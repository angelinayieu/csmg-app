// GET /api/spaces/[id]/objectives/catalog
//
// Phase A1.7 — objectives asset class for the universal library catalog.
// Returns ROOT objectives for a space (top-level trees) with their full
// sub-objective hierarchy + computed recursive progress + proposed/active
// counts, shaped for direct consumption by the Objectives drawer entry
// and the ObjectiveTreeShape renderer.
//
// Unlike /api/goals?spaceId=..., which returns a flat goal list for
// dashboards, this endpoint pre-builds the tree + progress so every
// library row + drop shape is instant (no client-side hydration). The
// catalog caches the result per-space by the asset catalog context.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  buildGoalTree,
  computeRecursiveProgress,
} from "@/lib/goals/build-goal-tree";
import type { ImprovementGoal, GoalTreeNode } from "@/types/goals";
import type { Space } from "@/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * One catalog entry = one ROOT objective tree (not one goal). A space
 * typically has 1–5 root goals; each root may have many sub-objectives.
 * The library row represents the root; drop materializes the full tree
 * as an ObjectiveTreeShape the user can expand in place on the canvas.
 */
export interface ObjectiveCatalogEntry {
  /** Root goal id — same as the improvement_goals.id of the tree root. */
  id: string;
  space_id: string;
  space_name: string;
  title: string;
  description: string | null;
  /** Wave A adds "proposed" / "rejected"; keep string for forward-compat
   *  with the older narrow enum on ImprovementGoal.status. */
  status: string;
  objective_type: string;
  /** 0–100, computed recursively across the full tree. */
  progress: number;
  /** Count of nodes in the tree (root + all descendants). */
  nodeCount: number;
  /** Deepest depth in the tree (root = 1). */
  depth: number;
  /** Count of sub-objectives with status = proposed (unreviewed). */
  proposedCount: number;
  /** Count of leaf sub-objectives (for progress-bar allocation). */
  leafCount: number;
  /** Full tree — serialized recursively for drop payloads. */
  tree: GoalTreeNode;
  /** Most recent updated_at in the tree for recency sorting. */
  updatedAt: string;
}

export interface ObjectivesCatalogResponse {
  objectives: ObjectiveCatalogEntry[];
  computed_at: string;
  space_name: string;
}

function walkDepth(node: GoalTreeNode): number {
  if (node.children.length === 0) return 1;
  let max = 0;
  for (const c of node.children) {
    const d = walkDepth(c);
    if (d > max) max = d;
  }
  return 1 + max;
}

function walkCount(node: GoalTreeNode): number {
  let total = 1;
  for (const c of node.children) total += walkCount(c);
  return total;
}

function walkLeafCount(node: GoalTreeNode): number {
  if (node.children.length === 0) return 1;
  let total = 0;
  for (const c of node.children) total += walkLeafCount(c);
  return total;
}

function walkProposedCount(node: GoalTreeNode): number {
  // @ts-expect-error Wave A extends status with 'proposed'/'rejected' but
  //  ImprovementGoal.status here is the narrower legacy union — intent is
  //  "count any node whose status string is 'proposed'".
  let count = node.status === "proposed" ? 1 : 0;
  for (const c of node.children) count += walkProposedCount(c);
  return count;
}

function mostRecentUpdate(node: GoalTreeNode): string {
  let latest = node.updated_at;
  for (const c of node.children) {
    const childLatest = mostRecentUpdate(c);
    if (new Date(childLatest).getTime() > new Date(latest).getTime()) {
      latest = childLatest;
    }
  }
  return latest;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [spaceRes, goalsRes] = await Promise.all([
    db.from("spaces").select("id, name, user_id").eq("id", spaceId).maybeSingle(),
    db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: true }),
  ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if ((spaceRes.data as Space).user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const spaceName = (spaceRes.data as Space).name;
  const goals = (goalsRes.data ?? []) as ImprovementGoal[];
  const roots = buildGoalTree(goals);

  const entries: ObjectiveCatalogEntry[] = roots.map((root) => ({
    id: root.id,
    space_id: spaceId,
    space_name: spaceName,
    title: root.title,
    description: root.description,
    status: root.status,
    objective_type: root.objective_type,
    progress: computeRecursiveProgress(root),
    nodeCount: walkCount(root),
    depth: walkDepth(root),
    proposedCount: walkProposedCount(root),
    leafCount: walkLeafCount(root),
    tree: root,
    updatedAt: mostRecentUpdate(root),
  }));

  // Surface most-recently-touched trees first — matches user expectation
  // that the thing they last worked on is top of the list.
  entries.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  const payload: ObjectivesCatalogResponse = {
    objectives: entries,
    computed_at: new Date().toISOString(),
    space_name: spaceName,
  };
  return NextResponse.json(payload);
}
