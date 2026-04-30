// ── Signal extractors — deterministic, cheap, transparent ────────────
//
// Every signal is:
//   1. Deterministic — same inputs → same output. Testable, replayable.
//   2. Cheap — O(|V|+|E|) worst case. No LLM calls. No RPCs except the
//      coverage-gap one (one query, batched upstream).
//   3. Normalized — every output lives in [0,1]. Null means "not
//      applicable to this candidate" — meaningful, not missing.
//   4. Interpretable — each signal has a one-sentence "what high
//      means" docstring so the planner LLM can reason over them.
//
// The rigor of the whole strategizer rests on these signals being
// *accurate*. A signal that lies consistently moves the planner in
// the wrong direction and burns tokens generating bad spaces. Every
// signal here has a defensive implementation: clamp to [0,1], ignore
// NaN, fall back to null rather than fabricate.

import type {
  Entity,
  Edge,
} from "@/types";
import type { NodeSignature } from "@/types/node-signature";
import type { SignalProfile, SpaceWorkKind } from "@/types/space-plan";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";
import type { AgentId } from "@/lib/agents/registry";

// ── Input bundle — everything the signal pass needs ───────────────────
//
// Gathered once per plan cycle. Signals read from this bundle rather
// than re-querying, so the whole signal pass is O(candidates × signals)
// without any I/O. The orchestrator is responsible for constructing
// the bundle before calling into signals.

