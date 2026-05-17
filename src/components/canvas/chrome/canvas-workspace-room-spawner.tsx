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
// Phase A.2.5 — Provenance auto-connectors.
// When a strategy room is added AND its source brainstorm exists on
// the canvas, an arrow auto-draws between them. When a brainstorm
// room is added AND any strategy on the canvas points to it, arrows
// auto-draw from the brainstorm to those strategies. Bindings keep
// the arrows attached as rooms are moved.
//
// Phase A handles brainstorm + strategy. Twin / probe extend by
// adding new event types + new arms in spawnRoom + new provenance
// rules in tryDrawProvenance.

import { useEffect } from "react";
import {
  createShapeId,
  toRichText,
  useEditor,
  type Editor,
  type TLArrowShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import {
  WORKSPACE_ROOM_DEFAULT_H,
  WORKSPACE_ROOM_DEFAULT_W,
} from "@/components/canvas/shapes/workspace-room-shape";
import type { WorkspaceRoomShape } from "@/components/canvas/shapes/types";

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
    // selects + zooms to it. Returns the new shape's id (or null on
    // failure) so callers can pass it to provenance helpers.
    function spawnRoom(props: {
      kind: "brainstorm" | "strategy" | "twin" | "probe";
      artifact_id: string;
      cached_title: string;
    }): TLShapeId | null {
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
        return shapeId;
      } catch (err) {
        console.warn(
          `[workspace-room-spawner] createShapes (${props.kind}) failed:`,
          err,
        );
        return null;
      }
    }

    function onAddBrainstorm(ev: Event) {
      const detail = (ev as CustomEvent<AddBrainstormDetail>).detail;
      if (!detail || !detail.sessionId) return;
      const shapeId = spawnRoom({
        kind: "brainstorm",
        artifact_id: detail.sessionId,
        cached_title: detail.title ?? "",
      });
      // Phase A.2.5 — reverse-direction provenance. The new
      // brainstorm room is now on the canvas; check if any existing
      // strategy rooms link back to it via their source session_id
      // and draw arrows for those matches.
      if (shapeId) {
        void drawProvenanceFromBrainstorm({
          editor,
          brainstormShapeId: shapeId,
          brainstormSessionId: detail.sessionId,
        });
      }
    }

    function onAddStrategy(ev: Event) {
      const detail = (ev as CustomEvent<AddStrategyDetail>).detail;
      if (!detail || !detail.strategyId) return;
      const shapeId = spawnRoom({
        kind: "strategy",
        artifact_id: detail.strategyId,
        cached_title: detail.statement ?? "",
      });
      // Phase A.2.5 — forward-direction provenance. If the picker
      // forwarded the source session_id (most strategies have one),
      // try to find a matching brainstorm room on the canvas right
      // now and draw an arrow from it to this new strategy.
      if (shapeId && detail.sessionId) {
        void drawProvenanceFromStrategy({
          editor,
          strategyShapeId: shapeId,
          sourceSessionId: detail.sessionId,
        });
      }
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

// ── Provenance auto-connector helpers (Phase A.2.5) ──
//
// When a strategy and its source brainstorm both appear on the
// canvas, an arrow connects them. The arrow is a real tldraw arrow
// with bindings on both ends — moves with the rooms.
//
// Each helper:
//   1. Finds the target room(s) on the canvas via meta.kind +
//      meta.artifact_id match
//   2. Idempotent: skips if a workspace-provenance arrow already
//      exists between the two endpoints (so re-spawning doesn't
//      double-draw)
//   3. Marks the new arrow with meta.workspaceProvenance so future
//      scans can recognize it

const PROVENANCE_META_KEY = "workspaceProvenance";

function findWorkspaceRoom(
  editor: Editor,
  kind: WorkspaceRoomShape["props"]["kind"],
  artifactId: string,
): TLShapeId | null {
  const all = editor.getCurrentPageShapes();
  for (const s of all) {
    if (s.type !== "workspace-room") continue;
    const props = s.props as WorkspaceRoomShape["props"];
    if (props.kind === kind && props.artifact_id === artifactId) {
      return s.id;
    }
  }
  return null;
}

function findAllWorkspaceRoomsByKind(
  editor: Editor,
  kind: WorkspaceRoomShape["props"]["kind"],
): Array<{ id: TLShapeId; artifactId: string }> {
  const all = editor.getCurrentPageShapes();
  const out: Array<{ id: TLShapeId; artifactId: string }> = [];
  for (const s of all) {
    if (s.type !== "workspace-room") continue;
    const props = s.props as WorkspaceRoomShape["props"];
    if (props.kind === kind) {
      out.push({ id: s.id, artifactId: props.artifact_id });
    }
  }
  return out;
}

function hasProvenanceArrow(
  editor: Editor,
  fromShapeId: TLShapeId,
  toShapeId: TLShapeId,
): boolean {
  const arrows = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "arrow");
  for (const a of arrows) {
    const meta = a.meta as { workspaceProvenance?: { from: string; to: string } };
    const tag = meta?.[PROVENANCE_META_KEY];
    if (!tag) continue;
    if (tag.from === fromShapeId && tag.to === toShapeId) return true;
  }
  return false;
}

