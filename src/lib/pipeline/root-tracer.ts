// ── Root-Cause Tracer ─────────────────────────────────────────────────
//
// What it does
// ────────────
// For each goal in a space, walks BACKWARDS along the causal edge
// subgraph (causes / enables / inhibits / moderates / mediates /
// constrains / temporally_precedes). Tags every visited entity with:
//   - causal_depth: BFS hops back from the nearest goal
//   - converges_chains: the set of goal ids whose backward trace
//                       reaches this entity
//   - is_root_candidate: true iff the entity has no further upstream
//                         causal edges (i.e., it's a BFS leaf)
//   - root_score: composite "how root-cause-like is this node?"
//
// Why backward, not forward
// ─────────────────────────
// The Kaufman diagram traces Problem → Root by asking "what caused
// this?" recursively. Causal edges are stored source→target in the
// graph (source is the cause, target is the effect). So to walk from
// a goal/problem toward its roots, we follow edges in REVERSE: from
// an entity, look at edges with entity as the target, and recurse on
// the source.
//
// Why only causal edge types
// ──────────────────────────
// `composes`, `competes`, `relates_to`, and edges without a
// relation_type enum value describe structural or weak-semantic
// relationships that shouldn't contribute to a causal trace.
// Including them would make every entity 1-hop from the goal via
// spurious paths.
//
// Convergence is the root signal
// ──────────────────────────────
// An entity that appears on the backward trace of MULTIPLE goals is
// a shared upstream driver — the thing we most want to fix, because
// fixing it moves all the goals at once. That's what converges_chains
// captures. A single-goal trace gives depth; multi-goal overlap
// gives priority.
//
// Scoring
// ───────
// root_score = convergence_weight * depth_ratio * uncertainty_boost
//
//   convergence_weight = convergence_count / max(1, total_goals)
//                         (1.0 when the entity is upstream of every goal)
//   depth_ratio        = min(1, causal_depth / CAP_DEPTH) where CAP_DEPTH=6
//                         (deeper = more root-like, capped so a
//                          pathologically long chain doesn't dominate)
//   uncertainty_boost  = 0.5 + 0.5 * residual_uncertainty (from signature,
//                         or 0.75 if no signature exists yet)
//
// Range [0, 1]. A score ≥ 0.55 with depth ≥ 2 is a strong root
// candidate.
//
// Soft-fails
// ──────────
// If a space has no goals, returns an empty result (nothing to trace).
// If the graph has no causal edges, returns results where every goal
// has depth 0 and no propagation. Never throws.

import type { Entity, Edge } from "@/types";
import type { NodeSignature } from "@/types/node-signature";

// Relation types we treat as causal for the backward trace.
// `temporally_precedes` is included because temporal precedence
// without explicit causation is still a useful directional signal
// for ordering root candidates (we just weight it slightly lower).
const CAUSAL_RELATIONS = new Set<string>([
  "causes",
  "enables",
  "inhibits",
  "moderates",
  "mediates",
  "constrains",
  "temporally_precedes",
]);

// Relative weight per relation type when scoring edges on the
// backward path. Used only to break ties in depth-equal nodes;
// convergence dominates the final score.
const RELATION_WEIGHT: Record<string, number> = {
  causes: 1.0,
  enables: 0.9,
  inhibits: 0.9,
  mediates: 0.85,
  moderates: 0.7,
  constrains: 0.7,
  temporally_precedes: 0.5,
};

const CAP_DEPTH = 6; // beyond this, extra depth stops increasing root_score

// ── Public API ────────────────────────────────────────────────────────

export interface TraceInput {
  entities: Entity[];
  edges: Edge[];
  goalEntityIds: string[];
  /** Residual uncertainty map (from entities.node_signature). Missing
   *  entries default to 0.5 so the uncertainty_boost doesn't bias one
   *  way. */
  signatures?: Map<string, NodeSignature>;
}