export interface SignalInputBundle {
  entities: Entity[];
  edges: Edge[];
  /** Entity id → node signature (from `entities.node_signature` JSONB). */
  signatures: Map<string, NodeSignature>;
  /** Entity ids flagged as improvement_goals. */
  goal_entity_ids: Set<string>;
  /** From high_value_uncovered_pairs RPC — set of "sourceId:targetId"
   *  keys (sorted order). Binary signal. */
  coverage_gap_pairs: Set<string>;
  /** Per-axis historical prospector acceptance rate in [0,1]. Empty
   *  map = no history; axis candidates get null for this signal. */
  axis_calibration: Map<ProbabilitySpaceAxis, number>;
  /** Intersection counts per entity id (from existing SpaceIntersection
   *  data). Used to derive `intersection_density`. */
  intersection_touches: Map<string, number>;
  /** Precomputed betweenness approximation per entity id (0..1 norm). */
  centrality: Map<string, number>;
  /** Precomputed shortest-path-to-goal per entity id (hop count, -1 if
   *  unreachable). */
  goal_hops: Map<string, number>;
  /** Precomputed undirected graph distance between any two entity ids,
   *  for novelty. Lazy — populated on first query. */
  distance_cache: Map<string, number>;
  /** Adjacency as Map<entityId, Set<entityId>> for distance lookups. */
  adjacency: Map<string, Set<string>>;
  /** Root-trace output per entity id. Populated by loadSignalBundle
   *  from entities.causal_depth + .converges_chains. Missing = entity
   *  wasn't reached by the last backward trace (or trace never ran). */
  root_trace: Map<
    string,
    {
      causal_depth: number;       // 0 = goal, N = N hops upstream
      converges_chains: string[]; // goal ids reaching this entity
    }
  >;
  /** Total goal count in the space at trace time. Used as denominator
   *  for convergence_count normalization. 0 if no goals were set. */
  total_goal_count: number;
  /** Per-entity set of canonical agent ids that independently proposed
   *  this entity. Derived by loadSignalBundle from entities.provenance
   *  + entities.proposing_agents via agents/registry.ts. Missing entry
   *  = no extractable agent signal (not "zero agents" — null in the
   *  downstream signal). */
  agent_proposed_entities: Map<string, Set<AgentId>>;
  /** Total ensemble size used as the denominator for agent_convergence_count
   *  normalization. Typically equals the count of distinct canonical agents
   *  that wrote ANY entity in the space (not the global AGENT_IDS.length,
   *  which would unfairly deflate scores in small pipelines). 0 ⇒ signal
   *  returns null. */
  total_agent_count: number;
  /** Per-entity lever metadata derived from the why-chain deepener's
   *  provenance stamp. Populated by loadSignalBundle when the entity has
   *  `entity_type="causal_driver"` AND `provenance.source="why_chain"`.
   *  Entities that are NOT drivers don't appear in this map; the signal
   *  extractor treats them as null (not a driver — no opinion).
   *
   *  Separate from the `agent_proposed_entities` map because they answer
   *  different questions: agents-map = "who reasoned about this node?",
   *  driver-map = "is this node an actionable root cause?" */
  driver_metadata: Map<
    string,
    {
      /** Driver is user_controllable vs external/continue/speculative. */
      is_user_controllable: boolean;
    }
  >;
  /** D3 (docs/KG_DEPTH_CRITIQUE.md §9): per-entity controllability
   *  KIND derived from `entity.manifold.operational.controllability.kind`.
   *  Populated by loadSignalBundle for every entity that has the
   *  field set, regardless of whether the entity is a why-chain
   *  driver. This map is the GRADIENT companion to driver_metadata
   *  (which is binary): when an entity has both, driver_metadata
   *  wins for back-compat; when only this map has signal, the
   *  user_controllable_lever signal falls back to the kind enum
   *  with full=1.0, partial=0.6, gated=0.4, observable_only=0.
   *  Missing entries → no opinion (signal returns null). */
  controllability_kind_by_entity: Map<
    string,
    "fully_controllable" | "partially_controllable" | "gated" | "observable_only"
  >;
  /** D3 phase 3 — per-entity cost summary derived from
   *  `manifold.operational.controllability.intervention_cost` +
   *  `opportunity_cost` + `cost_kind`. The cost-efficiency signal
   *  consumes this; missing entries return null (no opinion).
   *
   *  `dominant_cost` chooses the relevant USD figure for ranking:
   *    - opportunity_cost.estimate when cost_kind="opportunity_dominated"
   *      AND opportunity_cost is set
   *    - intervention_cost.estimate * 12 (annualized) when
   *      recurrence="recurring_monthly", or *1 when "yearly", or *24
   *      (rough multiplier) when "recurring_continuous"
   *    - intervention_cost.estimate as-is for "one_time"
   *
   *  `is_sunk` short-circuits the signal to 1.0 (sunk costs don't
   *  penalize future decisions). */
  controllability_cost_by_entity: Map<
    string,
    {
      dominant_cost: number;
      is_sunk: boolean;
      kind:
        | "direct"
        | "opportunity_dominated"
        | "coordination_dominated"
        | "risk_adjusted_dominated"
        | "switching_dominated"
        | "hidden_externalities";
    }
  >;
  /** D3 phase 3 — user-set cost budget from
   *  `spaces.reasoning_settings.costBudget`. When set, the
   *  cost-efficiency signal scores levers RELATIVE to this ceiling
   *  rather than the space's empirical cost distribution. Null when
   *  the user hasn't specified a budget — signal falls back to
   *  inverse-log normalized to space-wide max cost. */
  cost_budget: number | null;
  /** D3 phase 3 — strictness mode for cost_budget. When "hard",
   *  candidates whose dominant_cost exceeds cost_budget are
   *  excluded from enumeration entirely. When "soft" (default),
   *  they get a low cost_efficiency score but stay in the ranker
   *  pool — user always sees alternatives even when budget-tight. */
  cost_budget_strictness: "soft" | "hard";
  /** Phase 3 §4.3 — entity id that the target-outcome extractor resolved
   *  the focal outcome to. Null when no outcome was extracted from the
   *  input text, OR when the extracted outcome couldn't be resolved to
   *  any entity in the KG (jaccard similarity below threshold). The
   *  outcome_alignment signal returns null whenever this is null —
   *  there's nothing to be aligned WITH.
   *
   *  Distinct from goal_entity_ids: improvement_goals are user-flagged
   *  long-term metrics (often plural, broad); target_outcome is the
   *  SINGLE focal lever the run is about, derived from this run's
   *  input text. They can disagree, and when they do the outcome wins
   *  for THIS run because it's what the user actually asked. */
  target_outcome_entity_id: string | null;
  /** Phase 3 §4.3 — direction the user wants the outcome to move
   *  ("maximize" / "minimize" / "maintain"). Carried through for
   *  downstream consumption (insight-type tagging, rendering); the
   *  proximity-based outcome_alignment signal itself doesn't use it.
   *  Null when no outcome was extracted. */
  outcome_direction: "maximize" | "minimize" | "maintain" | null;
  /** Phase 4 §5.2 — directed-causal upstream hops from each entity to
   *  the resolved focal outcome. Computed by reverse-BFS from the
   *  outcome along the directed causal subgraph (edges traversed in
   *  reverse). Map entry presence means "this entity is on a directed
   *  path that reaches the outcome"; absence means "no directed causal
   *  route" (signal returns the unreachable floor 0.02).
   *
   *  This replaces the v1 undirected approximation that walked the
   *  symmetric adjacency. Directed semantics matter because "near the
   *  outcome" and "upstream of the outcome" are different questions:
   *  a downstream effect of the outcome is graph-adjacent but not a
   *  lever to move it. Empty map when no outcome was resolved. */
  directed_outcome_hops: Map<string, number>;
  /** Phase 4 §5.1 — extracted target-outcome time horizon
   *  ("immediate" / "short_term" / "medium_term" / "long_term") used
   *  to flex ranker weights. The strategizer derives multiplicative
   *  weight overrides from this — e.g. a long-horizon outcome boosts
   *  causal_depth + convergence (we have time for upstream root-cause
   *  work), while an immediate horizon boosts user_controllable_lever
   *  + goal_proximity (the user needs an actionable move now, not a
   *  philosophical root cause). Null when no outcome was extracted or
   *  the horizon was unspecified — the modulator is a no-op in that
   *  case. */
  outcome_horizon: "immediate" | "short_term" | "medium_term" | "long_term" | null;
  /** D4 — Per-entity count of emergent interactions the entity
   *  participates in (rows in `reactions` with reaction_type='emergent'
   *  produced by src/lib/pipeline/interaction-discovery.ts). Populated
   *  by loadSignalBundle scanning the `reactions` table once per plan
   *  cycle.
   *
   *  Empty map = interaction discovery hasn't run yet OR no emergent
   *  interactions detected. Missing entry for a specific entity = 0
   *  interactions (signal returns null, not 0 — "no opinion" semantics
   *  match the rest of the bundle's null-handling). */
  interaction_counts: Map<string, number>;
  /** D6 phase 2 — per-entity sum of |delta_strength| + |delta_confidence|
   *  across recent edge_calibrations rows on edges incident to the
   *  entity. Populated by loadSignalBundle scanning the
   *  edge_calibrations table for rows applied within
   *  `calibration_drift_window_days` (default 30).
   *
   *  Higher values = the local model around this entity has been
   *  actively recalibrated by reality-checks (predictions resolving).
   *  The strategizer can use this to surface "stale model regions" —
   *  entities whose model has been actively shifting and may benefit
   *  from fresh decomposition or user review. Null when no recent
   *  calibrations affect the entity (clean signal, not penalty). */
  calibration_drift_by_entity: Map<string, number>;
  /** Phase 5 — per-entity sum of |temporal_delta_days| across recent
   *  edge_calibrations rows on edges incident to the entity. Sourced
   *  from the resolver-driven path_aware_temporal_v1 calibrator
   *  (resolve-prediction.ts); only rows with non-null
   *  temporal_delta_days contribute.
   *
   *  Higher values = the entity's TIMING claims have been actively
   *  shifting under reality-checks. Distinct from
   *  calibration_drift_by_entity (which captures magnitude/confidence
   *  drift). The two surface different problems: high magnitude drift
   *  = "we got the size wrong"; high temporal drift = "we got the
   *  timing wrong." Both signal "stale model region" but for
   *  different reasons.
   *
   *  Null/missing entries handled with the same null semantics as
   *  the magnitude version. */
  calibration_drift_temporal_by_entity: Map<string, number>;
  /** Phase 4 — per-entity temporal summary of the shortest directed
   *  path from the entity to the focal outcome. Computed by
   *  `computeUpstreamTemporalSummaries` in one reverse-BFS sweep
   *  alongside `directed_outcome_hops`. Drives the four temporal
   *  signals (time_to_outcome, persistence_match, onset_alignment,
   *  temporal_heterogeneity_penalty).
   *
   *  Empty map when no focal outcome is set. Missing entry for an
   *  entity = entity isn't on a directed path to the outcome (signal
   *  returns null, not 0 — "no opinion" semantics).
   *
   *  Field semantics on each entry:
   *    total_peak_days     — sum of peak_days_p50 along the path to
   *                          outcome (the "time to outcome" via this
   *                          path; null when ANY edge on path lacks
   *                          peak_days_p50).
   *    first_onset_days    — onset_days_p50 of the FIRST edge from
   *                          this entity (the "when does the FIRST
   *                          measurable change happen" answer).
   *    min_persistence_days — min persistence along the path (the
   *                          weakest link in effect duration).
   *    mean_i2             — mean I² across path edges that have it
   *                          (heterogeneity across pooled studies).
   *    edges_with_temporal — count of path edges with ANY temporal
   *                          data (used as confidence floor).
   *    edges_total         — total path edges (denominator for
   *                          coverage). */
  temporal_path_summaries: Map<string, UpstreamTemporalSummary>;
  /** Phase 4 — user's deadline expressed as days. Derived from
   *  outcome_horizon by loadSignalBundle (immediate=14, short_term=90,
   *  medium_term=365, long_term=730). When null, the time-aware
   *  signals fall back to a horizon-agnostic normalization. */
  horizon_days: number | null;
}

/** Per-entity temporal summary along the shortest directed path to
 *  the focal outcome. See SignalInputBundle.temporal_path_summaries. */
