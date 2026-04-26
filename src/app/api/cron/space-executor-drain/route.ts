/**
 * Cron: Space Work Queue drain
 *
 * Fires every 10 minutes via Vercel Cron (see vercel.json). Finds
 * spaces with pending rows in `space_work_queue` and drains up to
 * PER_SPACE_CAP items per space, across up to MAX_SPACES_PER_TICK
 * spaces per invocation.
 *
 * This is the backstop for the strategizer pipeline: users can
 * always hit POST /api/pipeline/space-executor manually to drain
 * faster, but if nobody does, this cron guarantees forward
 * progress with bounded latency.
 *
 * Auth: CRON_SECRET bearer header — same pattern as axis-scorer /
 * research-loop / predictions-resolve.
 *
 * Discovery:
 *   SELECT distinct space_id FROM space_work_queue WHERE status='pending'
 *   ORDER BY oldest created_at asc
 *   LIMIT MAX_SPACES_PER_TICK
 *
 * Per-space drain:
 *   requeueStale=true (sweep items stuck in_progress from a crashed
 *   tick) then claim up to PER_SPACE_CAP pending rows in priority
 *   order and execute them.
 *
 * Budget:
 *   signature_deepen ≈ 1 LLM call × ~400 tokens × ~3-5s each.
 *   MAX_SPACES_PER_TICK=5 × PER_SPACE_CAP=3 = 15 items worst case,
 *   ≈ 75s under the 300s maxDuration. Stub kinds return instantly.
 *
 * Idempotency: a row flipped to in_progress is invisible to the next
 * tick's discovery query (status='pending' predicate). On a crash
 * mid-drain, stale in_progress rows are requeued by requeueStaleItems
 * on the next tick.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { drainSpaceQueue, type DrainResult } from "@/lib/pipeline/space-executor-drain";

export const maxDuration = 300; // 5 minutes
export const dynamic = "force-dynamic";

const MAX_SPACES_PER_TICK = 5;
const PER_SPACE_CAP = 3;
const STALE_SECONDS = 300; // 5 min — matches the requeue helper default

export async function GET(request: Request) {
  // ── Auth ──
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const startedAt = new Date().toISOString();

  // ── Discover spaces with pending work ──
  //
  // PostgREST doesn't expose DISTINCT directly, so we pull the oldest
  // pending rows (enough to cover the cap even with heavy duplication
  // per space) and uniq them in JS. The partial index
  // `space_work_queue_space_pending_idx` makes this query cheap.
  const { data: pendingRows, error: pendingErr } = await db
    .from("space_work_queue")
    .select("space_id, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(MAX_SPACES_PER_TICK * 10);

  if (pendingErr) {
    console.error("[cron:space-executor-drain] pending read failed:", pendingErr);
    return NextResponse.json(
      { ok: false, error: pendingErr.message, ran_at: startedAt },
      { status: 500 },
    );
  }

  const rows = (pendingRows ?? []) as Array<{ space_id: string; created_at: string }>;
  const seen = new Set<string>();
  const spaceIds: string[] = [];
  for (const r of rows) {
    if (!r.space_id || seen.has(r.space_id)) continue;
    seen.add(r.space_id);
    spaceIds.push(r.space_id);
    if (spaceIds.length >= MAX_SPACES_PER_TICK) break;
  }

  if (spaceIds.length === 0) {
    return NextResponse.json({
      ok: true,
      drained_spaces: 0,
      claimed_total: 0,
      results: [],
      ran_at: startedAt,
    });
  }

  // ── Drain each space sequentially ──
  //
  // Sequential (not Promise.all) so we stay predictable under the
  // LLM rate limit and don't explode concurrency when the queue is
  // full. 5 spaces × 3 items × a few seconds each is comfortable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const perSpaceResults: DrainResult[] = [];
  let claimedTotal = 0;
  let failedTotal = 0;
  let completedTotal = 0;
  let skippedTotal = 0;

  for (const spaceId of spaceIds) {
    try {
      const result = await drainSpaceQueue(anyDb, {
        spaceId,
        maxItems: PER_SPACE_CAP,
        runId: null, // cron is detached from any pipeline run
        requeueStale: true,
        staleSeconds: STALE_SECONDS,
      });
      perSpaceResults.push(result);
      claimedTotal += result.claimed;
      for (const r of result.results) {
        if (r.status === "completed") completedTotal += 1;
        else if (r.status === "failed") failedTotal += 1;
        else if (r.status === "skipped") skippedTotal += 1;
      }
    } catch (err) {
      // drainSpaceQueue already soft-fails per item, so a throw here
      // is unexpected — log and continue to the next space.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron:space-executor-drain] space ${spaceId} drain threw:`, message);
      perSpaceResults.push({
        space_id: spaceId,
        claimed: 0,
        results: [],
        requeued_stale: 0,
        run_id: null,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    drained_spaces: spaceIds.length,
    claimed_total: claimedTotal,
    completed: completedTotal,
    failed: failedTotal,
    skipped: skippedTotal,
    results: perSpaceResults,
    ran_at: startedAt,
  });
}
