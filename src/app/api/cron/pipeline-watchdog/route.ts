// ── Pipeline-run watchdog ────────────────────────────────────────────
//
// Background sweep that flips orphaned `pipeline_runs` from
// `status='running'` to `status='failed'` when they've gone quiet
// past a sane threshold. Without this, ANY failure mode in the
// chain (decompose Pass 1 hang, missing handoff, dev-server hot
// reload mid-flight, Lambda OOM, cookie decode error between hops)
// leaves the row at `running` forever:
//
//   • SSE consumers stay subscribed expecting a `done` that never
//     comes.
//   • The space card's "in flight" badge never clears.
//   • The next intake reuse-existing-space path mis-counts an
//     unfinished prior run.
//
// The diagnosis on 2026-04-24 of run c13f5bbf… surfaced this gap:
// decompose Pass 1 hung 6 minutes, fallback path emitted kg:exit,
// then research's after()-block handoff silently failed in dev mode
// and the run sat at `running` for 18+ minutes with no protection.
// A handful of similar orphans (8 visible in spot-check) had been
// accumulating across earlier days with the same shape.
//
// Two thresholds, OR'd:
//   • IDLE_MS — last event emitted > 3 minutes ago. Catches mid-run
//     hangs (some events fire, then the chain dies between hops).
//   • ABSOLUTE_MS — started > 15 minutes ago. Catches "Lambda
//     accepted the request and crashed before any emit landed"
//     where there are zero events and IDLE_MS would defer forever.
//
// Both can run safely on a busy system because the worst case is a
// premature kill of a legitimately slow run — and 15 minutes is
// >2× the worst-case observed cold-start + Pass 1 + Pass 2 + research +
// synthesize + strategy-refresh chain. If real workloads start
// pushing that envelope we lift the cap; we do NOT remove the
// watchdog, because no watchdog == orphan rows == every screen lies.
//
// Endpoint contract:
//   GET  — Vercel Cron entry. Requires `Authorization: Bearer
//          ${CRON_SECRET}` header. Production schedule TBD (every 5
//          minutes is the recommended setup).
//   POST — Programmatic / dev-loop trigger. Same logic, no auth (so
//          local dev can fire it from a button or page-load
//          fire-and-forget without juggling secrets). Rate-limit at
//          the proxy layer if exposing publicly.
//
// Always returns JSON: `{ swept: number, runs: [{id, reason, age_s}] }`.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { completePipelineRun } from "@/lib/events/structural-event-bus";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 3 minutes since last event = stuck mid-chain.
const IDLE_MS = 3 * 60 * 1000;
// 15 minutes since started = stuck even with zero events.
const ABSOLUTE_MS = 15 * 60 * 1000;
// Hard cap so a single sweep never swallows runaway hours of work.
const MAX_PER_SWEEP = 50;

interface SweptRun {
  id: string;
  pipeline: string;
  reason: "idle" | "absolute";
  age_seconds: number;
  last_event_age_seconds: number | null;
}

async function runSweep(): Promise<{ swept: number; runs: SweptRun[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const now = Date.now();

  // Pull all currently-running rows. We expect this set to be small
  // (single-digit) on a healthy system. If it ever balloons that's
  // itself a signal — log it.
  const { data: candidates, error: candidatesErr } = await db
    .from("pipeline_runs")
    .select("id, pipeline, started_at, last_sequence")
    .eq("status", "running")
    .order("started_at", { ascending: true })
    .limit(200);

  if (candidatesErr) {
    console.warn("[pipeline-watchdog] candidates query failed:", candidatesErr);
    return { swept: 0, runs: [] };
  }

  if (!candidates?.length) return { swept: 0, runs: [] };
  if (candidates.length > 50) {
    console.warn(
      `[pipeline-watchdog] ${candidates.length} running runs in flight — investigate.`,
    );
  }

  const swept: SweptRun[] = [];

  for (const run of candidates as Array<{
    id: string;
    pipeline: string;
    started_at: string;
    last_sequence: number;
  }>) {
    if (swept.length >= MAX_PER_SWEEP) break;

    const startedMs = new Date(run.started_at).getTime();
    const ageMs = now - startedMs;

    // Fast path: if it hasn't been started long enough to even cross
    // the idle threshold, skip without hitting the events table.
    if (ageMs < IDLE_MS) continue;

    // Cheap probe: read MAX(emitted_at) for this run. Cheap because
    // (run_id, sequence) is the unique-key index on pipeline_run_events.
    const { data: lastEventRow } = await db
      .from("pipeline_run_events")
      .select("emitted_at")
      .eq("run_id", run.id)
      .order("emitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastEventMs = lastEventRow?.emitted_at
      ? new Date(lastEventRow.emitted_at).getTime()
      : null;
    const idleMs = lastEventMs == null ? ageMs : now - lastEventMs;

    let reason: "idle" | "absolute" | null = null;
    if (idleMs >= IDLE_MS) reason = "idle";
    if (ageMs >= ABSOLUTE_MS) reason = reason ?? "absolute";
    if (!reason) continue;

    const ageSec = Math.round(ageMs / 1000);
    const idleSec = lastEventMs == null ? null : Math.round(idleMs / 1000);
    const message =
      reason === "idle"
        ? `watchdog: no events for ${idleSec}s (last_sequence=${run.last_sequence})`
        : `watchdog: stuck running for ${ageSec}s with no progress`;

    await completePipelineRun(db, run.id, "failed", message);
    swept.push({
      id: run.id,
      pipeline: run.pipeline,
      reason,
      age_seconds: ageSec,
      last_event_age_seconds: idleSec,
    });
  }

  if (swept.length > 0) {
    console.log(
      `[pipeline-watchdog] swept ${swept.length} stuck run(s):`,
      swept.map((r) => `${r.id.slice(0, 8)}/${r.pipeline}/${r.reason}/${r.age_seconds}s`).join(", "),
    );
  }

  return { swept: swept.length, runs: swept };
}

export async function GET(request: Request) {
  // Cron auth — same pattern as other cron routes in this codebase.
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runSweep();
  return NextResponse.json(result);
}

export async function POST() {
  // Programmatic / dev-loop trigger. No auth — intended for local dev
  // to self-heal stuck runs without setting up CRON_SECRET. In
  // production this is fine to leave open: the only effect is
  // marking already-stuck runs failed, which is desirable.
  const result = await runSweep();
  return NextResponse.json(result);
}
