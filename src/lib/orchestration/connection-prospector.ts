/**
 * Connection Prospector Agent
 *
 * Guarantees every entity is eventually assessed for connections against every
 * other entity. Addresses the "lazy connection formation" problem:
 *
 * Before: LLM only creates edges it happens to notice during decomposition.
 *         New entities may never be compared against older ones.
 *
 * Now: Periodic agent that:
 *   1. Picks the N entities with lowest `connection_search_count`
 *   2. For each, enumerates candidate pairs (excluding already-examined)
 *   3. Batches pairs through Haiku with a structured "any relationship?" prompt
 *   4. Records ALL checks in `pairwise_connection_checks` (even when no edge)
 *   5. Inserts proposed edges (confidence + dimension + reasoning)
 *   6. Increments `connection_search_count` on examined entities
 *
 * This is exhaustive over time: each scheduled tick chips away at the least-
 * examined pairs, so the (N choose 2) pair space is covered incrementally.
 */

import { llmJSON } from "@/lib/llm";
import type { Entity, Edge } from "@/types";

// ── Types ──

export interface ProspectorCandidate {
  entity_a_id: string;
  entity_b_id: string;
  entity_a_name: string;
  entity_b_name: string;
}

export interface ProspectorResult {
  /** Pair was examined — always recorded even if no edge */
  entity_a_id: string;
  entity_b_id: string;
  edge_found: boolean;
  relationship_type?: string;
  dimension?: Edge["dimension"];
  strength?: number;
  confidence?: number;
  polarity?: "positive" | "negative" | "neutral" | "conditional";
  /** LLM reasoning for the verdict — populated whether edge_found or not */
  reasoning?: string;
  /**
   * Which of the 9 edge dimensions the LLM explicitly considered on this pass.
   * An empty array means the LLM didn't enumerate dimensions (legacy / breadth scan).
   * A populated list of 9 means a full dimensional sweep.
   */
  dimensions_examined: string[];
  /**
   * When edge_found=false: the LLM's confidence that there truly is no edge.
   * 1.0 = certain; 0.5 = absence of evidence; 0 = would flip readily.
   */
  negative_confidence?: number;
  /** If no edge was found but one might emerge later: what would trigger revisit. */
  revisit_trigger?: string;
  /** Depth tier this check was performed at. 1=breadth_scan, 2=dimensional_sweep, 3=evidence_grounded, 4=user_validated. */
  examination_level: number;
}

export interface ProspectorRunSummary {
  pairs_examined: number;
  edges_proposed: number;
  entities_touched: string[];
  duration_ms: number;
}

// ── Canonical pair key (order-independent) ──

export function canonicalPairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

// ── Candidate selection ──

/**
 * Pick the N entities with the lowest connection_search_count, then enumerate
 * pairs between them and the rest of the space (capped at pairsPerRun).
 *
 * Excludes:
 *   - Self-pairs
 *   - Pairs where an edge already exists (either direction)
 *   - Pairs already in `pairwise_connection_checks` within the past `coolingOffHours`
 */
