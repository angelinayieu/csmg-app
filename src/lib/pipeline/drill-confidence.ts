// ── Drill confidence (D5b — docs/KG_DEPTH_CRITIQUE.md §9) ─────────────
//
// Pure-function module that decides "should we drill into entity X
// given its position in the KG and its depth in the current
// decomposition chain?" Replaces the static `MAX_DEPTH = 2` cap in
// src/components/canvas/hooks/use-recursive-decompose.ts.
//
// Pattern source: Microsoft GraphRAG DRIFT Search Figure 1 phase B
// (paper §3.x). They use a per-node confidence glyph at query time to
// decide expansion. We adapt it to BUILD time: the same idea, but the
// decision is "drill deeper to discover new entities" rather than
// "fan out to neighbors for retrieval."
//
// What's unique to us vs DRIFT:
//   - Confidence comes from STRATEGIZER signals (centrality,
//     convergence_count, agent_convergence_count, causal_depth,
//     outcome_alignment, user_controllable_lever) that already exist
//     in our system but weren't being used for drilling decisions.
//   - Lateral-at-depth: when sibling drills share convergence chains,
//     we expand laterally at the same depth before going deeper. This
//     implements the user's "broad-in-a-deep-way" pattern (see §7.1
//     of the critique). DRIFT only does plain depth-first.
//
// All inputs are read from the entity row directly; no LLM calls, no
// adjacency-graph traversal in this module. Cheap.

// ── Tunables ────────────────────────────────────────────────────────

/**
 * Hard ceiling regardless of confidence. Six layers of recursion is
 * already deeper than any prior MAX_DEPTH the codebase used (was 2);
 * we don't currently know if quality holds beyond 6 and the LLM cost
 * grows linearly per layer. Future work can lift this if data shows
 * confidence holds.
 */
export const ABSOLUTE_MAX_DRILL_DEPTH = 6;

/**
 * Below this confidence, we stop drilling. Empirically we want to
 * cut off well-defined "rabbit holes" (low signal, deep) but allow
 * keystone drills (high convergence, multiple agents triangulating).
 * 0.4 is a pragmatic threshold based on signal weights; tunable by
 * future telemetry.
 */
export const DRILL_CONFIDENCE_THRESHOLD = 0.4;

/**
 * Per-layer multiplier on confidence. After N drills the inherited
 * confidence is parent_quality * DECAY^N. With DECAY=0.78 and
 * threshold=0.4, a parent_quality of 0.85 lets us drill ~3 layers
 * before bottoming out (0.85 * 0.78³ ≈ 0.40), which matches the
 * "go to fundamentals" goal without being unbounded.
 */
export const DRILL_CONFIDENCE_DECAY = 0.78;

// ── Signal weights ──────────────────────────────────────────────────
//
// Mirrors the strategizer's signal weights but specialized for the
// "should we drill" question — biases toward signals that indicate
// "this node is a worthwhile root cause to explore." Convergence
// dominates because the signal docstring in space-strategizer/signals.ts
// explicitly names it as "the single strongest signal for Kaufman-style
// root-cause ranking."
//
// Weights sum to 1.0. Null inputs are treated as "no signal" (excluded
// from the weighted average rather than zeroing it out — preserves the
// "null is meaningful, not missing" semantics from signals.ts).

export const DRILL_SIGNAL_WEIGHTS = {
  centrality: 0.18,
  convergence_count: 0.25,
  agent_convergence_count: 0.15,
  causal_depth_normalized: 0.15,
  outcome_alignment: 0.17,
  user_controllable_lever: 0.10,
} as const;

// ── Signal input shape ──────────────────────────────────────────────

/**
 * Subset of strategizer signals relevant to drilling. All values in
 * [0,1] or null. Null = "not computed for this entity yet" (e.g.,
 * the root tracer hasn't run, or the entity isn't a why-chain
 * driver). Distinct from 0, which is a real "this signal opposes
 * drilling" answer.
 */
export interface DrillSignals {
  centrality: number | null;
  convergence_count: number | null;
  agent_convergence_count: number | null;
  causal_depth_normalized: number | null;
  outcome_alignment: number | null;
  user_controllable_lever: number | null;
}

