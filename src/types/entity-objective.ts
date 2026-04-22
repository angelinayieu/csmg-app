/**
 * Wave A — entity ↔ objective grounding types.
 *
 * Source of truth: supabase/migrations/20260514_objectives_grounding.sql
 *
 * These manual types cover the fields not yet in database.types.ts (the
 * Supabase codegen debt from Sprint 0). Swap for generated Row types
 * once `supabase gen types typescript --linked` has been re-run.
 */

export type EntityObjectiveSource = "auto_detected" | "manual" | "refined";

export interface EntityObjective {
  id: string;
  entity_id: string;
  goal_id: string;
  confidence: number;
  source: EntityObjectiveSource;
  rationale: string | null;
  created_at: string;
}

/** Columns added to improvement_goals in 20260514. Existing Row type
 *  covers the rest; this intersects with it at read time. */
export interface ImprovementGoalSprintWaveAAdditions {
  auto_detection_rationale: string | null;
  auto_detection_confidence: "high" | "moderate" | "low" | null;
  auto_detection_input_type: string | null;
  proposed_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

/** Extended status enum (Wave A adds 'proposed' and 'rejected'). */
export type GoalStatus =
  | "proposed"
  | "active"
  | "achieved"
  | "abandoned"
  | "paused"
  | "rejected";

/**
 * Hydrated proposed-goal view used by the review UI. Extends the raw
 * improvement_goals row with its linked entities so the card can render
 * "this objective is served by [entity A, entity B, ...]" without a
 * per-row round-trip.
 */
export interface ProposedGoalHydrated {
  id: string;
  space_id: string;
  title: string;
  description: string | null;
  objective_type:
    | "maximize"
    | "minimize"
    | "maintain"
    | "explore"
    | "avoid";
  source: string;
  status: GoalStatus;
  metric_name: string | null;
  metric_unit: string | null;
  target_value: number | null;
  baseline_value: number | null;
  deadline: string | null;
  created_at: string;
  proposed_at: string | null;
  auto_detection_rationale: string | null;
  auto_detection_confidence: "high" | "moderate" | "low" | null;
  auto_detection_input_type: string | null;
  parent_goal_id: string | null;
  linked_entities: Array<{
    entity_id: string;
    entity_name: string;
    entity_description: string | null;
    entity_category: string | null;
    confidence: number;
    rationale: string | null;
  }>;
}

/** POST /api/goals/[id]/approve — required fields to flip status to 'active' */
export interface ApproveGoalInput {
  /** User must supply these if they weren't set on the proposed row. */
  metric_name?: string;
  metric_unit?: string;
  target_value?: number;
  baseline_value?: number;
  deadline?: string | null;
  /** Optional user edits to the auto-detected title / description. */
  title?: string;
  description?: string;
  /** Optional edit to the entity linkage set — IDs to keep; others are
   *  archived. Undefined = keep all auto-detected links. */
  keep_entity_links?: string[];
}

/** POST /api/goals/[id]/reject */
export interface RejectGoalInput {
  reason?: string;
}