export interface UpstreamTemporalSummary {
  total_peak_days: number | null;
  first_onset_days: number | null;
  min_persistence_days: number | null;
  mean_i2: number | null;
  edges_with_temporal: number;
  edges_total: number;
}

// ── Utilities ─────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function distanceKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** BFS distance between two entity ids, memoized in bundle.distance_cache.
 *  Returns -1 if unreachable. */
export function graphDistance(
  bundle: SignalInputBundle,
  a: string,
  b: string,
): number {
  if (a === b) return 0;
  const key = distanceKey(a, b);
  const hit = bundle.distance_cache.get(key);
  if (hit !== undefined) return hit;

  const visited = new Set<string>([a]);
  let frontier: string[] = [a];
  let depth = 0;
  while (frontier.length > 0 && depth < 10) {
    const next: string[] = [];
    for (const node of frontier) {
      const neighbors = bundle.adjacency.get(node);
      if (!neighbors) continue;
      for (const n of neighbors) {
        if (n === b) {
          bundle.distance_cache.set(key, depth + 1);
          return depth + 1;
        }
        if (!visited.has(n)) {
          visited.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
    depth += 1;
  }
  bundle.distance_cache.set(key, -1);
  return -1;
}

// ── Betweenness approximation ─────────────────────────────────────────
//
// Full Brandes betweenness is O(V·E). For graphs of a few hundred
// entities the full thing is fine, but we prefer a k-sampled approach
// here because the strategizer may run repeatedly per run. Samples k
// random pairs, counts node appearances on shortest paths, normalizes.
// Quality-per-cost is excellent for ranking (we only need relative
// order, not exact values).

export function computeCentralityApprox(
  entities: Entity[],
  adjacency: Map<string, Set<string>>,
  k: number = 64,
): Map<string, number> {
  const ids = entities.map((e) => e.id);
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, 0);
  if (ids.length < 3) return counts;

  const sampleCount = Math.min(k, ids.length * (ids.length - 1));
  for (let i = 0; i < sampleCount; i++) {
    const s = ids[Math.floor(Math.random() * ids.length)];
    let t = ids[Math.floor(Math.random() * ids.length)];
    while (t === s) t = ids[Math.floor(Math.random() * ids.length)];

    // BFS with parent tracking for shortest-path reconstruction
    const prev = new Map<string, string>();
    const visited = new Set<string>([s]);
    let frontier: string[] = [s];
    let found = false;
    while (frontier.length > 0 && !found) {
      const next: string[] = [];
      for (const node of frontier) {
        if (found) break;
        const neighbors = adjacency.get(node);
        if (!neighbors) continue;
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            prev.set(n, node);
            if (n === t) { found = true; break; }
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    if (!found) continue;

    // Walk back and increment intermediate nodes (exclude endpoints)
    let cur = prev.get(t);
    while (cur && cur !== s) {
      counts.set(cur, (counts.get(cur) ?? 0) + 1);
      cur = prev.get(cur);
    }
  }

  // Normalize to [0,1]
  let max = 0;
  for (const v of counts.values()) if (v > max) max = v;
  if (max === 0) return counts;
  const out = new Map<string, number>();
  for (const [id, v] of counts) out.set(id, v / max);
  return out;
}

export function computeGoalHops(
  entities: Entity[],
  adjacency: Map<string, Set<string>>,
  goalIds: Set<string>,
): Map<string, number> {
  const hops = new Map<string, number>();
  if (goalIds.size === 0) {
    for (const e of entities) hops.set(e.id, -1);
    return hops;
  }
  // Multi-source BFS from all goals at once
  const queue: Array<[string, number]> = [];
  for (const gid of goalIds) {
    if (adjacency.has(gid)) {
      hops.set(gid, 0);
      queue.push([gid, 0]);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const [node, d] = queue[head++];
    const neighbors = adjacency.get(node);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (!hops.has(n)) {
        hops.set(n, d + 1);
        queue.push([n, d + 1]);
      }
    }
  }
  for (const e of entities) if (!hops.has(e.id)) hops.set(e.id, -1);
  return hops;
}

export function buildAdjacency(edges: Edge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    let set = adj.get(a);
    if (!set) { set = new Set(); adj.set(a, set); }
    set.add(b);
  };
  for (const e of edges) {
    addEdge(e.source_entity_id, e.target_entity_id);
    addEdge(e.target_entity_id, e.source_entity_id);
  }
  return adj;
}

/** Phase 4 §5.2 — Reverse-direction BFS from a single sink entity along
 *  the directed causal subgraph. For every entity reachable IN REVERSE
 *  (i.e. there's a directed path from that entity TO the sink), returns
 *  the hop distance. Entities not on any directed path to the sink are
 *  omitted from the map entirely.
 *
 *  Why reverse-BFS rather than forward-BFS from each candidate: O(V+E)
 *  total vs O(V*(V+E)) — a single sweep precomputes every entity's
 *  upstream distance in one go. The result lives in the bundle so the
 *  outcome_alignment signal is a O(1) lookup per candidate.
 *
 *  Returns an empty map when sinkId is null or unknown. */
export function computeUpstreamHops(
  edges: Edge[],
  sinkId: string | null,
): Map<string, number> {
  const hops = new Map<string, number>();
  if (!sinkId) return hops;

  // Reverse adjacency: for edge a→b, store b→a so BFS from sink walks
  // upstream. Built locally because it's only useful here — the global
  // adjacency map is undirected (cached for centrality + novelty).
  const reverse = new Map<string, Set<string>>();
  for (const e of edges) {
    let set = reverse.get(e.target_entity_id);
    if (!set) { set = new Set(); reverse.set(e.target_entity_id, set); }
    set.add(e.source_entity_id);
  }

  hops.set(sinkId, 0);
  const queue: Array<[string, number]> = [[sinkId, 0]];
  let head = 0;
  while (head < queue.length) {
    const [node, d] = queue[head++];
    const upstreams = reverse.get(node);
    if (!upstreams) continue;
    for (const u of upstreams) {
      if (!hops.has(u)) {
        hops.set(u, d + 1);
        queue.push([u, d + 1]);
      }
    }
  }
  return hops;
}

/** Phase 4 — companion to computeUpstreamHops. One reverse-BFS sweep
 *  over the directed causal subgraph that BOTH discovers shortest
 *  paths AND accumulates per-edge temporal data along the path back
 *  to the sink (focal outcome). For every entity on a directed path
 *  to the sink, returns a summary capturing the timing claim of that
 *  shortest path: how long until effect peaks at the outcome, when
 *  the FIRST measurable change happens, the bottleneck of effect
 *  persistence, and the heterogeneity (I²) across pool of edges on
 *  the path.
 *
 *  When edges on the path have no temporal data, the corresponding
 *  field on the summary is null — propagating "we don't know" rather
 *  than fabricating a fake number. The signals downstream interpret
 *  null as "no opinion" (returning null themselves), so a candidate
 *  with no temporal coverage on its path doesn't get unfairly
 *  penalized vs one whose timing is well-characterized.
 *
 *  Returns an empty map when sinkId is null or unknown. */
export function computeUpstreamTemporalSummaries(
  edges: Edge[],
  sinkId: string | null,
): Map<string, UpstreamTemporalSummary> {
  const summaries = new Map<string, UpstreamTemporalSummary>();
  if (!sinkId) return summaries;

  // Reverse adjacency with the EDGE retained so we can read its
  // temporal columns when accumulating. Each entry is (predecessor
  // node, edge_to_successor) — edge.target_entity_id is the
  // successor we're walking back from.
  const reverse = new Map<string, Array<{ predecessor: string; edge: Edge }>>();
  for (const e of edges) {
    let arr = reverse.get(e.target_entity_id);
    if (!arr) {
      arr = [];
      reverse.set(e.target_entity_id, arr);
    }
    arr.push({ predecessor: e.source_entity_id, edge: e });
  }

  // Per-entity running accumulators for I² mean; persistence min; etc.
  // Easier than recomputing from saved path edges every visit.
  const i2Sums = new Map<string, number>();
  const i2Counts = new Map<string, number>();
  const peakAccumulators = new Map<string, { sum: number; allKnown: boolean }>();

  // Sink seeds: zero-length path to itself.
  summaries.set(sinkId, {
    total_peak_days: 0,
    first_onset_days: null,
    min_persistence_days: null,
    mean_i2: null,
    edges_with_temporal: 0,
    edges_total: 0,
  });
  i2Sums.set(sinkId, 0);
  i2Counts.set(sinkId, 0);
  peakAccumulators.set(sinkId, { sum: 0, allKnown: true });

  const queue: string[] = [sinkId];
  let head = 0;
  while (head < queue.length) {
    const v = queue[head++];
    const incomingPredEdges = reverse.get(v);
    if (!incomingPredEdges) continue;
    const vSummary = summaries.get(v)!;
    const vPeak = peakAccumulators.get(v)!;
    const vI2Sum = i2Sums.get(v) ?? 0;
    const vI2Count = i2Counts.get(v) ?? 0;

    for (const { predecessor: u, edge: e } of incomingPredEdges) {
      if (summaries.has(u)) continue; // already on a shorter path
      // Per-edge temporal pull. The DB row has these as numeric|null.
      const peak = numericOrUndefined(
        (e as unknown as Record<string, unknown>).peak_days_p50,
      );
      const onset = numericOrUndefined(
        (e as unknown as Record<string, unknown>).onset_days_p50,
      );
      const persist = numericOrUndefined(
        (e as unknown as Record<string, unknown>).persistence_days_p50,
      );
      const i2 = numericOrUndefined(
        (e as unknown as Record<string, unknown>).temporal_heterogeneity_i2,
      );

      // Peak: cumulative sum. Once any edge on path is missing peak,
      // the running total becomes null (we don't fake durations).
      const peakKnown = peak !== undefined;
      const newPeakAllKnown = vPeak.allKnown && peakKnown;
      const newPeakSum = newPeakAllKnown ? vPeak.sum + (peak ?? 0) : 0;
      peakAccumulators.set(u, {
        sum: newPeakSum,
        allKnown: newPeakAllKnown,
      });

      // I² accumulator — running sum + count only over edges that
      // have it; mean computed from those at lookup time.
      const newI2Sum = i2 !== undefined ? vI2Sum + i2 : vI2Sum;
      const newI2Count = i2 !== undefined ? vI2Count + 1 : vI2Count;
      i2Sums.set(u, newI2Sum);
      i2Counts.set(u, newI2Count);

      // First onset = u's outgoing edge's onset (the FIRST edge in
      // u's path forward to outcome). The previous-leg's first onset
      // doesn't propagate — it belongs to v, not u.
      const firstOnset = onset ?? null;

      // Min persistence: smaller of current min and this edge's
      // persistence. Running across the path because the path's
      // effective persistence is bounded by its weakest link.
      const minPersist =
        persist === undefined
          ? vSummary.min_persistence_days
          : vSummary.min_persistence_days === null
            ? persist
            : Math.min(vSummary.min_persistence_days, persist);

      const edges_total = vSummary.edges_total + 1;
      const edges_with_temporal =
        vSummary.edges_with_temporal +
        (peakKnown || onset !== undefined || persist !== undefined ? 1 : 0);

      summaries.set(u, {
        total_peak_days: newPeakAllKnown ? newPeakSum : null,
        first_onset_days: firstOnset,
        min_persistence_days: minPersist,
        mean_i2: newI2Count > 0 ? newI2Sum / newI2Count : null,
        edges_with_temporal,
        edges_total,
      });
      queue.push(u);
    }
  }
  return summaries;
}

function numericOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Phase 4 — convert a categorical horizon to days for time-aware
 *  signals. Used by loadSignalBundle to populate
 *  SignalInputBundle.horizon_days; signals consume the numeric form
 *  so future "user picks an exact deadline" UX is a one-line change.
 *
 *  Buckets:
 *    immediate    → 14 days   (≈ 2 weeks; "what can I do this week")
 *    short_term   → 90 days   (≈ a quarter)
 *    medium_term  → 365 days  (≈ a year)
 *    long_term    → 730 days  (≈ 2 years)
 *    null         → null      (signals fall back to horizon-agnostic) */
export function horizonToDays(
  h: "immediate" | "short_term" | "medium_term" | "long_term" | null,
): number | null {
  if (!h) return null;
  switch (h) {
    case "immediate":
      return 14;
    case "short_term":
      return 90;
    case "medium_term":
      return 365;
    case "long_term":
      return 730;
  }
}

// ── The actual signal extractors ──────────────────────────────────────
//
// Each returns a single SignalProfile field value (or null). Kept as
// small pure functions so the ranker can compose them per-candidate
// without coupling.

/** Centrality — higher = more shortest paths flow through this node.
 *  A space that deepens a high-centrality node yields insight that
 *  propagates to many downstream widgets. */
export function centralitySignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  const v = bundle.centrality.get(targetEntityId);
  return v === undefined ? null : clamp01(v);
}

/** Goal proximity — 1 if target IS a goal, 1/(hops+1) if reachable,
 *  0.02 if unreachable (not 0, so the ranker still sees a signal that
 *  "this exists but is far from the goal"). */
export function goalProximitySignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  if (bundle.goal_entity_ids.size === 0) return null;
  if (bundle.goal_entity_ids.has(targetEntityId)) return 1;
  const hops = bundle.goal_hops.get(targetEntityId);
  if (hops === undefined || hops < 0) return 0.02;
  return clamp01(1 / (hops + 1));
}

/** Intersection density — normalized count of existing intersections
 *  touching the target. High density = "we've already found signal
 *  here, more to mine." */
export function intersectionDensitySignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  const v = bundle.intersection_touches.get(targetEntityId) ?? 0;
  // Normalize by max across all entities (avoid O(n) per call — do once)
  let max = 0;
  for (const n of bundle.intersection_touches.values()) if (n > max) max = n;
  if (max === 0) return 0;
  return clamp01(v / max);
}

