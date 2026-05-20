// ── GET /api/spaces/[id]/operating-twin-context ────────────────────
//
// W4. Returns the data shape OperatingTwinShell needs as props on
// the new Twin Detail Page Operating tab. Replaces useSpaceData()
// for the new mount point — the legacy TwinSurface mount keeps
// reading from SpaceDataProvider.
//
// Returns everything the shell's hook reads:
//   - space (full row)
//   - entities, edges, cycles
//   - claims, propositions
//   - active goal + child goals
//   - pending objectives (suggested but not yet accepted)
//
// No caching — the shell takes its first read on tab activation and
// the realtime hook handles staleness from there. If this becomes a
// hot path, we'll memoize per-space.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type {
  Space,
  Entity,
  Edge,
  Cycle,
  Claim,
  Proposition,
} from "@/types";
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface OperatingTwinContextPayload {
  space: Space;
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  claims: Claim[];
  propositions: Proposition[];
  activeGoal: ImprovementGoal | null;
  childGoals: ImprovementGoal[];
  pendingObjectives: SuggestedObjective[];
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id: spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [
    spaceRes,
    entRes,
    edgeRes,
    cycleRes,
    claimsRes,
    propsRes,
    goalsRes,
    pendingObjRes,
  ] = await Promise.all([
    db.from("spaces").select("*").eq("id", spaceId).maybeSingle(),
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db.from("cycles").select("*").eq("space_id", spaceId),
    db.from("claims").select("*").eq("space_id", spaceId),
    db.from("propositions").select("*").eq("space_id", spaceId),
    db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false }),
    // pendingObjectives ↔ proposed_objectives table. Empty array is
    // a fine fallback when the table doesn't exist on a given env.
    db
      .from("proposed_objectives")
      .select("*")
      .eq("space_id", spaceId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if ((spaceRes.data as Space).user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const goals = (goalsRes.data ?? []) as ImprovementGoal[];
  // Pick the active goal the same way SpaceDataProvider does — top-
  // level (no parent_goal_id) preferred, then any active goal.
  const activeGoal =
    goals.find((g) => g.status === "active" && !g.parent_goal_id) ??
    goals.find((g) => g.status === "active") ??
    null;
  const childGoals = activeGoal
    ? goals.filter((g) => g.parent_goal_id === activeGoal.id)
    : [];

  const payload: OperatingTwinContextPayload = {
    space: spaceRes.data as Space,
    entities: (entRes.data ?? []) as Entity[],
    edges: (edgeRes.data ?? []) as Edge[],
    cycles: (cycleRes.data ?? []) as Cycle[],
    claims: (claimsRes.data ?? []) as Claim[],
    propositions: (propsRes.data ?? []) as Proposition[],
    activeGoal,
    childGoals,
    pendingObjectives: (pendingObjRes.data ?? []) as SuggestedObjective[],
  };

  return NextResponse.json(payload);
}