function drawProvenanceArrow(
  editor: Editor,
  fromShapeId: TLShapeId,
  toShapeId: TLShapeId,
) {
  if (hasProvenanceArrow(editor, fromShapeId, toShapeId)) return;
  try {
    const arrowId = createShapeId();
    const arrow: TLShapePartial<TLArrowShape> = {
      id: arrowId,
      type: "arrow",
      props: {
        color: "grey",
        size: "s",
        font: "sans",
        // Dashed reads as "lineage" — purposefully different from
        // user-drawn solid arrows. Elbow routing keeps lines tidy
        // when rooms are arranged in a grid.
        dash: "dashed",
        kind: "elbow",
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        richText: toRichText(""),
      },
      meta: {
        [PROVENANCE_META_KEY]: { from: fromShapeId, to: toShapeId },
      },
    };
    editor.createShapes([arrow]);
    editor.createBindings([
      {
        fromId: arrowId,
        toId: fromShapeId,
        type: "arrow",
        props: {
          terminal: "start",
          normalizedAnchor: { x: 1, y: 0.5 }, // right edge
          isExact: false,
          isPrecise: false,
        },
        meta: {},
      },
      {
        fromId: arrowId,
        toId: toShapeId,
        type: "arrow",
        props: {
          terminal: "end",
          normalizedAnchor: { x: 0, y: 0.5 }, // left edge
          isExact: false,
          isPrecise: false,
        },
        meta: {},
      },
    ]);
  } catch (err) {
    console.warn("[workspace-room-spawner] drawProvenanceArrow failed:", err);
  }
}

/** Strategy was just added. If a brainstorm with the matching
 *  source_session_id is on the canvas, draw an arrow from it to the
 *  new strategy.
 *
 *  Hits /summary first for strategies whose detail didn't carry the
 *  session_id (e.g., legacy callers). The picker forwards it
 *  directly so most calls skip the fetch. */
async function drawProvenanceFromStrategy({
  editor,
  strategyShapeId,
  sourceSessionId,
}: {
  editor: Editor;
  strategyShapeId: TLShapeId;
  sourceSessionId: string;
}) {
  if (!sourceSessionId) return;
  const brainstormShapeId = findWorkspaceRoom(
    editor,
    "brainstorm",
    sourceSessionId,
  );
  if (!brainstormShapeId) return;
  drawProvenanceArrow(editor, brainstormShapeId, strategyShapeId);
}

/** Brainstorm was just added. For every strategy already on the
 *  canvas whose source_session_id === this brainstorm's
 *  artifact_id, draw an arrow from this brainstorm to that strategy.
 *
 *  Strategies on canvas don't carry their source session_id in shape
 *  props (the shape only has artifact_id = the strategy id). We have
 *  to fetch each one's summary to learn its source. Batched in
 *  parallel; soft-fails per-strategy. */
async function drawProvenanceFromBrainstorm({
  editor,
  brainstormShapeId,
  brainstormSessionId,
}: {
  editor: Editor;
  brainstormShapeId: TLShapeId;
  brainstormSessionId: string;
}) {
  const strategies = findAllWorkspaceRoomsByKind(editor, "strategy");
  if (strategies.length === 0) return;

  // Fetch all strategy summaries in parallel. Each returns the
  // strategy's session_id — match against ours.
  const fetched = await Promise.all(
    strategies.map(async ({ id, artifactId }) => {
      try {
        const res = await fetch(
          `/api/synergy/strategies/${artifactId}/summary`,
          { cache: "no-store" },
        );
        if (!res.ok) return null;
        const json = (await res.json()) as {
          strategy: { session_id: string };
        };
        return { id, sessionId: json.strategy.session_id };
      } catch {
        return null;
      }
    }),
  );

  for (const match of fetched) {
    if (!match) continue;
    if (match.sessionId === brainstormSessionId) {
      drawProvenanceArrow(editor, brainstormShapeId, match.id);
    }
  }
}