/** Uncertainty — residual_uncertainty from the node's signature. When
 *  a node has no signature yet, null (not 0) because "unknown" ≠
 *  "certain." */
export function uncertaintySignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  const sig = bundle.signatures.get(targetEntityId);
  if (!sig) return null;
  return clamp01(sig.residual_uncertainty);
}

/** Layer crossing — 1 when an edge candidate spans two knowledge
 *  layers. For node-scoped candidates: 1 if the node sits on ≥1
 *  cross-layer edge, 0 otherwise. */
export function layerCrossingSignal(
  bundle: SignalInputBundle,
  sourceId: string | null,
  targetId: string | null,
): number | null {
  if (!sourceId || !targetId) return null;
  const sourceEnt = bundle.entities.find((e) => e.id === sourceId);
  const targetEnt = bundle.entities.find((e) => e.id === targetId);
  if (!sourceEnt || !targetEnt) return null;
  const sLayer = sourceEnt.knowledge_layer ?? "internal";
  const tLayer = targetEnt.knowledge_layer ?? "internal";
  return sLayer !== tLayer ? 1 : 0;
}

/** Coverage gap — binary membership check against high_value_uncovered_pairs. */
export function coverageGapSignal(
  bundle: SignalInputBundle,
  sourceId: string | null,
  targetId: string | null,
): number | null {
  if (!sourceId || !targetId) return null;
  const key = sourceId < targetId ? `${sourceId}:${targetId}` : `${targetId}:${sourceId}`;
  return bundle.coverage_gap_pairs.has(key) ? 1 : 0;
}

