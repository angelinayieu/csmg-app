// GET /api/spaces/[id]/intelligence-spine
//
// One-shot hydrated payload for the Intelligence drawer's strategy-aware
// header + tabs. Bundles strategy snapshot, apps, agents (with latest
// run summary), recent pipeline runs, and runtime cron state so the
// drawer can render the full "research operations" picture without
// fanning out four separate fetches per open.
//
// Owner-only via verifySpaceOwnership. Read-only — never mutates.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import {
  readRuntimeSettings,
  isCronDue,
  type RuntimeLastRuns,
} from "@/lib/runtime/runtime-settings";
import type {
  IntelligenceSpine,
  SpineAgent,
  SpineAgentRunSummary,
  SpineApp,
  SpineRun,
  SpineStrategy,
} from "@/types/intelligence-spine";
import type { StrategicRecommendationData } from "@/types/strategy";
import type { AppStatus } from "@/types/app";
import type { AppAgentRunStatus } from "@/types/agent-run";
import type { PipelineRunStatus } from "@/types/pipeline-events";

export const maxDuration = 15;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const RUN_LOOKBACK = 500;        // app_agent_runs rows to scan for grouping
const PIPELINE_RUN_LIMIT = 20;   // recent pipeline_runs rows surfaced

interface SpaceCronRow {
  synthesis_data: unknown;
  strategy_committed_at: string | null;
  runtime_settings: unknown;
  last_agent_runtime_at: string | null;
  last_predictions_resolve_at: string | null;
}

interface AppRowMin {
  id: string;
  name: string;
  status: AppStatus;
  health_score: number | null;
  last_refreshed_at: string | null;
  /** Selected for Initiative 1 origin-app matching — entities this
   *  app primarily acts on. */
  dominant_entity_ids: string[] | null;
  /** Selected for Initiative 1 origin-app matching — JSONB column,
   *  parsed below for `reasoning_provenance.convergence_ids_addressed`. */
  config: unknown;
}

interface AppAgentRunRowMin {
  id: string;
  app_id: string;
  agent_id: string;
  agent_role: string;
  status: AppAgentRunStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}

interface PipelineRunRowMin {
  id: string;
  pipeline: string;
  status: PipelineRunStatus;
  started_at: string;
  completed_at: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const db = supabase as any;

  // Fan out the four reads in parallel. Each is independently soft-fail
  // so a hiccup on one (e.g. apps table empty, no recent runs) still
  // returns a usable spine.
  const [spaceRes, appsRes, runsRes, pipelineRunsRes] = await Promise.all([
    db
      .from("spaces")
      .select(
        "synthesis_data, strategy_committed_at, runtime_settings, last_agent_runtime_at, last_predictions_resolve_at",
      )
      .eq("id", spaceId)
      .eq("user_id", user.id)
      .single(),
    db
      .from("apps")
      .select(
        "id, name, status, health_score, last_refreshed_at, dominant_entity_ids, config",
      )
      .eq("space_id", spaceId)
      .eq("user_id", user.id)
      .neq("status", "retired")
      .order("priority", { ascending: true })
      .limit(100),
    db
      .from("app_agent_runs")
      .select(
        "id, app_id, agent_id, agent_role, status, started_at, completed_at, duration_ms",
      )
      .eq("space_id", spaceId)
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(RUN_LOOKBACK),
    db
      .from("pipeline_runs")
      .select("id, pipeline, status, started_at, completed_at")
      .eq("space_id", spaceId)
      .eq("created_by", user.id)
      .order("started_at", { ascending: false })
      .limit(PIPELINE_RUN_LIMIT),
  ]);

  const spaceRow = (spaceRes.data ?? null) as SpaceCronRow | null;
  const appRows = ((appsRes.data ?? []) as AppRowMin[]) ?? [];
  const runRows = ((runsRes.data ?? []) as AppAgentRunRowMin[]) ?? [];
  const pipelineRows =
    ((pipelineRunsRes.data ?? []) as PipelineRunRowMin[]) ?? [];

  // ── Strategy ─────────────────────────────────────────────────────
  const strategy = extractStrategy(spaceRow);

  // ── Agents (grouped from runs) ───────────────────────────────────
  const agents = groupAgents(runRows);

  // ── Apps (joined with agent presence + most-recent run) ──────────
  const apps = hydrateApps(appRows, runRows);

  // ── Recent pipeline runs ────────────────────────────────────────
  const recent_runs: SpineRun[] = pipelineRows.map((r) => ({
    id: r.id,
    pipeline: r.pipeline,
    status: r.status,
    started_at: r.started_at,
    completed_at: r.completed_at,
    duration_ms:
      r.completed_at && r.started_at
        ? Math.max(0, Date.parse(r.completed_at) - Date.parse(r.started_at))
        : null,
  }));

  // ── Runtime gating + due-check ──────────────────────────────────
  const settings = readRuntimeSettings(spaceRow?.runtime_settings ?? null);
  const lastRuns: RuntimeLastRuns = {
    agent_runtime: spaceRow?.last_agent_runtime_at ?? null,
    predictions_resolve: spaceRow?.last_predictions_resolve_at ?? null,
  };
  const now = new Date();
  const runtime = {
    settings,
    next_due: {
      agent_runtime: isCronDue(settings, "agent_runtime", lastRuns, now),
      predictions_resolve: isCronDue(
        settings,
        "predictions_resolve",
        lastRuns,
        now,
      ),
    },
    last_runs: lastRuns,
  };

