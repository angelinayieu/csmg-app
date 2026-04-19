/**
 * Manual coordinator dispatch endpoint.
 *
 * POST /api/coordinator/dispatch  { goalId }
 *
 * Used by the "Research this goal now" button in the Agent detail panel.
 * Emits a `goal.research.requested` event with `reason: "manual"` — the same
 * entry point the coordinator-tick cron uses. The event is picked up by the
 * `executeGoalResearch` Inngest function, which resolves (or creates) the
 * bound researcher and runs the research pipeline.
 *
 * Auth: user must own the goal's space (RLS via safeAuth).
 */

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { inngest } from "@/inngest/client";

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<{
    goalId?: string;
  }>(request);
  if (parseError) return parseError;

  const goalId = body?.goalId;
  if (!goalId || typeof goalId !== "string") {
    return NextResponse.json({ error: "goalId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Verify ownership via RLS — select only succeeds when user owns the goal.
  const { data: goal } = await db
    .from("improvement_goals")
    .select("id, space_id, user_id, title, status")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!goal) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  if (goal.status !== "active") {
    return NextResponse.json(
      { error: "Goal is not active; cannot dispatch research." },
      { status: 409 }
    );
  }

  try {
    await inngest.send({
      name: "goal.research.requested",
      data: {
        goalId: goal.id as string,
        spaceId: goal.space_id as string,
        userId: user.id,
        reason: "manual",
        goalTitle: typeof goal.title === "string" ? goal.title : undefined,
      },
    });
  } catch (err) {
    console.error("[coordinator/dispatch] Inngest send failed:", err);
    return NextResponse.json(
      { error: "Failed to dispatch research" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    goalId: goal.id,
    dispatched_at: new Date().toISOString(),
  });
}
