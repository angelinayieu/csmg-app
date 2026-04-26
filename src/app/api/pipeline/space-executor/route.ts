// POST /api/pipeline/space-executor
//
// Consumes pending items from space_work_queue and executes them.
// Returns a summary of what it did. Caller controls how many items
// to drain in one invocation via `max_items` (default 3, cap 10).
//
// This endpoint is called AFTER the strategizer has planned and
// enqueued rows. It does NOT plan; planning is a separate contract.
//
// The actual claim + dispatch logic lives in
//   src/lib/pipeline/space-executor-drain.ts
// so the cron (/api/cron/space-executor-drain) can share it with a
// service-role client. This route is a thin auth + ownership wrapper.
//
// GET variant returns the queue summary for a space (next pending
// item, counts per status) for UI badges without needing to hit the
// bulk queue endpoint.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { getQueueSummary, type SpaceWorkKind } from "@/lib/pipeline/space-work-queue";
import { drainSpaceQueue } from "@/lib/pipeline/space-executor-drain";

export const maxDuration = 120;
export const runtime = "nodejs";

interface ExecutorRequest {
  space_id: string;
  max_items?: number;
  kinds?: SpaceWorkKind[];
  run_id?: string | null;
  requeue_stale?: boolean;
  stale_seconds?: number;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Partial<ExecutorRequest>>(request);
  if (parseError) return parseError;

  const spaceId = body?.space_id;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const result = await drainSpaceQueue(db, {
    spaceId,
    maxItems: body?.max_items,
    kinds: body?.kinds,
    runId: body?.run_id ?? null,
    requeueStale: body?.requeue_stale === true,
    staleSeconds: typeof body?.stale_seconds === "number" ? body.stale_seconds : undefined,
  });

  return NextResponse.json(result);
}

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const summary = await getQueueSummary(db, spaceId);
  return NextResponse.json(summary);
}
