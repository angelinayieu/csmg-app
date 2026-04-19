import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

/**
 * GET /api/spaces/[id]/metric-trackers
 *
 * Returns active trackers for the space with the latest observation attached.
 * Used by the upcoming experimentation lab UI (Phase 2b).
 *
 * Response: { trackers: Array<TrackerWithLatestObservation> }
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { id: spaceId } = await params;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Load trackers
  const { data: trackers, error: tErr } = await db
    .from("metric_trackers")
    .select("*")
    .eq("space_id", spaceId)
    .eq("status", "active")
    .order("source_kind")
    .order("label");

  if (tErr) {
    console.error("[metric-trackers] list error:", tErr);
    return NextResponse.json({ error: "Failed to fetch trackers" }, { status: 500 });
  }

  const trackerIds = (trackers ?? []).map((t: { id: string }) => t.id);

  // Latest observation per tracker (single query, then reduce in memory).
  let latestByTracker: Record<string, unknown> = {};
  if (trackerIds.length > 0) {
    const { data: obs, error: oErr } = await db
      .from("metric_observations")
      .select("tracker_id, recorded_at, value, value_text, note, source")
      .in("tracker_id", trackerIds)
      .order("recorded_at", { ascending: false });

    if (oErr) {
      console.warn("[metric-trackers] observation fetch failed:", oErr);
    } else {
      for (const o of obs ?? []) {
        const tid = (o as { tracker_id: string }).tracker_id;
        if (!latestByTracker[tid]) latestByTracker[tid] = o;
      }
    }
  }

  const enriched = (trackers ?? []).map((t: { id: string }) => ({
    ...t,
    latest_observation: latestByTracker[t.id] ?? null,
  }));

  return NextResponse.json({ trackers: enriched });
}
