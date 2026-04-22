// ── GET /api/spaces/[id]/runs ──
//
// List recent pipeline runs for a space. Backs the run-history picker
// in the canvas audit panel — users click a past run to load its
// structured context without hunting for runIds in URLs or logs.
//
// Returns up to 30 most-recent runs regardless of status (running /
// completed / failed). Ownership enforced by RLS on pipeline_runs
// (created_by = auth.uid).

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 30;

interface RunSummary {
  id: string;
  pipeline: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  initial_prompt: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const { id: spaceId } = await params;
  if (!spaceId) {
    return NextResponse.json(
      { error: "space id required" },
      { status: 400 },
    );
  }

  // Space ownership check — pipeline_runs RLS enforces created_by but
  // we want the 404 vs 403 distinction to match other space endpoints.
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("pipeline_runs")
    .select(
      "id, pipeline, status, started_at, completed_at, initial_prompt",
    )
    .eq("space_id", spaceId)
    .order("started_at", { ascending: false })
    .limit(LIMIT);

  if (error) {
    console.error("[spaces/runs] query failed:", error);
    return NextResponse.json(
      { error: "Failed to list runs" },
      { status: 500 },
    );
  }

  const runs = (data ?? []) as RunSummary[];
  return NextResponse.json({ runs });
}
