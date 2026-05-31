"use client";

// ── WhiteboardBase ──
//
// The objective canvas's floor-0: a real, interactive tldraw whiteboard
// that lives BEHIND the floating room-window. The room-window is mostly
// opaque, so day-to-day you see the board peeking in the margins; when a
// room is collapsed (its window hidden), the board is fully revealed and
// the collapsed room sits on it as a draggable `room-card`.
//
// Why a *focused* board (just our one custom shape + tldraw's built-in
// tools) instead of the full InteraxisCanvas?
//   • InteraxisCanvas needs the heavy SpaceDataProvider (~12 DB queries
//     via /app/space/[id]/layout) — impractical to duplicate under the
//     objective route.
//   • We only need: an interactive surface (sticky notes, draw, arrows,
//     text — all free from tldraw's built-in tools) + a place to land
//     collapsed rooms. So we register ONE custom shape (RoomCard) and
//     let tldraw provide the rest. No app context = safe to mount here.
//
// The board is persisted server-side per objective (the `canvases` table,
// scope='objective', anchored to the space's root goal) via
// useObjectiveBoardPersistence, with a localStorage mirror — so
// arrangements survive reload AND sync across devices.

import {
  Tldraw,
  createShapeId,
  useValue,
  type Editor,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
  type TLArrowShape,
} from "tldraw";
import "tldraw/tldraw.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomCardShapeUtil, type RoomCardShape } from "./shapes/room-card-shape";
import {
  InsightCardShapeUtil,
  type InsightCardShape,
} from "./shapes/insight-card-shape";
import {
  ArtifactCardShapeUtil,
  type ArtifactCardShape,
} from "./shapes/artifact-card-shape";
import {
  SubsystemKgShapeUtil,
  type SubsystemKgShape,
} from "./shapes/subsystem-kg-shape";
import { LayerBandShapeUtil } from "./shapes/layer-band-shape";
import { BoardSelectionToolbar } from "./board-selection-toolbar";
import {
  saveCardsToLibrary,
  type SaveableCard,
} from "./canvas-interactions/save-to-library";
import {
  boardShapesToNodes,
  shapeToScanTarget,
} from "./canvas-interactions/shape-node-adapter";
import { FocusModePanel } from "./canvas-interactions/focus-mode-panel";
import { executeCardOperation } from "./canvas-interactions/operation-executor";
import { AiScannerPanel } from "./canvas-interactions/ai-scanner-panel";
import { CollapsibleStylePanel } from "./canvas-interactions/collapsible-style-panel";
import type { TLComponents } from "tldraw";
import type { OperationTarget } from "@/lib/objective-canvas/canvas-operations";
import { useFocusMode } from "@/components/synergy/focus-mode/use-focus-mode";
import { ListChecks, Sparkles } from "lucide-react";
import { BoardHint } from "./board-hint";
import { useObjectiveBoardPersistence } from "./use-objective-board-persistence";
import {
  DEPLOY_ARTIFACT_EVENT,
  OPEN_UNFURL_EVENT,
  CARD_ACTION_EVENT,
  type CardActionDetail,
  dispatchCardSaved,
  drainPendingArtifacts,
  type ArtifactCardDetail,
} from "./board-bus";
import {
  DEPLOY_SUBSYSTEM_KG_EVENT,
  drainPendingSubsystemKgs,
  type SubsystemKgCardDetail,
} from "./subsystem-kg-board-bus";
import {
  BRAINSTORM_OPEN_ON_BOARD_EVENT,
  BRAINSTORM_COLLAPSE_PAGE_EVENT,
  type BrainstormOpenOnBoardDetail,
  type BrainstormCollapsePageDetail,
} from "./brainstorm/brainstorm-board-bus";
import {
  renderBrainstormOnBoard,
  collapseBrainstormPage,
} from "./brainstorm/render-brainstorm-on-board";
import { useDepthDial } from "./unfurl/use-depth-dial";
import { DepthScrubber } from "./unfurl/depth-scrubber";
import {
  syncUnfurl,
  clearUnfurl,
  type UnfurlGraphs,
} from "./unfurl/render-unfurl";
import { mockCanvasGraph } from "./unfurl/render-canvas-unfurl";
import { mockRoomGraph } from "./unfurl/render-room-unfurl";
import type { UnfurlAnchor } from "./unfurl/anchor-from-path";
import { buildRoomGraph } from "./causal-map/lib/build-room-graph";
import type { CanvasGraph } from "./causal-map/lib/types";
import { X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

/** Detail payload for a collapse-to-card request. */
export interface DeployCardDetail {
  roomId: string;
  title: string;
  subtitle?: string;
  color?: string;
  /** Short stat strings rendered as pills on the card. */
  chips?: string[];
}

/** Event the shell fires to drop a collapsed room onto the board. */
export const DEPLOY_CARD_EVENT = "objective-board:deploy-card";

/** Event the shell fires to clear a room's card (e.g. when that room is
 *  re-opened as a window via the sidebar rather than via the card's own
 *  Expand button). Keeps the invariant: a room is EITHER a window OR a
 *  card on the board, never both. */
export const REMOVE_CARD_EVENT = "objective-board:remove-card";

/** Typed dispatcher so callers don't hand-roll the CustomEvent. */
export function deployRoomCard(detail: DeployCardDetail) {
  window.dispatchEvent(new CustomEvent(DEPLOY_CARD_EVENT, { detail }));
}

/** Remove any deployed card for this room. No-op if none exists (e.g.
 *  the card already deleted itself via its Expand button). */
export function removeRoomCard(roomId: string) {
  window.dispatchEvent(
    new CustomEvent(REMOVE_CARD_EVENT, { detail: { roomId } }),
  );
}

// Artifact dispatch (DEPLOY_ARTIFACT_EVENT / deployArtifactCard /
// ArtifactCardDetail) lives in the tldraw-free ./board-bus so room views
// can fire it without importing this heavy module. WhiteboardBase only
// LISTENS (below), using the imported event name + type.

/** A board card distilled to the context the AI needs. */
export interface BoardCardPayload {
  title: string;
  chips?: string[];
  roomId?: string;
}

export type AiLinkMode = "connect" | "synthesize";

/** Runs the on-demand AI for the current selection. Default posts to the
 *  objective connect route; the preflight harness injects a mock. */
export type AiLinkFn = (
  mode: AiLinkMode,
  cards: BoardCardPayload[],
) => Promise<{ headline: string; body: string }>;

// Custom shapes — room cards (collapsed rooms) + insight cards (AI
// connect/synthesize results). tldraw supplies select/draw/note/arrow/
// text/geo out of the box, which is the rest of the interactive surface.
/** Collapse tldraw's always-open style palette into a glass icon — declutters
 *  the top-right and stops it colliding with the Notebook pill. */
const BOARD_COMPONENTS: TLComponents = {
  StylePanel: CollapsibleStylePanel,
};

const CUSTOM_SHAPE_UTILS = [
  RoomCardShapeUtil,
  InsightCardShapeUtil,
  ArtifactCardShapeUtil,
  SubsystemKgShapeUtil,
  LayerBandShapeUtil,
];

export function WhiteboardBase({
  spaceId,
  showUi = true,
  onAiLink,
  onEditorReady,
}: {
  spaceId: string;
  /** When false, tldraw's chrome (toolbar / menus / style panel) is
   *  hidden — the canvas stays interactive but recedes into the
   *  background. The shell sets this false while a room window is open. */
  showUi?: boolean;
  /** Override the AI Connect/Synthesize call (default posts to the
   *  objective connect route). The preflight harness passes a mock. */
  onAiLink?: AiLinkFn;
  /** Called once with the tldraw editor on mount (parent escape hatch). */
  onEditorReady?: (editor: Editor) => void;
}) {
  const editorRef = useRef<Editor | null>(null);
  // Editor also held in state so the selection overlay (which needs
  // reactive `useValue`) can mount once the editor exists.
  const [editor, setEditor] = useState<Editor | null>(null);
  // Ref so handleMount stays stable while still seeing the latest callback.
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    setEditor(editor);
    // Light, graph-paper feel that matches the pearl substrate. Force
    // light mode so it never inherits a dark OS preference (the rest of
    // the objective canvas is pearl-light).
    editor.user.updateUserPreferences({ colorScheme: "light" });
    editor.updateInstanceState({ isGridMode: true });
    onEditorReadyRef.current?.(editor);
  }, []);

  // Default AI runner posts to the objective connect route; an override
  // (preflight mock) wins.
  const runAiLink = useMemo<AiLinkFn>(
    () =>
      onAiLink ??
      (async (mode, cards) => {
        const res = await fetch(`/api/objective/${spaceId}/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, cards }),
        });
        if (!res.ok) throw new Error(`connect failed: ${res.status}`);
        return (await res.json()) as { headline: string; body: string };
      }),
    [onAiLink, spaceId],
  );

  // Server-backed persistence (canvases table, scope='objective') with a
  // localStorage mirror — replaces tldraw's local-only persistenceKey so
  // the board survives reload AND syncs across devices.
  useObjectiveBoardPersistence(editor, spaceId, () => {
    // Restore settled — now safe to drop in any cross-page queued
    // artifacts (e.g. sent from the lab) without a late restore wiping them.
    const ed = editorRef.current;
    if (!ed) return;
    for (const d of drainPendingArtifacts(spaceId)) createArtifactCard(ed, d);
    for (const d of drainPendingSubsystemKgs(spaceId))
      createSubsystemKgCard(ed, d);
  });

  // ── Unfurl mode ──
  // "Open on whiteboard" fires OPEN_UNFURL_EVENT; we fetch the chain graph
  // up to the anchored surface, open the depth scrubber, and render the
  // unfurl as tldraw shapes (meta.unfurl) on top of the board. Exit clears
  // just those shapes — the user's collapsed cards stay put.
  const dial = useDepthDial(0);
  const [unfurl, setUnfurl] = useState<{
    anchor: UnfurlAnchor;
    graphs: UnfurlGraphs;
  } | null>(null);
  // Levers descend: guard concurrent room fetches, cache per room so the 2↔3
  // scrub is instant, and remember which room we anchored (independent of
  // whether it had levers to show) so an empty room can't retrigger a loop.
  const descendingRef = useRef(false);
  const anchoredRoomRef = useRef<string | null>(null);
  const roomGraphCache = useRef<
    Map<string, { room: UnfurlGraphs["room"]; roomTitle?: string }>
  >(new Map());

  useEffect(() => {
    function onOpen(e: Event) {
      const anchor = (e as CustomEvent<UnfurlAnchor>).detail;
      if (!anchor) return;
      dial.setDepth(anchor.depth);
      // A fresh unfurl resets the descend anchor to whatever the open carried
      // (a room id when opened from a room; null from the objective).
      anchoredRoomRef.current = anchor.roomId ?? null;
      const qs = anchor.roomId
        ? `?room=${encodeURIComponent(anchor.roomId)}`
        : "";
      fetch(`/api/objective/${spaceId}/unfurl${qs}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then(
          (d: {
            objectiveTitle?: string;
            canvas: CanvasGraph;
            room: { lanes: unknown; edges: unknown } | null;
            roomTitle?: string;
          }) => {
            // Build the room graph client-side (buildRoomGraph is a client
            // module) from the raw lanes/edges the endpoint returned.
            let room: UnfurlGraphs["room"] = null;
            if (d.room) {
              const rg = buildRoomGraph({
                lanes: d.room.lanes,
                edges: d.room.edges,
                spaceId,
                subObjectiveId: anchor.roomId ?? undefined,
              } as Parameters<typeof buildRoomGraph>[0]);
              room = { nodes: rg.nodes, edges: rg.edges };
            }
            setUnfurl({
              anchor,
              graphs: {
                canvas: d.canvas,
                room,
                objectiveTitle: d.objectiveTitle,
                roomTitle: d.roomTitle,
                roomId: anchor.roomId ?? undefined,
              },
            });
          },
        )
        .catch(() => {
          // No endpoint yet / unauthenticated preflight → mock so the
          // mount + scrubber are still exercisable.
          setUnfurl({
            anchor,
            graphs: {
              canvas: mockCanvasGraph(),
              room: mockRoomGraph(),
              objectiveTitle: "Objective",
              roomTitle: "Room",
              roomId: anchor.roomId ?? undefined,
            },
          });
        });
    }
    window.addEventListener(OPEN_UNFURL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_UNFURL_EVENT, onOpen);
    // dial.setDepth is stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  // Levers descend (depth ≥ 3): the objective-level unfurl carries no room, so
  // scrubbing into Levers anchors the focused room — the one selected, else the
  // room-card nearest the viewport center — fetches its lanes/edges, and builds
  // the room graph so the room phase can render. Scrubbing back below Levers
  // releases the anchor so the next descent can pick a different room.
  useEffect(() => {
    if (!unfurl) return;
    const ed = editorRef.current;
    if (!ed) return;

    if (dial.depth >= 3 && anchoredRoomRef.current === null && !descendingRef.current) {
      // Focus target: a single selected unfurl room-card, else the unfurl
      // room-card nearest the viewport center.
      const isRoom = (s: { type: string; meta?: Record<string, unknown> }) =>
        s.type === "room-card" && !!(s.meta as { unfurl?: boolean })?.unfurl;
      const realRoom = (rid: string | undefined): rid is string =>
        !!rid && rid !== "__obj";
      let roomId: string | null = null;
      const sel = ed.getSelectedShapes().filter((s): s is RoomCardShape => isRoom(s));
      if (sel.length === 1 && realRoom(sel[0].props.roomId)) {
        roomId = sel[0].props.roomId;
      } else {
        const vp = ed.getViewportPageBounds();
        const cx = vp.x + vp.w / 2;
        const cy = vp.y + vp.h / 2;
        let bestD = Infinity;
        for (const s of ed.getCurrentPageShapes()) {
          if (!isRoom(s)) continue;
          const rid = (s as RoomCardShape).props.roomId;
          if (!realRoom(rid)) continue;
          const b = ed.getShapePageBounds(s.id);
          if (!b) continue;
          const d = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy);
          if (d < bestD) {
            bestD = d;
            roomId = rid;
          }
        }
      }
      if (!roomId) return; // no room to descend into — stays clamped at Bets
      // Mark anchored BEFORE the fetch so an empty room can't retrigger.
      anchoredRoomRef.current = roomId;
      const cached = roomGraphCache.current.get(roomId);
      if (cached) {
        const rid = roomId;
        setUnfurl((u) =>
          u
            ? { ...u, graphs: { ...u.graphs, room: cached.room, roomId: rid, roomTitle: cached.roomTitle } }
            : u,
        );
        return;
      }
      descendingRef.current = true;
      const rid = roomId;
      fetch(`/api/objective/${spaceId}/unfurl?room=${encodeURIComponent(rid)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then(
          (d: {
            room: { lanes: unknown; edges: unknown } | null;
            roomTitle?: string;
          }) => {
            let room: UnfurlGraphs["room"] = null;
            if (d.room) {
              const rg = buildRoomGraph({
                lanes: d.room.lanes,
                edges: d.room.edges,
                spaceId,
                subObjectiveId: rid,
              } as Parameters<typeof buildRoomGraph>[0]);
              room = { nodes: rg.nodes, edges: rg.edges };
            }
            roomGraphCache.current.set(rid, { room, roomTitle: d.roomTitle });
            setUnfurl((u) =>
              u
                ? { ...u, graphs: { ...u.graphs, room, roomId: rid, roomTitle: d.roomTitle } }
                : u,
            );
          },
        )
        .catch(() => {})
        .finally(() => {
          descendingRef.current = false;
        });
      return;
    }

    // Released back to the canvas phase — drop the anchor + room so the next
    // descent re-picks (possibly a different room).
    if (dial.depth < 3 && anchoredRoomRef.current !== null) {
      anchoredRoomRef.current = null;
      setUnfurl((u) =>
        u && u.graphs.room ? { ...u, graphs: { ...u.graphs, room: null } } : u,
      );
    }
  }, [dial.depth, unfurl, spaceId]);

  // Reconcile the unfurl on depth / graph change, then frame it.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !unfurl) return;
    syncUnfurl(ed, unfurl.graphs, dial.depth);
    // Frame JUST the unfurl (not the user's parked collapsed cards):
    // select the unfurl shapes, zoom to that selection, then deselect.
    const t = setTimeout(() => {
      try {
        const ids = ed
          .getCurrentPageShapes()
          .filter((s) => !!(s.meta as { unfurl?: boolean })?.unfurl)
          .map((s) => s.id);
        if (ids.length === 0) {
          ed.zoomToFit({ animation: { duration: 300 } });
          return;
        }
        ed.select(...ids);
        ed.zoomToSelection({ animation: { duration: 300 } });
        ed.selectNone();
      } catch {
        /* no shapes */
      }
    }, 80);
    return () => clearTimeout(t);
  }, [unfurl, dial.depth]);

  // Sweep unfurl shapes on unmount so they never leak into the saved board.
  useEffect(() => {
    return () => {
      const ed = editorRef.current;
      if (ed) clearUnfurl(ed);
    };
  }, []);

  function exitUnfurl() {
    const ed = editorRef.current;
    if (ed) clearUnfurl(ed);
    setUnfurl(null);
    anchoredRoomRef.current = null;
  }

  // ── Brainstorm board integration (Phase 4b-2) ─────────────────────
  // The BrainstormPanel fires BRAINSTORM_OPEN_ON_BOARD_EVENT when the
  // user clicks "Open on whiteboard" (or, in future, automatically on
  // settle). We create a dedicated tldraw page and drop one sticky
  // note per candidate. Re-firing with the same sessionId updates the
  // existing shapes in place so streaming additions don't duplicate.
  //
  // COLLAPSE event switches the editor back to the main page; the
  // brainstorm page persists in tldraw's page sidebar so the user can
  // flip back via the built-in nav.
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<BrainstormOpenOnBoardDetail>).detail;
      const ed = editorRef.current;
      if (!ed || !detail) return;
      try {
        renderBrainstormOnBoard(ed, detail);
      } catch {
        // Soft-fail — the panel still works as a list view.
      }
    }
    function onCollapse(e: Event) {
      const detail = (e as CustomEvent<BrainstormCollapsePageDetail>).detail;
      const ed = editorRef.current;
      if (!ed || !detail) return;
      try {
        collapseBrainstormPage(ed, detail.sessionId);
      } catch {
        /* swallow */
      }
    }
    window.addEventListener(BRAINSTORM_OPEN_ON_BOARD_EVENT, onOpen);
    window.addEventListener(BRAINSTORM_COLLAPSE_PAGE_EVENT, onCollapse);
    return () => {
      window.removeEventListener(BRAINSTORM_OPEN_ON_BOARD_EVENT, onOpen);
      window.removeEventListener(BRAINSTORM_COLLAPSE_PAGE_EVENT, onCollapse);
    };
  }, []);

  // Collapse-to-card: the shell fires DEPLOY_CARD_EVENT; we materialize
  // a room-card near the current viewport center and select it so the
  // user immediately sees where the room "landed."
  useEffect(() => {
    function onDeploy(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      const detail = (e as CustomEvent<DeployCardDetail>).detail;
      if (!detail?.roomId) return;

      const roomCards = editor
        .getCurrentPageShapes()
        .filter((s): s is RoomCardShape => s.type === "room-card");

      // Don't stack duplicates: if a card for this room already exists,
      // just reselect + pan to it instead of creating a second one.
      const existing = roomCards.find(
        (s) => s.props.roomId === detail.roomId,
      );
      if (existing) {
        editor.select(existing.id);
        // Pan (don't zoom-to-fit — that over-zooms on one small card) so
        // the existing card is centered at the board's current zoom.
        editor.centerOnPoint(
          {
            x: existing.x + existing.props.w / 2,
            y: existing.y + existing.props.h / 2,
          },
          { animation: { duration: 300 } },
        );
        return;
      }

      const center = editor.getViewportPageBounds().center;
      const w = 268;
      const h = 184;
      // Cascade each new card so multiple collapsed rooms fan out instead
      // of stacking on the exact same point.
      const cascade = (roomCards.length % 6) * 28;
      const x = center.x - w / 2 + cascade;
      const y = center.y - h / 2 + cascade;
      const id = createShapeId();
      editor.createShape<RoomCardShape>({
        id,
        type: "room-card",
        x,
        y,
        props: {
          w,
          h,
          title: detail.title || "Room",
          subtitle: detail.subtitle ?? "",
          color: detail.color ?? "#475569",
          roomId: detail.roomId,
          chips: detail.chips ?? [],
        },
      });
      editor.select(id);
      // Guarantee the freshly-dropped card is centered & visible — a
      // persisted camera (pan/zoom from a prior session) can otherwise
      // leave it off the visible viewport. Panning onto the card's own
      // center always brings it into view.
      editor.centerOnPoint(
        { x: x + w / 2, y: y + h / 2 },
        { animation: { duration: 300 } },
      );
    }

    function onRemove(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      const roomId = (e as CustomEvent<{ roomId: string }>).detail?.roomId;
      if (!roomId) return;
      const matches = editor
        .getCurrentPageShapes()
        .filter(
          (s): s is RoomCardShape =>
            s.type === "room-card" &&
            (s as RoomCardShape).props.roomId === roomId,
        )
        .map((s) => s.id);
      if (matches.length) editor.deleteShapes(matches);
    }

    function onArtifact(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      createArtifactCard(editor, (e as CustomEvent<ArtifactCardDetail>).detail);
    }

    function onSubsystemKg(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      createSubsystemKgCard(
        editor,
        (e as CustomEvent<SubsystemKgCardDetail>).detail,
      );
    }

    // Per-card hover action. "save" → Library (canvas → object bridge).
    // The AI actions (decompose/variations/questions/make_plan) are left on
    // the bus for the brainstorm engine's handler — not owned here.
    function onCardAction(e: Event) {
      const d = (e as CustomEvent<CardActionDetail>).detail;
      if (!d) return;
      if (d.action === "save") {
        void (async () => {
          const { saved: n } = await saveCardsToLibrary(spaceId, [
            {
              objectType: "feature",
              title: d.title,
              sourceEntityId: d.entityId,
              sourceSubObjectiveId: d.roomId ?? null,
            },
          ]);
          // Confirm back to the card so its Save tile shows "Saved ✓".
          if (n >= 1) dispatchCardSaved(d.entityId);
        })();
        return;
      }
      // AI actions (decompose/variations/questions/make_plan) → run via the
      // canvas operation registry + executor; results land as cards just
      // below the source shape.
      const editor = editorRef.current;
      if (!editor) return;
      void executeCardOperation(
        editor,
        {
          text: d.title,
          shapeId: d.shapeId,
          entityId: d.entityId,
          roomId: d.roomId ?? undefined,
        },
        d.action,
      );
    }

    window.addEventListener(DEPLOY_CARD_EVENT, onDeploy);
    window.addEventListener(REMOVE_CARD_EVENT, onRemove);
    window.addEventListener(DEPLOY_ARTIFACT_EVENT, onArtifact);
    window.addEventListener(DEPLOY_SUBSYSTEM_KG_EVENT, onSubsystemKg);
    window.addEventListener(CARD_ACTION_EVENT, onCardAction);
    return () => {
      window.removeEventListener(DEPLOY_CARD_EVENT, onDeploy);
      window.removeEventListener(REMOVE_CARD_EVENT, onRemove);
      window.removeEventListener(DEPLOY_ARTIFACT_EVENT, onArtifact);
      window.removeEventListener(DEPLOY_SUBSYSTEM_KG_EVENT, onSubsystemKg);
      window.removeEventListener(CARD_ACTION_EVENT, onCardAction);
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <Tldraw
        shapeUtils={CUSTOM_SHAPE_UTILS}
        components={BOARD_COMPONENTS}
        onMount={handleMount}
        inferDarkMode={false}
        hideUi={!showUi}
      />
      {/* Contextual AI action — only while the board chrome is showing and
          we're NOT unfurling (the selection toolbar is for the normal board). */}
      {editor && showUi && (
        <BoardOverlay editor={editor} runAiLink={runAiLink} spaceId={spaceId} />
      )}

      {/* Unfurl mode — depth scrubber + exit. */}
      {editor && unfurl && (
        <>
          <DepthScrubber
            depth={dial.depth}
            onSet={dial.setDepth}
            onWheel={dial.onWheel}
          />
          <button
            type="button"
            onClick={exitUnfurl}
            title="Exit the unfurl"
            className="fixed left-1/2 top-4 z-[70] inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full transition-all duration-150 ease-out hover:scale-105"
            style={{
              background: "rgba(255,255,255,0.92)",
              border: `1px solid ${appleVibe.stroke.hairline}`,
              color: appleVibe.text.secondary,
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 600,
              boxShadow: "0 10px 28px -10px rgba(11,18,40,0.24)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              fontFamily: appleVibe.font.stack,
            }}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.4} />
            Exit unfurl
          </button>
        </>
      )}
    </div>
  );
}

// ── Board overlay: selection-aware AI Connect/Synthesize ──

function isBoardCard(s: TLShape): boolean {
  return (
    s.type === "room-card" ||
    s.type === "insight-card" ||
    s.type === "artifact-card"
  );
}

function cardPayload(s: TLShape): BoardCardPayload {
  if (s.type === "room-card") {
    const p = (s as RoomCardShape).props;
    return { title: p.title, chips: p.chips, roomId: p.roomId };
  }
  if (s.type === "artifact-card") {
    const p = (s as ArtifactCardShape).props;
    return {
      title: p.title,
      chips: p.subtitle ? [p.subtitle] : [],
      roomId: p.roomId,
    };
  }
  const p = (s as InsightCardShape).props;
  return { title: p.headline };
}

/** Project a board card into a library-saveable descriptor, or null when
 *  it isn't a savable object (room cards represent rooms, already
 *  first-class). Drives the "Save to Library" canvas interaction
 *  (canvas → object → Library, per OBJECT_FLOW_ARCHITECTURE.md). */
function cardSaveable(s: TLShape): SaveableCard | null {
  if (s.type === "artifact-card") {
    const p = (s as ArtifactCardShape).props;
    return {
      objectType: "feature",
      title: p.title,
      sourceEntityId: p.entityId ?? null,
      sourceSubObjectiveId: p.roomId ?? null,
    };
  }
  if (s.type === "insight-card") {
    const p = (s as InsightCardShape).props;
    return { objectType: "insight", title: p.headline };
  }
  return null;
}

/** Drop (or refocus) an artifact card on the board. Deduped by source
 *  entity so re-sending the same item doesn't stack. Shared by the live
 *  deploy listener and the cross-page queue drain. */
function createArtifactCard(editor: Editor, d: ArtifactCardDetail) {
  if (!d?.entityId) return;
  const existing = editor
    .getCurrentPageShapes()
    .find(
      (s): s is ArtifactCardShape =>
        s.type === "artifact-card" &&
        (s as ArtifactCardShape).props.entityId === d.entityId,
    );
  if (existing) {
    editor.select(existing.id);
    editor.centerOnPoint(
      {
        x: existing.x + existing.props.w / 2,
        y: existing.y + existing.props.h / 2,
      },
      { animation: { duration: 300 } },
    );
    return;
  }
  const artifactCount = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "artifact-card").length;
  const center = editor.getViewportPageBounds().center;
  const w = 240;
  const h = 150;
  const cascade = (artifactCount % 6) * 26;
  const x = center.x - w / 2 + cascade;
  const y = center.y - h / 2 + cascade;
  const id = createShapeId();
  editor.createShape<ArtifactCardShape>({
    id,
    type: "artifact-card",
    x,
    y,
    props: {
      w,
      h,
      kind: d.kind,
      title: d.title || "Item",
      subtitle: d.subtitle ?? "",
      color: d.color,
      entityId: d.entityId,
      roomId: d.roomId,
    },
  });
  editor.select(id);
  editor.centerOnPoint(
    { x: x + w / 2, y: y + h / 2 },
    { animation: { duration: 300 } },
  );
}

/** Drop (or refocus) a subsystem-KG card on the board. Deduped by focus
 *  mechanism so re-sending the same triad doesn't stack. Shared by the
 *  live deploy listener and the cross-page queue drain. */
function createSubsystemKgCard(editor: Editor, d: SubsystemKgCardDetail) {
  if (!d?.mechanismId) return;
  const existing = editor
    .getCurrentPageShapes()
    .find(
      (s): s is SubsystemKgShape =>
        s.type === "subsystem-kg" &&
        (s as SubsystemKgShape).props.mechanismId === d.mechanismId,
    );
  if (existing) {
    editor.select(existing.id);
    editor.centerOnPoint(
      {
        x: existing.x + existing.props.w / 2,
        y: existing.y + existing.props.h / 2,
      },
      { animation: { duration: 300 } },
    );
    return;
  }
  const kgCount = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "subsystem-kg").length;
  const center = editor.getViewportPageBounds().center;
  const w = 360;
  const h = 212;
  const cascade = (kgCount % 6) * 28;
  const x = center.x - w / 2 + cascade;
  const y = center.y - h / 2 + cascade;
  const id = createShapeId();
  editor.createShape<SubsystemKgShape>({
    id,
    type: "subsystem-kg",
    x,
    y,
    props: {
      w,
      h,
      mechanismId: d.mechanismId,
      mechanismName: d.mechanismName || "Mechanism",
      roomId: d.roomId,
      spaceId: d.spaceId,
      color: d.color || "#2563EB",
      problemLabels: d.problemLabels ?? [],
      solutionLabels: d.solutionLabels ?? [],
      problemCount: d.problemCount ?? 0,
      solutionCount: d.solutionCount ?? 0,
      hasSpec: !!d.hasSpec,
      stepCount: d.stepCount ?? 0,
    },
  });
  editor.select(id);
  editor.centerOnPoint(
    { x: x + w / 2, y: y + h / 2 },
    { animation: { duration: 300 } },
  );
}

/** Drop a proposed insight card at the centroid of its sources and tether
 *  it to each with a dashed arrow (meta.proposalFor === insightId so the
 *  card can solidify/delete those arrows on Keep/Dismiss). */
function createInsightWithLinks(
  editor: Editor,
  opts: {
    mode: AiLinkMode;
    headline: string;
    body: string;
    sourceIds: TLShapeId[];
    color: string;
  },
) {
  const centers = opts.sourceIds
    .map((id) => editor.getShapePageBounds(id))
    .filter((b): b is NonNullable<typeof b> => !!b)
    .map((b) => ({ x: b.midX, y: b.midY }));
  if (centers.length === 0) return;
  const cx = centers.reduce((a, c) => a + c.x, 0) / centers.length;
  const cy = centers.reduce((a, c) => a + c.y, 0) / centers.length;
  const w = 252;
  const h = 168;
  const insightId = createShapeId();
  editor.createShape<InsightCardShape>({
    id: insightId,
    type: "insight-card",
    x: cx - w / 2,
    y: cy - h / 2,
    props: {
      w,
      h,
      status: "proposed",
      kind: opts.mode,
      headline: opts.headline,
      body: opts.body,
      color: opts.color,
      sourceIds: opts.sourceIds,
    },
  });
  for (const sid of opts.sourceIds) {
    const arrowId = createShapeId();
    const arrow: TLShapePartial<TLArrowShape> = {
      id: arrowId,
      type: "arrow",
      props: { color: "grey", size: "s", dash: "dashed", arrowheadEnd: "none" },
      meta: { proposalFor: insightId },
    };
    editor.createShapes([arrow]);
    editor.createBindings([
      {
        fromId: arrowId,
        toId: sid,
        type: "arrow",
        props: {
          terminal: "start",
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: false,
        },
        meta: {},
      },
      {
        fromId: arrowId,
        toId: insightId,
        type: "arrow",
        props: {
          terminal: "end",
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: false,
        },
        meta: {},
      },
    ]);
  }
  editor.select(insightId);
  editor.centerOnPoint({ x: cx, y: cy }, { animation: { duration: 300 } });
}

function BoardOverlay({
  editor,
  runAiLink,
  spaceId,
}: {
  editor: Editor;
  runAiLink: AiLinkFn;
  spaceId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  // Default true so the hint never flashes before the localStorage read;
  // the effect flips it false for users who haven't dismissed it.
  const [hintDismissed, setHintDismissed] = useState(true);
  // Pin the AI scanner open so live recommendations persist while you work
  // (scans the selected card, or the whole board when nothing is selected).
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    try {
      setHintDismissed(
        window.localStorage.getItem("objective-board:hint-dismissed") === "1",
      );
    } catch {
      setHintDismissed(false);
    }
  }, []);

  // Reactive board view — selection (for the Connect toolbar) plus the
  // card/insight counts that gate the teaching hint.
  const view = useValue(
    "board-overlay",
    () => {
      const shapes = editor.getCurrentPageShapes();
      const selected = editor.getSelectedShapes();
      const cards = selected.filter(isBoardCard);
      const bounds = editor.getSelectionRotatedPageBounds();
      const screen = bounds
        ? editor.pageToScreen({ x: bounds.midX, y: bounds.minY })
        : null;
      // Single "idea" shape (sticky note / text) selected, not mid-edit →
      // offer the AI scanner. Cards already carry their own hover menu.
      let single: { target: OperationTarget; sx: number; sy: number } | null =
        null;
      if (
        selected.length === 1 &&
        editor.getEditingShapeId() !== selected[0].id
      ) {
        const tgt = shapeToScanTarget(selected[0]);
        const sb = tgt ? editor.getShapePageBounds(selected[0].id) : null;
        if (tgt && sb) {
          const pt = editor.pageToScreen({ x: sb.maxX, y: sb.minY });
          single = { target: tgt, sx: pt.x, sy: pt.y };
        }
      }
      // Whole-board scan text — aggregate every idea's text, for the pinned
      // AI panel when nothing specific is selected.
      const boardTexts: string[] = [];
      for (const s of shapes) {
        const t = shapeToScanTarget(s);
        if (t) boardTexts.push(t.text);
      }
      const boardScanText = boardTexts.join("\n").slice(0, 4000);
      return {
        ids: cards.map((c) => c.id),
        payloads: cards.map(cardPayload),
        saveables: cards
          .map(cardSaveable)
          .filter((c): c is SaveableCard => c !== null),
        screen,
        // Board projected into the Synergism ClientNode model so Focus
        // Mode's auto-marker can bucket what's decided vs. exploratory.
        nodes: boardShapesToNodes(shapes),
        boardCardCount: shapes.filter(
          (s) => s.type === "room-card" || s.type === "artifact-card",
        ).length,
        insightCount: shapes.filter((s) => s.type === "insight-card").length,
        single,
        boardScanText,
      };
    },
    [editor],
  );

  const count = view.ids.length;

  // ── Focus Mode ("Converge") ───────────────────────────────────────
  // Project the board → ClientNodes, run the auto-marker, and let the
  // user mark what they decided + publish the kept set to the Library
  // (the canvas → object → Strategy Brief bridge).
  const focus = useFocusMode(view.nodes);

  // Hover a panel row → select the matching shape so it highlights on
  // the canvas; clearing on mouse-out keeps it ephemeral.
  function handleFocusNode(id: string | null) {
    try {
      editor.setSelectedShapes(id ? [id as TLShapeId] : []);
    } catch {
      /* selection is best-effort */
    }
  }

  // Publish the converged set: persist the kept board cards to the
  // Library as objects (they then flow into the Strategy Brief / spec).
  async function handlePublishConverged(keptIds: string[]) {
    const saveables = keptIds
      .map((id) => editor.getShape(id as TLShapeId))
      .filter((s): s is TLShape => !!s)
      .map(cardSaveable)
      .filter((c): c is SaveableCard => c !== null);
    try {
      if (saveables.length > 0) await saveCardsToLibrary(spaceId, saveables);
    } catch (err) {
      console.warn("[board] converge publish failed:", err);
    } finally {
      focus.endPublishing();
    }
  }

  function dismissHint() {
    setHintDismissed(true);
    try {
      window.localStorage.setItem("objective-board:hint-dismissed", "1");
    } catch {
      // non-fatal
    }
  }

  async function handleRun() {
    if (busy || count < 2) return;
    const mode: AiLinkMode = count === 2 ? "connect" : "synthesize";
    const ids = view.ids;
    const payloads = view.payloads;
    setBusy(true);
    try {
      const { headline, body } = await runAiLink(mode, payloads);
      createInsightWithLinks(editor, {
        mode,
        headline,
        body,
        sourceIds: ids,
        color: appleVibe.accent.primary,
      });
    } catch (err) {
      console.warn("[board] AI link failed:", err);
      // Soft-fail — nothing destructive; the user can retry.
    } finally {
      setBusy(false);
    }
  }

  // Canvas interaction: save the selected card(s) to the Library as
  // objects (canvas → object → Library bridge). Soft-fails per card.
  async function handleSaveToLibrary() {
    if (busy || view.saveables.length === 0) return;
    setBusy(true);
    try {
      const { saved: n } = await saveCardsToLibrary(spaceId, view.saveables);
      if (n > 0) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      console.warn("[board] save to library failed:", err);
    } finally {
      setBusy(false);
    }
  }

  // Teaching nudge: only once the user has cards but hasn't connected
  // anything yet, and isn't mid-selection (the toolbar guides that).
  const showHint =
    !hintDismissed &&
    view.boardCardCount >= 1 &&
    view.insightCount === 0 &&
    count < 2;

  return (
    <>
      {showHint && <BoardHint onDismiss={dismissHint} />}
      {view.screen && (count >= 2 || view.saveables.length >= 1) && (
        <BoardSelectionToolbar
          x={view.screen.x}
          y={view.screen.y}
          count={count}
          busy={busy}
          onRun={count >= 2 ? handleRun : undefined}
          onSaveToLibrary={
            view.saveables.length >= 1 ? handleSaveToLibrary : undefined
          }
          saved={saved}
        />
      )}

      {/* AI scanner — a sticky-note / text idea selected → recommend + run ops. */}
      {(view.single || (pinned && view.boardScanText)) &&
        (() => {
          const target: OperationTarget = view.single?.target ?? {
            text: view.boardScanText,
          };
          const sx =
            view.single?.sx ??
            (typeof window !== "undefined" ? window.innerWidth - 328 : 16);
          const sy = view.single?.sy ?? 88;
          return (
            <AiScannerPanel
              key={view.single?.target.shapeId ?? "board-scan"}
              target={target}
              x={sx}
              y={sy}
              onRun={(opId) => executeCardOperation(editor, target, opId)}
            />
          );
        })()}

      {/* Persistent AI panel toggle — pin the scanner open so live
          recommendations stay while you work (scans the selected card, or the
          whole board when nothing is selected). */}
      <button
        type="button"
        onClick={() => setPinned((p) => !p)}
        title={pinned ? "Hide AI suggestions" : "Scan the board with AI"}
        style={{
          position: "absolute",
          left: 16,
          bottom: 16,
          zIndex: 65,
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "9px 14px",
          borderRadius: 999,
          border: `1px solid ${appleVibe.stroke.soft}`,
          background: pinned
            ? appleVibe.accent.primary
            : appleVibe.surface.card,
          color: pinned ? appleVibe.text.onAccent : appleVibe.text.primary,
          boxShadow: appleVibe.shadow.chip,
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          fontFamily: appleVibe.font.stack,
        }}
      >
        <Sparkles style={{ width: 15, height: 15 }} strokeWidth={2.2} />
        {pinned ? "AI on" : "Ask AI"}
      </button>

      {/* Converge entry — opens Focus Mode to mark what's decided. */}
      {focus.phase === "closed" && view.nodes.length > 0 && (
        <button
          type="button"
          onClick={() => focus.open()}
          title="Converge — mark what you decided, then publish the kept set"
          style={{
            position: "absolute",
            right: 16,
            bottom: 16,
            zIndex: 65,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "9px 14px",
            borderRadius: 999,
            border: `1px solid ${appleVibe.stroke.soft}`,
            background: appleVibe.surface.card,
            color: appleVibe.text.primary,
            boxShadow: appleVibe.shadow.chip,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: appleVibe.font.stack,
          }}
        >
          <ListChecks style={{ width: 15, height: 15 }} strokeWidth={2.2} />
          Converge
        </button>
      )}

      {/* Focus Mode panel — mark / publish the converged set. Offset below
          the Notebook pill (top-right, layout stacking context) so the panel's
          close button isn't buried under it. */}
      {focus.phase !== "closed" && (
        <div style={{ position: "absolute", right: 16, top: 64, zIndex: 75 }}>
          <FocusModePanel
            nodes={view.nodes}
            focus={focus}
            onFocusNode={handleFocusNode}
            onPublish={handlePublishConverged}
          />
        </div>
      )}
    </>
  );
}
