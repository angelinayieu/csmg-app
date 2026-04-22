// ── POST /api/pipeline/runs/[runId]/cancel ──
//
// User-initiated stop. Flips pipeline_runs.status → "failed" with
// error_message = "Cancelled by user". The SSE stream polls status
// every 500ms and closes as soon as it observes the non-running
// state, so the canvas HUD terminates in under a second.
//
// Today this does NOT cooperatively interrupt routes already in
// flight (they run to completion but their trailing events simply
// land after the stream has closed). A follow-up will add cancel-
// check gates in the long routes so the background work truly halts.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { completePipelineRun, emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type { PipelineRunRow } from "@/types/pipeline-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { runId } = await params;

  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: run } = (await db
    .from("pipeline_runs")
    .select("id, created_by, status")
    .eq("id", runId)
    .maybeSingle()) as {
    data: Pick<PipelineRunRow, "id" | "created_by" | "status"> | null;
  };

  if (!run) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (run.created_by !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (run.status !== "running") {
    return NextResponse.json({ ok: true, alreadyEnded: true, status: run.status });
  }

  try {
    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "results",
      phase: "exit",
      message: "Cancelled by user",
    });
  } catch {
    // Non-fatal — final status update below is the source of truth.
  }

  await completePipelineRun(db, runId, "failed", "Cancelled by user");

  return NextResponse.json({ ok: true });
}
