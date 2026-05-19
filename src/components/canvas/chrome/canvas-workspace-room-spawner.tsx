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

interface AddSpaceDetail {
  spaceId: string;
  name?: string;
  /** Optional: the strategy id this space was promoted FROM (carried
   *  by the strategy→space promotion bridge so we can auto-draw the
   *  arrow from strategy → space without an extra fetch). */
  fromStrategyId?: string;
  /** Phase A.6 — when the strategy was itself derived from a
   *  brainstorm, the promotion bridge forwards that session id too so
   *  a B → R arrow can also draw without hitting the network. */
  fromBrainstormSessionId?: string;
}

interface AddTwinDetail {
  spaceId: string;
  cachedTitle?: string;
}

export function CanvasWorkspaceRoomSpawner() {
  const editor = useEditor();

  useEffect(() => {
    // Shared helper — places a room at the viewport center and
    // selects + zooms to it. Returns the new shape's id (or null on
    // failure) so callers can pass it to provenance helpers.
    function spawnRoom(props: {
      kind: "brainstorm" | "strategy" | "twin" | "probe" | "space";
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
              expanded: false,
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
      // Phase A.2.5 — reverse-direction provenance to strategies on
      // canvas. Phase A.6 — also reverse-direction to space rooms
      // whose synthesis_data.provenance.from_brainstorm_session_id
      // matches this session.
      if (shapeId) {
        void drawProvenanceFromBrainstorm({
          editor,
          brainstormShapeId: shapeId,
          brainstormSessionId: detail.sessionId,
        });
        void drawSpaceProvenanceForBrainstorm({
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
      if (!shapeId) return;
      // Phase A.2.5 — forward-direction provenance to brainstorm rooms.
      if (detail.sessionId) {
        void drawProvenanceFromStrategy({
          editor,
          strategyShapeId: shapeId,
          sourceSessionId: detail.sessionId,
        });
      }
      // Phase A.6 — reverse-direction provenance to space rooms whose
      // synthesis_data.provenance.from_strategy_id matches this
      // strategy. Without this, S → R arrows didn't redraw in fresh
      // sessions when the room-add order was R-then-S.
      void drawSpaceProvenanceForStrategy({
        editor,
        strategyShapeId: shapeId,
        strategyId: detail.strategyId,
      });
    }

    function onAddSpace(ev: Event) {
      const detail = (ev as CustomEvent<AddSpaceDetail>).detail;
      if (!detail || !detail.spaceId) return;
      const shapeId = spawnRoom({
        kind: "space",
        artifact_id: detail.spaceId,
        cached_title: detail.name ?? "",
      });
      if (!shapeId) return;
      // Phase A.6 — hydrate cross-session provenance for this new
      // space room. If the live event detail carries fromStrategyId /
      // fromBrainstormSessionId (just-promoted), use them. Otherwise
      // fetch the space's room-summary which returns the same fields
      // from synthesis_data.provenance.
      void drawProvenanceFromSpace({
        editor,
        spaceShapeId: shapeId,
        spaceId: detail.spaceId,
        fromStrategyId: detail.fromStrategyId,
        fromBrainstormSessionId: detail.fromBrainstormSessionId,
      });
      // Reverse provenance: if a twin room for the SAME space already
      // exists, draw arrow space→twin so the lineage is visible
      // either way the user added them.
      const twinShapeId = findWorkspaceRoom(editor, "twin", detail.spaceId);
      if (twinShapeId) {
        drawProvenanceArrow(editor, shapeId, twinShapeId);
      }
    }

    function onAddTwin(ev: Event) {
      const detail = (ev as CustomEvent<AddTwinDetail>).detail;
      if (!detail || !detail.spaceId) return;
      const shapeId = spawnRoom({
        kind: "twin",
        artifact_id: detail.spaceId,
        cached_title: detail.cachedTitle ?? "",
      });
      if (!shapeId) return;
      // Auto-arrow: a twin is a projection of its space. If the
      // space room is already on the canvas (same artifact_id), draw
      // arrow space→twin.
      const spaceShapeId = findWorkspaceRoom(editor, "space", detail.spaceId);
      if (spaceShapeId) {
        drawProvenanceArrow(editor, spaceShapeId, shapeId);
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
    window.addEventListener("canvas-workspace:add-space", onAddSpace);
    window.addEventListener("canvas-workspace:add-twin", onAddTwin);
    return () => {
      window.removeEventListener(
        "canvas-workspace:add-brainstorm",
        onAddBrainstorm,
      );
      window.removeEventListener(
        "canvas-workspace:add-strategy",
        onAddStrategy,
      );
      window.removeEventListener("canvas-workspace:add-space", onAddSpace);
      window.removeEventListener("canvas-workspace:add-twin", onAddTwin);
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

// ── Phase A.6 — cross-session provenance hydration ───────────────
//
// When a space room is added, the spawner needs to learn whether the
// space was promoted from an upstream strategy / brainstorm so it can
// redraw arrows in fresh canvas sessions. The data lives in
// synthesis_data.provenance on the space row and is returned by
// /api/spaces/[id]/room-summary as `from_strategy_id` and
// `from_brainstorm_session_id`.
//
// Three helpers, each soft-failing on fetch error:
//   - drawProvenanceFromSpace: a space was just added → look up its
//     ancestors and draw arrows IN from whichever rooms exist.
//   - drawSpaceProvenanceForStrategy: a strategy was just added →
//     walk all space rooms on canvas, fetch their provenance, draw
//     arrows OUT to spaces that name this strategy as their parent.
//   - drawSpaceProvenanceForBrainstorm: same as above but for the
//     brainstorm ancestry chain.

interface SpaceRoomSummary {
  space: {
    id: string;
    from_strategy_id?: string | null;
    from_brainstorm_session_id?: string | null;
  };
}

async function fetchSpaceProvenance(
  spaceId: string,
): Promise<{
  fromStrategyId: string | null;
  fromBrainstormSessionId: string | null;
} | null> {
  try {
    const res = await fetch(`/api/spaces/${spaceId}/room-summary`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as SpaceRoomSummary;
    return {
      fromStrategyId: json.space.from_strategy_id ?? null,
      fromBrainstormSessionId: json.space.from_brainstorm_session_id ?? null,
    };
  } catch {
    return null;
  }
}

async function drawProvenanceFromSpace({
  editor,
  spaceShapeId,
  spaceId,
  fromStrategyId,
  fromBrainstormSessionId,
}: {
  editor: Editor;
  spaceShapeId: TLShapeId;
  spaceId: string;
  fromStrategyId?: string;
  fromBrainstormSessionId?: string;
}) {
  // Prefer the in-memory hints (set when the user just promoted),
  // fall back to the persisted provenance (cross-session case).
  let strategyId = fromStrategyId ?? null;
  let brainstormSessionId = fromBrainstormSessionId ?? null;
  if (!strategyId && !brainstormSessionId) {
    const persisted = await fetchSpaceProvenance(spaceId);
    if (persisted) {
      strategyId = persisted.fromStrategyId;
      brainstormSessionId = persisted.fromBrainstormSessionId;
    }
  }

  if (strategyId) {
    const strategyShapeId = findWorkspaceRoom(editor, "strategy", strategyId);
    if (strategyShapeId) {
      drawProvenanceArrow(editor, strategyShapeId, spaceShapeId);
    }
  }
  if (brainstormSessionId) {
    const brainstormShapeId = findWorkspaceRoom(
      editor,
      "brainstorm",
      brainstormSessionId,
    );
    if (brainstormShapeId) {
      drawProvenanceArrow(editor, brainstormShapeId, spaceShapeId);
    }
  }
}

async function drawSpaceProvenanceForStrategy({
  editor,
  strategyShapeId,
  strategyId,
}: {
  editor: Editor;
  strategyShapeId: TLShapeId;
  strategyId: string;
}) {
  const spaces = findAllWorkspaceRoomsByKind(editor, "space");
  if (spaces.length === 0) return;
  const fetched = await Promise.all(
    spaces.map(async ({ id, artifactId }) => ({
      id,
      provenance: await fetchSpaceProvenance(artifactId),
    })),
  );
  for (const m of fetched) {
    if (!m.provenance) continue;
    if (m.provenance.fromStrategyId === strategyId) {
      drawProvenanceArrow(editor, strategyShapeId, m.id);
    }
  }
}

async function drawSpaceProvenanceForBrainstorm({
  editor,
  brainstormShapeId,
  brainstormSessionId,
}: {
  editor: Editor;
  brainstormShapeId: TLShapeId;
  brainstormSessionId: string;
}) {
  const spaces = findAllWorkspaceRoomsByKind(editor, "space");
  if (spaces.length === 0) return;
  const fetched = await Promise.all(
    spaces.map(async ({ id, artifactId }) => ({
      id,
      provenance: await fetchSpaceProvenance(artifactId),
    })),
  );
  for (const m of fetched) {
    if (!m.provenance) continue;
    if (m.provenance.fromBrainstormSessionId === brainstormSessionId) {
      drawProvenanceArrow(editor, brainstormShapeId, m.id);
    }
  }
}
