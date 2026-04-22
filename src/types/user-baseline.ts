/**
 * Wave C — user baseline + events types.
 *
 * Source of truth: supabase/migrations/20260515_user_baseline_events.sql.
 *
 * These manual types cover the fields not yet in database.types.ts
 * (Supabase codegen debt from Sprint 0). Swap for generated Row types
 * once `supabase gen types typescript --linked` is re-run.
 */

/** Canonical event types the digest agent knows how to interpret. Kept
 *  here (not an SQL enum) so adding a new type is a soft change. When
 *  you add a type, teach the digest prompt + the dashboard stat rollup
 *  how to interpret it. */
export type UserEventType =
  // Objective lifecycle
  | "goal.approved"
  | "goal.rejected"
  | "goal.created"
  | "goal.achieved"
  | "goal.abandoned"
  | "goal.paused"
  // Proposal lifecycle (Sprint 3 concept_proposals)
  | "proposal.accepted"
  | "proposal.rejected"
  | "proposal.dismissed"
  // Bridge lifecycle (Sprint 4 universal canvas)
  | "bridge.confirmed"
  | "bridge.rejected"
  | "bridge.manual_created"
  // App lifecycle
  | "app.refreshed"
  | "app.generated"
  | "app.paused"
  | "app.retired"
  // Lab activity
  | "lab.what_if_run"
  | "lab.entity_deepened"
  | "lab.weave_run"
  // Canvas activity
  | "canvas.created"
  | "canvas.archived"
  | "canvas.frame_added"
  // Strategy
  | "strategy.regenerated"
  | "strategy.applied"
  // Intake
  | "intake.decomposed"
  // Observation
  | "metric.observation_recorded"
  // Fallback — extension slot
  | "misc";

/** Soft label for the referenced subject. Not validated against an
 *  enum because new surfaces may add new kinds; the digest agent
 *  handles unknown kinds gracefully. */
export type UserEventRefKind =
  | "goal"
  | "proposal"
  | "bridge"
  | "app"
  | "canvas"
  | "entity"
  | "strategy"
  | "space"
  | "tracker"
  | "observation"
  | null;

export interface UserEvent {
  id: string;
  user_id: string;
  event_type: UserEventType | string; // tolerate unknown types from future migrations
  source: string;
  ref_kind: UserEventRefKind | string | null;
  ref_id: string | null;
  space_id: string | null;
  payload: Record<string, unknown>;
  at: string;
}

/** Input for the recordUserEvent helper. All fields except event_type +
 *  source + user_id are optional. */
export interface RecordUserEventInput {
  user_id: string;
  event_type: UserEventType | string;
  source: string;
  ref_kind?: UserEventRefKind | string | null;
  ref_id?: string | null;
  space_id?: string | null;
  payload?: Record<string, unknown>;
}

/** Profile baseline fields added by Wave C. Extend existing Profile
 *  type via intersection at the read site. */
export interface ProfileBaselineFields {
  persona_tags: string[];
  behavior_summary: string | null;
  goal_preferences: Record<string, unknown>;
  baseline_metrics: Record<string, unknown>;
  behavior_summary_updated_at: string | null;
  events_since_last_digest: number;
}

/** The digest agent's structured output. Written to profiles by the cron. */
export interface UserBehaviorDigestOutput {
  persona_tags: string[];
  behavior_summary: string;
  goal_preferences: {
    /** Short label for user's lean, e.g. "retention-focused",
     *  "evidence-first", "speed-over-rigor". */
    lean?: string;
    /** Objective types the user consistently approves / rejects. */
    preferred_objective_types?: string[];
    rejected_objective_types?: string[];
    /** User's typical cadence: "daily" | "weekly" | "sporadic". */
    cadence?: string;
    /** Any other structured hints the digest surfaces. */
    [k: string]: unknown;
  };
  /** 3-7 high-signal baseline metrics the digest computed across the
   *  user's spaces. E.g. { "avg_approval_rate": 0.62, "active_spaces": 3 }. */
  baseline_metrics: Record<string, number | string>;
}
