/**
 * Agent run tracker — the durable runtime behind the Intelligence Radar.
 *
 * Works in two modes:
 *   1. Inside Inngest functions (service-role client, step.run wrapping)
 *   2. Inside regular API routes (service-role client or user-session client)
 *
 * Every agent run gets a row in `agent_runs` with start/heartbeat/complete/fail
 * lifecycle tracking. The parent `agents` row is kept in sync via DB trigger.
 *
 * This module is non-throwing by design — the caller's real work must never
 * fail because of a tracking failure. All errors are logged and swallowed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAgentKindMeta } from "./kinds";
import type { AgentKind } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export interface AgentRunOptions {
  spaceId: string;
  userId: string;
  kind: AgentKind;
  jobId?: string | null;
  inngestRunId?: string | null;
  stepId?: string | null;
  triggerEvent?: string;
  triggerData?: Record<string, unknown>;
  sourceObjectiveId?: string | null;
  sourceGoalId?: string | null;
  /** Optional goal title — used to personalise bound agent's display name */
  goalTitle?: string | null;
  /** Optional focus-area override (else falls back to kind defaults) */
  focusAreas?: string[];
}

export interface AgentRunResult {
  findingsCount?: number;
  artifactsProduced?: string[];
  entityIdsDiscovered?: string[];
  costCredits?: number;
}

/**
 * Upsert the parent `agents` row. Idempotent.
 *
 * Uniqueness after Phase B migration `20260419_goal_agent_binding.sql`:
 *   - when `sourceGoalId` is null:  unique(space_id, kind)
 *   - when `sourceGoalId` is set:   unique(space_id, kind, source_goal_id)
 *
 * When binding to a goal, the caller can pass `goalTitle` so the agent row
 * gets a human-readable name like "Researcher · <goal title>" for the UI.
 *
 * Returns the agent row id.
 */
export async function ensureAgent(
  db: Db,
  opts: {
    spaceId: string;
    userId: string;
    kind: AgentKind;
    sourceObjectiveId?: string | null;
    sourceGoalId?: string | null;
    /** Optional goal title — used to personalise `name` for bound agents */
    goalTitle?: string | null;
    focusAreas?: string[];
  }
): Promise<string | null> {
  const meta = getAgentKindMeta(opts.kind);

  // For goal-bound researchers, personalise name + callsign so the UI can
  // show "Researcher · <goal title>" and a short goal-scoped callsign.
  const bound = !!opts.sourceGoalId;
  const name = bound && opts.goalTitle
    ? `${meta.name} · ${opts.goalTitle.slice(0, 60)}`
    : meta.name;
  const callsign = bound && opts.sourceGoalId
    ? `${meta.callsign}-G${opts.sourceGoalId.slice(0, 4).toUpperCase()}`
    : meta.callsign;

  try {
    // Try insert first; on conflict, select existing id
    const { data, error } = await db
      .from("agents")
      .insert({
        space_id: opts.spaceId,
        user_id: opts.userId,
        kind: opts.kind,
        name,
        callsign,
        specialty: meta.specialty,
        focus_areas: opts.focusAreas ?? meta.focus_areas,
        source_objective_id: opts.sourceObjectiveId ?? null,
        source_goal_id: opts.sourceGoalId ?? null,
        status: "idle",
      })
      .select("id")
      .single();

    if (!error && data?.id) return data.id as string;

    // Conflict — fetch existing row, scoped correctly per binding state
    let query = db
      .from("agents")
      .select("id")
      .eq("space_id", opts.spaceId)
      .eq("kind", opts.kind);

    if (opts.sourceGoalId) {
      query = query.eq("source_goal_id", opts.sourceGoalId);
    } else {
      query = query.is("source_goal_id", null);
    }

    const { data: existing } = await query.maybeSingle();

    return (existing?.id as string) ?? null;
  } catch (err) {
    console.warn("[run-tracker] ensureAgent failed:", err);
    return null;
  }
}

