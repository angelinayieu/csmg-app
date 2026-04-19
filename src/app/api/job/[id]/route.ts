import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

/**
 * Fetch analysis_jobs row + recent job_events for the given job.
 * Used as:
 *   - Primer by useJobStream() on mount
 *   - Fallback when Supabase Realtime is unavailable
 *
 * RLS ensures users can only read their own jobs.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing job id" }, { status: 400 });
  }

  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: job, error: jobErr } = await db
    .from("analysis_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (jobErr) {
    return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { data: events, error: eventsErr } = await db
    .from("job_events")
    .select("*")
    .eq("job_id", id)
    .order("created_at", { ascending: true })
    .limit(200);

  if (eventsErr) {
    return NextResponse.json({ error: eventsErr.message }, { status: 500 });
  }

  return NextResponse.json({ job, events: events ?? [] });
}
