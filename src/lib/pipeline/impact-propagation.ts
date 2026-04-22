/**
 * Impact Propagation
 *
 * Goal-aware scoring for probability spaces. Given the KG edges and a set of
 * goal entity IDs, we compute — for every entity in the graph — the probability
 * that a perturbation at that entity can propagate through the graph to reach
 * each goal. This is a reverse-Dijkstra over edge-probability weights.
 *
 * Each ProbabilitySpace (an edge A→B) then gets an `ImpactAnalysis`:
 *   impact_probability = total_pathway_probability × max(reach(A), reach(B))
 *
 * Intent: attach "how much does this relationship matter to the goals" as a
 * per-space scalar, without touching the internal pathway math.
 */

import type { Edge } from "@/types";
import type {
  ProbabilitySpace,
  ImpactAnalysis,
  ImpactPerGoal,
} from "@/types/probability-space";

const MIN_EDGE_PROB = 0.05;
const DEFAULT_EDGE_PROB = 0.5;
const DEFAULT_MAX_HOPS = 6;

interface ReachEntry {
  probability: number;
  hops: number;
}

/** Per-entity, per-goal reachability table. */
export type ReachabilityMap = Map<string, Map<string, ReachEntry>>;

function clampProb(value: unknown, fallback: number = DEFAULT_EDGE_PROB): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
  if (!isFinite(n) || n <= 0) return fallback;
  return Math.min(1, Math.max(MIN_EDGE_PROB, n));
}

function edgeWeight(edge: Edge): number {
  // Combined confidence × strength gives a conservative transit probability.
  // Falls back to confidence alone, then to default, when either is missing.
  const conf = clampProb(edge.confidence, NaN);
  const str = clampProb(edge.strength, NaN);
  if (isFinite(conf) && isFinite(str)) return Math.min(1, conf * str);
  if (isFinite(conf)) return conf;
  if (isFinite(str)) return str;
  return DEFAULT_EDGE_PROB;
}

/**
 * Build an entity → goal → {probability, hops} map via reverse Dijkstra.
 *
 * For each goal g, we walk graph edges backward (target→source direction) and
 * find the max-probability path from every entity to g. The probability of a
 * path is the product of edge probabilities along the way; we store it as
 * -log in the priority queue for a straight min-dist Dijkstra.
 */
