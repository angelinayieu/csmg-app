/**
 * GET /api/agents?space_id=...
 * Returns the agent fleet + recent runs for a space.
 * Lazy-seeds the default fleet when the space has no agents yet (backfill).
 */

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { backfillAgentsIfMissing } from "@/lib/agents/seeding";

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json({ error: "space_id required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Verify the user owns this space before seeding / reading
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();

  if (!space || space.user_id !== user.id) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // Backfill: if zero agents exist for this space, seed the default fleet.
  await backfillAgentsIfMissing(db, spaceId, user.id);

  // Fetch agents
  const { data: agents, error: agentsErr } = await db
    .from("agents")
    .select("*")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: true });

  if (agentsErr) {
    return NextResponse.json({ error: agentsErr.message }, { status: 500 });
  }

  // Fetch recent runs (last 200 across all agents for this space)
  const { data: recentRuns, error: runsErr } = await db
    .from("agent_runs")
    .select("*")
    .eq("space_id", spaceId)
    .order("started_at", { ascending: false })
    .limit(200);

  if (runsErr) {
    return NextResponse.json({ error: runsErr.message }, { status: 500 });
  }

  // Phase B: decorate bound agents with their goal titles. One query per
  // request — cheap, since the set of goal IDs is small.
  const agentRows = (agents ?? []) as Array<Record<string, unknown>>;
  const boundGoalIds = Array.from(
    new Set(
      agentRows
        .map((a) => a.source_goal_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );

  const goalTitleById: Record<string, string> = {};
  if (boundGoalIds.length > 0) {
    const { data: goalRows } = await db
      .from("improvement_goals")
      .select("id, title, status")
      .in("id", boundGoalIds);
    for (const g of (goalRows ?? []) as Array<{ id: string; title: string }>) {
      goalTitleById[g.id] = g.title;
    }
  }

  const agentsWithTitles = agentRows.map((a) => {
    const gid = typeof a.source_goal_id === "string" ? a.source_goal_id : null;
    return {
      ...a,
      bound_goal_title: gid ? goalTitleById[gid] ?? null : null,
    };
  });

  return NextResponse.json({
    agents: agentsWithTitles,
    recent_runs: recentRuns ?? [],
  });
}