export function selectCandidatePairs(params: {
  entities: Entity[];
  edges: Edge[];
  recentlyCheckedPairKeys: Set<string>;
  entitiesToExamine: number;
  pairsPerRun: number;
  /** Entity IDs that have open user questions attached — jump to front of queue.
   *  Connects user intent directly to prospector effort. */
  questionedEntityIds?: Set<string>;
  /**
   * Pairs previously examined whose `revisit_required` flag was set
   * (invalidate-coverage helper flips this when neighborhood topology
   * changes). These bypass the cooling-off filter and land at the
   * front of the candidate list so the prospector re-examines them on
   * the next pass. See supabase/migrations/20260521_pairwise_revisit_required.sql.
   */
  revisitPairs?: Array<{ entity_a_id: string; entity_b_id: string }>;
}): ProspectorCandidate[] {
  const { entities, edges, recentlyCheckedPairKeys, entitiesToExamine, pairsPerRun, questionedEntityIds, revisitPairs } = params;
  if (entities.length < 2) return [];

  // Build existing edge pair-key set (bidirectional)
  const edgePairKeys = new Set<string>();
  for (const e of edges) {
    edgePairKeys.add(canonicalPairKey(e.source_entity_id, e.target_entity_id));
  }

  // Name lookup for revisit pairs — the caller hands us entity ids
  // only, but ProspectorCandidate carries names for the LLM prompt.
  const nameById = new Map<string, string>();
  for (const e of entities) nameById.set(e.id, e.name);

  const candidates: ProspectorCandidate[] = [];
  const seenKeys = new Set<string>();

  // ── Revisit-flagged pairs go to the head of the queue ──
  // These are pairs the invalidation helper marked as stale because
  // new context (new neighbor entity, new dimension, surprise deviation)
  // may have flipped the prior verdict. Higher leverage per examine
  // than a fresh pair because we already know it's borderline.
  for (const rp of revisitPairs ?? []) {
    if (rp.entity_a_id === rp.entity_b_id) continue;
    const key = canonicalPairKey(rp.entity_a_id, rp.entity_b_id);
    if (seenKeys.has(key)) continue;
    if (edgePairKeys.has(key)) continue;  // edge now exists → no longer a pair to check
    const aName = nameById.get(rp.entity_a_id);
    const bName = nameById.get(rp.entity_b_id);
    if (!aName || !bName) continue;  // endpoint was deleted

    seenKeys.add(key);
    candidates.push({
      entity_a_id: rp.entity_a_id,
      entity_b_id: rp.entity_b_id,
      entity_a_name: aName,
      entity_b_name: bName,
    });
    if (candidates.length >= pairsPerRun) return candidates;
  }

  // Sort entities by (questioned first) → connection_search_count ASC → last_connection_search_at ASC (null first)
  // Questioned entities always jump to the front, because the user has explicitly expressed interest in them.
  const sorted = [...entities].sort((a, b) => {
    const aQ = questionedEntityIds?.has(a.id) ? 1 : 0;
    const bQ = questionedEntityIds?.has(b.id) ? 1 : 0;
    if (aQ !== bQ) return bQ - aQ; // questioned first

    const aCount = (a as Entity & { connection_search_count?: number }).connection_search_count ?? 0;
    const bCount = (b as Entity & { connection_search_count?: number }).connection_search_count ?? 0;
    if (aCount !== bCount) return aCount - bCount;

    const aTime = (a as Entity & { last_connection_search_at?: string | null }).last_connection_search_at;
    const bTime = (b as Entity & { last_connection_search_at?: string | null }).last_connection_search_at;
    if (aTime === null && bTime !== null) return -1;
    if (bTime === null && aTime !== null) return 1;
    if (aTime && bTime) return aTime.localeCompare(bTime);
    return 0;
  });

  const focusEntities = sorted.slice(0, entitiesToExamine);

  // For each focus entity, pair it with every other entity (pick diverse partners)
  for (const focus of focusEntities) {
    for (const other of entities) {
      if (focus.id === other.id) continue;
      const key = canonicalPairKey(focus.id, other.id);
      if (seenKeys.has(key)) continue;
      if (edgePairKeys.has(key)) continue;
      if (recentlyCheckedPairKeys.has(key)) continue;

      seenKeys.add(key);
      candidates.push({
        entity_a_id: focus.id,
        entity_b_id: other.id,
        entity_a_name: focus.name,
        entity_b_name: other.name,
      });
      if (candidates.length >= pairsPerRun) return candidates;
    }
  }

  return candidates;
}

// ── LLM pairwise analysis (batched) ──

interface PairAnalysisResponse {
  results: Array<{
    pair_index: number;
    edge_found: boolean;
    relationship_type?: string;
    dimension?: Edge["dimension"];
    strength?: number;
    confidence?: number;
    polarity?: "positive" | "negative" | "neutral" | "conditional";
    reasoning?: string;
    dimensions_examined?: string[];
    negative_confidence?: number;
    revisit_trigger?: string;
  }>;
}

const DIMENSIONS = [
  "structural",
  "functional",
  "temporal",
  "causal",
  "correlational",
  "logical",
  "epistemic",
  "comparative",
  "agentive",
] as const;