export interface EntityTraceResult {
  entity_id: string;
  /** null = unreachable from any goal. */
  causal_depth: number | null;
  /** Goal ids whose backward trace visits this entity. */
  converges_chains: string[];
  /** Leaf of the backward BFS (no further upstream causal edges)
   *  AND reachable from ≥ 1 goal. */
  is_root_candidate: boolean;
  /** 0..1 composite. null when causal_depth is null. */
  root_score: number | null;
}

export interface TraceResult {
  per_entity: Map<string, EntityTraceResult>;
  goal_count: number;
  reachable_count: number;          // how many entities got a non-null depth
  convergence_points: number;       // how many entities have >= 2 goals converging
  root_candidates: number;          // how many got is_root_candidate=true
  /** Top-N entities by root_score. Useful for UI + event emission. */
  top_roots: Array<{
    entity_id: string;
    root_score: number;
    causal_depth: number;
    converges_chains: string[];
  }>;
}

export function traceRootCauses(
  input: TraceInput,
  topN: number = 10,
): TraceResult {
  const { entities, edges, goalEntityIds, signatures } = input;
  const goalSet = new Set(goalEntityIds);

  // ── Build upstream adjacency: target -> [sources] over causal edges only
  //
  // For BFS going backwards, we need "given this node, what are its
  // upstream causes?" Indexed by target_entity_id. Edges without a
  // causal relation_type are dropped entirely. Self-loops (source==
  // target) are also dropped — they'd make the BFS visit the same
  // node twice at different depths otherwise.
  const upstream = new Map<string, Array<{ source: string; weight: number }>>();
  for (const e of edges) {
    const rt = (e as unknown as { relation_type?: string | null }).relation_type ?? null;
    if (!rt || !CAUSAL_RELATIONS.has(rt)) continue;
    const src = e.source_entity_id;
    const tgt = e.target_entity_id;
    if (!src || !tgt || src === tgt) continue;
    const weight = RELATION_WEIGHT[rt] ?? 0.5;
    let list = upstream.get(tgt);
    if (!list) { list = []; upstream.set(tgt, list); }
    list.push({ source: src, weight });
  }

  // Initialize per-entity result
  const results = new Map<string, EntityTraceResult>();
  for (const ent of entities) {
    results.set(ent.id, {
      entity_id: ent.id,
      causal_depth: null,
      converges_chains: [],
      is_root_candidate: false,
      root_score: null,
    });
  }

  if (goalEntityIds.length === 0) {
    // Nothing to trace — return zeroed summary.
    return {
      per_entity: results,
      goal_count: 0,
      reachable_count: 0,
      convergence_points: 0,
      root_candidates: 0,
      top_roots: [],
    };
  }

  // ── Per-goal BFS ────────────────────────────────────────────────────
  //
  // Running one BFS per goal is O(goals × |V|). For realistic sizes
  // (≤ 10 goals × ≤ 500 entities) this is comfortably fast.
  // Combining them into a multi-source BFS would lose per-goal
  // convergence info.
  const perGoalReached = new Map<string, Set<string>>();
  for (const goalId of goalEntityIds) {
    if (!results.has(goalId)) continue; // orphan goal id — skip
    const reached = new Set<string>();
    const visited = new Map<string, number>(); // entity_id -> depth
    visited.set(goalId, 0);
    reached.add(goalId);
    const queue: Array<{ id: string; depth: number }> = [{ id: goalId, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      const parents = upstream.get(id);
      if (!parents || parents.length === 0) continue;
      for (const { source } of parents) {
        if (visited.has(source)) continue;
        // Guard against runaway depth — CAP_DEPTH * 2 is a hard ceiling.
        const nextDepth = depth + 1;
        if (nextDepth > CAP_DEPTH * 2) continue;
        visited.set(source, nextDepth);
        reached.add(source);
        queue.push({ id: source, depth: nextDepth });
      }
    }
    // Fold into results: min-depth across goals; converges_chains gets
    // this goal added.
    for (const [entityId, depth] of visited) {
      const r = results.get(entityId);
      if (!r) continue;
      if (r.causal_depth === null || depth < r.causal_depth) {
        r.causal_depth = depth;
      }
      r.converges_chains.push(goalId);
    }
    perGoalReached.set(goalId, reached);
  }

  // ── Score pass ──────────────────────────────────────────────────────
  //
  // Now that causal_depth + converges_chains are filled, compute
  // root_score and is_root_candidate.
  const totalGoals = goalEntityIds.length;
  let reachableCount = 0;
  let convergencePoints = 0;
  let rootCandidateCount = 0;
  for (const ent of entities) {
    const r = results.get(ent.id);
    if (!r) continue;
    if (r.causal_depth === null) continue;
    reachableCount++;

    // A goal itself shouldn't be a root candidate for itself. Also,
    // depth-0 entities are the problems, not the roots. We still
    // compute root_score for depth > 0.
    if (r.causal_depth === 0) continue;

    const parents = upstream.get(ent.id);
    const hasUpstream = parents && parents.length > 0;

    if (!hasUpstream) {
      r.is_root_candidate = true;
      rootCandidateCount++;
    }

    if (r.converges_chains.length >= 2) convergencePoints++;

    const convergenceWeight = r.converges_chains.length / Math.max(1, totalGoals);
    const depthRatio = Math.min(1, r.causal_depth / CAP_DEPTH);

    const sig = signatures?.get(ent.id);
    const residual = sig?.residual_uncertainty ?? 0.5;
    const uncertaintyBoost = 0.5 + 0.5 * Math.max(0, Math.min(1, residual));

    // Composite. Capped at 1; if there are bugs upstream that drive
    // it higher we'd rather truncate than propagate out-of-range.
    const raw = convergenceWeight * depthRatio * uncertaintyBoost;
    r.root_score = Math.min(1, Math.max(0, raw));
  }

  // ── Top-N roots for event emission / UI ─────────────────────────────
  const ranked: Array<{
    entity_id: string;
    root_score: number;
    causal_depth: number;
    converges_chains: string[];
  }> = [];
  for (const r of results.values()) {
    if (r.root_score === null || r.causal_depth === null) continue;
    if (r.root_score <= 0) continue;
    ranked.push({
      entity_id: r.entity_id,
      root_score: r.root_score,
      causal_depth: r.causal_depth,
      converges_chains: [...r.converges_chains],
    });
  }
  ranked.sort((a, b) => b.root_score - a.root_score);
  const top_roots = ranked.slice(0, topN);

  return {
    per_entity: results,
    goal_count: goalEntityIds.length,
    reachable_count: reachableCount,
    convergence_points: convergencePoints,
    root_candidates: rootCandidateCount,
    top_roots,
  };
}

// ── Persistence ──────────────────────────────────────────────────────
//
// Writes the trace back to the entities table. Each UPDATE is a
// single row; we batch by collecting per-entity payloads and sending
// them in one `upsert` with onConflict="id" so it's O(1) round trip
// for the whole space regardless of N.
//
// Soft-fail: if persistence errors, the caller still has the Map in
// memory and can choose what to do.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = import("@supabase/supabase-js").SupabaseClient<any>;

export async function persistTraceResults(
  db: AnyDb,
  trace: TraceResult,
): Promise<{ persisted: number; failed: number }> {
  let persisted = 0;
  let failed = 0;

  // Supabase doesn't have a clean "bulk UPDATE by id with different
  // payloads" path over PostgREST. We issue row-scoped UPDATEs in
  // small concurrent batches. This keeps each statement cheap and
  // avoids a huge JSON payload.
  const rows = Array.from(trace.per_entity.values());
  const BATCH = 20;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const updates = await Promise.all(
      slice.map(async (r) => {
        try {
          const { error } = await db
            .from("entities")
            .update({
              causal_depth: r.causal_depth,
              converges_chains: r.converges_chains,
              is_root_candidate: r.is_root_candidate,
              root_score: r.root_score,
            })
            .eq("id", r.entity_id);
          if (error) {
            console.warn("[root-tracer] persist row failed:", r.entity_id, error);
            return false;
          }
          return true;
        } catch (err) {
          console.warn("[root-tracer] persist row threw:", r.entity_id, err);
          return false;
        }
      }),
    );
    for (const ok of updates) {
      if (ok) persisted++; else failed++;
    }
  }

  return { persisted, failed };
}
