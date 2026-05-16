/**
 * Typed event schemas for the Inngest pipeline.
 * Any call to `inngest.send(...)` must match one of these shapes.
 */

import type { UserIntent } from "@/types/analysis";
import type { AnalysisTier } from "@/lib/tiers";

/** Kind-of-artifact identifiers used in job_events and analysis_jobs.artifacts_ready */
export type ArtifactKind =
  | "entities"
  | "edges"
  | "cycles"
  | "research"
  | "bridges"
  | "synthesis"
  | "strategy"
  | "twin"
  | "probability_spaces";

/** Phase labels used in job_events.payload.phase and analysis_jobs.current_phase */
export type JobPhase =
  | "queued"
  | "running"
  | "decomposing"
  | "structuring"
  | "critiquing"
  | "researching"
  | "bridging"
  | "synthesizing"
  | "strategizing"
  | "twin"
  | "probability"
  | "committing"
  | "complete"
  | "failed"
  | "cancelled";

/**
 * Events map — key is event name, value is the data payload.
 * Inngest's schemas helper will enforce this at send + handler sites.
 */
export type Events = {
  "analysis/orchestrate.requested": {
    data: {
      jobId: string;
      userId: string;
      input: string;
      tier: AnalysisTier;
      intent?: UserIntent;
      reservationId: string | null;
    };
  };
  "analysis/orchestrate.cancelled": {
    data: {
      jobId: string;
      reason: string;
    };
  };
  /**
   * Fired by POST /api/goals after a new improvement_goal row is inserted.
   * Consumed by on-goal-created → spawns a bound researcher + kicks first run.
   */
  "goal.created": {
    data: {
      goalId: string;
      spaceId: string;
      userId: string;
      goalTitle?: string;
    };
  };
  /**
   * Fired by coordinator-tick (cron), on-goal-created (first run), or
   * POST /api/coordinator/dispatch (manual "research this goal now").
   * Consumed by execute-goal-research.
   */
  "goal.research.requested": {
    data: {
      goalId: string;
      spaceId: string;
      userId: string;
      reason: "coordinator_tick" | "goal_created" | "manual";
      priority_score?: number;
      goalTitle?: string;
    };
  };
  /**
   * Cross-whiteboard Ask — user asks a question on the homescreen in "Ask" mode.
   * POST /api/ask/start creates the ask space + analysis_jobs row, then fires this.
   * Consumed by ask-cross-space.ts: retrieval → synthesis → ghost-clone cited entities.
   */
  "ask/cross-space.requested": {
    data: {
      jobId: string;
      userId: string;
      spaceId: string;
      query: string;
    };
  };
  /**
   * Synergy Phase 5 — parallel-path matching.
   *
   * Fired by POST /api/synergy/sessions/[id]/strategy/generate after a
   * strategy + its plan_step blocks are persisted. Consumed by
   * synergyStrategyMatcher: embed the strategy → run kNN + LLM rerank
   * against the cross-user pool → upsert strategy_matches rows.
   *
   * Soft-fail discipline: the matcher must never block the user's
   * strategy publish. If embedding or matching fails, the strategy is
   * still saved — only the parallel-path discovery feed is delayed.
   */
  "synergy/strategy.generated": {
    data: {
      strategyId: string;
      sessionId: string;
      userId: string;
    };
  };
  /**
   * Synergy Phase 5b — a parallel-path invitation was accepted, both
   * users now share a parallel_path room. Fired by the respond
   * endpoint AFTER the room row exists. Consumed (in Phase 5c) by a
   * notifier that emails both parties + pushes a realtime ping into
   * the new room channel.
   *
   * 5b ships this as a fire-and-forget queue — no handler is registered
   * yet. The handler lands in 5c.
   */
  "synergy/parallel-path.matched": {
    data: {
      roomId: string;
      requesterId: string;
      accepterId: string;
      sharedTheme: string;
    };
  };
};
