// POST /api/goals/[id]/reject
//
// Wave A — decline an auto-detected proposed objective. Flips status to
// 'rejected' (kept for audit); FK cascade on entity_objectives drops
// its junction rows. Memory item is removed.
//
// Body (optional):
//   reason: string  — free-text note for audit, stored in description.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { RejectGoalInputSchema } from "@/lib/schemas/goal-approval";
import { deleteMemoryItem } from "@/lib/memory/writer";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: goalId } = await ctx.params;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const parsed = RejectGoalInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: goal } = (await db
    .from("improvement_goals")
    .select("id, status, description")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: { id: string; status: string; description: string | null } | null;
  };

  if (!goal) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }
  if (goal.status !== "proposed") {
    return NextResponse.json(
      {
        error: `Goal is ${goal.status}; only 'proposed' goals can be rejected.`,
      },
      { status: 409 },
    );
  }

  // Compose a rejection note into description so the audit is on the row.
  const updateDescription = parsed.data.reason
    ? `${goal.description ?? ""}\n\n[Rejected: ${parsed.data.reason.trim()}]`.trim()
    : goal.description;

  // Clear any entity links first (cascade would handle this too, but
  // explicit is safer and allows us to count what was removed).
  const { count: linksRemoved } = (await db
    .from("entity_objectives")
    .delete({ count: "exact" })
    .eq("goal_id", goalId)) as { count: number | null };

  const { error: updErr } = await db
    .from("improvement_goals")
    .update({
      status: "rejected",
      description: updateDescription,
      resolved_by: user.id,
    })
    .eq("id", goalId)
    .eq("user_id", user.id);

  if (updErr) {
    console.error("[goal reject] update failed:", updErr);
    return NextResponse.json(
      { error: "Failed to reject goal" },
      { status: 500 },
    );
  }

  // Remove the memory item so rejected goals stop surfacing in ambient.
  try {
    await deleteMemoryItem(db, "objective", goalId);
  } catch (memErr) {
    console.warn("[goal reject] memory cleanup failed (non-fatal):", memErr);
  }

  // Wave C — log the user event so the digest agent learns rejection patterns.
  try {
    const { recordUserEvent } = await import("@/lib/user-events/record");
    await recordUserEvent(db, {
      user_id: user.id,
      event_type: "goal.rejected",
      source: `user:reject:${user.id}`,
      ref_kind: "goal",
      ref_id: goalId,
      payload: {
        reason: parsed.data.reason ?? null,
        links_removed: linksRemoved ?? 0,
      },
    });
  } catch {
    /* telemetry non-fatal */
  }

  return NextResponse.json({
    rejected: true,
    id: goalId,
    links_removed: linksRemoved ?? 0,
  });
}
