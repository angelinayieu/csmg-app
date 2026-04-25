// ── Scenario types (R5 Phase A) ──────────────────────────────────────
//
// A scenario is a fork off a snapshot with an ordered action list
// applied. This is the Palantir Scenarios pattern (see
// docs/R5_STRATEGIC_BRIEF.md §2.1): test a change against a frozen
// baseline before touching the live KG.
//
// Schema principles:
//   1. Action list is authoritative. If the delta rows and action list
//      disagree, re-derive from the action list. Deltas are a
//      denormalization for fast diff views.
//   2. Applying a scenario = replay the action list against the parent
//      snapshot's entities/edges. Never merge data branches directly.
//      (Palantir explicitly doesn't support this — three-way merge of
//      data has no good semantics.)
//   3. A scenario moves through a lifecycle: draft → testing → applied
//      or rejected. A superseded chain tracks iteration.
//
// See:
//   - supabase/migrations/20260602_snapshots_scenarios.sql (schema)
//   - src/lib/twin/scenario-apply.ts (action replay + delta diff)

import type { Entity, Edge } from "@/types";
import type { SnapshotCycle, SnapshotBridge } from "@/types/snapshot";

// ── Action shapes ───────────────────────────────────────────────────
//
// A ScenarioAction is a single structured mutation applied to a
// snapshot's entity/edge set. Actions are the SMALLEST operable unit
// — a "proposal" maps to 1-many actions, each independently applied.
//
// The union is closed so the replayer has a compile-time guarantee
// that every action kind has a handler. Adding a new kind requires:
//   1. Extending the union.
//   2. Adding a case in `applyScenarioAction`.
//   3. Bumping the scenario schema version in the migration notes.

export interface UpdateEntityConfidenceAction {
  kind: "update_entity_confidence";
  entityId: string;
  /** New confidence value in [0, 1]. The delta row captures old value. */
  confidence: number;
  rationale?: string;
}

export interface UpdateEdgeStrengthAction {
  kind: "update_edge_strength";
  edgeId: string;
  strength: number;
  rationale?: string;
}

export interface FlipEdgePolarityAction {
  kind: "flip_edge_polarity";
  edgeId: string;
  to: "positive" | "negative" | "neutral" | "conditional";
  rationale?: string;
}

export interface AddEntityAction {
  kind: "add_entity";
  /** Client-generated UUID. Must be unique across the scenario's additions. */
  entityId: string;
  name: string;
  description?: string;
  entity_category?: string | null;
  confidence?: number;
  rationale?: string;
}

export interface AddEdgeAction {
  kind: "add_edge";
  edgeId: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  polarity: "positive" | "negative" | "neutral" | "conditional";
  strength?: number;
  confidence?: number;
  dynamics?: string;
  rationale?: string;
}

export interface RemoveEntityAction {
  kind: "remove_entity";
  entityId: string;
  rationale?: string;
}

export interface RemoveEdgeAction {
  kind: "remove_edge";
  edgeId: string;
  rationale?: string;
}

/**
 * Discriminated union of all scenario actions. The replayer exhausts
 * this union — a missing case is a compile error.
 */
export type ScenarioAction =
  | UpdateEntityConfidenceAction
  | UpdateEdgeStrengthAction
  | FlipEdgePolarityAction
  | AddEntityAction
  | AddEdgeAction
  | RemoveEntityAction
  | RemoveEdgeAction;

// ── Row / domain shapes ──────────────────────────────────────────────

export type ScenarioStatus =
  | "draft"
  | "testing"
  | "applied"
  | "rejected"
  | "superseded";

export interface Scenario {
  id: string;
  space_id: string;
  user_id: string;
  parent_snapshot_id: string;
  status: ScenarioStatus;
  label: string;
  description: string | null;
  action_list: ScenarioAction[];
  action_count: number;
  delta_count: number;
  applied_at: string | null;
  post_snapshot_id: string | null;
  applied_by: string | null;
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Scalar-only view for list UIs that don't need the action_list. */
export interface ScenarioMeta {
  id: string;
  space_id: string;
  parent_snapshot_id: string;
  status: ScenarioStatus;
  label: string;
  action_count: number;
  delta_count: number;
  applied_at: string | null;
  post_snapshot_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Delta shapes ────────────────────────────────────────────────────

export type DeltaTargetKind = "entity" | "edge" | "cycle" | "bridge";
export type DeltaOp = "create" | "update" | "delete";

export interface ScenarioDelta {
  id: string;
  scenario_id: string;
  target_kind: DeltaTargetKind;
  target_id: string | null;
  op: DeltaOp;
  field: string | null;
  /** JSON-any — handles mixed types (numbers, strings, objects, null). */
  old_value: unknown;
  new_value: unknown;
  action_index: number | null;
  created_at: string;
}

// ── Replay result ───────────────────────────────────────────────────

/**
 * Output of replaying a scenario's action_list against a parent
 * snapshot. The mutated entities/edges/cycles/bridges are what
 * downstream code (MC engine, twin computer, diff UI) reads from.
 * The derived deltas are what the scenario_deltas table stores.
 */
export interface ScenarioReplayResult {
  entities: Entity[];
  edges: Edge[];
  cycles: SnapshotCycle[];
  bridges: SnapshotBridge[];
  deltas: Array<Omit<ScenarioDelta, "id" | "scenario_id" | "created_at">>;
  /** Actions that couldn't be applied (entity not found, edge already
   *  removed, etc.). Non-fatal — caller decides whether to abort or
   *  continue with a warning. */
  skipped: Array<{ action_index: number; reason: string }>;
}
