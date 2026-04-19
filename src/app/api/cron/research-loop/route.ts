/**
 * Cron: Self-Improving Research Loop
 *
 * Fires every 15 minutes via Vercel Cron. Finds spaces with enabled
 * research schedules that are overdue, and runs the self-improving
 * loop for each (capped at 3 per invocation).
 *
 * Auth: Verified via CRON_SECRET header (set in Vercel env vars).
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { executeResearchLoop } from "@/lib/pipeline/self-improving-loop";
import type { ResearchSchedule } from "@/types/intelligence";

export const maxDuration = 300; // 5 minutes
export const dynamic = "force-dynamic";

const MAX_SPACES_PER_INVOCATION = 3;

export async function GET(request: Request) {
  // ── Auth: verify cron secret ──
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const results: Array<{
    space_id: string;
    cycle_number: number;
    status: string;
    delta?: Record<string, number>;
    error?: string;
  }> = [];

  // ── Phase B: yield to Inngest coordinator when it is healthy ──
  // If any coordinator-tick agent run landed in the last 10 minutes, we
  // assume the Inngest 5-min cron is driving per-goal research and skip this
  // fallback tick entirely to avoid double-research + doubled cost. The
  // fallback only kicks in when the Coordinator is down.
  try {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;
    const { data: recent } = await dbAny
      .from("agent_runs")
      .select("id")
      .eq("trigger_event", "coordinator.tick")
      .gte("started_at", cutoff)
      .limit(1)
      .maybeSingle();

    if (recent?.id) {
      return NextResponse.json({
        skipped: "coordinator_healthy",
        last_tick_within: "10m",
      });
    }
  } catch (err) {
    // Non-fatal — if the skip check fails we just run the fallback anyway.
    console.warn("[cron/research-loop] coordinator-health check failed:", err);
  }

  try {
    // ── Find due spaces ──
    // Query spaces where schedule.enabled = true AND next_run_at <= now()
    const { data: spaces, error } = await db
      .from("spaces")
      .select("id, user_id, synthesis_data")
      .not("synthesis_data", "is", null)
      .order("updated_at", { ascending: true })
      .limit(50); // Broad fetch, filter in code

    if (error) {
      console.error("[cron/research-loop] DB query error:", error);
      return NextResponse.json({ error: "DB query failed" }, { status: 500 });
    }

    // Filter to spaces with enabled schedules that are overdue
    const dueSpaces: Array<{
      id: string;
      user_id: string;
      schedule: ResearchSchedule;
    }> = [];

    for (const space of spaces ?? []) {
      const synth = space.synthesis_data as Record<string, unknown> | null;
      if (!synth) continue;

      const radar = synth.intelligence_radar as Record<string, unknown> | null;
      if (!radar) continue;

      const schedule = radar.schedule as ResearchSchedule | null;
      if (!schedule?.enabled) continue;
      if (schedule.cadence === "manual") continue;

      // Check if overdue
      if (schedule.next_run_at) {
        const nextRun = new Date(schedule.next_run_at).getTime();
        if (Date.now() < nextRun) continue;
      }

      dueSpaces.push({
        id: space.id as string,
        user_id: space.user_id as string,
        schedule,
      });

      if (dueSpaces.length >= MAX_SPACES_PER_INVOCATION) break;
    }

    if (dueSpaces.length === 0) {
      return NextResponse.json({
        message: "No spaces due for research",
        checked: (spaces ?? []).length,
      });
    }

    // ── Execute loop for each due space ──
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

    for (const space of dueSpaces) {
      try {
        const record = await executeResearchLoop({
          spaceId: space.id,
          userId: space.user_id,
          schedule: space.schedule,
          baseUrl,
          serviceRoleKey,
        });

        results.push({
          space_id: space.id,
          cycle_number: record.cycle_number,
          status: record.status,
          delta: {
            entities_added: record.delta.entities_added,
            edges_added: record.delta.edges_added,
          },
        });
      } catch (err) {
        results.push({
          space_id: space.id,
          cycle_number: 0,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      message: `Processed ${results.length} spaces`,
      results,
    });
  } catch (err) {
    console.error("[cron/research-loop] Fatal error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
