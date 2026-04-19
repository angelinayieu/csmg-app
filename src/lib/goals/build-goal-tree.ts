import type { ImprovementGoal, GoalTreeNode } from "@/types/goals";

/**
 * Builds a tree structure from a flat list of goals.
 * Top-level goals have parent_goal_id === null.
 * Returns an array of root nodes, each with children resolved recursively.
 */
export function buildGoalTree(goals: ImprovementGoal[]): GoalTreeNode[] {
  const map = new Map<string, GoalTreeNode>();

  // Initialize all nodes
  for (const g of goals) {
    map.set(g.id, { ...g, children: [] });
  }

  const roots: GoalTreeNode[] = [];

  // Link children to parents
  for (const g of goals) {
    const node = map.get(g.id)!;
    if (g.parent_goal_id && map.has(g.parent_goal_id)) {
      map.get(g.parent_goal_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children by created_at within each parent
  for (const node of map.values()) {
    node.children.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }

  return roots;
}

/**
 * Gets child goals for a specific parent from a flat list.
 */
export function getChildGoals(
  goals: ImprovementGoal[],
  parentId: string
): ImprovementGoal[] {
  return goals.filter((g) => g.parent_goal_id === parentId);
}

/**
 * Computes aggregate progress for a parent goal based on children.
 * Returns a percentage (0-100) that is the average of child progress.
 */
export function computeAggregateProgress(
  parent: ImprovementGoal,
  children: ImprovementGoal[]
): number {
  if (children.length === 0) {
    // No children — use own metric
    const range = Number(parent.target_value) - Number(parent.baseline_value);
    if (range === 0) return 0;
    const progress = Number(parent.current_value) - Number(parent.baseline_value);
    return Math.max(0, Math.min(100, Math.round((progress / range) * 100)));
  }

  // Average of child progress percentages
  let totalPct = 0;
  for (const child of children) {
    const range = Number(child.target_value) - Number(child.baseline_value);
    if (range === 0) continue;
    const progress = Number(child.current_value) - Number(child.baseline_value);
    totalPct += Math.max(0, Math.min(100, (progress / range) * 100));
  }

  return Math.round(totalPct / children.length);
}

/**
 * Computes progress recursively through the full goal tree.
 * Leaf nodes: compute from own baseline/current/target.
 * Parent nodes: average of children's recursive progress.
 */
export function computeRecursiveProgress(node: GoalTreeNode): number {
  if (node.children.length === 0) {
    const range = Number(node.target_value) - Number(node.baseline_value);
    if (range === 0) return 0;
    const progress = Number(node.current_value) - Number(node.baseline_value);
    return Math.max(0, Math.min(100, Math.round((progress / range) * 100)));
  }

  let totalPct = 0;
  let count = 0;
  for (const child of node.children) {
    totalPct += computeRecursiveProgress(child);
    count++;
  }

  return count > 0 ? Math.round(totalPct / count) : 0;
}

/**
 * Collects all leaf nodes (goals with no children) from a tree.
 * Useful for progress bar width allocation.
 */
export function collectLeafGoals(nodes: GoalTreeNode[]): GoalTreeNode[] {
  const leaves: GoalTreeNode[] = [];
  function walk(node: GoalTreeNode) {
    if (node.children.length === 0) {
      leaves.push(node);
    } else {
      for (const child of node.children) walk(child);
    }
  }
  for (const n of nodes) walk(n);
  return leaves;
}
