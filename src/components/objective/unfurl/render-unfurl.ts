"use client";

// ── syncUnfurl ──
//
// Top-level phase switch for the depth dial. Depth 0–2 renders the canvas
// phase (objective → layers → bets); depth 3–5 renders the focused room's
// internals. Both phases share the meta.unfurl convention and each one's
// delete-non-desired pass clears the other phase's shapes — so crossing
// D2↔D3 swaps cleanly (the prototype's "swap into the room" feel) without
// a separate teardown.

import { type Editor } from "tldraw";
import { syncCanvasUnfurl } from "./render-canvas-unfurl";
import { syncRoomUnfurl, type RoomUnfurlGraph } from "./render-room-unfurl";
import type { CanvasGraph } from "@/components/objective/causal-map/lib/types";

export interface UnfurlGraphs {
  canvas: CanvasGraph;
  /** The focused room's graph (buildRoomGraph). Null until a room is
   *  anchored — depth then clamps to the canvas phase. */
  room?: RoomUnfurlGraph | null;
  objectiveTitle?: string;
  roomTitle?: string;
  roomId?: string;
}

/** Remove every unfurl shape from the board (exit unfurl mode). Leaves
 *  the user's regular board content (collapsed cards) untouched — those
 *  don't carry meta.unfurl. */
export function clearUnfurl(editor: Editor): void {
  const ids = editor
    .getCurrentPageShapes()
    .filter((s) => !!(s.meta as { unfurl?: boolean })?.unfurl)
    .map((s) => s.id);
  if (ids.length) editor.deleteShapes(ids);
}

export function syncUnfurl(
  editor: Editor,
  graphs: UnfurlGraphs,
  depth: number,
): void {
  if (depth < 3 || !graphs.room) {
    // Canvas phase (clamped to its max so a roomless space can't strand
    // the dial in an empty room phase).
    syncCanvasUnfurl(editor, graphs.canvas, Math.min(depth, 2), {
      objectiveTitle: graphs.objectiveTitle,
    });
  } else {
    syncRoomUnfurl(editor, graphs.room, depth, {
      roomTitle: graphs.roomTitle,
      roomId: graphs.roomId,
    });
  }
}
