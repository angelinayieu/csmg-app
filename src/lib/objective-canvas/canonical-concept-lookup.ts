// ── Canonical Concept Lookup ───────────────────────────────────────
//
// Cross-space read path for the KG concept registry. Before the
// decompose LLM call generates a sub-objective set, we look up which
// canonical concepts (from the user's prior spaces) are semantically
// similar to the current objective text. The LLM gets those concepts
// as a "you've already explored these — link or diverge" block.
//
// Flow:
//   1. Embed the objective text via memory/retrieve.
//   2. Query memory_items (entity kind only) for top-K similar
//      entities owned by the user.
//   3. Resolve those entity ids → canonical_concept_id via the
//      entities table.
//   4. Group by canonical_concept_id (one concept can be linked by
//      many entities; we want the concept, not the duplicates).
//   5. Fetch the canonical_concepts rows for display.
//   6. Return ranked by aggregate similarity.
//
// Returns the empty array on any failure — the decompose call falls
// through to lens-only / objective-only prompting. Logging is the
// telemetry; the user-visible flow never breaks.

import { retrieve } from "@/lib/memory/retrieve";

export interface RelevantCanonicalConcept {
  /** canonical_concepts.id (uuid). The KG's stable concept handle. */
  id: string;
  /** Deterministic slug — what the matcher uses to dedupe. */
  canonical_code: string;
  /** Human-readable name for display. */
  display_name: string;
  /** Short description for the prompt block — what the concept means. */
  description: string | null;
  /** Domain tags (e.g., ["health", "behavior"]) — useful for the
   *  LLM to gauge whether this concept is a stretch or a natural fit. */
  domain_tags: string[];
  /** Verification state — "verified" concepts have higher trust. */
  status: string;
  /** Cross-space evidence: how many of the user's spaces have entities
   *  linked to this concept. Higher = stronger "you've used this
   *  thinking before" signal. */
  space_count: number;
  /** Best (highest) memory-similarity score across the entities that
   *  link to this concept. 0..1. Used for ranking. */
  best_similarity: number;
}

export interface LoadRelevantCanonicalConceptsArgs {
  /** Already-authed supabase client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  /** Required for memory retrieval — RPC is owner-scoped. */
  userId: string;
  /** The text we're searching against (typically the parent objective). */
  queryText: string;
  /** Optional scope — when searching for sub-objective decompose,
   *  pass the current space_id so the retrieval can EXCLUDE
   *  entities from THIS space (we want concepts from PRIOR spaces,
   *  not the one we're decomposing). Optional — when omitted,
   *  retrieval includes current-space concepts too. */
  excludeSpaceId?: string;
  /** Max canonical concepts to return after dedup + ranking. The
   *  caller cap matters for prompt-token budget — keep ≤10. */
  limit?: number;
}