/**
 * Extract drill signals directly from an entity row. The columns
 * needed (causal_depth, converges_chains, proposing_agents,
 * is_leverage_point, centrality_rank) all exist in the entities
 * schema after migrations 20260424_root_cause_trace.sql,
 * 20260424_agent_consensus.sql, and the original entity schema.
 *
 * `total_goal_count` and `total_agent_count` come from the route
 * caller (loaded once per drill, passed through). Pass 0 to
 * disable the corresponding signal.
 *
 * `target_outcome_entity_id` and `directed_outcome_hops` are
 * optional: when null/undefined, outcome_alignment returns null.
 */
export function extractDrillSignalsFromEntity(input: {
  entity: {
    id: string;
    causal_depth?: number | null;
    converges_chains?: string[] | null;
    proposing_agents?: string[] | null;
    centrality_rank?: number | null;
    is_leverage_point?: boolean | null;
  };
  total_goal_count: number;
  total_agent_count: number;
  target_outcome_entity_id?: string | null;
  /** Map entity_id → directed-causal hops to outcome. */
  directed_outcome_hops?: Map<string, number>;
  /** Cap for causal_depth normalization. Mirrors signals.ts CAUSAL_DEPTH_CAP. */
  causal_depth_cap?: number;
  /** For centrality normalization — pass max centrality_rank seen
   *  across the space's entities. We invert the rank because lower
   *  rank = more central. Pass 1 if no max known (signal returns null). */
  max_centrality_rank?: number;
}): DrillSignals {
  const {
    entity,
    total_goal_count,
    total_agent_count,
    target_outcome_entity_id,
    directed_outcome_hops,
    causal_depth_cap = 6,
    max_centrality_rank,
  } = input;

  // Centrality: rank → [0,1]. centrality_rank is 1-indexed (1 = most
  // central). Higher rank = less central. Normalize: 1 - (rank-1)/max.
  let centrality: number | null = null;
  if (
    typeof entity.centrality_rank === "number" &&
    entity.centrality_rank > 0 &&
    typeof max_centrality_rank === "number" &&
    max_centrality_rank > 0
  ) {
    centrality = clamp01(
      1 - (entity.centrality_rank - 1) / Math.max(1, max_centrality_rank),
    );
  }

  // Causal depth: depth/CAP, clamped. Mirrors signals.ts.
  let causal_depth_normalized: number | null = null;
  if (typeof entity.causal_depth === "number" && entity.causal_depth > 0) {
    causal_depth_normalized = clamp01(entity.causal_depth / causal_depth_cap);
  } else if (entity.causal_depth === 0) {
    causal_depth_normalized = 0; // entity IS the goal — not a root
  }

  // Convergence count: |converges_chains| / total_goal_count.
  let convergence_count: number | null = null;
  if (
    Array.isArray(entity.converges_chains) &&
    total_goal_count > 0
  ) {
    convergence_count = clamp01(
      entity.converges_chains.length / total_goal_count,
    );
  }

  // Agent convergence: |proposing_agents| / total_agent_count.
  let agent_convergence_count: number | null = null;
  if (
    Array.isArray(entity.proposing_agents) &&
    entity.proposing_agents.length > 0 &&
    total_agent_count > 0
  ) {
    agent_convergence_count = clamp01(
      entity.proposing_agents.length / total_agent_count,
    );
  }

  // Outcome alignment: 1 if entity IS the outcome; 1/(d+1) if upstream;
  // 0.02 (unreachable floor) when outcome exists but entity isn't on
  // the directed-causal path; null when no outcome.
  let outcome_alignment: number | null = null;
  if (target_outcome_entity_id) {
    if (target_outcome_entity_id === entity.id) {
      outcome_alignment = 1;
    } else if (directed_outcome_hops) {
      const d = directed_outcome_hops.get(entity.id);
      outcome_alignment = d === undefined ? 0.02 : clamp01(1 / (d + 1));
    }
  }

  // User-controllable lever: cheap proxy via is_leverage_point. The
  // strategizer's signal goes through driver_metadata; here we only
  // have the entity row, so we treat is_leverage_point as 1 and
  // unknown as null (not 0 — we don't have evidence it's external).
  let user_controllable_lever: number | null = null;
  if (entity.is_leverage_point === true) {
    user_controllable_lever = 1;
  } else if (entity.is_leverage_point === false) {
    user_controllable_lever = 0;
  }

  return {
    centrality,
    convergence_count,
    agent_convergence_count,
    causal_depth_normalized,
    outcome_alignment,
    user_controllable_lever,
  };
}

// ── Confidence computation ──────────────────────────────────────────

/**
 * Weighted average of available signals, ignoring nulls (renormalizing
 * weights over the present signals). Returns 0 when no signals are
 * available — drilling a totally-unobserved entity is gated by depth,
 * not signal-weighted confidence.
 */
