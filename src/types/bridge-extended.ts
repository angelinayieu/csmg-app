/**
 * Bridge extended columns — Sprint 0 substrate
 *
 * The `bridges` Row type from database.types already covers the original
 * columns. This file documents the Sprint 0 additions (canvas_id, origin,
 * status, created_at, created_by, rationale) so API handlers and UI can
 * type-check against the new shape until Supabase codegen is re-run.
 *
 * Source of truth: supabase/migrations/20260502_bridges_shared_substrate.sql
 */

export type BridgeOrigin =
  | "weave"
  | "universal_canvas"
  | "ambient_promoted"
  | "manual";

export type BridgeStatus = "active" | "user_confirmed" | "user_rejected";

/**
 * Columns added to public.bridges in 20260502_bridges_shared_substrate.sql.
 * Merge with existing Bridge Row type via intersection:
 *   type FullBridge = Bridge & BridgeSprint0Additions;
 */
export interface BridgeSprint0Additions {
  canvas_id: string | null;
  origin: BridgeOrigin;
  status: BridgeStatus;
  created_at: string;
  created_by: string | null;
  rationale: string | null;
}

/** POST /api/canvases/:id/bridges — user draws a link on universal canvas */
export interface CreateManualBridgeInput {
  canvas_id: string;
  source_entity_id: string;
  target_entity_id: string;
  bridge_type: "identity" | "influence" | "structural";
  coupling_strength: "strong" | "moderate" | "weak";
  coupling_direction:
    | "source_to_target"
    | "target_to_source"
    | "bidirectional";
  shared_variable_name: string;
  description?: string;
  rationale?: string;
}

/** POST /api/bridges/:id/resolve — confirm/reject a weave-produced bridge */
export interface ResolveBridgeInput {
  action: "confirm" | "reject";
}
