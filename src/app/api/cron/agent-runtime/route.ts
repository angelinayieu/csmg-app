/**
 * Cron: Per-app agent runtime
 *
 * Tier 5 of the App+Strategy Rigor sprint. Fires every 2 hours via
 * Vercel Cron. Enumerates apps with an active sub-strategy + declared
 * predictor agent, checks which are due for a run, and invokes the
 * predictor. Each run writes a row to app_agent_runs for audit.
 *
 * v1 runs predictor agents only; v2 will also handle measurer,
 * validator, and critic roles. The scheduler's loop + app_agent_runs
 * schema is role-agnostic — v2 lands without route changes.
 *
 * Auth: Verified via CRON_SECRET header, matching other crons.
 *
 * Budget: bounded at 50 apps per invocation (see MAX_APPS_PER_RUN in
 * scheduler.ts). At 12 invocations/day × 50 apps = 600 app-runs/day
 * maximum per user, which matches our expected scale.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runAgentRuntime } from "@/lib/agents/scheduler";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Auth — same pattern as /api/cron/research-loop + /api/cron/predictions-resolve
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();

  try {
    const result = await runAgentRuntime(db);
    return NextResponse.json({
      ok: true,
      ...result,
      ran_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[cron:agent-runtime] failed:", err);
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
