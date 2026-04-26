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
  const meta = bundle.driver_metadata.get(entityId);
  if (!meta) return null;
  return meta.is_user_controllable ? 1 : 0;
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
  };
}