export function computeGoalReachability(
  edges: Edge[],
  goalEntityIds: string[],
  opts?: { maxHops?: number },
): ReachabilityMap {
  const maxHops = opts?.maxHops ?? DEFAULT_MAX_HOPS;
  const result: ReachabilityMap = new Map();
  if (goalEntityIds.length === 0) return result;

  // Reverse adjacency: for each entity, list edges whose TARGET is that entity
  // (so walking "backward" from a goal means traversing these).
  const reverseAdj = new Map<string, Array<{ source: string; logw: number }>>();
  for (const edge of edges) {
    const p = edgeWeight(edge);
    const logw = -Math.log(p);
    const list = reverseAdj.get(edge.target_entity_id);
    const entry = { source: edge.source_entity_id, logw };
    if (list) list.push(entry);
    else reverseAdj.set(edge.target_entity_id, [entry]);
  }

  for (const goalId of goalEntityIds) {
    // Dijkstra from goalId across reverse edges
    const dist = new Map<string, number>();
    const hops = new Map<string, number>();
    dist.set(goalId, 0);
    hops.set(goalId, 0);

    // Simple queue — for graphs up to a few thousand entities this is fine.
    // Swap for a heap if profiling shows it matters.
    const queue = new Set<string>([goalId]);

    while (queue.size > 0) {
      // Extract min-dist node
      let best: string | null = null;
      let bestD = Infinity;
      for (const id of queue) {
        const d = dist.get(id) ?? Infinity;
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (!best) break;
      queue.delete(best);

      const currentHops = hops.get(best) ?? 0;
      if (currentHops >= maxHops) continue;

      const neighbors = reverseAdj.get(best) ?? [];
      for (const { source, logw } of neighbors) {
        const alt = bestD + logw;
        const currentBest = dist.get(source) ?? Infinity;
        if (alt < currentBest) {
          dist.set(source, alt);
          hops.set(source, currentHops + 1);
          queue.add(source);
        }
      }
    }

    // Record per-goal reachability on every entity we reached
    for (const [entityId, d] of dist) {
      if (entityId === goalId) {
        // The goal entity reaches itself with probability 1, 0 hops
        let bucket = result.get(entityId);
        if (!bucket) {
          bucket = new Map();
          result.set(entityId, bucket);
        }
        bucket.set(goalId, { probability: 1, hops: 0 });
        continue;
      }
      const prob = Math.exp(-d);
      if (prob <= 0 || !isFinite(prob)) continue;
      let bucket = result.get(entityId);
      if (!bucket) {
        bucket = new Map();
        result.set(entityId, bucket);
      }
      bucket.set(goalId, { probability: prob, hops: hops.get(entityId) ?? -1 });
    }
  }

  return result;
}

/**
 * Compute the ImpactAnalysis for a single probability space given a
 * pre-built reachability map.
 */
export function computeImpactForSpace(
  space: ProbabilitySpace,
  reachabilityMap: ReachabilityMap,
  goalEntityIds: string[],
): ImpactAnalysis {
  const computedAt = new Date().toISOString();

  if (goalEntityIds.length === 0) {
    return {
      impact_probability: 0,
      impact_direction: "none",
      per_goal: [],
      closest_goal_entity_id: null,
      closest_goal_hops: null,
      direct: false,
      computed_at: computedAt,
    };
  }

  const sourceReach = reachabilityMap.get(space.source_entity_id) ?? new Map();
  const targetReach = reachabilityMap.get(space.target_entity_id) ?? new Map();

  const goalSet = new Set(goalEntityIds);
  const direct =
    goalSet.has(space.source_entity_id) || goalSet.has(space.target_entity_id);

  const perGoal: ImpactPerGoal[] = [];
  let maxCombined = 0;
  let closestGoalId: string | null = null;
  let closestHops: number | null = null;

  for (const goalId of goalEntityIds) {
    const srcEntry = sourceReach.get(goalId);
    const tgtEntry = targetReach.get(goalId);
    const srcProb = srcEntry?.probability ?? 0;
    const tgtProb = tgtEntry?.probability ?? 0;
    const combined = Math.max(srcProb, tgtProb);

    const srcHops = srcEntry?.hops ?? Infinity;
    const tgtHops = tgtEntry?.hops ?? Infinity;
    const minHops = Math.min(srcHops, tgtHops);
    const distanceHops = isFinite(minHops) ? minHops : -1;

    perGoal.push({
      goal_entity_id: goalId,
      reachability_from_source: srcProb,
      reachability_from_target: tgtProb,
      combined,
      distance_hops: distanceHops,
    });

    if (combined > maxCombined) {
      maxCombined = combined;
      closestGoalId = goalId;
      closestHops = distanceHops >= 0 ? distanceHops : null;
    } else if (combined === maxCombined && distanceHops >= 0) {
      // Prefer the goal that is closer in hops when probabilities tie
      if (closestHops === null || distanceHops < closestHops) {
        closestGoalId = goalId;
        closestHops = distanceHops;
      }
    }
  }

  const pathwayProb = Math.max(0, Math.min(1, space.total_pathway_probability ?? 0));
  const impactProbability = pathwayProb * maxCombined;

  const direction: ImpactAnalysis["impact_direction"] = direct
    ? "direct"
    : maxCombined > 0
      ? "indirect"
      : "none";

  return {
    impact_probability: impactProbability,
    impact_direction: direction,
    per_goal: perGoal,
    closest_goal_entity_id: closestGoalId,
    closest_goal_hops: closestHops,
    direct,
    computed_at: computedAt,
  };
}

/**
 * Batch helper: attach `impact` to every space in-place, given the graph edges
 * and goal entity IDs. Safe to call with goalEntityIds=[] (no-op).
 */
export function annotateSpacesWithImpact(
  spaces: ProbabilitySpace[],
  edges: Edge[],
  goalEntityIds: string[],
): void {
  if (goalEntityIds.length === 0 || spaces.length === 0) return;
  const reach = computeGoalReachability(edges, goalEntityIds);
  for (const space of spaces) {
    space.impact = computeImpactForSpace(space, reach, goalEntityIds);
  }
}
