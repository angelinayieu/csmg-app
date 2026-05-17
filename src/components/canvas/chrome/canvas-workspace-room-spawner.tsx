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

interface AddStrategyDetail {
  strategyId: string;
  /** session_id of the source brainstorm (synergy_strategies.session_id).
   *  Carried through so future provenance auto-connectors can match
   *  this strategy back to a brainstorm room on the same canvas. */
  sessionId?: string;
  statement?: string;
}

export function CanvasWorkspaceRoomSpawner() {
  const editor = useEditor();

  useEffect(() => {
    // Shared helper — places a room at the viewport center and
    // selects + zooms to it. Each kind passes its own props.
    function spawnRoom(props: {
      kind: "brainstorm" | "strategy" | "twin" | "probe";
      artifact_id: string;
      cached_title: string;
    }) {
      try {
        const center = editor.getViewportPageBounds().center;
        const shapeId = createShapeId();
        editor.createShapes([
          {
            id: shapeId,
            type: "workspace-room",
            x: center.x - WORKSPACE_ROOM_DEFAULT_W / 2,
            y: center.y - WORKSPACE_ROOM_DEFAULT_H / 2,
            props: {
              w: WORKSPACE_ROOM_DEFAULT_W,
              h: WORKSPACE_ROOM_DEFAULT_H,
              kind: props.kind,
              artifact_id: props.artifact_id,
              cached_title: props.cached_title,
              spawnedAt: Date.now(),
            },
          },
        ]);
        editor.select(shapeId);
        editor.zoomToSelection({ animation: { duration: 320 } });
      } catch (err) {
        console.warn(
          `[workspace-room-spawner] createShapes (${props.kind}) failed:`,
          err,
        );
      }
    }

    function onAddBrainstorm(ev: Event) {
      const detail = (ev as CustomEvent<AddBrainstormDetail>).detail;
      if (!detail || !detail.sessionId) return;
      spawnRoom({
        kind: "brainstorm",
        artifact_id: detail.sessionId,
        cached_title: detail.title ?? "",
      });
    }

    function onAddStrategy(ev: Event) {
      const detail = (ev as CustomEvent<AddStrategyDetail>).detail;
      if (!detail || !detail.strategyId) return;
      spawnRoom({
        kind: "strategy",
        artifact_id: detail.strategyId,
        cached_title: detail.statement ?? "",
      });
    }

    window.addEventListener(
      "canvas-workspace:add-brainstorm",
      onAddBrainstorm,
    );
    window.addEventListener(
      "canvas-workspace:add-strategy",
      onAddStrategy,
    );
    return () => {
      window.removeEventListener(
        "canvas-workspace:add-brainstorm",
        onAddBrainstorm,
      );
      window.removeEventListener(
        "canvas-workspace:add-strategy",
        onAddStrategy,
      );
    };
  }, [editor]);

  return null;
}
