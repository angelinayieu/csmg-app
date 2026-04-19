/**
 * Cron: Prediction resolver
 *
 * Item 2 of the App+Strategy Rigor sprint. Fires hourly via Vercel Cron
 * (scheduled in vercel.json). Processes open prediction_ledger rows whose
 * horizon_at is in the past: pulls the actual from metric_observations
 * (or metric_trackers.current_value as fallback), computes deviation,
 * assigns a deviation_tag (expected | regime_shift | surprise | qualitative),
 * and transitions status to 'resolved' or 'abandoned'.
 *
 * Auth: Verified via CRON_SECRET header (set in Vercel env vars) — same
 * pattern as /api/cron/research-loop.
 *
 * Batch cap: 200 predictions per invocation so a backlog doesn't starve
 * the cron budget. Each unresolved row stays open and gets retried next
 * tick; the index `idx_prediction_ledger_open_horizon` keeps the query
 * cheap even when the ledger is large.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePredictions } from "@/lib/twin/resolve-predictions";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BATCH_SIZE = 200;

export async function GET(request: Request) {
  // Auth — matches research-loop route
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();

  try {
    const result = await resolvePredictions(db, { batchSize: BATCH_SIZE });
    return NextResponse.json({
      ok: true,
      ...result,
      ran_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[cron:predictions-resolve] failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ran_at: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