const PROSPECTOR_SYSTEM = `You are a connection prospector for a knowledge graph. For each pair of entities, determine whether a meaningful relationship exists that is NOT yet in the graph.

DIMENSIONAL SWEEP — for every pair, you must EXPLICITLY consider all 9 relationship dimensions before concluding. Do not skip any:
  - structural   — one contains, is part of, or composes the other
  - functional   — one enables, implements, or performs a role for the other
  - temporal     — one precedes, follows, or is concurrent with the other
  - causal       — one causally affects the other (enabling or constraining)
  - correlational — they co-vary without clear causation
  - logical      — one entails, contradicts, or is equivalent to the other
  - epistemic    — one supports, refutes, or is evidence for the other
  - comparative  — one is a benchmark, alternative, or counterpart to the other
  - agentive     — one acts on the other, or both are acted on by a third party

Be rigorous: a "relationship" means the LINK is specific enough that the entities would be meaningfully coupled in reasoning about the space. Do NOT invent tenuous connections — it is OK (and common) to answer "no edge" for most pairs.

For each pair, output JSON with:
- pair_index: the number provided with the pair
- dimensions_examined: array of all 9 dimension names you considered (string array)
- edge_found: true only if a substantive, specific relationship exists in ANY of the 9 dimensions
- reasoning: 1-2 sentences describing what you found (or specifically why no dimension applies)

If edge_found=true, also provide:
  - relationship_type: short verb phrase (e.g. "constrains", "amplifies", "measures")
  - dimension: which of the 9 (use the strongest one if multiple apply)
  - strength: 0.0-1.0 (strength of the relationship)
  - confidence: 0.0-1.0 (your confidence in the relationship existing)
  - polarity: positive|negative|neutral|conditional

If edge_found=false, also provide:
  - negative_confidence: 0.0-1.0 — how certain are you no edge exists?
    - 0.9+ : entities are in entirely different domains with no plausible link
    - 0.6-0.9 : plausible link but no evidence found; absence of evidence
    - 0.3-0.6 : could easily flip with more context
    - 0-0.3 : genuinely uncertain — would readily revisit
  - revisit_trigger: OPTIONAL — if this verdict should be revisited, state what would trigger it (e.g. "if evidence on X domain appears" or "revisit after entity Y is decomposed"). Leave out if you're confidently no-edge.

Return JSON: { "results": [...] }`;

// ── Breadth-first screening (cheap plausibility pass) ──

interface BreadthScreenResponse {
  results: Array<{
    pair_index: number;
    plausible: "yes" | "maybe" | "no";
    hint?: string;
  }>;
}

const BREADTH_SCREEN_SYSTEM = `You are screening pairs of knowledge-graph entities for RELATIONSHIP PLAUSIBILITY. This is a coarse first pass — not a deep analysis.

For each pair, answer in ONE WORD whether a meaningful relationship (of any kind — structural, causal, temporal, etc.) plausibly exists:
  - "yes"   : almost certainly related; a deep analysis would find an edge
  - "maybe" : could go either way; deep analysis needed to decide
  - "no"    : almost certainly unrelated; no deep analysis needed

Also include a 4-8 word hint describing what relationship type seems most likely (for yes/maybe).

BIAS TOWARD "maybe": it's cheap for us to look closer at a maybe; it's expensive for us to miss a real edge by saying "no" too fast. Only say "no" when the entities are clearly in different universes.

Return JSON: { "results": [{ "pair_index": 0, "plausible": "maybe", "hint": "both about data retention" }, ...] }`;

/**
 * Cheap plausibility screening pass. Takes N pairs, returns those where the
 * LLM thinks there MIGHT be a relationship (plausible = "yes" or "maybe").
 *
 * This is Phase B's breadth-first discipline: before spending expensive
 * 9-dimension analysis tokens on a pair, spend ~5% of that to rule out
 * pairs where no serious deep-dive is warranted.
 *
 * Roughly 15-25× cheaper per pair than the full dimensional sweep.
 */
export async function screenPairsForPlausibility(
  candidates: ProspectorCandidate[],
  entityContextById: Map<string, { name: string; type: string; description: string | null; category: string }>,
): Promise<{
  plausible: ProspectorCandidate[];
  implausible: ProspectorCandidate[];
  screening_summary: Array<{ candidate: ProspectorCandidate; plausible: "yes" | "maybe" | "no"; hint?: string }>;
}> {
  if (candidates.length === 0) {
    return { plausible: [], implausible: [], screening_summary: [] };
  }

  // Compact rendering — name + category only, no description (keeps tokens cheap)
  const pairsText = candidates
    .map((c, i) => {
      const a = entityContextById.get(c.entity_a_id);
      const b = entityContextById.get(c.entity_b_id);
      return `${i}. ${c.entity_a_name} (${a?.category ?? "?"}) ↔ ${c.entity_b_name} (${b?.category ?? "?"})`;
    })
    .join("\n");

  let response: BreadthScreenResponse;
  try {
    response = await llmJSON<BreadthScreenResponse>({
      system: BREADTH_SCREEN_SYSTEM,
      user: `Screen these ${candidates.length} pairs for plausibility:\n\n${pairsText}\n\nReturn JSON with "results".`,
      maxTokens: 1024,
      temperature: 0.1,
      model: "gpt-4o-mini",
    });
  } catch {
    // If screening fails, default to "all maybe" — pessimistic toward deep-analysis cost but safe
    const allMaybe = candidates.map((c) => ({ candidate: c, plausible: "maybe" as const }));
    return { plausible: candidates, implausible: [], screening_summary: allMaybe };
  }

  const verdictByIndex = new Map<number, { plausible: "yes" | "maybe" | "no"; hint?: string }>();
  for (const r of response.results ?? []) {
    if (typeof r.pair_index !== "number") continue;
    const v = r.plausible === "yes" || r.plausible === "no" || r.plausible === "maybe" ? r.plausible : "maybe";
    verdictByIndex.set(r.pair_index, { plausible: v, hint: r.hint });
  }

  const plausible: ProspectorCandidate[] = [];
  const implausible: ProspectorCandidate[] = [];
  const screening_summary: Array<{ candidate: ProspectorCandidate; plausible: "yes" | "maybe" | "no"; hint?: string }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const verdict = verdictByIndex.get(i) ?? { plausible: "maybe" as const };
    screening_summary.push({ candidate: candidates[i], ...verdict });
    if (verdict.plausible === "no") {
      implausible.push(candidates[i]);
    } else {
      plausible.push(candidates[i]);
    }
  }

  return { plausible, implausible, screening_summary };
}

