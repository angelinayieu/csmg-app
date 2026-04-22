/**
 * Cron: App health re-computation
 *
 * Wave B. Walks the `apps` table and recomputes `health_score` for
 * every non-retired app. Does NOT clear staleness — this is an "update
 * the number" pass, not a "mark it reviewed" pass.
 *
 * Scheduled via Vercel Cron (add entry to vercel.json). Recommended
 * cadence: every 6 hours. Fires via CRON_SECRET bearer auth matching
 * the existing cron pattern.
 *
 * Why batched + capped:
 *   - `reconcileAppWithKG` does 3 DB queries per app (synthesis, goal,
 *     interventions, predictions). 500 apps × 4 round-trips = 2000
 *     queries, well within Vercel's 300s maxDuration.
 *   - Cap at BATCH_SIZE=500 per tick so a very large account doesn't
 *     stall a single invocation. Next tick resumes.
 *
 * Ordering: least-recently-refreshed first, so apps that haven't been
 * reconciled in days get priority.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { recomputeAppHealth } from "@/lib/apps/app-updates";
import type { AppRow } from "@/types/app";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BATCH_SIZE = 500;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data: apps, error } = (await anyDb
      .from("apps")
      .select("*")
      .neq("status", "retired")
      .order("last_refreshed_at", { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE)) as {
      data: AppRow[] | null;
      error: unknown;
    };

    if (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    const rows = apps ?? [];
    let recomputed = 0;
    let failed = 0;

    // Sequential: each reconcile does several DB round-trips; parallelising
    // would just move bottleneck to DB connections. Cron budget is generous.
    for (const app of rows) {
      try {
        // recomputeAppHealth does NOT clear staleness — staleness flips
        // only on explicit user refresh via /api/apps/[id]/refresh so
        // review badges aren't silently hidden by this cron.
        await recomputeAppHealth(db, app, "cron:recompute-app-health");
        recomputed += 1;
      } catch (err) {
        console.warn(
          `[cron:recompute-app-health] app ${app.id} failed:`,
          err,
        );
        failed += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: rows.length,
      recomputed,
      failed,
      batch_size_cap: BATCH_SIZE,
      ran_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[cron:recompute-app-health] failed:", err);
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
