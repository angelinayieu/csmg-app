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
import { type RoomCardShape } from "./shapes/room-card-shape";
import { type InsightCardShape } from "./shapes/insight-card-shape";
import { type ArtifactCardShape } from "./shapes/artifact-card-shape";
import { type OcCardShape } from "./shapes/oc-card-shape";
import { type SubsystemKgShape } from "./shapes/subsystem-kg-shape";
import {
  OPEN_CAUSAL_MODEL_EVENT,
  type OpenCausalModelDetail,
} from "./shapes/specforge-card-shape";
import {
  OPEN_TECH_SPEC_EVENT,
  BUILD_PROTOTYPE_EVENT,
  TOGGLE_TECH_SPEC_EXPAND_EVENT,
  REFINE_SECTION_EVENT,
  SECTION_OP_EVENT,
  type OpenTechSpecDetail,
  type ToggleTechSpecExpandDetail,
  type RefineSectionDetail,
  type SectionOpDetail,
  type TechSpecCardShape,
} from "./shapes/tech-spec-card-shape";
import {
  ATTACH_TO_SECTION_EVENT,
  type AttachToSectionDetail,
  type SpecFeedbackCardShape,
} from "./shapes/spec-feedback-card-shape";
import {
  SECTION_LABEL,
  parseSectionMeta,
  serializeSectionMeta,
  emptySectionMeta,
  asSectionId,
  getSectionValue,
  type TechSpecSectionId,
  type SectionMetaMap,
} from "@/lib/objective-canvas/tech-spec/sections";
import {
  PROTOTYPE_REFINE_EVENT,
  type PrototypeCardShape,
  type PrototypeRefineDetail,
} from "./shapes/prototype-card-shape";
import {
  BUILD_UI_PLANS_EVENT,
  type BuildUiPlansDetail,
  type UiPlanCardShape,
} from "./shapes/ui-plan-card-shape";
import { reserveSpace } from "./canvas-interactions/placement";
import { TechSpecPanel } from "./tech-spec-panel";
import { CausalModelPanel } from "./causal-model-panel";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";
import {
  PHASE_LABEL,
  PHASE_ORDER,
  SPECFORGE_CHAIN,
  type ProblemTreeResult,
} from "@/lib/objective-canvas/specforge/types";
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
import { ObjectDetailMount } from "./canvas-interactions/object-detail-drawer";
import { GoalLauncher } from "./canvas-interactions/goal-ranking-sidebar";
import { BoardHistoryLauncher } from "./canvas-interactions/board-history";
import { BoardSettingsLauncher } from "./canvas-interactions/board-settings";
import { BoardNavBar } from "./canvas-interactions/board-nav-bar";
import { WhiteboardChatPanel } from "./canvas-interactions/whiteboard-chat-panel";
import { CommentBoardMount } from "./canvas-interactions/comment-board-mount";
import {
  forkSynthesisMap,
  type SynthesisBranch,
} from "./canvas-interactions/synthesis-map";
import {
  runSpecForge,
  type SpecForgeProgress,
} from "./canvas-interactions/specforge-runner";
import { ConvergeDivergePopup } from "./canvas-interactions/converge-diverge-popup";
import {
  PowerupRail,
  FORGE_REQUEST_EVENT,
  FORGE_STATE_EVENT,
} from "./canvas-interactions/powerup-rail";
import { CollapsibleStylePanel } from "./canvas-interactions/collapsible-style-panel";
import { ArtifactDock } from "./canvas-interactions/artifact-dock";
import { NotebookMount } from "./canvas-interactions/notebook-panel";
import type { TLComponents, TLPageId } from "tldraw";
import type { OperationTarget } from "@/lib/objective-canvas/canvas-operations";
import { useFocusMode } from "@/components/synergy/focus-mode/use-focus-mode";
import {
  ListChecks,
  Wand2,
  Loader2,
  Check,
  Globe,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { BoardHint } from "./board-hint";
import { FavoritesSidebar } from "./favorites-sidebar";
import { useObjectiveBoardPersistence } from "./use-objective-board-persistence";
import {
  useBoardCollaboration,
  colorForUser,
  type BoardIdentity,
} from "./use-board-collaboration";
import { ShareBoardLauncher } from "./share-board-modal";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
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
  DEPLOY_VOICE_NOTE_EVENT,
  UPDATE_VOICE_ANALYSIS_EVENT,
  DEPLOY_JOURNAL_EVENT,
  type VoiceNoteCardDetail,
  type VoiceNoteAnalysisDetail,
  type JournalCardDetail,
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
  clearLegacySharpeningArrows,
} from "./canvas-interactions/prompt-sharpening-board";
import { SharpeningConnectorsOverlay } from "./canvas-interactions/sharpening-connectors";
import { SpecForgeConnectorsOverlay } from "./canvas-interactions/specforge-connectors";
import { CommentStrandsOverlay } from "./canvas-interactions/comment-strands";
import {
  deployChatboxOnBoard,
  deployObjectiveOnBoard,
  promoteChatboxToObjective,
  clearStaleChatboxCards,
} from "./canvas-interactions/intake-board";
import { deployImageCardOnBoard } from "./canvas-interactions/objective-image-board";
import {
  deployVoiceNoteOnBoard,
  updateVoiceNoteAnalysisOnBoard,
  deployJournalOnBoard,
} from "./canvas-interactions/voice-journal-board";
import { CUSTOM_SHAPE_UTILS } from "./board-shape-utils";
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
  const [editingId, setEditingId] = useState<TLPageId | null>(null);
  const [editValue, setEditValue] = useState("");
  const [hoverId, setHoverId] = useState<TLPageId | null>(null);
  const [confirmId, setConfirmId] = useState<TLPageId | null>(null);

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

  // Auto-name default "Page N" pages from the objective on the board — a concise
  // condensed title. Only touches still-default names, so manual names persist.
  useEffect(() => {
    const obj = editor
      .getCurrentPageShapes()
      .find((s) => s.type === "objective-card" || s.type === "room-card");
    const raw = (obj?.props as { title?: unknown } | undefined)?.title;
    const objective = typeof raw === "string" ? raw.trim() : "";
    if (!objective) return;
    const concise = objective
      .replace(/[.…]+$/, "")
      .split(/\s+/)
      .slice(0, 6)
      .join(" ")
      .slice(0, 44);
    if (!concise) return;
    // Only auto-name the FIRST page (the main objective board). Pages added
    // with "+" keep their "New page" name until renamed — they are NOT copies
    // of the objective.
    const first = editor.getPages()[0];
    if (first && /^(Page \d+|New page)$/.test(first.name)) {
      editor.updatePage({ id: first.id, name: concise });
    }
  }, [editor, pages.length]);

  function commitEdit(id: TLPageId) {
    const name = editValue.trim();
    if (name) editor.updatePage({ id, name });
    setEditingId(null);
  }
  function deletePage(id: TLPageId) {
    if (editor.getPages().length > 1) {
      if (id === currentPageId) {
        const other = editor.getPages().find((p) => p.id !== id);
        if (other) editor.setCurrentPage(other.id);
      }
      editor.deletePage(id);
    }
    setConfirmId(null);
  }

  const confirmName = pages.find((p) => p.id === confirmId)?.name ?? "this page";
  return (
    <>
      <div
        style={{
          // Escape tldraw's TopPanel slot (which anchors top-left) and pin
          // ourselves to the top-CENTER of the viewport, directly above the
          // CanvasTopControls AI settings pill (top: 56). Fixed positioning
          // keeps us off the slot's flex flow so the slot wrapper can't drag
          // us back left.
          position: "fixed",
          top: 14,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 60,
          pointerEvents: "all",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Branch lineage — clickable ancestor objectives (oldest → parent). */}
        {lineage.map((e) => (
          <button
            key={e.spaceId}
            type="button"
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={() => window.location.assign(`/app/objective/${e.spaceId}`)}
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
        {/* Page / room control — always shown (the current page name pill),
            even with one page. Click = switch · double-click = rename ·
            hover × = delete (with confirm) · + = add a page. */}
        {pages.length >= 1 && (
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
              const editing = editingId === p.id;
              return (
                <div
                  key={p.id}
                  style={{ position: "relative", display: "flex", alignItems: "center" }}
                  onMouseEnter={() => setHoverId(p.id)}
                  onMouseLeave={() => setHoverId((c) => (c === p.id ? null : c))}
                >
                  {editing ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(p.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => commitEdit(p.id)}
                      style={{
                        width: 140,
                        padding: "5px 11px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: appleVibe.text.primary,
                        background: appleVibe.surface.chip,
                        border: `1px solid ${appleVibe.accent.primary}`,
                        borderRadius: appleVibe.radius.pill,
                        outline: "none",
                        fontFamily: appleVibe.font.stack,
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => editor.setCurrentPage(p.id)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditValue(p.name);
                        setEditingId(p.id);
                      }}
                      title={`${p.name} — double-click to rename`}
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
                  )}
                  {!editing && pages.length > 1 && hoverId === p.id && (
                    <button
                      type="button"
                      title="Delete page"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmId(p.id);
                      }}
                      style={{
                        position: "absolute",
                        top: -7,
                        right: -5,
                        width: 16,
                        height: 16,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 999,
                        border: "1px solid var(--glass-border)",
                        background: "white",
                        color: appleVibe.text.tertiary,
                        fontSize: 11,
                        lineHeight: 1,
                        cursor: "pointer",
                        boxShadow: "0 4px 12px -4px rgba(11,18,40,0.3)",
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            {/* + add a new page */}
            <button
              type="button"
              title="Add a page"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => editor.createPage({ name: "New page" })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                marginLeft: 1,
                borderRadius: appleVibe.radius.pill,
                border: "none",
                background: "transparent",
                color: appleVibe.text.secondary,
                fontSize: 17,
                fontWeight: 400,
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              +
            </button>
          </div>
        )}
      </div>

      {/* Delete confirmation — clean white, no icons. */}
      {confirmId && (
        <div
          onPointerDown={() => setConfirmId(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            // TopPanel slot is pointer-events:none — opt this overlay back in so
            // the Cancel/Delete buttons actually receive clicks.
            pointerEvents: "auto",
            background: "rgba(11,18,40,0.22)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              width: "min(380px, calc(100vw - 32px))",
              background: "white",
              borderRadius: 16,
              padding: "20px 20px 16px",
              boxShadow: "0 30px 70px -24px rgba(11,18,40,0.4)",
              fontFamily: appleVibe.font.stack,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: appleVibe.text.primary }}>
              Delete this page?
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 13,
                lineHeight: 1.45,
                color: appleVibe.text.secondary,
              }}
            >
              “{confirmName}” and everything on it will be permanently removed.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => setConfirmId(null)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: "1px solid rgba(15,23,42,0.12)",
                  background: "white",
                  color: appleVibe.text.primary,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: appleVibe.font.stack,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deletePage(confirmId)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: "1px solid #DC2626",
                  background: "#DC2626",
                  color: "white",
                  fontSize: 13,
                  fontWeight: 650,
                  cursor: "pointer",
                  fontFamily: appleVibe.font.stack,
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const BOARD_COMPONENTS: TLComponents = {
  StylePanel: CollapsibleStylePanel,
  TopPanel: PageTabs,
  // The custom PageTabs (top-center) replaces tldraw's default page menu — drop
  // the duplicate "Page 1 ▾" from the top-left cluster.
  PageMenu: null,
  // Custom flow-builder connectors (bezier + handles) for the sharpening
  // graph AND comment strands (soft beziers from comment-card to its
  // target shapes). Both derive live from card positions. Mounted in the
  // OnTheCanvas slot so they render BEHIND the shapes (on the board
  // surface) — InFrontOfTheCanvas painted them over any card you opened.
  // The slot takes one component, so we compose both.
  OnTheCanvas: function ComposedConnectors() {
    return (
      <>
        <SharpeningConnectorsOverlay />
        <SpecForgeConnectorsOverlay />
        <CommentStrandsOverlay />
      </>
    );
  },
};

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
  // Ref mirror so the once-registered deploy listeners (deps: []) read the
  // LATEST settled state synchronously, plus a buffer for any deploy event
  // that fires DURING the ~100–500ms async restore window. Restore ends with
  // `loadSnapshot`, which REPLACES the whole store — so a card created before
  // it lands is silently wiped. This is the main "cards disappear / glitch on
  // load" cause: intake seed/promote and the polling mounts all fire right as
  // the board mounts. We buffer those deploys and replay them once restore
  // settles instead of letting the restore eat them.
  const restoreSettledRef = useRef(false);
  const pendingDeployRef = useRef<Array<() => void>>([]);
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

  // ── Live collaboration wiring ──────────────────────────────────
  // Identity + shared-flag come from /members. Collaboration spins up only
  // when the board is shared with ≥1 other participant; otherwise the hook
  // is a complete no-op (zero change to the solo case).
  const [collabIdentity, setCollabIdentity] = useState<BoardIdentity | null>(
    null,
  );
  const [collabEnabled, setCollabEnabled] = useState(false);
  const [collabRole, setCollabRole] = useState<BoardIdentity["role"] | null>(
    null,
  );
  // Refs read at save-time by the persistence single-writer gate so the
  // saver election can change without re-subscribing.
  const collabStateRef = useRef({ enabled: false, isSaver: true });
  const canSave = useCallback(() => {
    const s = collabStateRef.current;
    return !s.enabled || s.isSaver;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, membersRes] = await Promise.all([
          createSupabaseBrowserClient().auth.getUser(),
          fetch(`/api/objective/${spaceId}/members`, { cache: "no-store" }),
        ]);
        if (cancelled) return;
        const user = meRes.data.user;
        if (!user || !membersRes.ok) return;
        const m = (await membersRes.json()) as {
          myRole: BoardIdentity["role"];
          shared: boolean;
        };
        const name =
          (user.user_metadata?.display_name as string | undefined) ||
          (user.email ? user.email.split("@")[0] : "Guest");
        setCollabIdentity({
          userId: user.id,
          name,
          color: colorForUser(user.id),
          role: m.myRole,
        });
        setCollabRole(m.myRole);
        setCollabEnabled(Boolean(m.shared));
      } catch {
        /* soft-fail — board still works solo */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // Server-backed persistence (canvases table, scope='objective') with a
  // localStorage mirror — replaces tldraw's local-only persistenceKey so
  // the board survives reload AND syncs across devices.
  const { status: saveStatus } = useObjectiveBoardPersistence(
    editor,
    spaceId,
    () => {
    // Restore settled — now safe to drop in any cross-page queued
    // artifacts (e.g. sent from the lab) without a late restore wiping them.
    restoreSettledRef.current = true;
    setRestoreSettled(true);
    const ed = editorRef.current;
    if (!ed) return;
    // Replay any deploy events that arrived mid-restore (their shapes would
    // otherwise have been wiped by the restore's loadSnapshot). Drain a copy
    // so a handler that re-buffers can't loop.
    const buffered = pendingDeployRef.current;
    pendingDeployRef.current = [];
    for (const replay of buffered) {
      try {
        replay();
      } catch (err) {
        console.warn("[objective-board] buffered deploy replay failed", err);
      }
    }
    // Older boards persisted real tldraw arrows for the sharpening graph;
    // the bezier overlay now draws those, so the persisted arrows show as a
    // straight-line duplicate under each curve. Sweep them once the board is
    // restored (deploy doesn't re-run on a returning visit).
    clearLegacySharpeningArrows(ed);
    // Self-heal a board that wrongly carries a chatbox card ON TOP of a
    // promoted objective (stale draft id seeded intake onto a finished board).
    clearStaleChatboxCards(ed);
    for (const d of drainPendingArtifacts(spaceId)) createArtifactCard(ed, d);
    for (const d of drainPendingSubsystemKgs(spaceId))
      createSubsystemKgCard(ed, d);
    },
    canSave,
  );

  // Live multiplayer — presence cursors + real-time shape deltas over a
  // private Supabase Realtime channel. Gated on a shared board + restore
  // having settled (so we never broadcast/merge onto a store that's about
  // to be replaced by loadSnapshot).
  const collab = useBoardCollaboration(editor, spaceId, {
    enabled: collabEnabled,
    ready: restoreSettled,
    identity: collabIdentity,
  });
  // Keep the single-writer gate's refs current (read by `canSave`).
  collabStateRef.current = { enabled: collabEnabled, isSaver: collab.isSaver };

  // Viewers are read-only: tldraw blocks local edits, and the collaboration
  // hook additionally refuses to broadcast for the viewer role.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !collabRole) return;
    ed.updateInstanceState({ isReadonly: collabRole === "viewer" });
  }, [collabRole, editor]);

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
    async function onDecompose(e: Event) {
      const ed = editorRef.current;
      if (!ed || decomposingRef.current) return;
      decomposingRef.current = true;
      // Optional objective override (e.g. the re-framed objective after the
      // Resolution Studio applies answers); bare triggers decompose space text.
      const objective = (e as CustomEvent<{ objective?: string }>)?.detail
        ?.objective;
      try {
        const res = await fetch(`/api/objective/${spaceId}/decompose-cards`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(objective ? { objective } : {}),
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
            spaceId,
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
        { spaceId },
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

    function onDeployVoiceNote(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      deployVoiceNoteOnBoard(
        editor,
        (e as CustomEvent<VoiceNoteCardDetail>).detail,
      );
    }

    function onUpdateVoiceAnalysis(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      updateVoiceNoteAnalysisOnBoard(
        editor,
        (e as CustomEvent<VoiceNoteAnalysisDetail>).detail,
      );
    }

    function onDeployJournal(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      deployJournalOnBoard(
        editor,
        (e as CustomEvent<JournalCardDetail>).detail,
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

    // Until restore settles, buffer any shape-CREATING deploy so the restore's
    // loadSnapshot can't wipe it; replayed in the onRestored callback above.
    // (REMOVE / CARD_ACTION pass through — they target shapes that, by
    // definition, only exist after restore.)
    const buffered = (handler: (e: Event) => void) => (e: Event) => {
      if (!restoreSettledRef.current) {
        pendingDeployRef.current.push(() => handler(e));
        return;
      }
      handler(e);
    };

    const onDeployB = buffered(onDeploy);
    const onArtifactB = buffered(onArtifact);
    const onSubsystemKgB = buffered(onSubsystemKg);
    const onDeploySharpeningB = buffered(onDeploySharpening);
    const onForkAmbiguityB = buffered(onForkAmbiguity);
    const onDeployImageCardB = buffered(onDeployImageCard);
    const onDeployVoiceNoteB = buffered(onDeployVoiceNote);
    const onDeployJournalB = buffered(onDeployJournal);
    const onSeedChatboxB = buffered(onSeedChatbox);
    const onSeedObjectiveB = buffered(onSeedObjective);
    const onPromoteToObjectiveB = buffered(onPromoteToObjective);

    window.addEventListener(DEPLOY_CARD_EVENT, onDeployB);
    window.addEventListener(REMOVE_CARD_EVENT, onRemove);
    window.addEventListener(DEPLOY_ARTIFACT_EVENT, onArtifactB);
    window.addEventListener(DEPLOY_SUBSYSTEM_KG_EVENT, onSubsystemKgB);
    window.addEventListener(CARD_ACTION_EVENT, onCardAction);
    window.addEventListener(DEPLOY_SHARPENING_EVENT, onDeploySharpeningB);
    window.addEventListener(FORK_AMBIGUITY_EVENT, onForkAmbiguityB);
    window.addEventListener(DEPLOY_IMAGE_CARD_EVENT, onDeployImageCardB);
    window.addEventListener(DEPLOY_VOICE_NOTE_EVENT, onDeployVoiceNoteB);
    window.addEventListener(UPDATE_VOICE_ANALYSIS_EVENT, onUpdateVoiceAnalysis);
    window.addEventListener(DEPLOY_JOURNAL_EVENT, onDeployJournalB);
    window.addEventListener(SEED_CHATBOX_EVENT, onSeedChatboxB);
    window.addEventListener(SEED_OBJECTIVE_EVENT, onSeedObjectiveB);
    window.addEventListener(PROMOTE_TO_OBJECTIVE_EVENT, onPromoteToObjectiveB);
    return () => {
      window.removeEventListener(DEPLOY_CARD_EVENT, onDeployB);
      window.removeEventListener(REMOVE_CARD_EVENT, onRemove);
      window.removeEventListener(DEPLOY_ARTIFACT_EVENT, onArtifactB);
      window.removeEventListener(DEPLOY_SUBSYSTEM_KG_EVENT, onSubsystemKgB);
      window.removeEventListener(CARD_ACTION_EVENT, onCardAction);
      window.removeEventListener(DEPLOY_SHARPENING_EVENT, onDeploySharpeningB);
      window.removeEventListener(FORK_AMBIGUITY_EVENT, onForkAmbiguityB);
      window.removeEventListener(DEPLOY_IMAGE_CARD_EVENT, onDeployImageCardB);
      window.removeEventListener(DEPLOY_VOICE_NOTE_EVENT, onDeployVoiceNoteB);
      window.removeEventListener(UPDATE_VOICE_ANALYSIS_EVENT, onUpdateVoiceAnalysis);
      window.removeEventListener(DEPLOY_JOURNAL_EVENT, onDeployJournalB);
      window.removeEventListener(SEED_CHATBOX_EVENT, onSeedChatboxB);
      window.removeEventListener(SEED_OBJECTIVE_EVENT, onSeedObjectiveB);
      window.removeEventListener(PROMOTE_TO_OBJECTIVE_EVENT, onPromoteToObjectiveB);
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

  // ── Tech-spec inline expand + per-section ops + refine + attach ─────
  // Four board-bus events from the expanded tech-spec card:
  //   TOGGLE_EXPAND  — flip the card's collapsed/expanded layout + resize
  //   SECTION_OP     — Ask | Variations | Improve → POST → spec-feedback-card
  //   ATTACH_TO_SECTION — feedback card pushed into a section's pending queue
  //   REFINE_SECTION — POST refine → swap section value + bump version + flash
  useEffect(() => {
    function findTechSpecCard(shapeId: string): TechSpecCardShape | null {
      const editor = editorRef.current;
      if (!editor) return null;
      const shape = editor.getShape(shapeId as TechSpecCardShape["id"]);
      if (!shape || shape.type !== "tech-spec-card") return null;
      return shape as TechSpecCardShape;
    }

    function onToggleExpand(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      const d = (e as CustomEvent<ToggleTechSpecExpandDetail>).detail;
      const card = findTechSpecCard(d.shapeId);
      if (!card) return;
      const COLLAPSED_W = 308;
      const COLLAPSED_H = 184;
      const EXPANDED_W = 640;
      const EXPANDED_H = 640;
      editor.updateShape<TechSpecCardShape>({
        id: card.id,
        type: "tech-spec-card",
        props: {
          expanded: d.expanded,
          w: d.expanded ? EXPANDED_W : COLLAPSED_W,
          h: d.expanded ? EXPANDED_H : COLLAPSED_H,
        },
      });
    }

    async function onSectionOp(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      const d = (e as CustomEvent<SectionOpDetail>).detail;
      const card = findTechSpecCard(d.specCardId);
      if (!card) return;
      let spec: TechSpec | null = null;
      try {
        spec = JSON.parse(card.props.specJson) as TechSpec;
      } catch {
        return;
      }
      // Place a "thinking" feedback card immediately so the user has feedback.
      const cardBounds = editor.getShapePageBounds(card.id);
      if (!cardBounds) return;
      const feedbackW = 320;
      const feedbackH = 240;
      const ignore = new Set<TLShapeId>();
      ignore.add(card.id as TLShapeId);
      // Place to the RIGHT of the spec card by default — anchor center sits
      // a half-width past the right edge so reserveSpace lays it out
      // side-by-side; if it can't, reserveSpace will relocate downward.
      const anchorMidX = cardBounds.x + cardBounds.w + 24 + feedbackW / 2;
      const preferredTop = cardBounds.y;
      const spot = reserveSpace(
        editor,
        { w: feedbackW, h: feedbackH },
        { anchorMidX, preferredTop, gap: 16, ignore },
      );
      const feedbackId = createShapeId();
      const newShape: TLShapePartial<SpecFeedbackCardShape> = {
        id: feedbackId,
        type: "spec-feedback-card",
        x: spot.x,
        y: spot.y,
        props: {
          w: feedbackW,
          h: feedbackH,
          kind: d.kind,
          sectionLabel: d.sectionLabel,
          sectionId: d.sectionId,
          specCardId: card.id,
          selection: d.selection,
          content: "Thinking…",
          attached: false,
        },
      };
      editor.createShapes([newShape]);
      // Arrow: spec card → feedback card.
      const arrowId = createShapeId();
      const arrow: TLShapePartial<TLArrowShape> = {
        id: arrowId,
        type: "arrow",
        props: { color: "grey", size: "s", dash: "dashed", arrowheadEnd: "arrow" },
        meta: { specFeedbackFor: card.id, sectionId: d.sectionId },
      };
      editor.createShapes([arrow]);
      editor.createBindings([
        {
          fromId: arrowId,
          toId: card.id,
          type: "arrow",
          props: {
            terminal: "start",
            normalizedAnchor: { x: 0.5, y: 0.5 },
            isExact: false,
            isPrecise: false,
          },
        },
        {
          fromId: arrowId,
          toId: feedbackId,
          type: "arrow",
          props: {
            terminal: "end",
            normalizedAnchor: { x: 0.5, y: 0.5 },
            isExact: false,
            isPrecise: false,
          },
        },
      ]);
      try {
        const res = await fetch("/api/canvas/tech-spec/section-op", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            spec,
            sectionId: d.sectionId,
            selection: d.selection,
            kind: d.kind,
            prompt: d.prompt,
          }),
        });
        if (!res.ok) throw new Error(`section-op ${res.status}`);
        const json = (await res.json()) as { content?: string };
        const content = typeof json.content === "string" ? json.content : "(no content)";
        editor.updateShape<SpecFeedbackCardShape>({
          id: feedbackId,
          type: "spec-feedback-card",
          props: { content },
        });
      } catch (err) {
        console.warn("[board] section-op failed:", err);
        editor.updateShape<SpecFeedbackCardShape>({
          id: feedbackId,
          type: "spec-feedback-card",
          props: {
            content:
              "Section op failed. Try again, or refine your selection / prompt and retry.",
          },
        });
      }
    }

    function onAttachToSection(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      const d = (e as CustomEvent<AttachToSectionDetail>).detail;
      const sectionId = asSectionId(d.sectionId);
      if (!sectionId) return;
      const card = findTechSpecCard(d.specCardId);
      if (!card) return;
      const meta: SectionMetaMap = parseSectionMeta(card.props.sectionMeta);
      const slot = meta[sectionId] ?? emptySectionMeta();
      slot.pending = [
        ...slot.pending,
        {
          source: "card",
          content: d.content,
          cardId: d.feedbackCardId,
          addedAt: Date.now(),
        },
      ];
      meta[sectionId] = slot;
      editor.updateShape<TechSpecCardShape>({
        id: card.id,
        type: "tech-spec-card",
        props: { sectionMeta: serializeSectionMeta(meta) },
      });
      // Mark the source feedback card as attached.
      const fbShape = editor.getShape(d.feedbackCardId as SpecFeedbackCardShape["id"]);
      if (fbShape && fbShape.type === "spec-feedback-card") {
        editor.updateShape<SpecFeedbackCardShape>({
          id: d.feedbackCardId as SpecFeedbackCardShape["id"],
          type: "spec-feedback-card",
          props: { attached: true },
        });
      }
    }

    async function onRefineSection(e: Event) {
      const editor = editorRef.current;
      if (!editor) return;
      const d = (e as CustomEvent<RefineSectionDetail>).detail;
      const card = findTechSpecCard(d.specCardId);
      if (!card) return;
      let spec: TechSpec | null = null;
      try {
        spec = JSON.parse(card.props.specJson) as TechSpec;
      } catch {
        return;
      }
      const meta = parseSectionMeta(card.props.sectionMeta);
      const slot = meta[d.sectionId];
      if (!slot || !slot.pending.length) return;
      const versionHistory = slot.versions.map((v) => v.value);
      try {
        const res = await fetch("/api/canvas/tech-spec/refine-section", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            spec,
            sectionId: d.sectionId,
            pendingImprovements: slot.pending.map((p) => ({
              source: p.source,
              content: p.content,
            })),
            versionHistory,
          }),
        });
        if (!res.ok) throw new Error(`refine-section ${res.status}`);
        const json = (await res.json()) as { value?: unknown };
        if (json.value === undefined) throw new Error("refine returned no value");
        // Roll the OLD value into versions (cap 5), clear pending, stamp time.
        const prior = getSectionValue(spec, d.sectionId);
        slot.versions = [
          ...slot.versions,
          { value: prior, createdAt: Date.now() },
        ].slice(-5);
        slot.pending = [];
        slot.lastRefinedAt = Date.now();
        meta[d.sectionId] = slot;
        const nextSpec = { ...spec, [d.sectionId]: json.value } as TechSpec;
        editor.updateShape<TechSpecCardShape>({
          id: card.id,
          type: "tech-spec-card",
          props: {
            specJson: JSON.stringify(nextSpec),
            sectionMeta: serializeSectionMeta(meta),
            lastChangedSection: d.sectionId,
            lastChangedAt: Date.now(),
          },
        });
      } catch (err) {
        console.warn("[board] refine-section failed:", err);
      }
    }

    window.addEventListener(TOGGLE_TECH_SPEC_EXPAND_EVENT, onToggleExpand);
    window.addEventListener(SECTION_OP_EVENT, onSectionOp);
    window.addEventListener(ATTACH_TO_SECTION_EVENT, onAttachToSection);
    window.addEventListener(REFINE_SECTION_EVENT, onRefineSection);
    return () => {
      window.removeEventListener(TOGGLE_TECH_SPEC_EXPAND_EVENT, onToggleExpand);
      window.removeEventListener(SECTION_OP_EVENT, onSectionOp);
      window.removeEventListener(ATTACH_TO_SECTION_EVENT, onAttachToSection);
      window.removeEventListener(REFINE_SECTION_EVENT, onRefineSection);
    };
  }, [spaceId]);

  return (
    <div className="absolute inset-0 oc-board">
      <Tldraw
        shapeUtils={CUSTOM_SHAPE_UTILS}
        components={BOARD_COMPONENTS}
        onMount={handleMount}
        inferDarkMode={false}
        hideUi={!showUi}
      />
      {/* Autosave status pill — green = saved, amber = saving, red = failed.
          Gives the user explicit save feedback. */}
      {editor && showUi && (
        <div
          style={{
            // Unified right toolbar baseline (top:16) — fifth stop in the row:
            // palette · Share · Powerups · Library · Saved · collaborators.
            // Passive (pointer-events:none); tucks behind a launcher panel
            // when one is open.
            position: "absolute",
            top: 16,
            right: 390,
            zIndex: 69,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 11px",
            borderRadius: 999,
            pointerEvents: "none",
            fontFamily: appleVibe.font.stack,
            fontSize: 11,
            fontWeight: 600,
            color:
              saveStatus === "error"
                ? "#DC2626"
                : appleVibe.text.secondary,
            // Translucent — sits behind everything else, status-only.
            background: "rgba(255,255,255,0.45)",
            border: "1px solid rgba(255,255,255,0.55)",
            backdropFilter: "blur(var(--blur-float)) saturate(1.5)",
            WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.5)",
            boxShadow: "0 4px 14px -10px rgba(11,18,40,0.18)",
            opacity: 0.85,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background:
                saveStatus === "error"
                  ? "#DC2626"
                  : saveStatus === "saving"
                    ? "#F59E0B"
                    : "#16A34A",
            }}
          />
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "error"
              ? "Save failed"
              : "Saved"}
        </div>
      )}
      {/* Share button — invite collaborators by email (owner) / see roster. */}
      {editor && showUi && <ShareBoardLauncher spaceId={spaceId} />}
      {/* Live-collaboration avatar stack — who else is on the board now. */}
      {editor && showUi && collab.collaborators.length > 0 && (
        <div
          style={{
            // Unified right toolbar baseline (top:16) — sixth/leftmost stop;
            // only present while others are on the board.
            position: "absolute",
            top: 16,
            right: 478,
            zIndex: 70,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          {collab.collaborators.slice(0, 5).map((c, i) => (
            <div
              key={c.clientId}
              title={`${c.name}${c.role === "viewer" ? " (viewer)" : ""}`}
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                marginLeft: i === 0 ? 0 : -8,
                background: c.color,
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid #fff",
                boxShadow: "0 2px 8px -2px rgba(11,18,40,0.3)",
                fontFamily: appleVibe.font.stack,
                textTransform: "uppercase",
              }}
            >
              {(c.name || "?").trim().charAt(0)}
            </div>
          ))}
        </div>
      )}
      {/* Contextual AI action — only while the board chrome is showing and
          we're NOT unfurling (the selection toolbar is for the normal board). */}
      {editor && showUi && (
        <BoardOverlay editor={editor} runAiLink={runAiLink} spaceId={spaceId} />
      )}
      {editor && <PrototypeEventBridge editor={editor} spaceId={spaceId} />}
      {editor && <UiPlanEventBridge editor={editor} spaceId={spaceId} />}
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
    s.type === "artifact-card" ||
    s.type === "oc-card"
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
  if (s.type === "oc-card") {
    const p = (s as OcCardShape).props;
    const body = p.body ? p.body.slice(0, 200) : "";
    return {
      title: p.name,
      chips: body ? [p.kind, body] : [p.kind],
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
  // Passive drop → yield only: land in clear space near the viewport center
  // without shoving existing work (allowPush: false).
  const spot = reserveSpace(
    editor,
    { w, h },
    {
      anchorMidX: center.x + cascade,
      preferredTop: center.y - h / 2 + cascade,
      gap: 28,
      allowPush: false,
    },
  );
  const x = spot.x;
  const y = spot.y;
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

    // Persist a finished prototype as an `artifacts` row (so it shows in the
    // Artifacts Library + survives as a continuously-updated final product).
    // Idempotent on (engine_key, board_shape_id); soft-fail.
    function persistPrototype(
      shapeId: TLShapeId,
      title: string,
      html: string,
      specJson: string,
    ) {
      void fetch(`/api/objective/${spaceId}/artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          engineKey: "build_prototype",
          artifactType: "prototype",
          title: title || "Prototype",
          status: "ready",
          content: { html, specJson },
          boardShapeId: shapeId,
          lastUpdatedBy: "agent:build_prototype",
          appendVersion: true,
          changeType: "generated",
        }),
      }).catch(() => {});
    }

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
        persistPrototype(id, d.title || "Prototype", html, d.specJson);
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
        persistPrototype(
          shape.id,
          shape.props.title || "Prototype",
          html,
          shape.props.specJson,
        );
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

// ── UiPlanEventBridge ──
// The "Build prototype" fork: from any selected card, drop N ui-plan-cards
// below it (tldraw arrows from source → each card), then POST /api/canvas/ui-plan
// and fill each card with one variant. Each card's footer then fires
// BUILD_PROTOTYPE_EVENT to commit that variant to a real prototype.
function UiPlanEventBridge({
  editor,
  spaceId,
}: {
  editor: Editor;
  spaceId: string;
}) {
  useEffect(() => {
    const CARD_W = 280;
    const CARD_H = 340;
    const GAP_X = 18;
    const GAP_BELOW = 90;

    async function onBuild(e: Event) {
      const d = (e as CustomEvent<BuildUiPlansDetail>).detail;
      if (!d || !d.sourceText?.trim()) return;
      const count = Math.max(1, Math.min(5, Math.round(d.count || 3)));

      const anchor = d.sourceShapeId
        ? editor.getShapePageBounds(d.sourceShapeId as TLShapeId)
        : undefined;
      const vp = editor.getViewportPageBounds();
      const totalW = count * CARD_W + (count - 1) * GAP_X;
      const anchorMidX = anchor ? anchor.midX : vp.center.x;
      const preferredTop = anchor ? anchor.maxY + GAP_BELOW : vp.center.y - CARD_H / 2;
      // Active generator → push-then-yield: make room for the row of plan cards
      // (else relocate it), ignoring the source it grows from.
      const ignore = new Set<TLShapeId>();
      if (d.sourceShapeId) ignore.add(d.sourceShapeId as TLShapeId);
      const spot = reserveSpace(
        editor,
        { w: totalW, h: CARD_H },
        { anchorMidX, preferredTop, gap: GAP_BELOW, ignore },
      );
      const left = spot.x;
      const top = spot.y;

      // Create N placeholder cards + arrows from the source.
      const cardIds: TLShapeId[] = [];
      for (let i = 0; i < count; i++) {
        const id = createShapeId();
        cardIds.push(id);
        editor.createShape<UiPlanCardShape>({
          id,
          type: "ui-plan-card",
          x: left + i * (CARD_W + GAP_X),
          y: top,
          props: {
            w: CARD_W,
            h: CARD_H,
            title: d.sourceLabel || "UI plan",
            variantLabel: "",
            overview: "",
            sourceText: d.sourceText,
            uiPlanJson: "",
            status: "generating",
          },
          meta: { sourceShapeId: d.sourceShapeId, variantIndex: i },
        });
        if (d.sourceShapeId) {
          const arrowId = createShapeId();
          const arrow: TLShapePartial<TLArrowShape> = {
            id: arrowId,
            type: "arrow",
            props: {
              color: "grey",
              size: "s",
              dash: "solid",
              arrowheadStart: "none",
              arrowheadEnd: "arrow",
              bend: 0,
            },
            meta: { uiPlanLink: true },
          };
          editor.createShapes([arrow]);
          editor.createBindings([
            {
              fromId: arrowId,
              toId: d.sourceShapeId as TLShapeId,
              type: "arrow",
              props: {
                terminal: "start",
                normalizedAnchor: { x: 0.5, y: 1 },
                isExact: false,
                isPrecise: true,
              },
              meta: {},
            },
            {
              fromId: arrowId,
              toId: id,
              type: "arrow",
              props: {
                terminal: "end",
                normalizedAnchor: { x: 0.5, y: 0 },
                isExact: false,
                isPrecise: true,
              },
              meta: {},
            },
          ]);
        }
      }

      // Focus the new row.
      editor.select(...cardIds);
      const bounds = editor.getSelectionPageBounds();
      if (bounds) {
        editor.zoomToBounds(bounds, { inset: 160, animation: { duration: 300 } });
      }
      editor.selectNone();

      try {
        const res = await fetch(`/api/canvas/ui-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            sourceText: d.sourceText,
            count,
            temperature: d.temperature,
          }),
        });
        if (!res.ok) throw new Error(`ui-plan failed: ${res.status}`);
        const json = (await res.json()) as {
          title: string;
          overview: string;
          variants: Array<{ label: string; plan: unknown }>;
        };
        const variants = json.variants || [];
        for (let i = 0; i < cardIds.length; i++) {
          const v = variants[i];
          const id = cardIds[i];
          if (!editor.getShape(id)) continue;
          if (!v || !v.plan) {
            editor.updateShape<UiPlanCardShape>({
              id,
              type: "ui-plan-card",
              props: { status: "error" },
            });
            continue;
          }
          editor.updateShape<UiPlanCardShape>({
            id,
            type: "ui-plan-card",
            props: {
              status: "ready",
              title: json.title || d.sourceLabel || "UI plan",
              overview: json.overview || "",
              variantLabel: v.label || `Variant ${i + 1}`,
              uiPlanJson: JSON.stringify(v.plan),
            },
          });
        }
      } catch (err) {
        console.warn("[board] ui-plan build failed:", err);
        for (const id of cardIds) {
          try {
            editor.updateShape<UiPlanCardShape>({
              id,
              type: "ui-plan-card",
              props: { status: "error" },
            });
          } catch {
            /* card may have been deleted */
          }
        }
      }
    }

    window.addEventListener(BUILD_UI_PLANS_EVENT, onBuild);
    return () => window.removeEventListener(BUILD_UI_PLANS_EVENT, onBuild);
  }, [editor, spaceId]);

  return null;
}

