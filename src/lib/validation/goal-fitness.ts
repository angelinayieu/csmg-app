// Goal-fitness validator — Gap 1
// Checks whether synthesis findings actually advance the user's goal
// Programmatic validation (~10ms), no LLM call

import type { Entity, Edge } from "@/types";
import type { SynthesisData, GoalFitnessResult, GoalFitnessIssue } from "@/types/synthesis";
import type { ImprovementGoal, ObjectiveBenchmark } from "@/types/goals";

/**
 * Check whether synthesis findings align with the user's improvement goal.
 * Uses BFS from goal-related entities to build a critical path,
 * then checks if leverage/risk/actions touch that path.
 */
export function checkGoalFitness(
  synthesis: SynthesisData,
  goal: ImprovementGoal,
  entities: Entity[],
  edges: Edge[],
  benchmark?: ObjectiveBenchmark | null,
): GoalFitnessResult {
  const issues: GoalFitnessIssue[] = [];

  // Build entity lookup maps
  const entityById = new Map<string, Entity>();
  const entityByUuid = new Map<string, Entity>();
  for (const e of entities) {
    entityById.set(e.entity_id, e);
    entityByUuid.set(e.id, e);
  }

  // Build forward-only adjacency filtered to causal + functional dimensions
  const causalDimensions = new Set(["causal", "functional"]);
  const adj = new Map<string, Set<string>>(); // uuid → Set<uuid> (source → target only)
  for (const edge of edges) {
    if (!causalDimensions.has(edge.dimension)) continue;
    if (!adj.has(edge.source_entity_id)) adj.set(edge.source_entity_id, new Set());
    adj.get(edge.source_entity_id)!.add(edge.target_entity_id);
  }

  // ── Build critical path: entities reachable within 2 forward hops from seed ──
  const criticalPathIds = new Set<string>(); // entity_ids (display IDs)
  const goalSeeds: string[] = []; // UUIDs to BFS from

  // Seed only from goal source entity (entity_id → uuid lookup)
  const goalSourceId = (goal as any).source_entity_id as string | undefined;
  if (goalSourceId) {
    // source_entity_id may be a display ID (entity_id) or a UUID — try both
    const seedByDisplay = entityById.get(goalSourceId);
    const seedByUuid = entityByUuid.get(goalSourceId);
    const seed = seedByDisplay ?? seedByUuid;
    if (seed) goalSeeds.push(seed.id);
  }

  // Fallback: if no source_entity_id, seed from master bottleneck only
  if (goalSeeds.length === 0 && synthesis.master_bottleneck) {
    const mbId = synthesis.master_bottleneck.entity_id;
    const seedByDisplay = entityById.get(mbId);
    const seedByUuid = entityByUuid.get(mbId);
    const seed = seedByDisplay ?? seedByUuid;
    if (seed) goalSeeds.push(seed.id);
  }

  // BFS 2 forward hops from seeds
  const visited = new Set<string>();
  let frontier = [...new Set(goalSeeds)];
  for (let depth = 0; depth <= 2 && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];
    for (const uuid of frontier) {
      if (visited.has(uuid)) continue;
      visited.add(uuid);
      const entity = entityByUuid.get(uuid);
      if (entity) criticalPathIds.add(entity.entity_id);

      for (const neighbor of adj.get(uuid) ?? []) {
        if (!visited.has(neighbor)) nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }

  // ── Score leverage points ──
  const onPath: string[] = [];
  const offPath: string[] = [];

  for (const lp of synthesis.leverage_points ?? []) {
    if (criticalPathIds.has(lp.entity_id)) {
      onPath.push(lp.entity_id);
    } else {
      offPath.push(lp.entity_id);
      issues.push({
        type: "off_path_leverage",
        severity: "warning",
        message: `Leverage point ${lp.entity_id} (${lp.entity_name ?? ""}) is valid but doesn't directly advance "${goal.metric_name}"`,
        entity_id: lp.entity_id,
      });
    }
  }

  // ── Score risk points ──
  for (const rp of synthesis.risk_points ?? []) {
    if (criticalPathIds.has(rp.entity_id)) {
      onPath.push(rp.entity_id);
    } else {
      offPath.push(rp.entity_id);
      issues.push({
        type: "off_path_risk",
        severity: "warning",
        message: `Risk point ${rp.entity_id} (${rp.entity_name ?? ""}) may not directly threaten progress toward "${goal.title}"`,
        entity_id: rp.entity_id,
      });
    }
  }

  // ── Check bottleneck ──
  let bottleneckBlocksGoal = false;
  if (synthesis.master_bottleneck) {
    if (criticalPathIds.has(synthesis.master_bottleneck.entity_id)) {
      bottleneckBlocksGoal = true;
      onPath.push(synthesis.master_bottleneck.entity_id);
    } else {
      issues.push({
        type: "bottleneck_not_blocking_goal",
        severity: "warning",
        message: `Master bottleneck (${synthesis.master_bottleneck.entity_id}) isn't on the critical path to "${goal.title}"`,
        entity_id: synthesis.master_bottleneck.entity_id,
      });
    }
  }

  // ── Check action plan references critical path ──
  let actionPlanAddressesGoal = false;
  if (synthesis.action_plan?.paths) {
    for (const path of synthesis.action_plan.paths) {
      for (const tf of path.timeframes ?? []) {
        for (const action of tf.actions ?? []) {
          // Check if action tags or text reference critical path entities
          const actionText = `${action.text} ${action.why ?? ""}`.toLowerCase();
          for (const cpId of criticalPathIds) {
            const entity = entityById.get(cpId);
            if (entity && actionText.includes(entity.name.toLowerCase())) {
              actionPlanAddressesGoal = true;
              break;
            }
          }
          // Check tag references
          for (const tag of action.tags ?? []) {
            if (tag.t && criticalPathIds.has(tag.t)) {
              actionPlanAddressesGoal = true;
            }
          }
        }
      }
    }
  }

  if (!actionPlanAddressesGoal) {
    issues.push({
      type: "no_goal_actions",
      severity: "warning",
      message: `No actions in the plan directly reference entities on the critical path to "${goal.metric_name}"`,
    });
  }

  // ── Tally findings ──
  const totalFindings = (synthesis.leverage_points?.length ?? 0) +
    (synthesis.risk_points?.length ?? 0) +
    (synthesis.master_bottleneck ? 1 : 0);

  // ── Check benchmark quality ──
  let benchmarkBonus = 0;
  if (benchmark) {
    const mustHaves = benchmark.success_criteria.filter(sc => sc.priority === "must_have");
    if (mustHaves.length >= 1) benchmarkBonus += 3; // Has must-have criteria
    if (benchmark.leading_indicators.length >= 1) benchmarkBonus += 2; // Has leading indicators
    if (benchmark.failure_signals.length >= 1) benchmarkBonus += 2; // Has failure signals
    if (benchmark.milestones.length >= 2) benchmarkBonus += 3; // Has milestone roadmap
  } else if (totalFindings >= 5) {
    // Penalize goals without benchmarks in non-trivial analyses
    issues.push({
      type: "off_path_leverage" as const, // reuse closest type
      severity: "warning" as const,
      message: `Goal "${goal.title}" has no evaluation criteria (benchmarks). Define success criteria to track progress effectively.`,
    });
    benchmarkBonus = -5;
  }

  // ── Compute score ──
  const rawScore = totalFindings > 0
    ? Math.round((onPath.length / totalFindings) * 100)
    : 50;

  const score = Math.max(0, Math.min(100, rawScore + benchmarkBonus));

  return {
    score,
    on_critical_path: [...new Set(onPath)],
    off_critical_path: [...new Set(offPath)],
    bottleneck_blocks_goal: bottleneckBlocksGoal,
    action_plan_addresses_goal: actionPlanAddressesGoal,
    issues,
  };
}
