// ── Entity dominance scoring (Phase A1.9) ──
//
// A single-dimension "importance" score is lossy — we want users to
// understand WHY an entity matters, so the score is compound and its
// components are exposed independently. The library sorts/filters/
// ranks by any combination.
//
// Four components, all normalized to [0, 1]:
//
//   centrality      ← edge count relative to the max in the space.
//                     Answers: "how connected is this thing?"
//   intersections   ← distinct neighbor-categories it touches.
//                     Answers: "how many domains does it bridge?"
//   leverage        ← is this in the synthesis leverage_points list?
//                     Answers: "did the AI flag it as high-impact?"
//   goal_proximity  ← inverse graph-distance to nearest active goal.
//                     Answers: "how directly does it serve intent?"
//
// Composite weighting:
//   score = 0.3*centrality + 0.25*intersections + 0.25*leverage
//         + 0.2*goal_proximity
//
// Default weighting balances "connected" + "bridging" + "flagged" +
// "goal-aligned". Tuneable in future if telemetry shows a better mix.

import type { Entity, Edge } from "@/types";
import type { RichLeveragePoint } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";

export interface DominanceBreakdown {
  score: number;
  centrality: number;
  intersections: number;
  leverage: number;
  goal_proximity: number;
}

export interface DominanceInputs {
  entities: readonly Entity[];
  edges: readonly Edge[];
  leveragePoints: readonly RichLeveragePoint[];
  goals: readonly ImprovementGoal[];
}

/**
 * Pre-compute everything once per catalog request so per-entity
 * calls are O(1). Call this then `computeEntityDominance(ctx, entity)`.
 */
export interface DominanceContext {
  // For centrality: edge count per entity (both directions)
  edgeCountsById: Map<string, number>;
  maxEdgeCount: number;
  // For intersections: neighbor category set per entity
  neighborCategoriesById: Map<string, Set<string>>;
  // For leverage: O(1) membership check
  leverageEntityIds: Set<string>;
  // For goal proximity: min hops from each entity to any goal-linked entity
  goalProximityById: Map<string, number>;
  // Max observed hops for normalization
  maxGoalHops: number;
}

export function buildDominanceContext(
  inputs: DominanceInputs,
): DominanceContext {
  const { entities, edges, leveragePoints, goals } = inputs;

  // ── Edge counts ────────────────────────────────────────────────────
  const edgeCountsById = new Map<string, number>();
  const neighborsById = new Map<string, Set<string>>();
  for (const e of edges) {
    const from = String(e.source_entity_id);
    const to = String(e.target_entity_id);
    edgeCountsById.set(from, (edgeCountsById.get(from) ?? 0) + 1);
    edgeCountsById.set(to, (edgeCountsById.get(to) ?? 0) + 1);
    if (!neighborsById.has(from)) neighborsById.set(from, new Set());
    if (!neighborsById.has(to)) neighborsById.set(to, new Set());
    neighborsById.get(from)!.add(to);
    neighborsById.get(to)!.add(from);
  }
  let maxEdgeCount = 0;
  for (const c of edgeCountsById.values()) {
    if (c > maxEdgeCount) maxEdgeCount = c;
  }

  // ── Neighbor category diversity ────────────────────────────────────
  const categoryById = new Map<string, string>();
  for (const e of entities) {
    categoryById.set(e.id, String(e.entity_category ?? "unknown"));
  }
  const neighborCategoriesById = new Map<string, Set<string>>();
  for (const [id, neighborIds] of neighborsById.entries()) {
    const cats = new Set<string>();
    for (const nid of neighborIds) {
      const cat = categoryById.get(nid);
      if (cat) cats.add(cat);
    }
    neighborCategoriesById.set(id, cats);
  }

  // ── Leverage membership ────────────────────────────────────────────
  const leverageEntityIds = new Set(
    leveragePoints.map((lp) => String(lp.entity_id)),
  );

  // ── Goal proximity (BFS from goal-linked seed set) ─────────────────
  //
  // "Goal-linked" seed = any entity that is a direct source/target
  // of an active goal. Without entity_objectives linkage we use the
  // goal's own entity reference if present, else fall back to all
  // entities being equidistant (proximity = 0 for every entity).
  //
  // Data model note: `entity_objectives` isn't joined here to keep the
  // endpoint fast; sub-objective entity-linkage is the richer signal
  // and can be layered in once it's reliably populated. For now we
  // mark every leverage-flagged entity as goal-adjacent as a proxy.
  const activeGoals = goals.filter(
    (g) => (g.status as string) === "active" || (g.status as string) === "proposed",
  );

  const goalSeedIds = new Set<string>();
  // Proxy: leverage entities are typically goal-adjacent by construction.
  if (activeGoals.length > 0) {
    for (const lp of leveragePoints) goalSeedIds.add(String(lp.entity_id));
  }

  const goalProximityById = new Map<string, number>();
  let maxGoalHops = 0;
  if (goalSeedIds.size > 0) {
    // BFS from seeds. Each entity gets the min hop count to the nearest seed.
    const queue: Array<{ id: string; hops: number }> = [];
    for (const seed of goalSeedIds) {
      goalProximityById.set(seed, 0);
      queue.push({ id: seed, hops: 0 });
    }
    while (queue.length > 0) {
      const { id, hops } = queue.shift()!;
      const neighbors = neighborsById.get(id);
      if (!neighbors) continue;
      for (const nid of neighbors) {
        if (goalProximityById.has(nid)) continue;
        const h = hops + 1;
        goalProximityById.set(nid, h);
        if (h > maxGoalHops) maxGoalHops = h;
        queue.push({ id: nid, hops: h });
      }
    }
  }

  return {
    edgeCountsById,
    maxEdgeCount,
    neighborCategoriesById,
    leverageEntityIds,
    goalProximityById,
    maxGoalHops,
  };
}

