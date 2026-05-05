// ── Intelligence Spine ───────────────────────────────────────────────
//
// Shared types for `/api/spaces/[id]/intelligence-spine` and the
// `useIntelligenceSpine` hook. The spine bundles the four data sources
// the Intelligence drawer's tabs need to render in a strategy-aware
// way — strategy, apps, agents, recent pipeline runs — into a single
// payload so each tab doesn't fan-out independently.
//
// Lives here (not co-located with the route) because client code in
// `src/components/intelligence/*` and `src/lib/hooks/use-intelligence-
// spine.ts` need it without dragging in any server-only imports.

import type { AppStatus } from "./app";
import type { AppAgentRunStatus } from "./agent-run";
import type { AgentRoleKind } from "./strategy";
import type { PipelineRunStatus } from "./pipeline-events";
import type { RuntimeSettings, DueCheck } from "@/lib/runtime/runtime-settings";

export interface SpineStrategy {
  /** Plain-language headline from StrategicRecommendation.headline. */
  headline: string | null;
  /** Strategic posture (aggressive_growth / cautious_validation / …). */
  posture: string | null;
  /** Confidence 0–100 from StrategicRecommendation.confidence. */
  confidence: number | null;
  /** What the strategy is optimizing for. */
  target_objective: {
    title: string;
    metric: string;
    target: string;
  } | null;
  /** ISO timestamp from spaces.strategy_committed_at. Null when the
   *  user has not yet confirmed the strategy. */
  committed_at: string | null;
  /** Lifecycle status from synthesis_data.strategic_recommendation.status. */
  status: "generated" | "reviewing" | "confirmed" | "superseded" | null;
}

export interface SpineApp {
  id: string;
  name: string;
  status: AppStatus;
  health_score: number | null;
  /** ISO timestamp; null when the app has never been refreshed. */
  last_refreshed_at: string | null;
  /** Distinct agents (by agent_id) that have run on this app. */
  agent_count: number;
  /** Most recent app_agent_runs.completed_at across this app's agents.
   *  Null when no agent has completed for this app yet. */
  last_run_at: string | null;
  /** Initiative 1 — entities this app primarily acts on. Used to match
   *  apps to findings whose `source_entity_ids` overlap, surfacing the
   *  origin-app pill on convergence cards. Empty array when the app
   *  was created without entity grounding. */
  dominant_entity_ids: string[];
  /** Initiative 1 — convergence cluster ids (`conv:N`) this app's
   *  reasoning provenance claims to address. Cross-references with
   *  `Finding.convergence_data.id` for direct origin matching on
   *  convergence-type findings. Optional + may be empty. */
  convergence_ids_addressed: string[];
}

export interface SpineAgentRunSummary {
  id: string;
  status: AppAgentRunStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface SpineAgent {
  /** agent_id from app_agent_runs.agent_id (matches AgentSpec.id). */
  id: string;
  app_id: string;
  /** Role tag from app_agent_runs.agent_role on the latest run. */
  agent_role: AgentRoleKind | string;
  /** Most recent run for this (app_id, agent_id), or null. */
  last_run: SpineAgentRunSummary | null;
  /** Count of completed/failed/skipped runs in the last 7 days. */
  runs_7d: number;
  /** Total runs we observed in the lookback window (sanity counter). */
  runs_total: number;
}

export type PipelineRunKind = string;

export interface SpineRun {
  id: string;
  /** pipeline_runs.pipeline — e.g. "decompose", "research", "synthesize",
   *  "strategy-refresh", "generate-apps", "critique", "expand". */
  pipeline: PipelineRunKind;
  status: PipelineRunStatus;
  started_at: string;
  completed_at: string | null;
  /** Computed: completed_at - started_at when both present, else null. */
  duration_ms: number | null;
}

export interface SpineRuntime {
  settings: RuntimeSettings;
  next_due: {
    agent_runtime: DueCheck;
    predictions_resolve: DueCheck;
  };
  last_runs: {
    agent_runtime: string | null;
    predictions_resolve: string | null;
  };
}

export interface IntelligenceSpine {
  strategy: SpineStrategy | null;
  apps: SpineApp[];
  agents: SpineAgent[];
  recent_runs: SpineRun[];
  runtime: SpineRuntime;
  /** ISO timestamp the payload was assembled — for cache busting. */
  generated_at: string;
}
