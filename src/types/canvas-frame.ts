/**
 * canvas_frames types — Sprint 4 substrate
 *
 * Source of truth: supabase/migrations/20260507_canvas_frames.sql
 */

import type { Entity } from "./index";
import type { Canvas, CanvasScope } from "./canvas-library";
import type { BridgeSprint0Additions } from "./bridge-extended";

export interface CanvasFrame {
  id: string;
  owner_id: string;
  canvas_id: string;
  frame_canvas_id: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  display_order: number;
  pinned_entity_ids: string[];
  created_at: string;
  updated_at: string;
}

/** POST /api/canvases/[id]/frames — add a child canvas as a frame */
export interface CreateFrameInput {
  frame_canvas_id: string;
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
  pinned_entity_ids?: string[];
}

/** PATCH /api/canvases/[id]/frames/[frameId] — move/resize/repin */
export interface UpdateFrameInput {
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
  display_order?: number;
  pinned_entity_ids?: string[];
}

/**
 * The hydrated view consumed by UniversalCanvasEditor — one frame,
 * its child-canvas metadata, and the entities currently visible on it.
 */
export interface HydratedFrame extends CanvasFrame {
  frame_canvas: Pick<Canvas, "id" | "title" | "scope" | "scope_ref_id"> & {
    scope_ref_name: string | null;
  };
  /** Subset of entities to render inside this frame. If pinned_entity_ids
   *  is non-empty, exactly those. Otherwise top-by-importance fallback. */
  entities: Array<
    Pick<Entity, "id" | "name" | "description" | "entity_category" | "importance"> & {
      space_id: string;
    }
  >;
}

/** Cross-frame bridge hydrated for the edge layer. */
export interface FrameBridge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  bridge_type: "identity" | "influence" | "structural";
  coupling_strength: "strong" | "moderate" | "weak";
  coupling_direction:
    | "source_to_target"
    | "target_to_source"
    | "bidirectional";
  shared_variable_name: string;
  description: string | null;
  confidence: number;
  origin: BridgeSprint0Additions["origin"];
  status: BridgeSprint0Additions["status"];
  rationale: string | null;
}

/** Response shape for GET /api/canvases/[id]/frames */
export interface FramesResponse {
  canvas: Pick<Canvas, "id" | "title" | "scope" | "scope_ref_id" | "description">;
  frames: HydratedFrame[];
  bridges: FrameBridge[];
  /** Canvases the user owns that are candidates to add as a new frame
   *  (same owner, not archived, not already a frame, not the parent). */
  addable_canvases: Array<{
    id: string;
    title: string;
    scope: CanvasScope;
  }>;
}
