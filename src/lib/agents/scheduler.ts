// ── Agent runtime scheduler (Tier 5 v1) ────────────────────────────────
//
// Orchestrates per-app agent execution. Called by /api/cron/agent-runtime
// every 2 hours. Does the simple thing: enumerate every active app with
// an active sub-strategy, and for each declared agent, check if a run is
// due; if so, invoke the agent and record the run.
//
// v1 only runs predictor agents. v2 will fan out to measurer, validator,
// critic — the row schema in app_agent_runs is already role-agnostic.
//
// "Due" semantics:
//   - Look up the most recent completed run for (app_id, agent_id)
//   - Compute next_due_at = that run's completed_at + cadence
//   - If now >= next_due_at, the agent is due
//   - First-time runs (no prior completion) are always due
//
// Cadence derivation:
//   - Prefer AgentSpec.measurement_spec.cadence when set
//   - Fall back to sub-strategy's prediction_spec.default_horizon_days / 4
//     (so we generate ~4 predictions per horizon period, giving the
//     resolver cron enough data to notice regime shifts)
//   - Floor at 6 hours so even "on_event" + short-horizon combinations
//     don't spam the predictor
//
// Failure isolation: one app's predictor failing shouldn't block others.
// Each app's run is wrapped in its own try/catch; failures are recorded
// as app_agent_runs rows with status=failed + the error message in note.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { AppRow } from "@/types/app";
import type { AppStrategyRow } from "@/types/app-strategy";
import type { AgentSpec } from "@/types/strategy";
import type { AppAgentRunRow, PredictorOutput } from "@/types/agent-run";
import {
  runPredictorAgent,
  findPredictorAgent,
  hydrateSubStrategy,
} from "./predictor-agent";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<Database> | any;

// Tuning constants — deliberately conservative for v1.
//
// MAX_APPS_PER_RUN bounds cron cost. A space with 100 apps × 2h cadence
// = 1,200 runs/day per app; 5 spaces × that = 6,000 runs/day. We let
// the cron handle up to 50 apps per invocation; overflow waits for the
// next tick. At Vercel's 2h cron cadence, 50 apps/run × 12 runs/day =
// 600 apps/day ceiling per user before we start dropping runs.
const MAX_APPS_PER_RUN = 50;

// Concurrency within a run — LLM IO-bound even though v1 doesn't use
// the LLM, for parity with batch sub-strategy generation. When v2 adds
// LLM predictors, this cap prevents rate-limit cascades.
const CONCURRENCY = 3;

// Minimum interval between two runs of the same agent on the same app.
// Prevents "on_event" cadence from turning into a spam loop. 6 hours
// means the predictor can emit at most 4 predictions per 24h per app.
const MIN_INTERVAL_HOURS = 6;

// Fallback cadence when neither measurement_spec.cadence nor a usable
// prediction_spec horizon is set. 24h is a safe default; most metrics
// move slowly enough that daily predictions are enough signal.
const FALLBACK_CADENCE_HOURS = 24;

export interface SchedulerResult {
  scanned: number;
  eligible: number;
  ran: number;
  skipped: number;
  failed: number;
  by_outcome: Record<string, number>;
}

export async function runAgentRuntime(db: DB): Promise<SchedulerResult> {
  const result: SchedulerResult = {
    scanned: 0,
    eligible: 0,
    ran: 0,
    skipped: 0,
    failed: 0,
    by_outcome: {},
  };

  // Pull active sub-strategies across all spaces. RLS is bypassed here
  // because the cron uses the service client — we scope manually via
  // the user_id on each row.
  const { data: subRows } = await db
    .from("app_strategies")
    .select("*")
    .eq("status", "active")
    .limit(MAX_APPS_PER_RUN);

  const subStrategies = (subRows ?? []) as AppStrategyRow[];
  result.scanned = subStrategies.length;

  if (subStrategies.length === 0) {
    return result;
  }

  // Load the apps referenced by these sub-strategies in one roundtrip.
  const appIds = subStrategies.map((s) => s.app_id);
  const { data: appRows } = await db
    .from("apps")
    .select("*")
    .in("id", appIds);
  const appsById = new Map<string, AppRow>();
  for (const a of (appRows ?? []) as AppRow[]) {
    appsById.set(a.id, a);
  }

  // Load the most recent completed agent_runs for these apps so we can
  // compute "is the agent due?" without N+1 queries.
  const { data: recentRuns } = await db
    .from("app_agent_runs")
    .select("app_id, agent_id, completed_at")
    .in("app_id", appIds)
    .eq("status", "completed")
    .order("completed_at", { ascending: false });

  const lastCompleted = new Map<string, string>();
  for (const r of (recentRuns ?? []) as Pick<AppAgentRunRow, "app_id" | "agent_id" | "completed_at">[]) {
    const key = `${r.app_id}::${r.agent_id}`;
    if (!lastCompleted.has(key) && r.completed_at) {
      lastCompleted.set(key, r.completed_at);
    }
  }

  // Filter to sub-strategies that both have a declared predictor AND
  // are due according to the lastCompleted index. Skipping drafts /
  // missing predictor specs is cheap before any DB writes.
  const eligible: Array<{
    appRow: AppRow;
    subStrategy: ReturnType<typeof hydrateSubStrategy>;
    agentSpec: AgentSpec;
  }> = [];

  for (const subRow of subStrategies) {
    const appRow = appsById.get(subRow.app_id);
    if (!appRow) continue;
    const subStrategy = hydrateSubStrategy(subRow);
    const predictor = findPredictorAgent(subStrategy);
    if (!predictor) continue;

    const cadenceHours = computeCadenceHours(predictor, subStrategy);
    const lastKey = `${appRow.id}::${predictor.id}`;
    const lastRun = lastCompleted.get(lastKey);
    const dueAt = lastRun
      ? new Date(
          new Date(lastRun).getTime() + cadenceHours * 60 * 60 * 1000,
        ).getTime()
      : 0; // first run — always due

    if (Date.now() < dueAt) continue;
    eligible.push({ appRow, subStrategy, agentSpec: predictor });
  }

  result.eligible = eligible.length;

  // Run in batches of CONCURRENCY. Each slot: insert a 'running' row →
  // run agent → update to completed/failed/skipped.
  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const slice = eligible.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      slice.map((job) => executeOne(db, job, result)),
    );
  }

  console.log(
    `[agent-runtime] scanned=${result.scanned} eligible=${result.eligible} ` +
    `ran=${result.ran} skipped=${result.skipped} failed=${result.failed} ` +
    `outcomes=${JSON.stringify(result.by_outcome)}`,
  );

  return result;
}

