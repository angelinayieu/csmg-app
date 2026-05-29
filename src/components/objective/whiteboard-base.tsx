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
import { BoardSelectionToolbar } from "./board-selection-toolbar";
import { useObjectiveBoardPersistence } from "./use-objective-board-persistence";
import {
  DEPLOY_ARTIFACT_EVENT,
  type ArtifactCardDetail,
} from "./board-bus";
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
const CUSTOM_SHAPE_UTILS = [
  RoomCardShapeUtil,
  InsightCardShapeUtil,
  ArtifactCardShapeUtil,
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
  useObjectiveBoardPersistence(editor, spaceId);

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
          color: detail.color ?? "#7C3AED",
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
      const d = (e as CustomEvent<ArtifactCardDetail>).detail;
      if (!d?.entityId) return;

      // Dedupe by source entity — don't drop the same item twice.
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

    window.addEventListener(DEPLOY_CARD_EVENT, onDeploy);
    window.addEventListener(REMOVE_CARD_EVENT, onRemove);
    window.addEventListener(DEPLOY_ARTIFACT_EVENT, onArtifact);
    return () => {
      window.removeEventListener(DEPLOY_CARD_EVENT, onDeploy);
      window.removeEventListener(REMOVE_CARD_EVENT, onRemove);
      window.removeEventListener(DEPLOY_ARTIFACT_EVENT, onArtifact);
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <Tldraw
        shapeUtils={CUSTOM_SHAPE_UTILS}
        onMount={handleMount}
        inferDarkMode={false}
        hideUi={!showUi}
      />
      {/* Contextual AI action — only while the board chrome is showing
          (the user is working on the board, not viewing a room window). */}
      {editor && showUi && (
        <BoardOverlay editor={editor} runAiLink={runAiLink} />
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
}: {
  editor: Editor;
  runAiLink: AiLinkFn;
}) {
  const [busy, setBusy] = useState(false);

  // Reactive selection of *board cards* (rooms + insights) + the screen
  // position of the selection's top-center, so the toolbar tracks the
  // selection as it moves / the camera pans.
  const sel = useValue(
    "board-card-selection",
    () => {
      const cards = editor.getSelectedShapes().filter(isBoardCard);
      const bounds = editor.getSelectionRotatedPageBounds();
      const screen = bounds
        ? editor.pageToScreen({ x: bounds.midX, y: bounds.minY })
        : null;
      return {
        ids: cards.map((c) => c.id),
        payloads: cards.map(cardPayload),
        screen,
      };
    },
    [editor],
  );

  const count = sel.ids.length;

  async function handleRun() {
    if (busy || count < 2) return;
    const mode: AiLinkMode = count === 2 ? "connect" : "synthesize";
    const ids = sel.ids;
    const payloads = sel.payloads;
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

  if (count < 2 || !sel.screen) return null;

  return (
    <BoardSelectionToolbar
      x={sel.screen.x}
      y={sel.screen.y}
      count={count}
      busy={busy}
      onRun={handleRun}
    />
  );
}