export async function prospectPairwiseConnections(
  candidates: ProspectorCandidate[],
  entityContextById: Map<string, { name: string; type: string; description: string | null; category: string }>,
): Promise<ProspectorResult[]> {
  if (candidates.length === 0) return [];

  // Build the user message listing all pairs
  const pairsText = candidates
    .map((c, i) => {
      const a = entityContextById.get(c.entity_a_id);
      const b = entityContextById.get(c.entity_b_id);
      return `Pair ${i}:
  A: ${c.entity_a_name} (${a?.type ?? "?"}, ${a?.category ?? "?"})${a?.description ? ` — ${a.description.slice(0, 160)}` : ""}
  B: ${c.entity_b_name} (${b?.type ?? "?"}, ${b?.category ?? "?"})${b?.description ? ` — ${b.description.slice(0, 160)}` : ""}`;
    })
    .join("\n\n");

  const response = await llmJSON<PairAnalysisResponse>({
    system: PROSPECTOR_SYSTEM,
    user: `Analyze these ${candidates.length} pairs for potential relationships:\n\n${pairsText}\n\nReturn JSON with "results" array.`,
    maxTokens: 4096,
    temperature: 0.2,
    model: "gpt-4o-mini",
  });

  const results: ProspectorResult[] = [];
  const seen = new Set<number>();
  for (const r of response.results ?? []) {
    if (seen.has(r.pair_index)) continue;
    seen.add(r.pair_index);
    const candidate = candidates[r.pair_index];
    if (!candidate) continue;

    // Validate dimension
    const dim = r.dimension && (DIMENSIONS as readonly string[]).includes(r.dimension) ? r.dimension : undefined;

    // Validate dimensions_examined: keep only known dimensions
    const dimsExamined = Array.isArray(r.dimensions_examined)
      ? r.dimensions_examined.filter((d): d is string =>
          typeof d === "string" && (DIMENSIONS as readonly string[]).includes(d),
        )
      : [];

    // Infer examination level from LLM output:
    //   level 2 (dimensional_sweep) when 7+ dimensions were explicitly considered
    //   level 1 (breadth_scan) otherwise
    const examinationLevel = dimsExamined.length >= 7 ? 2 : 1;

    const negConf =
      r.edge_found
        ? undefined
        : typeof r.negative_confidence === "number"
          ? Math.max(0, Math.min(1, r.negative_confidence))
          : undefined;

    results.push({
      entity_a_id: candidate.entity_a_id,
      entity_b_id: candidate.entity_b_id,
      edge_found: Boolean(r.edge_found && dim && r.relationship_type),
      relationship_type: r.relationship_type,
      dimension: dim,
      strength: typeof r.strength === "number" ? Math.max(0, Math.min(1, r.strength)) : undefined,
      confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : undefined,
      polarity: r.polarity,
      reasoning: r.reasoning,
      dimensions_examined: dimsExamined,
      negative_confidence: negConf,
      revisit_trigger: r.revisit_trigger && typeof r.revisit_trigger === "string" ? r.revisit_trigger : undefined,
      examination_level: examinationLevel,
    });
  }

  // Record "no edge found" results for pairs that had no entry in response
  for (let i = 0; i < candidates.length; i++) {
    if (seen.has(i)) continue;
    // LLM dropped this pair entirely — mark as breadth-scan with unknown verdict
    results.push({
      entity_a_id: candidates[i].entity_a_id,
      entity_b_id: candidates[i].entity_b_id,
      edge_found: false,
      dimensions_examined: [],
      examination_level: 1,
      negative_confidence: 0.3, // low — we didn't actually hear back
      reasoning: "Pair was submitted but LLM did not return a verdict; treat as unresolved.",
    });
  }

  return results;
}