// ── Per-job executor ───────────────────────────────────────────────────

async function executeOne(
  db: DB,
  job: {
    appRow: AppRow;
    subStrategy: ReturnType<typeof hydrateSubStrategy>;
    agentSpec: AgentSpec;
  },
  result: SchedulerResult,
): Promise<void> {
  const { appRow, subStrategy, agentSpec } = job;

  // Insert the 'scheduled' → 'running' row up-front so concurrent
  // invocations of this cron don't double-run the same agent. If the
  // cron fires twice within the same window (e.g. retry after a prior
  // timeout), the second invocation sees a 'running' row and can skip.
  //
  // v1 is generous — we don't check for an existing 'running' row
  // because the cron itself is the only writer. v2 should add that
  // check when agents become user-triggerable.
  const startedAt = new Date().toISOString();
  const { data: runRow, error: runErr } = await db
    .from("app_agent_runs")
    .insert({
      app_id: appRow.id,
      space_id: appRow.space_id,
      user_id: appRow.user_id,
      agent_id: agentSpec.id,
      agent_role: agentSpec.role,
      scheduled_for: startedAt,
      started_at: startedAt,
      status: "running",
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    console.warn(
      `[agent-runtime] failed to insert run row for app ${appRow.id}:`,
      runErr,
    );
    result.failed++;
    return;
  }

  const runId = runRow.id as string;
  const t0 = Date.now();

  try {
    const outcome = await runPredictorAgent({
      db,
      appRow,
      subStrategy,
      agentSpec,
    });

    const duration = Date.now() - t0;
    const completedAt = new Date().toISOString();

    if (outcome.status === "completed") {
      const output: PredictorOutput = {
        kind: "predictor",
        prediction_id: outcome.predictionId,
        metric_label: outcome.metricLabel,
        horizon_days: outcome.horizonDays,
        method: outcome.method,
      };
      await db
        .from("app_agent_runs")
        .update({
          status: "completed",
          completed_at: completedAt,
          duration_ms: duration,
          output: output as unknown as Database["public"]["Tables"]["app_agent_runs"]["Update"]["output"],
        })
        .eq("id", runId);
      result.ran++;
      result.by_outcome[outcome.method] = (result.by_outcome[outcome.method] ?? 0) + 1;
    } else if (outcome.status === "skipped") {
      await db
        .from("app_agent_runs")
        .update({
          status: "skipped",
          completed_at: completedAt,
          duration_ms: duration,
          note: outcome.note,
        })
        .eq("id", runId);
      result.skipped++;
      result.by_outcome.skipped = (result.by_outcome.skipped ?? 0) + 1;
    } else {
      await db
        .from("app_agent_runs")
        .update({
          status: "failed",
          completed_at: completedAt,
          duration_ms: duration,
          note: outcome.note,
        })
        .eq("id", runId);
      result.failed++;
      result.by_outcome.failed = (result.by_outcome.failed ?? 0) + 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[agent-runtime] agent execution threw for app ${appRow.id}:`,
      err,
    );
    await db
      .from("app_agent_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - t0,
        note: `Uncaught: ${message}`,
      })
      .eq("id", runId);
    result.failed++;
  }
}

// ── Cadence helpers ────────────────────────────────────────────────────

function computeCadenceHours(
  agentSpec: AgentSpec,
  subStrategy: ReturnType<typeof hydrateSubStrategy>,
): number {
  // Prefer explicit measurement_spec.cadence.
  const cadenceEnum = agentSpec.measurement_spec?.cadence;
  if (cadenceEnum) {
    const map: Record<string, number> = {
      on_event: MIN_INTERVAL_HOURS, // "on_event" without a real event loop → min interval
      hourly: 1,
      daily: 24,
      weekly: 24 * 7,
    };
    const hours = map[cadenceEnum];
    if (hours) return Math.max(hours, MIN_INTERVAL_HOURS);
  }

  // Fallback: derive from prediction_spec horizon. We want ~4 predictions
  // per horizon period so the resolver sees enough points to tag regime
  // shifts. Horizon 30d → 7.5d cadence; horizon 90d → 22.5d cadence.
  const horizon = subStrategy.spec?.prediction_spec?.default_horizon_days;
  if (horizon && horizon >= 1) {
    const hours = (horizon / 4) * 24;
    return Math.max(hours, MIN_INTERVAL_HOURS);
  }

  return FALLBACK_CADENCE_HOURS;
}