/**
 * Start a new agent run. Returns the run id, or null on failure.
 */
export async function startAgentRun(
  db: Db,
  opts: AgentRunOptions
): Promise<string | null> {
  const agentId = await ensureAgent(db, {
    spaceId: opts.spaceId,
    userId: opts.userId,
    kind: opts.kind,
    sourceObjectiveId: opts.sourceObjectiveId,
    sourceGoalId: opts.sourceGoalId,
    goalTitle: opts.goalTitle,
    focusAreas: opts.focusAreas,
  });
  if (!agentId) return null;

  try {
    const { data, error } = await db
      .from("agent_runs")
      .insert({
        agent_id: agentId,
        space_id: opts.spaceId,
        job_id: opts.jobId ?? null,
        inngest_run_id: opts.inngestRunId ?? null,
        step_id: opts.stepId ?? null,
        trigger_event: opts.triggerEvent ?? null,
        trigger_data: opts.triggerData ?? null,
        status: "running",
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      console.warn("[run-tracker] startAgentRun insert failed:", error);
      return null;
    }
    return data.id as string;
  } catch (err) {
    console.warn("[run-tracker] startAgentRun exception:", err);
    return null;
  }
}

/** Bump heartbeat_at to keep the UI's "alive" indicator refreshed. */
export async function heartbeatAgentRun(db: Db, runId: string | null): Promise<void> {
  if (!runId) return;
  try {
    await db
      .from("agent_runs")
      .update({ heartbeat_at: new Date().toISOString() })
      .eq("id", runId);
  } catch (err) {
    console.warn("[run-tracker] heartbeat failed:", err);
  }
}

/** Mark an agent run successful + record outputs. */
export async function completeAgentRun(
  db: Db,
  runId: string | null,
  result: AgentRunResult = {}
): Promise<void> {
  if (!runId) return;
  try {
    await db
      .from("agent_runs")
      .update({
        status: "completed",
        findings_count: result.findingsCount ?? 0,
        artifacts_produced: result.artifactsProduced ?? [],
        entity_ids_discovered: result.entityIdsDiscovered ?? [],
        cost_credits: result.costCredits ?? 0,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
  } catch (err) {
    console.warn("[run-tracker] completeAgentRun failed:", err);
  }
}

/** Mark an agent run failed with an error message. */
export async function failAgentRun(
  db: Db,
  runId: string | null,
  errorMessage: string
): Promise<void> {
  if (!runId) return;
  try {
    await db
      .from("agent_runs")
      .update({
        status: "failed",
        error_message: errorMessage.slice(0, 2000),
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
  } catch (err) {
    console.warn("[run-tracker] failAgentRun failed:", err);
  }
}

/**
 * Convenience wrapper: run `fn` as a tracked agent run. Installs a heartbeat
 * interval (10s) while the fn runs, completes on success, fails on throw.
 *
 * The fn receives the runId so it can stamp intermediate events or be re-entered
 * by background retries. It must return an AgentRunResult or void.
 */
export async function runAsAgent<T>(
  db: Db,
  opts: AgentRunOptions,
  fn: (runId: string | null) => Promise<{ result?: AgentRunResult; value: T }>
): Promise<T> {
  const runId = await startAgentRun(db, opts);

  // Heartbeat loop — every 10s while fn is in flight
  let cancelled = false;
  const heartbeat = runId
    ? setInterval(() => {
        if (!cancelled) void heartbeatAgentRun(db, runId);
      }, 10_000)
    : null;

  try {
    const { result, value } = await fn(runId);
    cancelled = true;
    if (heartbeat) clearInterval(heartbeat);
    await completeAgentRun(db, runId, result);
    return value;
  } catch (err) {
    cancelled = true;
    if (heartbeat) clearInterval(heartbeat);
    await failAgentRun(
      db,
      runId,
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }
}
