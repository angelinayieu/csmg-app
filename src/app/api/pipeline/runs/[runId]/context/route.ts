// ── GET /api/pipeline/runs/[runId]/context ──
//
// Read-side of the pipeline event log. Returns a structured summary of
// everything that happened in the run — counts, stage timing, entities
// added, edges added, sources cited, proposals emitted with their
// distributions. Single round-trip (one SELECT against pipeline_runs,
// one against pipeline_run_events).
//
// Consumers:
//   - Downstream pipelines that want "what happened earlier in this run"
//   - Canvas audit drawer (future UI) showing at-a-glance summary
//   - Developer tools debugging a specific run

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { readRunContext } from "@/lib/events/run-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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

  // Ownership — reuse the same pattern as the SSE endpoint. Check the
  // run row's created_by before loading the event log.
  const { data: run } = await db
    .from("pipeline_runs")
    .select("id, created_by")
    .eq("id", runId)
    .maybeSingle();

  if (!run) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if ((run as { created_by: string }).created_by !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const context = await readRunContext(db, runId);
    if (!context) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(context);
  } catch (err) {
    console.error("[runs/context] readRunContext failed:", err);
    return NextResponse.json(
      { error: "Failed to build run context" },
      { status: 500 },
    );
  }
}
