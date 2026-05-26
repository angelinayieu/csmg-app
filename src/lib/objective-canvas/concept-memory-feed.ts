// ── Concept Memory Feed ────────────────────────────────────────────
//
// Ambient view of the user's top canonical concepts by recent
// activity. Powers a small strip on the main canvas that surfaces
// "concepts you've been actively reasoning across" without requiring
// any objective-specific query.
//
// Unlike loadRelevantCanonicalConcepts (which is similarity-scoped
// to a query text), this returns the user's most-active concepts
// PERIOD — ordered by recency of entity links + cross-space spread.
//
// Used by the main canvas page (server-rendered once on load) to
// give the user a sense of their cross-space accumulation outside
// of any specific picker / drawer context.

export interface ConceptMemoryEntry {
  id: string;
  canonical_code: string;
  display_name: string;
  description: string | null;
  domain_tags: string[];
  /** Total entities the user has across all spaces linked to this. */
  entity_count: number;
  /** Distinct spaces of the user's that touch this concept. */
  space_count: number;
  /** Last touch timestamp — drives recency weighting. */
  last_seen_at: string | null;
}

export interface LoadConceptMemoryArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  userId: string;
  /** How many concepts to surface in the feed. Default 8 — small
   *  enough for a single-row chip strip on the canvas. */
  limit?: number;
}

/** Compute the user's top concepts by activity. We start from the
 *  USER's entities (only their own KG), aggregate by
 *  canonical_concept_id, then rank by combined recency + spread.
 *
 *  Two queries:
 *    1. entities → (canonical_concept_id, space_id, updated_at) joined
 *       to space ownership. We use updated_at on entities as the
 *       recency proxy.
 *    2. canonical_concepts → row data for the top-K ids.
 *
 *  Soft-fail throughout. Returns [] on any failure so the feed strip
 *  hides gracefully. */
export async function loadConceptMemoryFeed(
  args: LoadConceptMemoryArgs,
): Promise<ConceptMemoryEntry[]> {
  const { db, userId, limit = 8 } = args;

  // ── 1. Resolve the user's space_ids first (one cheap query) so the
  //    entities pull can scope correctly. RLS would gate this server-
  //    side too but explicit scoping keeps the query bounded. ──
  const { data: spaceRows, error: spaceErr } = await db
    .from("spaces")
    .select("id")
    .eq("user_id", userId);
  if (spaceErr) {
    console.warn(
      "[concept-memory-feed] space lookup failed:",
      spaceErr.message,
    );
    return [];
  }
  const spaceIds = ((spaceRows ?? []) as Array<{ id: string }>).map(
    (s) => s.id,
  );
  if (spaceIds.length === 0) return [];

  // ── 2. Entities → canonical link counts. Pull (canonical_concept_id,
  //    space_id, updated_at) for ALL the user's entities that have a
  //    canonical link. Aggregate client-side: cheap because the user's
  //    own KG isn't large enough to warrant an RPC. ──
  const { data: entityRows, error: entityErr } = await db
    .from("entities")
    .select("canonical_concept_id, space_id, updated_at")
    .in("space_id", spaceIds)
    .not("canonical_concept_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(2000); // generous cap; user-scoped queries are bounded
  if (entityErr) {
    console.warn(
      "[concept-memory-feed] entity lookup failed:",
      entityErr.message,
    );
    return [];
  }
  const entities = ((entityRows ?? []) as Array<{
    canonical_concept_id: string;
    space_id: string;
    updated_at: string;
  }>) ?? [];
  if (entities.length === 0) return [];

  // Aggregate: per canonical concept, count entities + distinct spaces,
  // track most-recent updated_at.
  type Agg = {
    entity_count: number;
    space_ids: Set<string>;
    last_seen_at: string;
  };
  const aggByConceptId = new Map<string, Agg>();
  for (const e of entities) {
    const cell = aggByConceptId.get(e.canonical_concept_id) ?? {
      entity_count: 0,
      space_ids: new Set<string>(),
      last_seen_at: e.updated_at,
    };
    cell.entity_count += 1;
    cell.space_ids.add(e.space_id);
    if (e.updated_at > cell.last_seen_at) {
      cell.last_seen_at = e.updated_at;
    }
    aggByConceptId.set(e.canonical_concept_id, cell);
  }

  // Rank: recency × log(1 + cross-space spread). A concept touched
  // recently AND across multiple spaces ranks highest. Compute a
  // ranking score per concept, then sort.
  const nowMs = Date.now();
  const decayHalfLifeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
  const scored: Array<{ id: string; score: number }> = [];
  for (const [conceptId, cell] of aggByConceptId.entries()) {
    const ageMs = nowMs - new Date(cell.last_seen_at).getTime();
    // Recency multiplier: 1 at age=0, ~0.5 at age=30 days, ~0.25 at 60d.
    const recency = Math.pow(0.5, ageMs / decayHalfLifeMs);
    const spread = 1 + Math.log(1 + cell.space_ids.size);
    scored.push({ id: conceptId, score: recency * spread });
  }
  scored.sort((a, b) => b.score - a.score);
  const topIds = scored.slice(0, limit).map((s) => s.id);
  if (topIds.length === 0) return [];

  // ── 3. Fetch canonical_concepts rows for the top-K. ──
  const { data: conceptRows, error: conceptErr } = await db
    .from("canonical_concepts")
    .select(
      "id, canonical_code, display_name, description, domain_tags, last_seen_at",
    )
    .in("id", topIds);
  if (conceptErr) {
    console.warn(
      "[concept-memory-feed] concept lookup failed:",
      conceptErr.message,
    );
    return [];
  }
  const conceptById = new Map<
    string,
    {
      id: string;
      canonical_code: string;
      display_name: string;
      description: string | null;
      domain_tags: string[] | null;
      last_seen_at: string | null;
    }
  >();
  for (const c of (conceptRows ?? []) as Array<{
    id: string;
    canonical_code: string;
    display_name: string;
    description: string | null;
    domain_tags: string[] | null;
    last_seen_at: string | null;
  }>) {
    conceptById.set(c.id, c);
  }

  // ── 4. Materialize in ranked order. ──
  const out: ConceptMemoryEntry[] = [];
  for (const id of topIds) {
    const c = conceptById.get(id);
    if (!c) continue;
    const agg = aggByConceptId.get(id)!;
    out.push({
      id: c.id,
      canonical_code: c.canonical_code,
      display_name: c.display_name,
      description: c.description,
      domain_tags: Array.isArray(c.domain_tags) ? c.domain_tags : [],
      entity_count: agg.entity_count,
      space_count: agg.space_ids.size,
      last_seen_at: agg.last_seen_at,
    });
  }
  return out;
}
