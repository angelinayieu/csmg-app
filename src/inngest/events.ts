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
};
