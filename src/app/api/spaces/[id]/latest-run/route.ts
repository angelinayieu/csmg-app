// ── GET /api/spaces/[id]/latest-run ──────────────────────────────────
//
// Returns the most recent pipeline_run for this space owned by the
// caller, or null if none exists. Used by interaxis-canvas as a
// FALLBACK source for the SSE subscription when the URL is missing
// the `?run=` query param.
//
// Why this exists: the whiteboard's SSE subscription is keyed on a
// `runId` resolved from the `?run=` query param. If the user
// navigates back to /app/space/[id]/whiteboard WITHOUT that param
// (e.g. via the navbar, a bookmark, or a deep link from another
// tab), `activeRunId` is null → no SSE → no events → no painted
// cards. Even if a strategy-refresh successfully completed on a
// prior visit, the user sees an empty canvas because the painter
// never re-subscribes to the backlog.
//
// This endpoint exposes the latest run so the canvas can fall back
// to it. The stream endpoint at /api/pipeline/stream/[runId] handles
// both running and completed runs (replays backlog, then either
// continues polling for new events or closes cleanly), so this
// fallback works regardless of run status.
//
// Phase-2-relevance: Phase 2's lab events are SSE-delivered
// identically to Phase 1's framing events. Without this fallback,
// any UX flow that involves leaving the whiteboard and coming back
// (e.g. user clicks "Review N framings → /framing/pick → back to
// whiteboard") drops all subsequent lab events. This fix is the
// foundation for every future divergent-cycle increment.
//
// Response shape:
//   { run: { id, status, started_at, pipeline } } | { run: null }
//
// Auth: caller must own the space. Returns 404 on cross-space
// access attempts.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Sort by started_at DESC — the existing index
  // idx_pipeline_runs_space_started covers this query exactly
  // (20260520_pipeline_event_bus.sql:55-56). One row, no scan.
  //
  // Status filter: we accept ANY status (running / completed / failed)
  // because:
  //   - 'running' is the obvious case: an active run the user wants
  //     to watch unfurl
  //   - 'completed' is critical: a finished run whose events were
  //     emitted on a prior visit; replaying the backlog repaints
  //     every card that was rendered before
  //   - 'failed' surfaces the failure HUD so the user knows why
  //     their pipeline didn't produce expected output (essential
  //     for the upcoming Sprint C instrumentation)
  //
  // We DON'T filter "recent" — if the latest run is months old, that's
  // still the user's most recent context. The canvas can render a
  // dismissable "Resume from N days ago?" affordance later if needed.
  const { data, error } = await db
    .from("pipeline_runs")
    .select("id, status, started_at, pipeline")
    .eq("space_id", spaceId)
    .eq("created_by", user.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[latest-run] query failed:", error.message ?? error);
    return NextResponse.json({ run: null });
  }

  return NextResponse.json({ run: data ?? null });
}
