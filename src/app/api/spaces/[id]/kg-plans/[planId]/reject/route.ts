// POST /api/spaces/[id]/kg-plans/[planId]/reject
//
// Reject a proposed plan. Closes the plan + the in-progress
// plan_propose pipeline_run. The user can re-plan via
// /api/pipeline/propose-plan with superseded_plan_id pointing here.
//
// Body (optional): { reason?: string }

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import {
  emitStructuralEvent,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import type { KgGenerationPlan } from "@/types/kg-generation-plan";

export const runtime = "nodejs";

interface RequestBody {
  reason?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> },
) {
  const { id: spaceId, planId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body } = await safeJsonParse<RequestBody>(request);
  const reason = body?.reason?.slice(0, 500) ?? null;

  const { data: planRow } = (await db
    .from("kg_generation_plans")
    .select("status, pipeline_handoff_context")
    .eq("id", planId)
    .eq("space_id", spaceId)
    .maybeSingle()) as {
    data: Pick<
      KgGenerationPlan,
      "status" | "pipeline_handoff_context"
    > | null;
  };

  if (!planRow) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  if (planRow.status === "approved") {
    return NextResponse.json(
      { error: "Cannot reject an approved plan" },
      { status: 400 },
    );
  }
  if (planRow.status === "rejected" || planRow.status === "superseded") {
    return NextResponse.json({ alreadyClosed: true });
  }

  const { error: updErr } = await db
    .from("kg_generation_plans")
    .update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq("id", planId);

  if (updErr) {
    return NextResponse.json(
      { error: `Failed to reject plan: ${updErr.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // Close the plan_propose pipeline_run.
  const { data: runRow } = (await db
    .from("pipeline_runs")
    .select("id")
    .eq("space_id", spaceId)
    .eq("pipeline", "plan_propose")
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };

  await emitStructuralEvent(db, runRow?.id ?? null, {
    type: "kg_plan_rejected",
    planId,
    rejectionReason: reason,
  });
  await completePipelineRun(db, runRow?.id ?? null, "failed").catch(() => {});

  // ── Cancel the bootstrap-time reservation + close intake run ───
  //
  // When the plan was created via the bootstrap chain, we hold a
  // credit reservation open across the review. On rejection the
  // reservation never gets consumed (no decompose runs), so refund
  // it. Also close the intake_bootstrap run so its SSE consumers
  // stop waiting.
  const handoffCtx = planRow.pipeline_handoff_context;
  if (handoffCtx) {
    const { cancelReservation } = await import("@/lib/credits");
    await cancelReservation(db, handoffCtx.reservation_id).catch(() => {});
    await emitStructuralEvent(db, handoffCtx.intake_run_id, {
      type: "stage_boundary",
      stage: "intake",
      phase: "exit",
      message: "Plan rejected — pipeline halted.",
    }).catch(() => {});
    await completePipelineRun(
      db,
      handoffCtx.intake_run_id,
      "failed",
      "Plan rejected by user",
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