/** Novelty — graph distance between endpoints. Distant pairs that get
 *  connected produce insight that couldn't be derived locally. */
export function noveltySignal(
  bundle: SignalInputBundle,
  sourceId: string | null,
  targetId: string | null,
): number | null {
  if (!sourceId || !targetId) return null;
  if (sourceId === targetId) return 0;
  const d = graphDistance(bundle, sourceId, targetId);
  if (d < 0) return 1; // disconnected = maximally novel IF we can bridge
  // Saturating map: 1 hop=0, 2 hops=0.33, 3 hops=0.5, 4+ hops=0.7+
  return clamp01(1 - 1 / (1 + d * 0.7));
}

/** Axis calibration — historical acceptance rate. Only for axis
 *  candidates. Raises axes that have consistently produced accepted
 *  proposals; dampens axes that churn out rejected noise. */
export function axisCalibrationSignal(
  bundle: SignalInputBundle,
  axis: ProbabilitySpaceAxis | null,
): number | null {
  if (!axis) return null;
  const v = bundle.axis_calibration.get(axis);
  return v === undefined ? null : clamp01(v);
}

/** Controllability spread — for an edge or convergent_point candidate,
 *  1 if the spanned sub-components cover all three controllability
 *  tiers; 0.66 for two tiers; 0.33 for one. Measured via signatures
 *  on the endpoints. This is a DIVERSITY signal — the ranker uses it
 *  to prefer candidates that broaden the plan's manifold footprint. */
export function controllabilitySpreadSignal(
  bundle: SignalInputBundle,
  sourceId: string | null,
  targetId: string | null,
): number | null {
  if (!sourceId && !targetId) return null;
  const tiers = new Set<"direct" | "indirect" | "uncontrollable">();
  for (const id of [sourceId, targetId]) {
    if (!id) continue;
    const sig = bundle.signatures.get(id);
    if (!sig) continue;
    for (const b of sig.basis) tiers.add(b.controllability);
  }
  if (tiers.size === 0) return null;
  return clamp01(tiers.size / 3);
}

/** Causal depth signal — how far upstream from the nearest goal the
 *  candidate's target sits along the directed causal subgraph,
 *  normalized to [0,1] by CAP_DEPTH. Sourced from entities.causal_depth
 *  written by /api/pipeline/root-trace.
 *
 *  Why it's not redundant with goal_proximity:
 *    goal_proximity uses UNDIRECTED graph distance over ALL edges
 *    (a mediation edge back to a goal counts the same as a purely
 *    structural edge). causal_depth uses DIRECTED distance over the
 *    causal subgraph only. A node can be goal-proximate (1-hop)
 *    without being causally upstream (it's a downstream effect).
 *    Together they disambiguate "near the goal" vs "upstream of the
 *    goal."
 *
 *  Returns null when the target wasn't reached by the backward trace.
 *  A null is NOT evidence of "not a root" — just "we haven't looked
 *  there." The ranker treats null as neutral. */
const CAUSAL_DEPTH_CAP = 6;

export function causalDepthSignal(
  bundle: SignalInputBundle,
  entityId: string | null,
): number | null {
  if (!entityId) return null;
  const hit = bundle.root_trace.get(entityId);
  if (!hit) return null;
  // Depth 0 = the goal itself; return 0 (not a root). Depth > CAP is
  // floored at 1 (max root-ness).
  if (hit.causal_depth <= 0) return 0;
  return clamp01(hit.causal_depth / CAUSAL_DEPTH_CAP);
}

/** Convergence count signal — fraction of space goals whose backward
 *  trace passes through the target entity. 1.0 means the entity is
 *  upstream of EVERY goal (keystone root). 0 means it's on no goal's
 *  trace (or trace hasn't run).
 *
 *  This is the single strongest signal for Kaufman-style root-cause
 *  ranking. An entity with convergence_count = 0.8 means 4 out of 5
 *  goals will improve if you move this one node — that's exactly the
 *  kind of work item the strategizer should be pushing up the queue. */
export function convergenceCountSignal(
  bundle: SignalInputBundle,
  entityId: string | null,
): number | null {
  if (!entityId) return null;
  const hit = bundle.root_trace.get(entityId);
  if (!hit) return null;
  if (bundle.total_goal_count <= 0) return null;
  return clamp01(hit.converges_chains.length / bundle.total_goal_count);
}

/** Agent convergence count signal — fraction of DISTINCT canonical
 *  agents that independently proposed the target entity, normalized by
 *  total_agent_count (the ensemble size active in this space).
 *
 *  Why this is useful beyond structural convergence: `convergence_count`
 *  asks "how many goal chains fan into this node in the KG"; this
 *  signal asks "how many distinct reasoning agents independently
 *  landed on this node". High values mean multiple perspectives
 *  triangulated to the same concept — a strong sanity check. Low values
 *  in an entity that nonetheless has high structural signals may mean
 *  a single agent's bias is driving the ranking.
 *
 *  Returns null when:
 *    - candidate doesn't attach to an entity (axis-level kinds)
 *    - the entity has no proposing-agents metadata
 *    - total_agent_count is zero (degenerate ensemble) */