export async function loadRelevantCanonicalConcepts(
  args: LoadRelevantCanonicalConceptsArgs,
): Promise<RelevantCanonicalConcept[]> {
  const { db, userId, queryText, excludeSpaceId, limit = 8 } = args;
  if (queryText.trim().length < 8) return [];

  // ── 1+2. Embed + similarity search ──
  // Overfetch to allow canonical-concept dedup to still yield `limit`
  // distinct concepts.
  let hits;
  try {
    hits = await retrieve(db, {
      owner_id: userId,
      query_text: queryText,
      k: limit * 4,
      // We only care about entity-kind memory items — those are what
      // link to canonical_concepts via the entities table.
      kinds: ["entity"],
      min_salience: 0,
    });
  } catch (err) {
    console.warn(
      "[canonical-concept-lookup] retrieve threw:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
  if (hits.length === 0) return [];

  // ── 3. Resolve entity ids → canonical_concept_id ──
  // memory_items.ref_id is the entity id for kind=entity rows.
  // MemoryHit shape: { item: MemoryItem, similarity: number }.
  const entityIds = hits
    .map((h) => h.item.ref_id)
    .filter((id): id is string => typeof id === "string");
  if (entityIds.length === 0) return [];

  const { data: entityRows, error: entityErr } = await db
    .from("entities")
    .select("id, space_id, canonical_concept_id")
    .in("id", entityIds);
  if (entityErr) {
    console.warn(
      "[canonical-concept-lookup] entity lookup failed:",
      entityErr.message,
    );
    return [];
  }
  const entities = ((entityRows ?? []) as Array<{
    id: string;
    space_id: string;
    canonical_concept_id: string | null;
  }>) ?? [];

  // Best similarity per entity id — we'll project it onto the
  // canonical_concept_id after dedup. MemoryHit.similarity is
  // 1-cosine_distance, ∈ [-1, 1]; clamp to [0, 1] for downstream
  // ranking arithmetic.
  const similarityByEntityId = new Map<string, number>();
  for (const h of hits) {
    if (typeof h.item.ref_id !== "string") continue;
    const sim = Math.max(0, Math.min(1, h.similarity));
    similarityByEntityId.set(h.item.ref_id, sim);
  }

  // ── 4. Group by canonical_concept_id (drop unlinked entities) ──
  // Also exclude entities from the current space when requested —
  // the user wants concepts from PRIOR spaces, not the one they're
  // actively decomposing.
  const conceptIdToBestSim = new Map<string, number>();
  for (const e of entities) {
    if (!e.canonical_concept_id) continue;
    if (excludeSpaceId && e.space_id === excludeSpaceId) continue;
    const sim = similarityByEntityId.get(e.id) ?? 0;
    const existing = conceptIdToBestSim.get(e.canonical_concept_id) ?? 0;
    if (sim > existing) {
      conceptIdToBestSim.set(e.canonical_concept_id, sim);
    }
  }
  if (conceptIdToBestSim.size === 0) return [];

  // ── 5. Fetch canonical_concepts rows ──
  const conceptIds = Array.from(conceptIdToBestSim.keys());
  const { data: conceptRows, error: conceptErr } = await db
    .from("canonical_concepts")
    .select(
      "id, canonical_code, display_name, description, domain_tags, status, space_count",
    )
    .in("id", conceptIds);
  if (conceptErr) {
    console.warn(
      "[canonical-concept-lookup] concept lookup failed:",
      conceptErr.message,
    );
    return [];
  }
  const concepts = ((conceptRows ?? []) as Array<{
    id: string;
    canonical_code: string;
    display_name: string;
    description: string | null;
    domain_tags: string[] | null;
    status: string;
    space_count: number | null;
  }>) ?? [];

  // ── 6. Materialize + rank ──
  const out: RelevantCanonicalConcept[] = concepts.map((c) => ({
    id: c.id,
    canonical_code: c.canonical_code,
    display_name: c.display_name,
    description: c.description,
    domain_tags: Array.isArray(c.domain_tags) ? c.domain_tags : [],
    status: c.status,
    space_count: typeof c.space_count === "number" ? c.space_count : 0,
    best_similarity: conceptIdToBestSim.get(c.id) ?? 0,
  }));

  // Rank: combined signal = best_similarity * (1 + log(space_count)).
  // A concept that's both semantically similar AND used across many
  // spaces ranks above either signal alone.
  out.sort((a, b) => {
    const aScore = a.best_similarity * (1 + Math.log(1 + a.space_count));
    const bScore = b.best_similarity * (1 + Math.log(1 + b.space_count));
    return bScore - aScore;
  });

  return out.slice(0, limit);
}

/** Render the relevant-concepts block for prompt injection. Returns
 *  empty string when no concepts found, so callers can template
 *  uniformly without conditional logic. */
export function buildPriorConceptsBlock(
  concepts: RelevantCanonicalConcept[],
): string {
  if (concepts.length === 0) return "";
  const lines: string[] = [
    "CONCEPTS YOU'VE ALREADY EXPLORED ACROSS YOUR SPACES",
    "(your cross-space knowledge graph — link or diverge):",
  ];
  concepts.forEach((c, i) => {
    const tags = c.domain_tags.length > 0 ? ` [${c.domain_tags.slice(0, 3).join(", ")}]` : "";
    const spaceEvidence = c.space_count > 1 ? ` · used in ${c.space_count} of your spaces` : "";
    lines.push(`  [${i + 1}] ${c.display_name}${tags}${spaceEvidence}`);
    if (c.description) {
      lines.push(`      ${c.description.slice(0, 180)}`);
    }
  });
  return `\n\n${lines.join("\n")}\n`;
}

/** Instruction block paired with the concepts block. Tells the LLM
 *  how to USE the prior concepts: prefer linking (reuse the exact
 *  display_name) when natural, prefer diverging (and explain why)
 *  when the new cut is genuinely different. */
export const PRIOR_CONCEPTS_RULE = `PRIOR-CONCEPTS RULE: If a proposal naturally uses one of the concepts above, REFERENCE ITS display_name verbatim in your title or summary so the post-insert matcher can link it across your KG. If you're DELIBERATELY proposing a divergent take on a concept above, NAME THE DIVERGENCE in your rationale (e.g., "diverges from prior 'cortisol-stress-loop' by treating cortisol as moderator, not mediator"). Don't reinvent concepts you've already named — that fragments your KG.`;