export function computeParentQualityScore(signals: DrillSignals): number {
  let total = 0;
  let weightSum = 0;
  for (const key of Object.keys(DRILL_SIGNAL_WEIGHTS) as Array<
    keyof typeof DRILL_SIGNAL_WEIGHTS
  >) {
    const v = signals[key];
    if (v === null || v === undefined) continue;
    total += v * DRILL_SIGNAL_WEIGHTS[key];
    weightSum += DRILL_SIGNAL_WEIGHTS[key];
  }
  if (weightSum === 0) return 0;
  return clamp01(total / weightSum);
}

/**
 * Apply depth decay and threshold gate. Returns the decision payload
 * the API and hook both consume: the numeric confidence, the
 * stop reason (if any), and the boolean continue flag.
 *
 * Depth is the depth of the CHILD whose continuation we're deciding —
 * i.e. the depth at which we'd drill NEXT if continuing.
 */
export function decideDrillContinuation(input: {
  parent_quality_score: number;
  child_depth: number;
}): {
  confidence_to_continue: number;
  should_continue: boolean;
  stop_reason: null | "absolute_max_depth" | "below_confidence_threshold";
} {
  const { parent_quality_score, child_depth } = input;
  if (child_depth >= ABSOLUTE_MAX_DRILL_DEPTH) {
    return {
      confidence_to_continue: 0,
      should_continue: false,
      stop_reason: "absolute_max_depth",
    };
  }
  const decayed = clamp01(
    parent_quality_score *
      Math.pow(DRILL_CONFIDENCE_DECAY, Math.max(0, child_depth)),
  );
  if (decayed < DRILL_CONFIDENCE_THRESHOLD) {
    return {
      confidence_to_continue: decayed,
      should_continue: false,
      stop_reason: "below_confidence_threshold",
    };
  }
  return {
    confidence_to_continue: decayed,
    should_continue: true,
    stop_reason: null,
  };
}

// ── Lateral-at-depth detection ──────────────────────────────────────

/**
 * "Broad-in-a-deep-way" pattern. Given the parent entity that just
 * spawned children, find OTHER entities at the same depth that share
 * convergence chains with the parent — these are lateral siblings the
 * drilling should also visit at the same depth before going deeper.
 *
 * Implementation: an entity is a lateral sibling if its
 * `converges_chains` overlaps with the parent's by ≥ JACCARD_MIN.
 * Capped at MAX_LATERAL_SIBLINGS to keep fan-out bounded.
 *
 * Pure function; the caller queries the candidate-set and passes it.
 */
const LATERAL_JACCARD_MIN = 0.34;
const LATERAL_MAX_SIBLINGS = 4;

export function findLateralSiblings(input: {
  parent_converges_chains: string[];
  /** Entities at the same depth as the parent (excluding the parent itself). */
  candidates: Array<{
    id: string;
    converges_chains?: string[] | null;
  }>;
}): string[] {
  const { parent_converges_chains, candidates } = input;
  const parentSet = new Set(parent_converges_chains);
  if (parentSet.size === 0) return [];

  const scored: Array<{ id: string; jaccard: number }> = [];
  for (const c of candidates) {
    const cc = c.converges_chains;
    if (!Array.isArray(cc) || cc.length === 0) continue;
    const childSet = new Set(cc);
    const intersection = [...childSet].filter((x) => parentSet.has(x)).length;
    const union = new Set([...parentSet, ...childSet]).size;
    if (union === 0) continue;
    const j = intersection / union;
    if (j >= LATERAL_JACCARD_MIN) scored.push({ id: c.id, jaccard: j });
  }
  scored.sort((a, b) => b.jaccard - a.jaccard);
  return scored.slice(0, LATERAL_MAX_SIBLINGS).map((s) => s.id);
}

// ── Drill record (for decomposition_tree append) ────────────────────

/**
 * One row in the `pipeline_runs.decomposition_tree` JSONB array.
 * Append-only — see migration 20260610_decomposition_tree.sql.
 */
export interface DrillRecord {
  parent_entity_id: string;
  child_entity_id: string;
  child_entity_code: string;
  depth: number;
  confidence_to_continue: number;
  parent_quality_score: number;
  drilled_at: string;
  stop_reason:
    | null
    | "absolute_max_depth"
    | "below_confidence_threshold"
    | "no_children_returned";
  lateral_siblings?: string[];
}

// ── Internals ───────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
