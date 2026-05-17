"use client";

// ── CanvasWorkspaceRoomSpawner (universal-canvas Phase A) ─────────
//
// In-canvas companion to CanvasWorkspaceRoomPicker. Lives inside the
// tldraw editor tree (where useEditor() works) and listens for
// `canvas-workspace:add-*` window events. Each event creates a new
// WorkspaceRoomShape at the current viewport center.
//
// The picker chrome lives OUTSIDE the editor tree (fixed-positioning
// layer) so we use window CustomEvents to bridge them — mirrors the
// CanvasSubjectCardSpawner pattern already used for + Subject.
//
// Phase A handles `add-brainstorm` only. Strategy / twin / probe
// extend by adding new event types + new switch arms here.

import { useEffect } from "react";
import { createShapeId, useEditor } from "tldraw";
import {
  WORKSPACE_ROOM_DEFAULT_H,
  WORKSPACE_ROOM_DEFAULT_W,
} from "@/components/canvas/shapes/workspace-room-shape";

interface AddBrainstormDetail {
  sessionId: string;
  title?: string;
}

export function CanvasWorkspaceRoomSpawner() {
  const editor = useEditor();

  useEffect(() => {
    function onAddBrainstorm(ev: Event) {
      const detail = (ev as CustomEvent<AddBrainstormDetail>).detail;
      if (!detail || !detail.sessionId) return;
      try {
        const center = editor.getViewportPageBounds().center;
        const shapeId = createShapeId();
        editor.createShapes([
          {
            id: shapeId,
            type: "workspace-room",
            // Anchor to viewport center, offset by half-w/h so the
            // shape lands centered on the cursor's current focus.
            x: center.x - WORKSPACE_ROOM_DEFAULT_W / 2,
            y: center.y - WORKSPACE_ROOM_DEFAULT_H / 2,
            props: {
              w: WORKSPACE_ROOM_DEFAULT_W,
              h: WORKSPACE_ROOM_DEFAULT_H,
              kind: "brainstorm",
              artifact_id: detail.sessionId,
              cached_title: detail.title ?? "",
              spawnedAt: Date.now(),
            },
          },
        ]);
        // Bring it into view + select so the user sees the room land.
        editor.select(shapeId);
        editor.zoomToSelection({ animation: { duration: 320 } });
      } catch (err) {
        console.warn(
          "[workspace-room-spawner] createShapes failed:",
          err,
        );
      }
    }

    window.addEventListener(
      "canvas-workspace:add-brainstorm",
      onAddBrainstorm,
    );
    return () => {
      window.removeEventListener(
        "canvas-workspace:add-brainstorm",
        onAddBrainstorm,
      );
    };
  }, [editor]);

  return null;
}