export function agentConvergenceCountSignal(
  bundle: SignalInputBundle,
  entityId: string | null,
): number | null {
  if (!entityId) return null;
  const proposers = bundle.agent_proposed_entities.get(entityId);
  if (!proposers || proposers.size === 0) return null;
  if (bundle.total_agent_count <= 0) return null;
  return clamp01(proposers.size / bundle.total_agent_count);
}

/** User-controllable lever signal — binary 0/1, null when the entity
 *  isn't a driver at all (no opinion).
 *
 *  Contract:
 *    1 → entity is `causal_driver` + `stop_reason="user_controllable"`
 *    0 → entity is `causal_driver` but stop_reason is external/
 *        continue/speculative (a driver, but not actionable)
 *    null → entity is not a driver, OR the candidate doesn't attach
 *           to a specific entity (axis-level), OR the why-chain
 *           deepener didn't run and there's no metadata to read
 *
 *  Null is meaningful and distinct from 0: the ranker's re-normalization
 *  pass treats null as "signal inapplicable," which is the correct
 *  behavior here — we have no grounds to reject a non-driver entity
 *  for lacking a "lever" property, since it was never evaluated for
 *  controllability. A 0 IS a rejection (we looked; it's an external
 *  boundary condition, not a lever).
 *
 *  Why 0/1 rather than a continuous value: the upstream provenance is
 *  itself a discrete label set (external / user_controllable / continue
 *  / speculative). Fabricating a continuous interpretation would
 *  smuggle uncertainty the deepener never expressed. */
export function userControllableLeverSignal(
  bundle: SignalInputBundle,
  entityId: string | null,
): number | null {
  if (!entityId) return null;

  // Legacy why-chain driver metadata wins when present — preserves
  // the original binary semantic (1 = user-controllable driver, 0 =
  // external/continue/speculative driver). Returning early keeps
  // back-compat with rankers + reports that asserted "value ≥ 1
  // means actionable lever."
  const meta = bundle.driver_metadata.get(entityId);
  if (meta) return meta.is_user_controllable ? 1 : 0;

  // D3 fallback (docs/KG_DEPTH_CRITIQUE.md §9): non-driver entities
  // can still carry a controllability profile in
  // manifold.operational.controllability. When `kind` is set, we
  // emit a gradient score so the ranker can distinguish a fully-
  // controllable lever from a partially-controllable one without
  // needing the why-chain deepener to have run on this entity.
  //
  // Magnitudes:
  //   fully_controllable      → 1.00 (parity with binary 1)
  //   partially_controllable  → 0.60 (clearly actionable but
  //                                   requires others)
  //   gated                   → 0.40 (binary on/off only)
  //   observable_only         → 0.00 (parity with binary 0)
  //
  // The 0/null distinction is preserved: 0 means "we evaluated and
  // it's not actionable"; null means "we have no opinion."
  const kind = bundle.controllability_kind_by_entity.get(entityId);
  if (kind) {
    switch (kind) {
      case "fully_controllable":
        return 1;
      case "partially_controllable":
        return 0.6;
      case "gated":
        return 0.4;
      case "observable_only":
        return 0;
      default:
        return null;
    }
  }

  return null;
}

/** D3 phase 3 — Cost-efficiency signal.
 *
 *  Returns:
 *    1.0     → cost is sunk (already paid; should not penalize future
 *              decisions; explicit counter to sunk-cost fallacy)
 *    1.0     → free (estimate = 0, not sunk — already-instrumented
 *              levers like "post in #engineering Slack")
 *    [0,1]   → relative to budget (when cost_budget set) OR inverse-log
 *              of estimate normalized by space-wide max cost
 *    0.0     → over budget by ≥ 2× (still in pool under soft strictness;
 *              the ranker shows it but heavily de-prioritizes)
 *    null    → no cost data on this entity (no opinion — ranker treats
 *              null as "doesn't apply" rather than "expensive")
 *
 *  Why inverse-log: cost is a long-tailed distribution (orders-of-magnitude
 *  variation between $50 levers and $5M strategic capex). Linear
 *  normalization would make every cheap lever look identical (~1.0); log
 *  spreads them out so a $500 lever scores higher than a $5k one even
 *  when both are well under budget.
 *
 *  Opportunity-dominated case: when cost_kind="opportunity_dominated"
 *  and opportunity_cost is set, we use opportunity_cost.estimate as the
 *  dominant cost — honest accounting of the hidden alternative-foreclosed
 *  cost rather than rewarding direct-dollar levers that look cheap on
 *  paper but cost a lot in foregone alternatives.
 */
export function costEfficiencySignal(
  bundle: SignalInputBundle,
  entityId: string | null,
): number | null {
  if (!entityId) return null;
  const cost = bundle.controllability_cost_by_entity.get(entityId);
  if (!cost) return null;

  // Sunk cost short-circuit — counter to sunk-cost fallacy bias.
  if (cost.is_sunk) return 1;
  // Truly free → top score.
  if (cost.dominant_cost === 0) return 1;

  const dollars = cost.dominant_cost;
  const budget = bundle.cost_budget;

  if (budget !== null && budget > 0) {
    // Budget-relative scoring. Cheap relative to budget → high score;
    // over-budget → trends to 0 quickly.
    const ratio = dollars / budget;
    if (ratio <= 0.1) return 1; // ≤ 10% of budget — clearly in-bounds
    if (ratio >= 2) return 0;   // ≥ 2× budget — clearly out
    // Smooth interp between 1.0 (at 10% of budget) and 0.0 (at 200%).
    // Using 1 - sqrt(ratio/2) gives a gentle curve through the [0.1, 2]
    // range that crosses 0.5 around the budget itself.
    const t = (ratio - 0.1) / (2 - 0.1);
    return Math.max(0, Math.min(1, 1 - Math.sqrt(t)));
  }

  // No budget set — score on absolute log-cost normalized to the
  // space's empirical max. We don't know the max from this signal's
  // perspective; use a reasonable baseline (1e6 — $1M caps the scale)
  // since strategy levers above $1M are exotic and should saturate.
  // log10($100) → 2, log10($1M) → 6. Normalize: (6 - log10(cost)) / 4
  // gives [0,1] over [$100, $1M] with $100 → 1.0 and $1M → 0.
  const logCost = Math.log10(Math.max(1, dollars));
  const score = (6 - logCost) / 4;
  return Math.max(0, Math.min(1, score));
}