const MAX_CATEGORY_SPREAD = 6; // matches the 6 entity_category values

/**
 * Default weighting — used when no domain profile is supplied. Tuned
 * to be neutral across domains. Domain-adaptive weights come from
 * `domain-detector.ts` and override these at the endpoint layer.
 */
export interface DominanceWeights {
  centrality: number;
  intersections: number;
  leverage: number;
  goal_proximity: number;
}

const DEFAULT_WEIGHTS: DominanceWeights = {
  centrality: 0.3,
  intersections: 0.25,
  leverage: 0.25,
  goal_proximity: 0.2,
};

export function computeEntityDominance(
  ctx: DominanceContext,
  entity: Entity,
  weights: DominanceWeights = DEFAULT_WEIGHTS,
): DominanceBreakdown {
  // Centrality ← normalized edge count
  const edgeCount = ctx.edgeCountsById.get(entity.id) ?? 0;
  const centrality =
    ctx.maxEdgeCount > 0 ? edgeCount / ctx.maxEdgeCount : 0;

  // Intersections ← distinct neighbor categories / max possible
  const neighborCategories =
    ctx.neighborCategoriesById.get(entity.id) ?? new Set();
  const intersections =
    Math.min(neighborCategories.size, MAX_CATEGORY_SPREAD) /
    MAX_CATEGORY_SPREAD;

  // Leverage ← 1 if synthesis flagged it, else 0
  const leverage = ctx.leverageEntityIds.has(entity.id) ? 1 : 0;

  // Goal proximity ← inverse hops to nearest goal-adjacent entity.
  // 1 = on a goal seed, 0 = unreachable or no goals.
  let goal_proximity = 0;
  if (ctx.goalProximityById.size > 0) {
    const hops = ctx.goalProximityById.get(entity.id);
    if (hops !== undefined) {
      // Normalize: 0 hops → 1.0, maxHops → 0.0
      const denom = ctx.maxGoalHops > 0 ? ctx.maxGoalHops : 1;
      goal_proximity = Math.max(0, 1 - hops / denom);
    }
  }

  const score =
    weights.centrality * centrality +
    weights.intersections * intersections +
    weights.leverage * leverage +
    weights.goal_proximity * goal_proximity;

  // Round components to 4 decimals for clean JSON + stable UI display.
  return {
    score: Math.round(score * 10000) / 10000,
    centrality: Math.round(centrality * 10000) / 10000,
    intersections: Math.round(intersections * 10000) / 10000,
    leverage,
    goal_proximity: Math.round(goal_proximity * 10000) / 10000,
  };
}

/**
 * Count upstream (incoming) and downstream (outgoing) edges for an
 * entity. Directed counts — an entity being edge-target = upstream,
 * being edge-source = downstream (cause flows forward).
 */
export function countEdgeDirection(
  entity: Entity,
  edges: readonly Edge[],
): { upstream: number; downstream: number } {
  let upstream = 0;
  let downstream = 0;
  for (const e of edges) {
    if (e.target_entity_id === entity.id) upstream += 1;
    if (e.source_entity_id === entity.id) downstream += 1;
  }
  return { upstream, downstream };
}