// DecomposeCardsButton (the bottom-left float) was removed — the objective
// decompose now lives in the Powerups rail (requestDecomposeIntoCards).

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
  // The scanner surfaces on card select; the "Ask AI" pin toggle was removed,
  // so this stays false (no whole-board scan branch). Kept as state so the
  // scanner-host render condition below reads cleanly.
  const [pinned] = useState(false);
  // SpecForge — the full causal-spec chain running off the selected idea.
  // Non-null while the chain runs; drives the floating progress chip + the
  // scanner's "Forge full spec" button busy state.
  const [forging, setForging] = useState<SpecForgeProgress | null>(null);

  // The Powerups rail's Forge button dispatches FORGE_REQUEST_EVENT — run the
  // SpecForge chain on the current selection (aggregated). handleForge is a
  // hoisted declaration below, so referencing it here is fine.
  useEffect(() => {
    function onForgeReq() {
      const targets = editor
        .getSelectedShapes()
        .map(shapeToScanTarget)
        .filter((t): t is OperationTarget => !!t);
      // Rail flips its button to busy optimistically on click. If we bail
      // here (no selection / empty text) we MUST clear that — otherwise the
      // button stays disabled with the spinner stuck on. handleForge below
      // also flips to running which broadcasts true again on a real run.
      const text = targets.map((t) => t.text).join("\n\n");
      if (targets.length === 0 || !text.trim()) {
        window.dispatchEvent(
          new CustomEvent(FORGE_STATE_EVENT, { detail: { running: false } }),
        );
        return;
      }
      handleForge({ text, shapeId: targets[0].shapeId });
    }
    window.addEventListener(FORGE_REQUEST_EVENT, onForgeReq);
    return () => window.removeEventListener(FORGE_REQUEST_EVENT, onForgeReq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
  // Deep Synthesize (pro Claude + web search) — busy flag + the staged
  // label shown in its progress chip while the long run is in flight.
  const [deepBusy, setDeepBusy] = useState(false);
  const [deepStage, setDeepStage] = useState("Reading your selection…");
  // Transient failure surface — so a failed run reads as "couldn't synthesize"
  // instead of the panel silently vanishing with no map ("nothing happened").
  const [deepError, setDeepError] = useState<string | null>(null);
  // SpecForge → Tech Spec stage (auto-runs after the forge unfurl completes).
  const [techSpecBusy, setTechSpecBusy] = useState(false);
  const [techSpecStage, setTechSpecStage] = useState("Writing the tech spec…");
  // "Custom" synthesizing op (the user's own instruction over the selection).
  const [customBusy, setCustomBusy] = useState(false);
  // Which forge verb is running, so only the clicked toolbar button spins:
  // "spec" (Spec) vs "prototype" (Prototype = forge → spec → auto-build).
  const [forgeKind, setForgeKind] = useState<"spec" | "prototype" | null>(null);

  // Mirror Forge busy-state out to the Powerup rail (which renders the hero
  // button) so it can disable + spinner the click target. Covers BOTH stages
  // of the chain — the 9-engine unfurl AND the follow-up tech-spec — so a
  // second click is blocked end-to-end, not just during the unfurl.
  useEffect(() => {
    const running = !!(forging && forging.phase === "running") || techSpecBusy;
    window.dispatchEvent(
      new CustomEvent(FORGE_STATE_EVENT, { detail: { running } }),
    );
  }, [forging, techSpecBusy]);

  // Run the SpecForge chain for the selected idea — streams decision cards
  // below the source. Guarded so a second click can't double-run.
  function handleForge(
    target: OperationTarget,
    opts?: { autoPrototype?: boolean },
  ) {
    if ((forging && forging.phase === "running") || techSpecBusy) return;
    if (!target.text.trim()) return;
    setForgeKind(opts?.autoPrototype ? "prototype" : "spec");
    // Bootstrap progress state with the real chain length and the first act —
    // the chip then transitions smoothly to the runner's first onProgress call.
    setForging({
      phase: "running",
      done: 0,
      total: SPECFORGE_CHAIN.length,
      label: "Starting…",
      act: "frame",
      actIndex: 1,
      actTotal: PHASE_ORDER.length,
    });
    void (async () => {
      // 1) Run the SpecForge unfurl — full causal chain.
      let forge;
      try {
        forge = await runSpecForge(editor, target, { onProgress: setForging });
      } catch (err) {
        console.warn("[board] specforge failed:", err);
        setForging(null);
        setForgeKind(null);
        return;
      }
      setForging(null);
      if (!forge?.createdAny) {
        setForgeKind(null);
        return;
      }

      // 2) Auto-generate the tech-spec page (incl. UI plan), ingesting any
      //    inspiration images. With autoPrototype, the pipeline skips the spec
      //    page and jumps straight to building the prototype off the spec.
      setTechSpecBusy(true);
      setTechSpecStage(
        opts?.autoPrototype
          ? "Writing the spec → prototype…"
          : "Writing the tech spec…",
      );
      try {
        await runForgePipeline(editor, spaceId, forge, {
          anchorShapeId: target.shapeId,
          inspirationImages: collectInspirationImages(editor),
          onProgress: setTechSpecStage,
          autoPrototype: opts?.autoPrototype,
        });
      } catch (err) {
        console.warn("[board] tech spec failed:", err);
      } finally {
        setTechSpecBusy(false);
        setForgeKind(null);
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
      // Converge/Diverge popup — beside the selection (single OR lasso) whenever
      // ≥1 scannable card is selected and none is mid-edit. Anchor = the
      // selection's bounding box in screen coords; target = the aggregate.
      const editingId = editor.getEditingShapeId();
      const cdActive =
        deepEntries.length >= 1 && selected.every((s) => s.id !== editingId);
      let cdAnchor: { left: number; right: number; midY: number } | null = null;
      if (cdActive && bounds) {
        const l = editor.pageToScreen({ x: bounds.minX, y: bounds.midY });
        const r = editor.pageToScreen({ x: bounds.maxX, y: bounds.midY });
        cdAnchor = { left: l.x, right: r.x, midY: r.y };
      }
      const cdTarget: OperationTarget | null = cdActive
        ? {
            text: deepEntries.map((e) => e.text).join("\n\n"),
            shapeId: deepEntries[0].id,
          }
        : null;
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
        cdAnchor,
        cdTarget,
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

  // Spec on a SELECTION: forge a full spec from the combined selection text
  // (reuses the single-idea SpecForge → tech-spec pipeline via handleForge).
  function handleSpec() {
    const text = view.deepPayloads.map((p) => p.text).join("\n\n").slice(0, 6000);
    if (!text.trim()) return;
    handleForge({ text, shapeId: view.deepIds[0] });
  }

  // Prototype on a SELECTION: forge -> tech-spec -> auto-build the prototype
  // in one shot (reuses handleForge with autoPrototype; skips the spec page).
  function handlePrototype() {
    const text = view.deepPayloads.map((p) => p.text).join("\n\n").slice(0, 6000);
    if (!text.trim()) return;
    handleForge({ text, shapeId: view.deepIds[0] }, { autoPrototype: true });
  }

  // Custom op on a SELECTION: run the user's own instruction over the
  // combined selection text → result cards below the first selected shape.
  async function handleCustom(prompt: string) {
    if (customBusy) return;
    const text = view.deepPayloads.map((p) => p.text).join("\n\n").slice(0, 6000);
    if (!text.trim() || !prompt.trim()) return;
    setCustomBusy(true);
    try {
      const s = getAiSettings();
      await executeCardOperation(
        editor,
        { text, shapeId: view.deepIds[0] },
        "custom",
        { prompt, temperature: s.temperature, spaceId },
      );
    } catch (err) {
      console.warn("[board] custom op failed:", err);
    } finally {
      setCustomBusy(false);
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
    setDeepError(null);
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
      // Surface it — a silent soft-fail reads as "nothing happened". The chip
      // auto-clears after a few seconds; the selection is untouched, so retry.
      setDeepError("Couldn't synthesize — please try again.");
      window.setTimeout(() => setDeepError(null), 5000);
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
      {/* Consolidated nav — one white icon pill (Home · Goal · History ·
          Settings) in the top-right, replacing the old left-side stack of
          labelled glass pills. Home navigates; the rest open their launcher
          panels (mounted below) via events. */}
      <BoardNavBar />
      {/* RoomPill removed — it duplicated the objective name the centered
          PageTabs already shows; "+ new objective" now lives in the Powerups
          rail ("New objective + refine") and the Home nav. */}
      {/* Decompose (and every other op) now lives in the Powerups rail — no
          stray bottom-left float. Converge/Diverge are the inline verbs. */}
      {/* Top-center AI thinking-settings cluster (depth · complexity · temp ·
          web search) — global knobs the ‹ › verbs + scanner ops read. */}
      <CanvasTopControls />
      {/* Dedicated Library rail (glossary + knowledge graph), launched from a
          right-edge pill; expandable to full screen. Reads the space glossary
          + focuses board cards. */}
      <LibraryLauncher spaceId={spaceId} editor={editor} />
      {/* Powerups + Artifacts rail — the persistent right-edge home for every
          AI op (run on the live selection) + the finished tech-specs/artifacts. */}
      <PowerupRail spaceId={spaceId} editor={editor} />
      {/* Artifact Dock — left-edge gradient circles for TERMINAL deliverables
          (Prototype, Notebook, …). Select objects → tap a circle → the engine
          runs plan→create and drops a persistent artifact. */}
      <ArtifactDock spaceId={spaceId} editor={editor} />
      {/* Notebook — the editable on-canvas Notebook panel. Opens on
          OPEN_NOTEBOOK_EVENT (journal-card "Open" + the Notebook dock engine);
          block-model editing, board stays live behind. */}
      <NotebookMount spaceId={spaceId} />
      {/* AI Chat — bottom-right card overlay. Opens on OPEN_BOARD_CHAT_EVENT
          (dispatched by the toolbox sphere's "AI Chat" pill). Reads the live
          board snapshot every send; cross-board scope is a header toggle. */}
      <WhiteboardChatPanel spaceId={spaceId} editor={editor} />
      {/* Comments — orchestrator for the comment-card shape. Listens for
          OPEN_BOARD_COMMENT (toolbox sphere), body/resolve/delete patches,
          and the "Analyze on board" extension. Hydrates existing rows on
          mount so comments survive a page refresh. */}
      <CommentBoardMount spaceId={spaceId} editor={editor} />
      {/* Object detail drawer — listens for OPEN_CARD_DETAIL_EVENT (oc-card
          double-click + Library clicks) → metadata + object-graph modal. */}
      <ObjectDetailMount spaceId={spaceId} editor={editor} />
      {/* Left-edge Goal & alignment rail: ultimate goal + live ranking of
          convergent/divergent board nodes (rank-nodes endpoint). */}
      <GoalLauncher spaceId={spaceId} editor={editor} />
      {/* Version history — left-edge pill → timestamped snapshots + restore;
          auto-captures every few minutes while the board changes. */}
      <BoardHistoryLauncher spaceId={spaceId} editor={editor} />
      {/* Minimalist account settings — left-edge pill → who you're signed in
          as + sign out. The old /app/settings page is retired (middleware). */}
      <BoardSettingsLauncher />
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
            onSpec={view.deepPayloads.length >= 2 ? handleSpec : undefined}
            specBusy={forgeKind === "spec"}
            onPrototype={
              view.deepPayloads.length >= 2 ? handlePrototype : undefined
            }
            prototypeBusy={forgeKind === "prototype"}
            onCustom={view.deepPayloads.length >= 2 ? handleCustom : undefined}
            customBusy={customBusy}
          />
        )}

      {/* Converge / Diverge — the minimal verbs, beside the selection (single OR
          lasso/multi-select). The full op list + Forge live in the Powerups
          rail; these two stay inline as the primary move. */}
      {view.cdAnchor &&
        view.cdTarget &&
        (() => {
          const anchor = view.cdAnchor!;
          const target = view.cdTarget!;
          return (
            <ConvergeDivergePopup
              anchor={anchor}
              onRun={(opId, temperature) => {
                const s = getAiSettings();
                return executeCardOperation(editor, target, opId, {
                  temperature,
                  depth: s.depth,
                  questionCount: s.complexity,
                  webSearch: s.webSearch,
                  spaceId,
                });
              }}
            />
          );
        })()}

      {/* SpecForge progress — a calm glass chip while the causal-spec chain
          runs, so the user knows the cards are streaming in below the idea. */}
      {forging && <SpecForgeProgressChip progress={forging} />}

      {/* Deep Synthesize progress — calm glass chip while pro Claude reads
          the selection, searches the web, and weaves the cross-link map. */}
      {deepBusy && <DeepSynthProgressChip label={deepStage} />}
      {deepError && !deepBusy && <DeepSynthErrorChip message={deepError} />}

      {/* Tech-spec progress — the SpecForge → Tech Spec hand-off chip. */}
      {techSpecBusy && (
        <DeepSynthProgressChip
          title="Tech spec"
          label={techSpecStage}
          stages={TECH_SPEC_STAGES}
          expectedMs={30000}
        />
      )}

      {/* The "Ask AI" pin toggle was removed to declutter the board chrome —
          the scanner now surfaces on card select (view.single) only. */}

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
// ready" confirmation before the host clears it. With the chain at 20 stages,
// "12/20" alone is high-arousal and low-information — we show the act
// (Frame / Interweave / Decide / Build / Validate) so the user knows which
// scene of the play they're in.
function SpecForgeProgressChip({ progress }: { progress: SpecForgeProgress }) {
  const editor = useEditor();
  const done = progress.phase === "done";
  const pct = Math.round((progress.done / Math.max(1, progress.total)) * 100);
  const actLabel = progress.act ? PHASE_LABEL[progress.act] : null;
  const canJump = done && !!progress.focusShapeId;

  const handleJump = () => {
    if (!canJump || !progress.focusShapeId) return;
    try {
      const id = progress.focusShapeId as TLShapeId;
      editor.select(id);
      editor.zoomToSelection({ animation: { duration: 420 } });
    } catch {
      // Shape was deleted between completion and click — soft-fail.
    }
  };

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
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, minWidth: 0 }}>
        {/* Act header (only while running). Reads like "Act 3 of 5 · Decide" — */}
        {/* gives the user a sense of scene without exposing the 20-stage count. */}
        {!done && actLabel && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: appleVibe.text.faint,
            }}
          >
            <span>{`Act ${progress.actIndex} of ${progress.actTotal}`}</span>
            <span aria-hidden style={{ color: appleVibe.text.faint, opacity: 0.55 }}>·</span>
            <span style={{ color: appleVibe.text.tertiary }}>{actLabel}</span>
          </span>
        )}
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
      {/* Done + we captured the recommendation card's id: offer a one-tap */}
      {/* zoom-to-recommendation. The hero "first build" card is otherwise */}
      {/* buried mid-spine and users routinely miss it. */}
      {canJump && (
        <button
          type="button"
          onClick={handleJump}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: "1px solid var(--glass-border)",
            background: "rgba(15,23,42,0.04)",
            color: appleVibe.text.primary,
            padding: "5px 11px",
            borderRadius: 999,
            fontFamily: appleVibe.font.stack,
            fontSize: 11.5,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "-0.005em",
          }}
        >
          Jump to first build
          <ArrowRight style={{ width: 12, height: 12 }} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

/** The Deep Synthesize / Tech-Spec stage timeline (time-driven, since the
 *  routes are request/response — no SSE). Each entry lights up once elapsed
 *  passes its `atMs`. */
const DEEP_SYNTH_STAGES = [
  { label: "Reading your selection", atMs: 0 },
  { label: "Searching the web", atMs: 2600 },
  { label: "Weaving cross-links", atMs: 13000 },
  { label: "Composing the map", atMs: 21000 },
];

/** Stage timeline for the Tech-Spec hand-off (reuses the same panel). */
const TECH_SPEC_STAGES = [
  { label: "Reading the idea", atMs: 0 },
  { label: "Tracing the mechanism", atMs: 3000 },
  { label: "Designing the build", atMs: 11000 },
  { label: "Writing the spec", atMs: 19000 },
];

/** One stage row: filled-check (done) · spinning ring (active) · dotted ring
 *  (pending). Mirrors the sharpening card's GenerationActivity treatment. */
function DeepStageIcon({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <span
        style={{
          display: "inline-flex",
          width: 16,
          height: 16,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: appleVibe.accent.primary,
          color: "white",
          flexShrink: 0,
        }}
      >
        <Check style={{ width: 10, height: 10 }} strokeWidth={3} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <Loader2
        className="animate-spin"
        style={{ width: 16, height: 16, color: appleVibe.accent.primary, flexShrink: 0 }}
        strokeWidth={2.4}
      />
    );
  }
  return (
    <span
      style={{
        width: 16,
        height: 16,
        borderRadius: 999,
        border: `1.5px dotted ${appleVibe.stroke.soft}`,
        flexShrink: 0,
      }}
    />
  );
}

/** Brief, centered glass error toast when a Deep Synthesize run fails — so the
 *  failure is visible instead of the panel silently vanishing ("nothing
 *  happened"). Host auto-clears it after a few seconds; the selection is kept. */
function DeepSynthErrorChip({ message }: { message: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 88,
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px",
        borderRadius: 16,
        background: "var(--glass-float-bg)",
        backdropFilter: "blur(var(--blur-float)) saturate(1.8)",
        WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.8)",
        border: "1px solid var(--glass-border)",
        boxShadow:
          "inset 0 1px 0 var(--glass-highlight), 0 30px 70px -26px rgba(11,18,40,0.46)",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          width: 24,
          height: 24,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: "rgba(220,38,38,0.12)",
          color: "#DC2626",
          flexShrink: 0,
        }}
      >
        <AlertTriangle style={{ width: 14, height: 14 }} strokeWidth={2.3} />
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: appleVibe.text.primary,
        }}
      >
        {message}
      </span>
    </div>
  );
}

