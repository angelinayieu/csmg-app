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
  useEditor,
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
import { OcCardShapeUtil } from "./shapes/oc-card-shape";
import {
  SubsystemKgShapeUtil,
  type SubsystemKgShape,
} from "./shapes/subsystem-kg-shape";
import { LayerBandShapeUtil } from "./shapes/layer-band-shape";
import {
  SpecForgeCardShapeUtil,
  OPEN_CAUSAL_MODEL_EVENT,
  type OpenCausalModelDetail,
} from "./shapes/specforge-card-shape";
import {
  TechSpecCardShapeUtil,
  OPEN_TECH_SPEC_EVENT,
  BUILD_PROTOTYPE_EVENT,
  type OpenTechSpecDetail,
} from "./shapes/tech-spec-card-shape";
import {
  PrototypeCardShapeUtil,
  PROTOTYPE_REFINE_EVENT,
  type PrototypeCardShape,
  type PrototypeRefineDetail,
} from "./shapes/prototype-card-shape";
import { PromptSharpeningCardShapeUtil } from "./shapes/prompt-sharpening-card-shape";
import { ObjectiveImageCardShapeUtil } from "./shapes/objective-image-card-shape";
import { ChatboxCardShapeUtil } from "./shapes/chatbox-card-shape";
import { ObjectiveCardShapeUtil } from "./shapes/objective-card-shape";
import { TechSpecPanel } from "./tech-spec-panel";
import { CausalModelPanel } from "./causal-model-panel";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";
import type { ProblemTreeResult } from "@/lib/objective-canvas/specforge/types";
import {
  runForgePipeline,
  type InspirationImage,
} from "./canvas-interactions/forge-pipeline";
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
import {
  DECOMPOSE_INTO_CARDS_EVENT,
  DECOMPOSE_DONE_EVENT,
  deployOcCards,
  requestDecomposeIntoCards,
  type DeployCard,
  type DeployLink,
} from "./canvas-interactions/deploy-oc-cards";
import {
  opIdForDirection,
  getDirectionEngine,
} from "@/lib/objective-canvas/converge-diverge";
import { getAiSettings } from "@/lib/objective-canvas/ai-settings";
import { CanvasTopControls } from "./canvas-interactions/canvas-top-controls";
import { LibraryLauncher } from "./canvas-interactions/library-rail";
import {
  forkSynthesisMap,
  type SynthesisBranch,
} from "./canvas-interactions/synthesis-map";
import {
  runSpecForge,
  type SpecForgeProgress,
} from "./canvas-interactions/specforge-runner";
import { AiScannerPanel } from "./canvas-interactions/ai-scanner-panel";
import { CollapsibleStylePanel } from "./canvas-interactions/collapsible-style-panel";
import type { TLComponents } from "tldraw";
import type { OperationTarget } from "@/lib/objective-canvas/canvas-operations";
import { useFocusMode } from "@/components/synergy/focus-mode/use-focus-mode";
import { ListChecks, Sparkles, Wand2, Loader2, Check, Globe } from "lucide-react";
import { BoardHint } from "./board-hint";
import { FavoritesSidebar } from "./favorites-sidebar";
import { useObjectiveBoardPersistence } from "./use-objective-board-persistence";
import {
  DEPLOY_ARTIFACT_EVENT,
  OPEN_UNFURL_EVENT,
  SEND_DATAFLOW_EVENT,
  CARD_ACTION_EVENT,
  type CardActionDetail,
  dispatchCardSaved,
  drainPendingArtifacts,
  type ArtifactCardDetail,
  DEPLOY_SHARPENING_EVENT,
  FORK_AMBIGUITY_EVENT,
  type SharpeningCardDetail,
  type AmbiguityForkDetail,
  DEPLOY_IMAGE_CARD_EVENT,
  type ImageCardDetail,
  SEED_CHATBOX_EVENT,
  SEED_OBJECTIVE_EVENT,
  PROMOTE_TO_OBJECTIVE_EVENT,
  deploySharpeningCard,
  type SeedChatboxDetail,
  type SeedObjectiveDetail,
  type PromoteToObjectiveDetail,
} from "./board-bus";
import {
  deployPromptSharpeningOnBoard,
  forkAmbiguityOnBoard,
} from "./canvas-interactions/prompt-sharpening-board";
import { SharpeningConnectorsOverlay } from "./canvas-interactions/sharpening-connectors";
import {
  deployChatboxOnBoard,
  deployObjectiveOnBoard,
  promoteChatboxToObjective,
} from "./canvas-interactions/intake-board";
import { deployImageCardOnBoard } from "./canvas-interactions/objective-image-board";
import { syncDataFlowUnfurl } from "./unfurl/render-dataflow-unfurl";
import type { DataFlowGraph } from "@/lib/objective-canvas/build-data-flow-graph";
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
// Page navigator — surfaces the board's pages as one clean glass segmented
// control at the top (active page = filled accent), so it's clear which page
// is which and the user can switch across them (e.g. a feature spun off into
// its own page). Reactive via tldraw's useValue; hidden when there's only one
// page so it never clutters.
function PageTabs() {
  const editor = useEditor();
  const pages = useValue("pages", () => editor.getPages(), [editor]);
  const currentPageId = useValue(
    "currentPageId",
    () => editor.getCurrentPageId(),
    [editor],
  );
  const [lineage, setLineage] = useState<
    { spaceId: string; title: string }[]
  >([]);
  useEffect(() => {
    const sid = window.location.pathname.match(/\/objective\/([^/]+)/)?.[1];
    if (!sid) return;
    let cancelled = false;
    void fetch(`/api/brainstorm/space/${sid}/lineage`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && Array.isArray(j?.lineage)) setLineage(j.lineage);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (pages.length <= 1 && lineage.length === 0) return null;
  return (
    <div
      style={{
        pointerEvents: "all",
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 10,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Branch lineage — clickable ancestor objectives (oldest → parent). */}
      {lineage.map((e) => (
        <button
          key={e.spaceId}
          type="button"
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={() =>
            window.location.assign(`/app/objective/${e.spaceId}`)
          }
          title={`Back to: ${e.title}`}
          style={{
            maxWidth: 150,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            padding: "6px 13px",
            fontSize: 12,
            fontWeight: 550,
            color: appleVibe.text.secondary,
            background: "var(--glass-float-bg)",
            border: "1px solid var(--glass-border)",
            borderRadius: 999,
            boxShadow:
              "inset 0 1px 0 var(--glass-highlight), 0 8px 24px -14px rgba(11,18,40,0.28)",
            backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
            WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
            cursor: "pointer",
          }}
        >
          ‹ {e.title}
        </button>
      ))}
      {/* Page segmented control — one glass pill; active page = filled accent. */}
      {pages.length > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            padding: 4,
            borderRadius: appleVibe.radius.pill,
            background: "var(--glass-float-bg)",
            border: "1px solid var(--glass-border)",
            boxShadow:
              "inset 0 1px 0 var(--glass-highlight), 0 12px 30px -16px rgba(11,18,40,0.32)",
            backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
            WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
          }}
        >
          {pages.map((p) => {
            const active = p.id === currentPageId;
            return (
              <button
                key={p.id}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => editor.setCurrentPage(p.id)}
                title={p.name}
                style={{
                  maxWidth: 170,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  padding: "5px 13px",
                  fontSize: 12,
                  fontWeight: active ? 650 : 550,
                  letterSpacing: "-0.01em",
                  color: active
                    ? appleVibe.text.onAccent
                    : appleVibe.text.secondary,
                  background: active ? appleVibe.accent.primary : "transparent",
                  border: "1px solid transparent",
                  borderRadius: appleVibe.radius.pill,
                  boxShadow: active
                    ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 4px 12px -6px rgba(11,18,40,0.4)"
                    : "none",
                  cursor: "pointer",
                  transition: "background 140ms ease, color 140ms ease",
                }}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const BOARD_COMPONENTS: TLComponents = {
  StylePanel: CollapsibleStylePanel,
  TopPanel: PageTabs,
  // Custom flow-builder connectors (bezier + handles) for the sharpening
  // graph — replaces the default tldraw arrows. Derived live from card
  // positions; see canvas-interactions/sharpening-connectors.tsx.
  InFrontOfTheCanvas: SharpeningConnectorsOverlay,
};

const CUSTOM_SHAPE_UTILS = [
  RoomCardShapeUtil,
  InsightCardShapeUtil,
  ArtifactCardShapeUtil,
  OcCardShapeUtil,
  SubsystemKgShapeUtil,
  LayerBandShapeUtil,
  SpecForgeCardShapeUtil,
  TechSpecCardShapeUtil,
  PrototypeCardShapeUtil,
  PromptSharpeningCardShapeUtil,
  ObjectiveImageCardShapeUtil,
  ChatboxCardShapeUtil,
  ObjectiveCardShapeUtil,
];

export function WhiteboardBase({
  spaceId,
  showUi = true,
  onAiLink,
  onEditorReady,
  seedCard = null,
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
  /** Minimal mode — when set, this room-card is auto-deployed onto the
   *  board once persistence has restored. Idempotent: skipped if a card
   *  for the same roomId already exists. Used to land the objective as a
   *  card on an otherwise-empty board (the default objective surface). */
  seedCard?: DeployCardDetail | null;
}) {
  const editorRef = useRef<Editor | null>(null);
  // Editor also held in state so the selection overlay (which needs
  // reactive `useValue`) can mount once the editor exists.
  const [editor, setEditor] = useState<Editor | null>(null);
  // True once server persistence has restored. Gates the minimal-mode
  // seed so a late restore can't wipe the seeded objective card.
  const [restoreSettled, setRestoreSettled] = useState(false);
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
    setRestoreSettled(true);
    const ed = editorRef.current;
    if (!ed) return;
    for (const d of drainPendingArtifacts(spaceId)) createArtifactCard(ed, d);
    for (const d of drainPendingSubsystemKgs(spaceId))
      createSubsystemKgCard(ed, d);
  });

  // Minimal mode — seed the objective as a card on the board once restore
  // has settled. Idempotent (skips if a card for this roomId already
  // exists), so a re-render or a returning visit never stacks duplicates.
  useEffect(() => {
    if (!restoreSettled || !seedCard) return;
    const ed = editorRef.current;
    if (!ed) return;
    const exists = ed
      .getCurrentPageShapes()
      .some(
        (s) =>
          s.type === "room-card" &&
          (s as RoomCardShape).props.roomId === seedCard.roomId,
      );
    if (!exists) deployRoomCard(seedCard);
  }, [restoreSettled, seedCard]);

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

  // "Send to whiteboard" for the data-unit flow map. The data-flow panel
  // fires SEND_DATAFLOW_EVENT carrying the {nodes,edges} graph directly
  // (the anchor-based OPEN_UNFURL can't carry a payload). We materialize it
  // as real artifact-card nodes + bound arrows — tagged meta.unfurl, so the
  // unmount sweep / exitUnfurl clears it like any unfurl — then frame it.
  useEffect(() => {
    function onSendDataFlow(e: Event) {
      const ed = editorRef.current;
      const graph = (e as CustomEvent<DataFlowGraph>).detail;
      if (!ed || !graph) return;
      syncDataFlowUnfurl(ed, graph);
      setTimeout(() => {
        try {
          const ids = ed
            .getCurrentPageShapes()
            .filter((s) => !!(s.meta as { unfurl?: boolean })?.unfurl)
            .map((s) => s.id);
          if (ids.length > 0) {
            ed.select(...ids);
            ed.zoomToSelection({ animation: { duration: 300 } });
            ed.selectNone();
          }
        } catch {
          /* no shapes */
        }
      }, 80);
    }
    window.addEventListener(SEND_DATAFLOW_EVENT, onSendDataFlow);
    return () => window.removeEventListener(SEND_DATAFLOW_EVENT, onSendDataFlow);
  }, []);

  // ── Decompose the objective into Feature/Variable cards ──
  // A trigger (the Decompose button / command) fires
  // DECOMPOSE_INTO_CARDS_EVENT; we POST the objective to /decompose-cards and
  // lay the returned cards + their connections out on the board. Isolated
  // from the heavy rooms pipeline. Single-flight via the ref.
  const decomposingRef = useRef(false);
  useEffect(() => {
    async function onDecompose() {
      const ed = editorRef.current;
      if (!ed || decomposingRef.current) return;
      decomposingRef.current = true;
      try {
        const res = await fetch(`/api/objective/${spaceId}/decompose-cards`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (res.ok) {
          const json = (await res.json()) as {
            cards?: DeployCard[];
            links?: DeployLink[];
          };
          if (Array.isArray(json.cards) && json.cards.length > 0) {
            deployOcCards(ed, json.cards, json.links ?? []);
          }
        }
      } catch {
        /* soft-fail — the board stays as-is */
      } finally {
        decomposingRef.current = false;
        try {
          window.dispatchEvent(new CustomEvent(DECOMPOSE_DONE_EVENT));
        } catch {
          /* SSR / no-window */
        }
      }
    }
    window.addEventListener(DECOMPOSE_INTO_CARDS_EVENT, onDecompose);
    return () => window.removeEventListener(DECOMPOSE_INTO_CARDS_EVENT, onDecompose);
  }, [spaceId]);

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
      // The compressed verbs ( ‹ diverge / converge › ) resolve to an op id
      // through the active engine toggle — pipeline = the new questions→answers→
      // distill loop, regroup = an existing op — at the scanner's temperature.
      if (d.action === "diverge" || d.action === "converge") {
        const editor = editorRef.current;
        if (!editor) return;
        const s = getAiSettings();
        void executeCardOperation(
          editor,
          {
            text: d.title,
            shapeId: d.shapeId,
            entityId: d.entityId,
            roomId: d.roomId ?? undefined,
          },
          opIdForDirection(d.action, getDirectionEngine()),
          {
            temperature: s.temperature,
            depth: s.depth,
            questionCount: s.complexity,
            webSearch: s.webSearch,
          },
        );
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

    function onDeploySharpening(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      deployPromptSharpeningOnBoard(
        editor,
        (e as CustomEvent<SharpeningCardDetail>).detail,
      );
    }

    function onForkAmbiguity(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      forkAmbiguityOnBoard(
        editor,
        (e as CustomEvent<AmbiguityForkDetail>).detail,
      );
    }

    function onDeployImageCard(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      deployImageCardOnBoard(
        editor,
        (e as CustomEvent<ImageCardDetail>).detail,
      );
    }

    function onSeedChatbox(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      deployChatboxOnBoard(editor, (e as CustomEvent<SeedChatboxDetail>).detail);
    }

    function onSeedObjective(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      deployObjectiveOnBoard(
        editor,
        (e as CustomEvent<SeedObjectiveDetail>).detail,
      );
    }

    function onPromoteToObjective(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      const d = (e as CustomEvent<PromoteToObjectiveDetail>).detail;
      promoteChatboxToObjective(editor, d);
      // Optimistic "Sharpening…" card forks below immediately; the mount
      // fills it in place when the artifact lands.
      deploySharpeningCard({
        spaceId: d.spaceId,
        title: "Sharpening…",
        sharpenedPrompt: "Refining your objective into a sharper prompt…",
        chips: [],
        heatmapJson: "{}",
        rankedJson: "[]",
      });
    }

    window.addEventListener(DEPLOY_CARD_EVENT, onDeploy);
    window.addEventListener(REMOVE_CARD_EVENT, onRemove);
    window.addEventListener(DEPLOY_ARTIFACT_EVENT, onArtifact);
    window.addEventListener(DEPLOY_SUBSYSTEM_KG_EVENT, onSubsystemKg);
    window.addEventListener(CARD_ACTION_EVENT, onCardAction);
    window.addEventListener(DEPLOY_SHARPENING_EVENT, onDeploySharpening);
    window.addEventListener(FORK_AMBIGUITY_EVENT, onForkAmbiguity);
    window.addEventListener(DEPLOY_IMAGE_CARD_EVENT, onDeployImageCard);
    window.addEventListener(SEED_CHATBOX_EVENT, onSeedChatbox);
    window.addEventListener(SEED_OBJECTIVE_EVENT, onSeedObjective);
    window.addEventListener(PROMOTE_TO_OBJECTIVE_EVENT, onPromoteToObjective);
    return () => {
      window.removeEventListener(DEPLOY_CARD_EVENT, onDeploy);
      window.removeEventListener(REMOVE_CARD_EVENT, onRemove);
      window.removeEventListener(DEPLOY_ARTIFACT_EVENT, onArtifact);
      window.removeEventListener(DEPLOY_SUBSYSTEM_KG_EVENT, onSubsystemKg);
      window.removeEventListener(CARD_ACTION_EVENT, onCardAction);
      window.removeEventListener(DEPLOY_SHARPENING_EVENT, onDeploySharpening);
      window.removeEventListener(FORK_AMBIGUITY_EVENT, onForkAmbiguity);
      window.removeEventListener(DEPLOY_IMAGE_CARD_EVENT, onDeployImageCard);
      window.removeEventListener(SEED_CHATBOX_EVENT, onSeedChatbox);
      window.removeEventListener(SEED_OBJECTIVE_EVENT, onSeedObjective);
      window.removeEventListener(PROMOTE_TO_OBJECTIVE_EVENT, onPromoteToObjective);
    };
  }, []);

  // Tech Spec page — opened by the forge pipeline (auto, at the end of a
  // run) or by a Tech Spec card's "Open spec" button (OPEN_TECH_SPEC_EVENT).
  const [techSpecPanel, setTechSpecPanel] = useState<{
    spec: TechSpec;
    markdown: string;
    shapeId: string;
  } | null>(null);
  const [causalModelPanel, setCausalModelPanel] = useState<{
    model: ProblemTreeResult;
    title: string;
  } | null>(null);
  useEffect(() => {
    function onOpen(e: Event) {
      const d = (e as CustomEvent<OpenTechSpecDetail>).detail;
      try {
        setTechSpecPanel({
          spec: JSON.parse(d.specJson) as TechSpec,
          markdown: d.markdown,
          shapeId: d.shapeId,
        });
      } catch {
        /* ignore malformed spec json */
      }
    }
    window.addEventListener(OPEN_TECH_SPEC_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TECH_SPEC_EVENT, onOpen);
  }, []);

  useEffect(() => {
    function onOpen(e: Event) {
      const d = (e as CustomEvent<OpenCausalModelDetail>).detail;
      try {
        setCausalModelPanel({
          model: JSON.parse(d.modelJson) as ProblemTreeResult,
          title: d.title,
        });
      } catch {
        /* ignore malformed model json */
      }
    }
    window.addEventListener(OPEN_CAUSAL_MODEL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CAUSAL_MODEL_EVENT, onOpen);
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
      {editor && <PrototypeEventBridge editor={editor} spaceId={spaceId} />}
      {/* Favorites sidebar — pans to hearted cards; hidden until ≥1 favorite. */}
      {editor && <FavoritesSidebar editor={editor} />}

      {/* Tech Spec page — the full-screen spec document (auto-opens at the
          end of a forge run; reopened from a Tech Spec card). */}
      {techSpecPanel && (
        <TechSpecPanel
          spec={techSpecPanel.spec}
          markdown={techSpecPanel.markdown}
          onClose={() => setTechSpecPanel(null)}
          onBuildPrototype={() => {
            window.dispatchEvent(
              new CustomEvent<OpenTechSpecDetail>(BUILD_PROTOTYPE_EVENT, {
                detail: {
                  specJson: JSON.stringify(techSpecPanel.spec),
                  markdown: techSpecPanel.markdown,
                  title: techSpecPanel.spec.title,
                  shapeId: techSpecPanel.shapeId,
                },
              }),
            );
            setTechSpecPanel(null);
          }}
        />
      )}

      {causalModelPanel && (
        <CausalModelPanel
          model={causalModelPanel.model}
          title={causalModelPanel.title}
          onClose={() => setCausalModelPanel(null)}
        />
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

/** Gather UI-inspiration images pasted on the board: read each tldraw image
 *  shape's asset data-URL → { base64, mediaType }. Only data-URL assets are
 *  read (tldraw's default for pasted images); capped at 4. */
function collectInspirationImages(editor: Editor): InspirationImage[] {
  const allowed = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  const out: InspirationImage[] = [];
  const getAsset = editor.getAsset.bind(editor) as (
    id: string,
  ) => { props?: { src?: unknown } } | undefined;
  for (const s of editor.getCurrentPageShapes()) {
    if (s.type !== "image") continue;
    const assetId = (s.props as { assetId?: string }).assetId;
    if (!assetId) continue;
    const src = getAsset(assetId)?.props?.src;
    if (typeof src !== "string") continue;
    const m = src.match(/^data:([^;]+);base64,(.+)$/);
    if (!m || !allowed.includes(m[1])) continue;
    out.push({ base64: m[2], mediaType: m[1] as InspirationImage["mediaType"] });
    if (out.length >= 4) break;
  }
  return out;
}

function PrototypeEventBridge({
  editor,
  spaceId,
}: {
  editor: Editor;
  spaceId: string;
}) {
  useEffect(() => {
    const PROTO_W = 420;
    const PROTO_H = 540;

    async function onBuild(e: Event) {
      const d = (e as CustomEvent<OpenTechSpecDetail>).detail;
      if (!d?.specJson) return;
      // Dedupe — one prototype per tech-spec card; refocus if it exists.
      const existing = editor
        .getCurrentPageShapes()
        .find(
          (s) =>
            s.type === "prototype-card" &&
            (s.meta as { sourceShapeId?: string })?.sourceShapeId === d.shapeId,
        );
      let id: TLShapeId;
      if (existing) {
        editor.select(existing.id);
        const b = editor.getShapePageBounds(existing.id);
        if (b)
          editor.centerOnPoint(
            { x: b.midX, y: b.midY },
            { animation: { duration: 300 } },
          );
        if (
          existing.type !== "prototype-card" ||
          (existing as PrototypeCardShape).props.status !== "error"
        ) {
          return;
        }
        id = existing.id;
        editor.updateShape<PrototypeCardShape>({
          id,
          type: "prototype-card",
          props: {
            html: "",
            status: "generating",
            specJson: d.specJson,
            title: d.title || "Prototype",
          },
        });
      } else {
        const anchor = d.shapeId
          ? editor.getShapePageBounds(d.shapeId as TLShapeId)
          : undefined;
        const vp = editor.getViewportPageBounds();
        const x = anchor ? anchor.maxX + 64 : vp.center.x - PROTO_W / 2;
        const y = anchor ? anchor.minY : vp.center.y - PROTO_H / 2;
        id = createShapeId();
        editor.createShape<PrototypeCardShape>({
          id,
          type: "prototype-card",
          x,
          y,
          props: {
            w: PROTO_W,
            h: PROTO_H,
            title: d.title || "Prototype",
            html: "",
            status: "generating",
            version: 0,
            specJson: d.specJson,
          },
          meta: { sourceShapeId: d.shapeId },
        });
        editor.select(id);
        editor.centerOnPoint(
          { x: x + PROTO_W / 2, y: y + PROTO_H / 2 },
          { animation: { duration: 320 } },
        );
      }
      try {
        const spec = JSON.parse(d.specJson);
        const res = await fetch(`/api/canvas/prototype`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spaceId, spec }),
        });
        if (!res.ok) throw new Error(`prototype failed: ${res.status}`);
        const { html } = (await res.json()) as { html: string };
        editor.updateShape<PrototypeCardShape>({
          id,
          type: "prototype-card",
          props: { html, status: "ready", version: 1 },
        });
      } catch (err) {
        console.warn("[board] prototype build failed:", err);
        try {
          editor.updateShape<PrototypeCardShape>({
            id,
            type: "prototype-card",
            props: { status: "error" },
          });
        } catch {
          /* card may have been deleted */
        }
      }
    }

    async function onRefine(e: Event) {
      const d = (e as CustomEvent<PrototypeRefineDetail>).detail;
      const shape = editor.getShape(d.shapeId as TLShapeId) as
        | PrototypeCardShape
        | undefined;
      if (!shape || shape.type !== "prototype-card") return;
      const prevVersion = shape.props.version;
      const currentHtml = shape.props.html;
      editor.updateShape<PrototypeCardShape>({
        id: shape.id,
        type: "prototype-card",
        props: { status: "generating" },
      });
      try {
        let spec: unknown = null;
        try {
          spec = JSON.parse(shape.props.specJson || "null");
        } catch {
          /* spec optional */
        }
        const res = await fetch(`/api/canvas/prototype/refine`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            currentHtml,
            feedback: d.feedback,
            spec,
          }),
        });
        if (!res.ok) throw new Error(`refine failed: ${res.status}`);
        const { html } = (await res.json()) as { html: string };
        editor.updateShape<PrototypeCardShape>({
          id: shape.id,
          type: "prototype-card",
          props: { html, status: "ready", version: prevVersion + 1 },
        });
      } catch (err) {
        console.warn("[board] prototype refine failed:", err);
        try {
          editor.updateShape<PrototypeCardShape>({
            id: shape.id,
            type: "prototype-card",
            props: { status: "error" },
          });
        } catch {
          /* card may have been deleted */
        }
      }
    }

    window.addEventListener(BUILD_PROTOTYPE_EVENT, onBuild);
    window.addEventListener(PROTOTYPE_REFINE_EVENT, onRefine);
    return () => {
      window.removeEventListener(BUILD_PROTOTYPE_EVENT, onBuild);
      window.removeEventListener(PROTOTYPE_REFINE_EVENT, onRefine);
    };
  }, [editor, spaceId]);

  return null;
}

// Quiet, zen trigger for the default decomposition. Dispatches the request
// (the board's listener does the fetch + deploy); clears its busy state when
// the run settles. Fixed bottom-left so it never collides with the toolbar.
function DecomposeCardsButton() {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const done = () => setBusy(false);
    window.addEventListener(DECOMPOSE_DONE_EVENT, done);
    return () => window.removeEventListener(DECOMPOSE_DONE_EVENT, done);
  }, []);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (busy) return;
        setBusy(true);
        requestDecomposeIntoCards();
      }}
      title="Break the objective into Feature & Variable cards"
      style={{
        position: "fixed",
        left: 16,
        bottom: 16,
        zIndex: 60,
        padding: "8px 15px",
        borderRadius: appleVibe.radius.pill,
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        boxShadow: appleVibe.shadow.chip,
        color: busy ? appleVibe.text.tertiary : appleVibe.text.primary,
        fontFamily: appleVibe.font.stack,
        fontSize: 12.5,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        cursor: busy ? "default" : "pointer",
        pointerEvents: "all",
        transition: "color 160ms ease-out",
      }}
    >
      {busy ? "Decomposing…" : "Decompose"}
    </button>
  );
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
  // SpecForge — the full causal-spec chain running off the selected idea.
  // Non-null while the chain runs; drives the floating progress chip + the
  // scanner's "Forge full spec" button busy state.
  const [forging, setForging] = useState<SpecForgeProgress | null>(null);
  // Deep Synthesize (pro Claude + web search) — busy flag + the staged
  // label shown in its progress chip while the long run is in flight.
  const [deepBusy, setDeepBusy] = useState(false);
  const [deepStage, setDeepStage] = useState("Reading your selection…");
  // SpecForge → Tech Spec stage (auto-runs after the forge unfurl completes).
  const [techSpecBusy, setTechSpecBusy] = useState(false);
  const [techSpecStage, setTechSpecStage] = useState("Writing the tech spec…");

  // Run the SpecForge chain for the selected idea — streams decision cards
  // below the source. Guarded so a second click can't double-run.
  function handleForge(target: OperationTarget) {
    if ((forging && forging.phase === "running") || techSpecBusy) return;
    if (!target.text.trim()) return;
    setForging({ phase: "running", done: 0, total: 9, label: "Starting…" });
    void (async () => {
      // 1) Run the SpecForge unfurl (existing 9 engines).
      let forge;
      try {
        forge = await runSpecForge(editor, target, { onProgress: setForging });
      } catch (err) {
        console.warn("[board] specforge failed:", err);
        setForging(null);
        return;
      }
      setForging(null);
      if (!forge?.createdAny) return;

      // 2) Auto-generate the tech-spec page (incl. UI plan), ingesting any
      //    inspiration images pasted on the board. Prototype stays a tap.
      setTechSpecBusy(true);
      setTechSpecStage("Writing the tech spec…");
      try {
        await runForgePipeline(editor, spaceId, forge, {
          anchorShapeId: target.shapeId,
          inspirationImages: collectInspirationImages(editor),
          onProgress: setTechSpecStage,
        });
      } catch (err) {
        console.warn("[board] tech spec failed:", err);
      } finally {
        setTechSpecBusy(false);
      }
    })();
  }

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
      // Broader "idea" selection for Deep Synthesize — post-its + text +
      // cards (anything shapeToScanTarget reads), in selection order so the
      // numbered list sent to the LLM maps back to shape ids for tethering.
      const deepEntries: { id: TLShapeId; kind: string; text: string }[] = [];
      for (const s of selected) {
        const t = shapeToScanTarget(s);
        if (t) deepEntries.push({ id: s.id, kind: s.type, text: t.text });
      }
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
        deepIds: deepEntries.map((e) => e.id),
        deepPayloads: deepEntries.map((e) => ({ kind: e.kind, text: e.text })),
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

  // Deep Synthesize: pro Claude (Opus) reads the whole idea selection
  // (post-its + text + cards), searches the web, and forks a hub +
  // cross-link map onto the board. Request/response, so the staged labels
  // are time-driven; a Keep on the hub later commits the whole map.
  async function handleDeepRun() {
    if (busy || deepBusy || view.deepPayloads.length < 2) return;
    const sourceIds = view.deepIds;
    const payloads = view.deepPayloads;
    setDeepBusy(true);
    setDeepStage("Reading your selection…");
    const t1 = window.setTimeout(
      () => setDeepStage("Searching the web…"),
      2600,
    );
    const t2 = window.setTimeout(
      () => setDeepStage("Weaving cross-links…"),
      14000,
    );
    try {
      const res = await fetch(`/api/objective/${spaceId}/deep-synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection: payloads }),
      });
      if (!res.ok) throw new Error(`deep-synthesize failed: ${res.status}`);
      const data = (await res.json()) as {
        hub: { headline: string; body: string };
        branches: SynthesisBranch[];
      };
      forkSynthesisMap(editor, {
        map: { hub: data.hub, branches: data.branches },
        sourceIds,
        color: appleVibe.accent.primary,
      });
    } catch (err) {
      console.warn("[board] deep synthesize failed:", err);
      // Soft-fail — nothing destructive; the user can retry.
    } finally {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      setDeepBusy(false);
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
      {/* The ‹ diverge / converge › buttons run the default "pipeline" engine
          (questions → answers → distilled nodes). The dev A/B toggle for
          pipeline-vs-regroup is intentionally not surfaced on the board — it
          read as a mystery control next to the page tabs. Flip the engine in
          code via setDirectionEngine if A/B testing is needed again. */}
      <DecomposeCardsButton />
      {/* Top-center AI thinking-settings cluster (depth · complexity · temp ·
          web search) — global knobs the ‹ › verbs + scanner ops read. */}
      <CanvasTopControls />
      {/* Dedicated Library rail (glossary + knowledge graph), launched from a
          right-edge pill; expandable to full screen. Reads the space glossary
          + focuses board cards. */}
      <LibraryLauncher spaceId={spaceId} editor={editor} />
      {showHint && <BoardHint onDismiss={dismissHint} />}
      {view.screen &&
        (count >= 2 ||
          view.saveables.length >= 1 ||
          view.deepPayloads.length >= 2) && (
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
            deepCount={view.deepPayloads.length}
            deepBusy={deepBusy}
            onDeepRun={
              view.deepPayloads.length >= 2 ? handleDeepRun : undefined
            }
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
              onRun={(opId, temperature) => {
                const s = getAiSettings();
                void executeCardOperation(editor, target, opId, {
                  temperature,
                  depth: s.depth,
                  questionCount: s.complexity,
                  webSearch: s.webSearch,
                });
              }}
              onForge={() => handleForge(target)}
              forging={forging?.phase === "running"}
            />
          );
        })()}

      {/* SpecForge progress — a calm glass chip while the causal-spec chain
          runs, so the user knows the cards are streaming in below the idea. */}
      {forging && <SpecForgeProgressChip progress={forging} />}

      {/* Deep Synthesize progress — calm glass chip while pro Claude reads
          the selection, searches the web, and weaves the cross-link map. */}
      {deepBusy && <DeepSynthProgressChip label={deepStage} />}

      {/* Tech-spec progress — the SpecForge → Tech Spec hand-off chip. */}
      {techSpecBusy && (
        <DeepSynthProgressChip title="Tech spec" label={techSpecStage} />
      )}

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

// ── SpecForge progress chip ───────────────────────────────────────
// A calm, centered glass status pill shown while the causal-spec chain runs.
// Reads the runner's onProgress stream; on completion it flips to a "Spec
// ready" confirmation before the host clears it.
function SpecForgeProgressChip({ progress }: { progress: SpecForgeProgress }) {
  const done = progress.phase === "done";
  const pct = Math.round((progress.done / Math.max(1, progress.total)) * 100);
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        zIndex: 80,
        display: "inline-flex",
        alignItems: "center",
        gap: 11,
        padding: "9px 15px",
        borderRadius: 999,
        background: "var(--glass-float-bg)",
        backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        border: "1px solid var(--glass-border)",
        boxShadow:
          "inset 0 1px 0 var(--glass-highlight), 0 18px 40px -18px rgba(11,18,40,0.34)",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          width: 22,
          height: 22,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: done ? "#2FA968" : appleVibe.accent.primary,
          color: "white",
        }}
      >
        {done ? (
          <Check style={{ width: 13, height: 13 }} strokeWidth={2.8} />
        ) : (
          <Wand2 style={{ width: 12.5, height: 12.5 }} strokeWidth={2.2} />
        )}
      </span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 650,
            letterSpacing: "-0.01em",
            color: appleVibe.text.primary,
          }}
        >
          {done ? "Spec ready" : "Forging full spec"}
        </span>
        <span style={{ fontSize: 11, fontWeight: 500, color: appleVibe.text.tertiary }}>
          {done
            ? `${progress.total} stages · scroll down to read`
            : `${progress.label} · ${progress.done}/${progress.total}`}
        </span>
      </span>
      {!done && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              position: "relative",
              width: 56,
              height: 4,
              borderRadius: 999,
              background: "rgba(15,23,42,0.10)",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                width: `${pct}%`,
                borderRadius: 999,
                background: appleVibe.accent.primary,
                transition: "width 280ms ease-out",
              }}
            />
          </span>
          <Loader2
            className="animate-spin"
            style={{ width: 13, height: 13, color: appleVibe.text.faint }}
          />
        </span>
      )}
    </div>
  );
}

/** Calm glass chip shown while Deep Synthesize (pro Claude + web search)
 *  runs. The label is staged client-side since the route is request/
 *  response; the map forks in below when it resolves. */
function DeepSynthProgressChip({
  title = "Deep Synthesize",
  label,
}: {
  title?: string;
  label: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        zIndex: 80,
        display: "inline-flex",
        alignItems: "center",
        gap: 11,
        padding: "9px 15px",
        borderRadius: 999,
        background: "var(--glass-float-bg)",
        backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        border: "1px solid var(--glass-border)",
        boxShadow:
          "inset 0 1px 0 var(--glass-highlight), 0 18px 40px -18px rgba(11,18,40,0.34)",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          width: 22,
          height: 22,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: appleVibe.accent.primary,
          color: "white",
        }}
      >
        <Globe style={{ width: 12.5, height: 12.5 }} strokeWidth={2.2} />
      </span>
      <span
        style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}
      >
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 650,
            letterSpacing: "-0.01em",
            color: appleVibe.text.primary,
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: appleVibe.text.tertiary,
          }}
        >
          {label}
        </span>
      </span>
      <Loader2
        className="animate-spin"
        style={{ width: 13, height: 13, color: appleVibe.text.faint }}
      />
    </div>
  );
}