/** Outcome alignment signal — proximity from candidate to the resolved
 *  focal target outcome entity, measured along DIRECTED causal edges.
 *
 *  Returns:
 *    1       → candidate IS the resolved outcome entity (perfect alignment)
 *    1/(d+1) → candidate is d directed-causal hops UPSTREAM of the outcome
 *    0.02    → no directed path from candidate to outcome (still > 0 so
 *             the ranker sees "this exists but doesn't lead to the lever")
 *    null    → no outcome was extracted, no entity resolved, OR the
 *             candidate doesn't attach to a specific entity (axis-level)
 *
 *  Why directed (Phase 4 §5.2): "near the outcome" and "upstream of the
 *  outcome" are different questions. A downstream effect of the outcome
 *  is graph-adjacent under undirected BFS but isn't a lever to move it
 *  — pulling that node won't propagate back. Directed BFS asks the
 *  intervention-relevant question: which candidates, when changed,
 *  causally cascade into the focal outcome?
 *
 *  Why not redundant with goal_proximity:
 *    goal_proximity ranks against improvement_goals (multiple, often
 *    broad, set at intake/whiteboard time) using UNDIRECTED hops.
 *    outcome_alignment ranks against the SINGLE focal outcome the
 *    target-outcome extractor pulled from this run's input text using
 *    DIRECTED causal hops. They can disagree — an improvement_goal
 *    might be "increase retention 30%" while the user's frame-extracted
 *    outcome for this run is "ship the onboarding redesign." When they
 *    disagree, outcome_alignment wins for THIS run because it reflects
 *    what the user actually asked AND it's tested for actionability via
 *    the directed-edge constraint. */
export function outcomeAlignmentSignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  if (!bundle.target_outcome_entity_id) return null;
  if (bundle.target_outcome_entity_id === targetEntityId) return 1;
  const d = bundle.directed_outcome_hops.get(targetEntityId);
  if (d === undefined) return 0.02; // no directed causal path → unreachable lever
  return clamp01(1 / (d + 1));
}

/** Calibration drift signal (D6 phase 2) — recent prediction-driven
 *  calibration activity on edges incident to the target entity.
 *  Reads from `bundle.calibration_drift_by_entity`, populated by
 *  loadSignalBundle scanning the edge_calibrations table for rows
 *  within the recent window (default 30 days).
 *
 *  Returns:
 *    1   → entity has the most recent calibration activity in the
 *          space (most "stale" model region)
 *    >0  → fractional activity
 *    null → no recent calibrations OR no edge_calibrations rows
 *           OR axis-level candidate
 *
 *  Why null instead of 0: matches the bundle's null-aware semantics.
 *  Zero calibration activity isn't evidence against picking the
 *  candidate — it just means we have no fresh reality-check signal
 *  on this entity yet. The strategizer treats null as "no opinion." */
export function calibrationDriftSignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  if (bundle.calibration_drift_by_entity.size === 0) return null;
  const v = bundle.calibration_drift_by_entity.get(targetEntityId);
  if (!v || v <= 0) return null;
  let max = 0;
  for (const n of bundle.calibration_drift_by_entity.values()) if (n > max) max = n;
  if (max === 0) return null;
  return clamp01(v / max);
}

/** Interaction density signal (D4) — normalized count of emergent
 *  interactions involving the target entity. Reads from
 *  `bundle.interaction_counts`, populated by loadSignalBundle scanning
 *  the `reactions` table for rows with reaction_type='emergent'.
 *
 *  Returns:
 *    1   → target entity participates in the most interactions seen
 *          in the space (normalized by max count across entities)
 *    >0  → fractional participation
 *    null → entity has no interactions OR interaction discovery
 *           hasn't run OR axis-level candidate (no entity attached)
 *
 *  Why null instead of 0 for zero interactions: matches the bundle's
 *  null-aware semantics. A candidate with zero interactions ISN'T
 *  evidence against picking it for joint-intervention reasoning —
 *  it just means we haven't discovered any emergence touching it
 *  (yet). The strategizer treats null as "no signal," which is
 *  honest. */
export function interactionDensitySignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  if (bundle.interaction_counts.size === 0) return null;
  const v = bundle.interaction_counts.get(targetEntityId);
  if (!v || v <= 0) return null;
  let max = 0;
  for (const n of bundle.interaction_counts.values()) if (n > max) max = n;
  if (max === 0) return null;
  return clamp01(v / max);
}

/** Consequence breadth signal (D13a) — fraction-of-max distinct
 *  downstream consequences this entity carries in its
 *  `node_signature.consequence_surface`, normalized by the max
 *  surface size seen across the space.
 *
 *  Reads `bundle.signatures.get(entityId).consequence_surface.length`
 *  and divides by the per-space max. Returns null when:
 *    - entity has no signature at all (signature pass hasn't run)
 *    - signature has empty consequence_surface (no outgoing edges,
 *      or D13a backfill hasn't run on a legacy space)
 *    - candidate is axis-level (no attached entity)
 *
 *  Why null instead of 0 for empty surface: matches the bundle's
 *  null-aware semantics. An entity with zero downstream consequences
 *  ISN'T evidence against picking it — it might just be a leaf node
 *  in the decomposition. The strategizer treats null as "no signal,"
 *  which is honest.
 *
 *  Companion to `convergence_count` (upstream fan-in) — together they
 *  give the strategizer bidirectional reach signal per entity. The
 *  ranker weights this modestly (~0.03) initially because the field
 *  was just-activated and we want telemetry before raising weight. */
export function consequenceBreadthSignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  const sig = bundle.signatures.get(targetEntityId);
  if (!sig) return null;
  const surface = sig.consequence_surface;
  if (!Array.isArray(surface) || surface.length === 0) return null;

  // Compute per-space max once. We don't cache this on the bundle
  // because the function is called per-candidate inside the same plan
  // cycle — recomputing the max is O(|signatures|) which is small
  // (typically 50-100), and avoiding bundle pollution keeps the
  // bundle interface stable.
  let max = 0;
  for (const other of bundle.signatures.values()) {
    const len = Array.isArray(other.consequence_surface)
      ? other.consequence_surface.length
      : 0;
    if (len > max) max = len;
  }
  if (max === 0) return null;
  return clamp01(surface.length / max);
}

// ── Phase 4 — temporal-rigor signals ─────────────────────────────────
//
// Four time-aware signals consuming the per-edge temporal pool from
// edges.{onset,peak,persistence}_days_p50 + decay_kinetics_modal +
// temporal_heterogeneity_i2 (Phase 3). They flow through
// computeUpstreamTemporalSummaries so a candidate's "time signature"
// is the path-aggregate going forward to the focal outcome.

/** Phase 4 — `time_to_outcome` — how many days until the candidate's
 *  effect peaks at the outcome. Lower = faster = better.
 *
 *  Returns 1 / (1 + total_peak_days / horizon_days):
 *    1.0  → instant impact (total_peak_days = 0, e.g. candidate IS
 *           the outcome).
 *    0.5  → impact lands at the user's deadline.
 *    →0   → impact lands long after the deadline.
 *
 *  Null when:
 *    - no focal outcome resolved (no path to compute);
 *    - candidate isn't on a directed path to outcome;
 *    - any edge on the path lacks peak_days_p50 (we don't fabricate
 *      durations — null propagates "we don't know" rather than
 *      lying about reach time).
 *  Falls back to horizon=90 days when horizon_days is null so a
 *  candidate with full temporal coverage still gets a defensible
 *  ranking signal. */
