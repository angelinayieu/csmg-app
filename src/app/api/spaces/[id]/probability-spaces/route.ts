// GET /api/spaces/[id]/probability-spaces
//   ?focal=<entity_uuid>         — filter spaces to those touching a focal
//   ?goal=<goal_row_id>           — restrict goal context to a single improvement_goal
//   ?goals=id1,id2,id3            — restrict goal context to a comma-separated set
//
// Returns edge-level ProbabilitySpace[] for the given space plus (when goal
// context is available) impact analysis per space. This is pure read-side —
// computed on the fly from entities + edges + expansions. Also returns the
// goal roster so the lab can render a goal selector without a second fetch.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import { buildProbabilitySpacesForGraph } from "@/lib/pipeline/probability-space-engine";
import type { Entity, Edge } from "@/types";
import type { ProbabilitySpace } from "@/types/probability-space";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

interface GoalRow {
  id: string;
  title: string;
  entity_id: string | null;
}

export async function GET(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const url = new URL(request.url);
  const focalId = url.searchParams.get("focal");
  const goalIdParam = url.searchParams.get("goal");
  const goalsCsv = url.searchParams.get("goals");

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [entitiesRes, edgesRes, expansionsRes, goalsRes] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db
      .from("expansions")
      .select("entity_id, sub_components, internal_pathways, internal_dynamics")
      .eq("space_id", spaceId),
    db
      .from("improvement_goals")
      .select("id, title, entity_id")
      .eq("space_id", spaceId),
  ]);

  if (entitiesRes.error || edgesRes.error) {
    console.error("[probability-spaces] fetch error:", entitiesRes.error ?? edgesRes.error);
    return NextResponse.json({ error: "Failed to load graph" }, { status: 500 });
  }

  const entities = (entitiesRes.data ?? []) as Entity[];
  const edges = (edgesRes.data ?? []) as Edge[];

  const expansionsMap = new Map<
    string,
    { sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }
  >();
  for (const row of (expansionsRes.data ?? []) as Array<{
    entity_id: string;
    sub_components: unknown;
    internal_pathways: unknown;
    internal_dynamics: unknown;
  }>) {
    expansionsMap.set(row.entity_id, {
      sub_components: row.sub_components,
      internal_pathways: row.internal_pathways,
      internal_dynamics: row.internal_dynamics,
    });
  }

  const allGoals = (goalsRes.data ?? []) as GoalRow[];

  // Resolve goal entity IDs to propagate against. `goal` and `goals` query
  // params narrow the context for lab views that want to see impact relative
  // to a single goal; otherwise we use every goal with a linked entity.
  let scopedGoals: GoalRow[] = allGoals.filter((g) => !!g.entity_id);
  if (goalIdParam) {
    scopedGoals = scopedGoals.filter((g) => g.id === goalIdParam);
  } else if (goalsCsv) {
    const wanted = new Set(goalsCsv.split(",").map((s) => s.trim()).filter(Boolean));
    scopedGoals = scopedGoals.filter((g) => wanted.has(g.id));
  }
  const goalEntityIds = scopedGoals
    .map((g) => g.entity_id)
    .filter((x): x is string => !!x);

  const allSpaces = buildProbabilitySpacesForGraph(edges, entities, expansionsMap, goalEntityIds);

  const spaces: ProbabilitySpace[] = focalId
    ? allSpaces.filter(
        (s) => s.source_entity_id === focalId || s.target_entity_id === focalId,
      )
    : allSpaces;

  return NextResponse.json({
    space_id: spaceId,
    focal_entity_id: focalId,
    spaces,
    count: spaces.length,
    total: allSpaces.length,
    goal_context: {
      active_goal_ids: scopedGoals.map((g) => g.id),
      active_goal_entity_ids: goalEntityIds,
      available_goals: allGoals.map((g) => ({
        id: g.id,
        title: g.title,
        entity_id: g.entity_id,
        has_entity: !!g.entity_id,
      })),
    },
  });
}
