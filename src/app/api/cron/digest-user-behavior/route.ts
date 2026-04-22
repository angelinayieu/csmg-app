/**
 * Cron: user-behavior digest
 *
 * Wave C. Fires daily (add schedule "0 4 * * *" to vercel.json — 4 AM
 * UTC, low-traffic window). Picks candidate users with stale digests
 * or enough new events since last run and re-runs the LLM digest on
 * each, writing persona_tags / behavior_summary / goal_preferences /
 * baseline_metrics into profiles.
 *
 * Auth: CRON_SECRET bearer, same pattern as predictions-resolve.
 *
 * Per-invocation cap: 200 users so a single cron tick doesn't burn the
 * entire token budget. If backlog forms, increase cadence to hourly.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { digestAllStaleUsers } from "@/lib/user-events/digest";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();

  try {
    const result = await digestAllStaleUsers(db, {
      eventThreshold: 20,
      staleAgeHours: 24,
      maxUsers: 200,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      ran_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[cron:digest-user-behavior] failed:", err);
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