export function timeToOutcomeSignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  if (!bundle.target_outcome_entity_id) return null;
  const summary = bundle.temporal_path_summaries.get(targetEntityId);
  if (!summary) return null;
  if (summary.total_peak_days === null) return null;
  const horizonDays = bundle.horizon_days ?? 90;
  if (horizonDays <= 0) return null;
  return clamp01(1 / (1 + summary.total_peak_days / horizonDays));
}

/** Phase 4 — `persistence_match` — does the effect outlast the user's
 *  horizon? 1 means yes (sustained at deadline), 0 means no (decays
 *  before deadline reached).
 *
 *  Returns clamp01(min_persistence_days / horizon_days). The min is
 *  the bottleneck on the path; the path's effective persistence is
 *  bounded by its weakest link.
 *
 *  Null when no min_persistence on path OR no horizon set. */
export function persistenceMatchSignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  if (!bundle.target_outcome_entity_id) return null;
  const summary = bundle.temporal_path_summaries.get(targetEntityId);
  if (!summary || summary.min_persistence_days === null) return null;
  const horizonDays = bundle.horizon_days ?? 90;
  if (horizonDays <= 0) return null;
  return clamp01(summary.min_persistence_days / horizonDays);
}

/** Phase 4 — `onset_alignment` — does the FIRST measurable change
 *  land before the user's deadline? 1 means immediately, 0 means
 *  never within the horizon.
 *
 *  Returns 1 - clamp01(first_onset_days / horizon_days). Counter-
 *  intuitively named: "alignment" framed as "how aligned is this
 *  with the user's need-it-soon expectation." High onset = poor
 *  alignment.
 *
 *  Null when no first_onset on path OR no horizon set. */
export function onsetAlignmentSignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  if (!bundle.target_outcome_entity_id) return null;
  const summary = bundle.temporal_path_summaries.get(targetEntityId);
  if (!summary || summary.first_onset_days === null) return null;
  const horizonDays = bundle.horizon_days ?? 90;
  if (horizonDays <= 0) return null;
  return clamp01(1 - summary.first_onset_days / horizonDays);
}

/** Phase 4 — `temporal_heterogeneity_penalty` — coverage and study-
 *  agreement signal. 1 means the path's edges have low I² (studies
 *  agree on timing). 0 means high I² (timing claims contradict).
 *
 *  Returns 1 - mean_i2. Aggregates I² across path edges that have
 *  it; null when no path edges have I² coverage at all. The signal
 *  rewards candidates whose timing is well-characterized AND whose
 *  pooled studies agree — a candidate at the end of a path of
 *  contradictory studies should rank lower than one with consistent
 *  evidence even if the point estimates are equal. */
export function temporalHeterogeneityPenaltySignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  if (!bundle.target_outcome_entity_id) return null;
  const summary = bundle.temporal_path_summaries.get(targetEntityId);
  if (!summary || summary.mean_i2 === null) return null;
  return clamp01(1 - summary.mean_i2);
}

/** Phase 5 — `calibration_drift_temporal` — recent prediction-driven
 *  TIMING calibration activity on edges incident to the entity.
 *  Reads from `bundle.calibration_drift_temporal_by_entity`,
 *  populated by loadSignalBundle scanning edge_calibrations for
 *  rows where temporal_delta_days IS NOT NULL within the recent
 *  window (default 30 days).
 *
 *  Returns:
 *    1   — entity has the most recent temporal calibration activity
 *          in the space (most "stale TIMING model region" — the
 *          system has been actively shifting peak-day estimates here)
 *    >0  — fractional activity
 *    null — no recent temporal calibrations OR axis-level candidate
 *
 *  Distinct from calibration_drift (magnitude). High temporal drift
 *  surfaces "we got the WHEN wrong" zones; magnitude drift surfaces
 *  "we got the HOW MUCH wrong" zones. Strategizer can preferentially
 *  re-decompose entities whose timing model has been shifting if the
 *  user's run cares about temporal accuracy (e.g. immediate-horizon
 *  decisions where a 4-week mis-prediction matters more than a 0.1
 *  effect-size mis-prediction). */
export function calibrationDriftTemporalSignal(
  bundle: SignalInputBundle,
  targetEntityId: string | null,
): number | null {
  if (!targetEntityId) return null;
  const drifts = bundle.calibration_drift_temporal_by_entity;
  if (drifts.size === 0) return null;
  const here = drifts.get(targetEntityId);
  if (here === undefined) return null;
  let max = 0;
  for (const v of drifts.values()) if (v > max) max = v;
  if (max === 0) return null;
  return clamp01(here / max);
}

// ── One-shot: compute the full SignalProfile for a candidate ──────────

export interface CandidateTarget {
  kind: SpaceWorkKind;
  /** Source entity id (null for axis, signature_deepen uses only one id). */
  source_entity_id: string | null;
  /** Target entity id (null for axis). */
  target_entity_id: string | null;
  /** Axis for kind=axis. */
  axis: ProbabilitySpaceAxis | null;
}

export function computeSignalProfile(
  bundle: SignalInputBundle,
  target: CandidateTarget,
): SignalProfile {
  const primaryId = target.target_entity_id ?? target.source_entity_id ?? null;
  return {
    centrality: centralitySignal(bundle, primaryId),
    goal_proximity: goalProximitySignal(bundle, primaryId),
    intersection_density: intersectionDensitySignal(bundle, primaryId),
    uncertainty: uncertaintySignal(bundle, primaryId),
    layer_crossing: layerCrossingSignal(bundle, target.source_entity_id, target.target_entity_id),
    coverage_gap: coverageGapSignal(bundle, target.source_entity_id, target.target_entity_id),
    novelty: noveltySignal(bundle, target.source_entity_id, target.target_entity_id),
    axis_calibration: axisCalibrationSignal(bundle, target.axis),
    controllability_spread: controllabilitySpreadSignal(bundle, target.source_entity_id, target.target_entity_id),
    causal_depth_normalized: causalDepthSignal(bundle, primaryId),
    convergence_count: convergenceCountSignal(bundle, primaryId),
    agent_convergence_count: agentConvergenceCountSignal(bundle, primaryId),
    user_controllable_lever: userControllableLeverSignal(bundle, primaryId),
    outcome_alignment: outcomeAlignmentSignal(bundle, primaryId),
    interaction_density: interactionDensitySignal(bundle, primaryId),
    cost_efficiency: costEfficiencySignal(bundle, primaryId),
    calibration_drift: calibrationDriftSignal(bundle, primaryId),
    consequence_breadth: consequenceBreadthSignal(bundle, primaryId),
    // Phase 4 — temporal-rigor signals.
    time_to_outcome: timeToOutcomeSignal(bundle, primaryId),
    persistence_match: persistenceMatchSignal(bundle, primaryId),
    onset_alignment: onsetAlignmentSignal(bundle, primaryId),
    temporal_heterogeneity_penalty: temporalHeterogeneityPenaltySignal(
      bundle,
      primaryId,
    ),
    // Phase 5 — closed-loop temporal feedback.
    calibration_drift_temporal: calibrationDriftTemporalSignal(
      bundle,
      primaryId,
    ),
  };
}
