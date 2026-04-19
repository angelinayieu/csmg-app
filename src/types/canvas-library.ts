/**
 * Canvas Library types — Sprint 0 substrate
 *
 * These types back the Canvas Library (Sprint 1) and the universal-canvas
 * surface (Sprint 4). They are written manually (not generated via
 * database.types) because Supabase codegen hasn't been re-run against
 * the Sprint 0 migrations yet; when it is, these can migrate to Row types.
 *
 * Source of truth: supabase/migrations/20260430_canvases.sql
 */

export type CanvasScope = "universal" | "project" | "objective" | "app";
export type CanvasScopeRefType = "space" | "improvement_goal" | "app";

export interface Canvas {
  id: string;
  owner_id: string;

  scope: CanvasScope;
  scope_ref_type: CanvasScopeRefType | null;
  scope_ref_id: string | null;

  title: string;
  description: string | null;

  /**
   * tldraw document snapshot. Same shape as space_canvases.snapshot.
   * NULL for universal canvases that haven't been edited yet.
   */
  snapshot: unknown | null;
  schema_version: number;

  pinned: boolean;
  archived: boolean;

  /**
   * Count of active bridges whose source or target entity is rendered on
   * this canvas. Drives the CanvasCard Ring. Recomputed by the
   * bridges-change hook (Sprint 4).
   */
  connectedness_score: number;

  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

/** Input for POST /api/canvases */
export interface CreateCanvasInput {
  scope: CanvasScope;
  /** Required for scope !== 'universal'; must exist in the appropriate table. */
  scope_ref_type?: CanvasScopeRefType;
  scope_ref_id?: string;
  title: string;
  description?: string;
}

/** Input for PATCH /api/canvases/:id */
export interface UpdateCanvasInput {
  title?: string;
  description?: string;
  pinned?: boolean;
  archived?: boolean;
  snapshot?: unknown;
  schema_version?: number;
}

/** Library listing response — one row per card */
export interface CanvasCardData extends Canvas {
  /**
   * Human-readable scope anchor name resolved by the API
   * (space name, objective name, or app name). NULL for universal.
   */
  scope_ref_name: string | null;
  /** Count of pending concept_proposals for this canvas. */
  pending_proposals: number;
}