  const spine: IntelligenceSpine = {
    strategy,
    apps,
    agents,
    recent_runs,
    runtime,
    generated_at: now.toISOString(),
  };

  return NextResponse.json(spine);
}

// ── Helpers ──────────────────────────────────────────────────────────

function extractStrategy(row: SpaceCronRow | null): SpineStrategy | null {
  if (!row) return null;
  const sd = parseJson(row.synthesis_data);
  if (!sd || typeof sd !== "object") return null;
  // synthesis_data.strategic_recommendation can be StrategicRecommendationData
  // (has .recommendation) or directly the StrategicRecommendation. Handle both.
  const rec = (sd as Record<string, unknown>).strategic_recommendation as
    | StrategicRecommendationData
    | undefined;
  if (!rec) return null;
  const inner =
    "recommendation" in rec && rec.recommendation ? rec.recommendation : null;
  if (!inner) return null;
  return {
    headline: inner.headline ?? null,
    posture: inner.strategic_posture ?? null,
    confidence:
      typeof inner.confidence === "number" ? inner.confidence : null,
    target_objective: inner.target_objective
      ? {
          title: inner.target_objective.title,
          metric: inner.target_objective.metric,
          target: inner.target_objective.target,
        }
      : null,
    committed_at: row.strategy_committed_at ?? null,
    status: rec.status ?? null,
  };
}

function parseJson(v: unknown): unknown {
  if (!v) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}

function groupAgents(runs: AppAgentRunRowMin[]): SpineAgent[] {
  // Bucket runs by (app_id, agent_id). Rows are pre-sorted desc by
  // started_at so the first occurrence per key is the latest run.
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const map = new Map<
    string,
    {
      app_id: string;
      agent_id: string;
      agent_role: string;
      latest: SpineAgentRunSummary;
      runs_7d: number;
      runs_total: number;
    }
  >();

  for (const r of runs) {
    const key = `${r.app_id}::${r.agent_id}`;
    const existing = map.get(key);
    const startedMs = r.started_at ? Date.parse(r.started_at) : NaN;
    const within7d = !Number.isNaN(startedMs) && startedMs >= cutoff;

    if (!existing) {
      map.set(key, {
        app_id: r.app_id,
        agent_id: r.agent_id,
        agent_role: r.agent_role,
        latest: {
          id: r.id,
          status: r.status,
          started_at: r.started_at,
          completed_at: r.completed_at,
          duration_ms: r.duration_ms,
        },
        runs_7d: within7d ? 1 : 0,
        runs_total: 1,
      });
    } else {
      existing.runs_total += 1;
      if (within7d) existing.runs_7d += 1;
    }
  }

  return Array.from(map.values()).map((g) => ({
    id: g.agent_id,
    app_id: g.app_id,
    agent_role: g.agent_role,
    last_run: g.latest,
    runs_7d: g.runs_7d,
    runs_total: g.runs_total,
  }));
}

function hydrateApps(
  appRows: AppRowMin[],
  runs: AppAgentRunRowMin[],
): SpineApp[] {
  // Index runs by app_id once so the per-app derivation is O(N).
  const distinctAgentsByApp = new Map<string, Set<string>>();
  const lastRunByApp = new Map<string, string>();
  for (const r of runs) {
    if (!r.completed_at) continue;
    const set = distinctAgentsByApp.get(r.app_id) ?? new Set<string>();
    set.add(r.agent_id);
    distinctAgentsByApp.set(r.app_id, set);
    const prev = lastRunByApp.get(r.app_id);
    if (!prev || Date.parse(r.completed_at) > Date.parse(prev)) {
      lastRunByApp.set(r.app_id, r.completed_at);
    }
  }

  return appRows.map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    health_score: a.health_score,
    last_refreshed_at: a.last_refreshed_at,
    agent_count: distinctAgentsByApp.get(a.id)?.size ?? 0,
    last_run_at: lastRunByApp.get(a.id) ?? null,
    dominant_entity_ids: Array.isArray(a.dominant_entity_ids)
      ? a.dominant_entity_ids
      : [],
    convergence_ids_addressed: extractConvergenceIds(a.config),
  }));
}

/**
 * Pulls `config.reasoning_provenance.convergence_ids_addressed` out of
 * the JSONB config blob. Defensive: any shape mismatch returns []
 * rather than throwing — a malformed config row shouldn't break the
 * spine for unrelated callers.
 */
function extractConvergenceIds(config: unknown): string[] {
  if (!config || typeof config !== "object") return [];
  const c = config as Record<string, unknown>;
  const prov = c.reasoning_provenance as Record<string, unknown> | undefined;
  if (!prov || typeof prov !== "object") return [];
  const ids = prov.convergence_ids_addressed;
  if (!Array.isArray(ids)) return [];
  return ids.filter((x): x is string => typeof x === "string");
}