/** Prominent, centered glass progress panel shown while Deep Synthesize (pro
 *  Claude + web search) — or the Tech-Spec hand-off — runs. Self-timed: an
 *  eased progress bar climbs to ~96% over `expectedMs` and the stage checklist
 *  advances on the same clock, so the user always sees that work is underway
 *  (the bottom chip it replaced was easy to miss). The map/cards fork in when
 *  the request resolves and the host unmounts this. */
function DeepSynthProgressChip({
  title = "Deep Synthesize",
  label,
  stages = DEEP_SYNTH_STAGES,
  expectedMs = 26000,
}: {
  title?: string;
  label: string;
  stages?: { label: string; atMs: number }[];
  expectedMs?: number;
}) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    const clock = () =>
      typeof performance !== "undefined" ? performance.now() : Date.now();
    startRef.current = clock();
    const id = window.setInterval(() => {
      setElapsed(clock() - (startRef.current ?? clock()));
    }, 120);
    return () => window.clearInterval(id);
  }, []);

  // Eased, decelerating fill → never reaches 100% until the host unmounts.
  const frac = Math.min(1, elapsed / expectedMs);
  const pct = Math.min(96, Math.round(4 + (1 - Math.pow(1 - frac, 2.2)) * 92));
  // Active stage = the last one whose threshold elapsed has passed.
  let active = 0;
  for (let i = 0; i < stages.length; i++) if (elapsed >= stages[i].atMs) active = i;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 88,
        width: 300,
        padding: "16px 18px 14px",
        borderRadius: 20,
        background: "var(--glass-float-bg)",
        backdropFilter: "blur(var(--blur-float)) saturate(1.8)",
        WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.8)",
        border: "1px solid var(--glass-border)",
        boxShadow:
          "inset 0 1px 0 var(--glass-highlight), 0 30px 70px -26px rgba(11,18,40,0.46)",
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* header — icon · title · live % */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            display: "inline-flex",
            width: 26,
            height: 26,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            background: appleVibe.accent.primary,
            color: "white",
            flexShrink: 0,
          }}
        >
          <Globe style={{ width: 14, height: 14 }} strokeWidth={2.2} />
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13.5,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: appleVibe.text.primary,
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color: appleVibe.accent.primary,
          }}
        >
          {pct}%
        </span>
      </div>

      {/* progress bar */}
      <div
        style={{
          position: "relative",
          height: 4,
          marginTop: 12,
          borderRadius: 999,
          background: "rgba(15,23,42,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            borderRadius: 999,
            background: appleVibe.accent.primary,
            transition: "width 260ms cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      </div>

      {/* stage checklist */}
      <div style={{ marginTop: 13, display: "flex", flexDirection: "column", gap: 9 }}>
        {stages.map((s, i) => {
          const state = i < active ? "done" : i === active ? "active" : "pending";
          return (
            <div
              key={s.label}
              style={{ display: "flex", alignItems: "center", gap: 9 }}
            >
              <DeepStageIcon state={state} />
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: state === "pending" ? 500 : 600,
                  color:
                    state === "pending"
                      ? appleVibe.text.faint
                      : state === "active"
                        ? appleVibe.text.primary
                        : appleVibe.text.tertiary,
                  letterSpacing: "-0.01em",
                }}
              >
                {state === "active" ? label || s.label : s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
