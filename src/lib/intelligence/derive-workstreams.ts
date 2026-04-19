/**
 * Workstream Derivation — Pure compute.
 *
 * Builds a unified list of "workstreams" (top nav tabs in the radar page)
 * from sub-objectives + top-level improvement goals. Each workstream
 * carries the set of entity IDs it covers so we can filter signals,
 * the allocation radar, and the agent fleet by active workstream.
 */

import type { Entity } from "@/types";
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";
import type { IntelligenceSignal } from "@/types/intelligence";

export interface Workstream {
  id: string;
  label: string;
  source: "suggested_objective" | "improvement_goal";
  /** Number of active (non-dismissed) signals targeting entities in this workstream */
  signalCount: number;
  /** Entity IDs this workstream covers — used for filtering */
  entityIds: string[];
  /** Optional category tag for icon display */
  category?: string;
  /** Priority (from source objective or goal) */
  priority?: number;
  /** Original source payload for trace-back (discriminated by source) */
  sourceData: SuggestedObjective | ImprovementGoal;
}

interface DeriveInput {
  suggestedObjectives?: SuggestedObjective[];
  improvementGoals?: ImprovementGoal[];
  signals?: IntelligenceSignal[];
  entities?: Entity[];
}

export function deriveWorkstreams({
  suggestedObjectives = [],
  improvementGoals = [],
  signals = [],
  entities = [],
}: DeriveInput): Workstream[] {
  const entityByLogicalId = new Map<string, Entity>();
  for (const e of entities) {
    entityByLogicalId.set(e.entity_id, e);
    entityByLogicalId.set(e.id, e);
  }

  // Active signals set — for fast lookup
  const activeSignalsByEntityId = new Map<string, IntelligenceSignal[]>();
  for (const sig of signals) {
    if (sig.status === "dismissed" || sig.status === "resolved") continue;
    const key = sig.entity_id;
    if (!activeSignalsByEntityId.has(key)) activeSignalsByEntityId.set(key, []);
    activeSignalsByEntityId.get(key)!.push(sig);
    for (const rel of sig.related_internal_entities ?? []) {
      if (!activeSignalsByEntityId.has(rel)) activeSignalsByEntityId.set(rel, []);
      activeSignalsByEntityId.get(rel)!.push(sig);
    }
  }

  const workstreams: Workstream[] = [];

  // ── Sub-objectives ──
  for (const obj of suggestedObjectives) {
    const entityIds = new Set<string>();
    if (obj.source_entity_id) entityIds.add(obj.source_entity_id);
    for (const id of obj.causal_chain ?? []) entityIds.add(id);
    if (obj.propellant?.entity_id) entityIds.add(obj.propellant.entity_id);

    let signalCount = 0;
    for (const id of entityIds) {
      signalCount += (activeSignalsByEntityId.get(id)?.length ?? 0);
    }

    workstreams.push({
      id: `so:${obj.key}`,
      label: obj.title,
      source: "suggested_objective",
      signalCount,
      entityIds: Array.from(entityIds),
      category: obj.depth ?? obj.objective_type,
      priority: obj.priority,
      sourceData: obj,
    });
  }

  // ── Top-level improvement goals ──
  const topLevelGoals = improvementGoals.filter((g) => g.parent_goal_id == null && g.status === "active");
  const childrenByParent = new Map<string, ImprovementGoal[]>();
  for (const g of improvementGoals) {
    if (!g.parent_goal_id) continue;
    if (!childrenByParent.has(g.parent_goal_id)) childrenByParent.set(g.parent_goal_id, []);
    childrenByParent.get(g.parent_goal_id)!.push(g);
  }

  for (const goal of topLevelGoals) {
    const entityIds = new Set<string>();
    // Recursively collect from this goal + children — goals don't have explicit entity ids
    // in the Goal row; callers should resolve via source_entity_id or related mapping
    // if available. Here we use metric_name + goal.title as implicit matches.

    const goalChildren = childrenByParent.get(goal.id) ?? [];

    let signalCount = 0;
    for (const [, sigs] of activeSignalsByEntityId) {
      for (const s of sigs) {
        const hay = `${s.entity_name} ${s.description}`.toLowerCase();
        if (
          hay.includes(goal.metric_name.toLowerCase()) ||
          hay.includes(goal.title.toLowerCase())
        ) {
          signalCount++;
          break;
        }
      }
    }

    workstreams.push({
      id: `goal:${goal.id}`,
      label: goal.title,
      source: "improvement_goal",
      signalCount,
      entityIds: Array.from(entityIds),
      category: goal.objective_type,
      priority: goalChildren.length,
      sourceData: goal,
    });
  }

  // Sort by signal count desc, then priority
  workstreams.sort((a, b) => {
    if (b.signalCount !== a.signalCount) return b.signalCount - a.signalCount;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });

  return workstreams;
}
