"use client";

// Tldraw overlay layer + the components prop passed to <Tldraw>.
// Extracted from interaxis-canvas.tsx so the main file isn't tracking
// a dozen chrome imports it doesn't otherwise care about.
//
// CRITICAL: CanvasOverlays is module-scope (NOT a per-render closure)
// so its component identity is stable across renders. Previously this
// was a factory that returned a fresh function on every entities/edges
// length change — which caused tldraw to remount the entire overlay
// subtree on every SSE entity arrival, producing the "blank flash"
// during live runs. Per-overlay props (spaceId, entities, edges) flow
// through CanvasOverlayPropsContext so the components prop passed to
// <Tldraw> can be a true module-scope constant. Do not move
// per-render data through props on CanvasOverlays.

import { createContext, useContext } from "react";
import type { Entity, Edge } from "@/types";
import { ThreadTethersOverlay } from "./chrome/thread-tethers-overlay";
import { AppPairTetherOverlay } from "./chrome/app-pair-tether-overlay";
import { CanvasLegendSidebar } from "./chrome/canvas-legend-sidebar";
import { ResearchLibraryChip } from "./chrome/research-library-chip";
import { CommunitiesChip } from "./chrome/communities-chip";
import { CanvasBridgeGapsButton } from "./chrome/canvas-bridge-gaps-button";
import { CanvasPreflightChip } from "./chrome/canvas-preflight-chip";
import { CanvasStageIndicator } from "./chrome/canvas-stage-indicator";
import { CanvasLassoSystemButton } from "./chrome/canvas-lasso-system-button";
import { CanvasLassoSubjectButton } from "./chrome/canvas-lasso-subject-button";
import { CanvasLassoSummarizeButton } from "./chrome/canvas-lasso-summarize-button";
import { CanvasLassoChatButton } from "./chrome/canvas-lasso-chat-button";
import { CanvasSummaryArrowFader } from "./chrome/canvas-summary-arrow-fader";
import { CanvasSummaryCardActions } from "./chrome/canvas-summary-card-actions";
import { CanvasRoomExtendHandler } from "./chrome/canvas-room-extend-handler";
import { LabLeaderboardChip } from "./chrome/lab-leaderboard-chip";
import { CanvasFinalPlanCardBridge } from "./chrome/canvas-final-plan-card-bridge";
import { CanvasStrategyAppFanout } from "./chrome/canvas-strategy-app-fanout";
import { CanvasImageVisionBridge } from "./chrome/canvas-image-vision-bridge";
import { CanvasSubjectCardSpawner } from "./chrome/canvas-subject-card-spawner";
import { CanvasSubjectCardHydrator } from "./chrome/canvas-subject-card-hydrator";
import { CanvasWorkspaceRoomSpawner } from "./chrome/canvas-workspace-room-spawner";
import { CanvasWorkspaceAutoPopulate } from "./chrome/canvas-workspace-auto-populate";
import { CanvasTwinRevealOrchestrator } from "./chrome/canvas-twin-reveal-orchestrator";
import { CanvasActivityTracker } from "./chrome/canvas-activity-tracker";
import {
  CanvasStrategyExpandResponder,
  CanvasEntityGlowResponder,
} from "./chrome/canvas-strategy-orchestration";
import { CanvasSceneDirector } from "./chrome/canvas-scene-director";
import { CanvasKgOverviewSpawner } from "./chrome/canvas-kg-overview-spawner";
import { CanvasOperationalSeedSpawner } from "./chrome/canvas-operational-seed-spawner";
import { CanvasRoomTransitionSpawner } from "./chrome/canvas-room-transition-spawner";
import { CanvasCascadeConnectorSpawner } from "./chrome/canvas-cascade-connector-spawner";
import { RelaxLayoutButton } from "./chrome/relax-layout-button";
import { SHOW_TOP_STAGE_INDICATOR } from "@/lib/whiteboard/canvas-feature-flags";

// Hide tldraw's stock UI — we supply our own chrome (top bar, left tool
// dock, HUD rail, bottom dock, command palette, shortcut help). Leaving
// tldraw's default components ON creates a visually cluttered double-
// toolbar UX.
const HIDDEN_TLDRAW_COMPONENTS = {
  Toolbar: null,
  StylePanel: null,
  PageMenu: null,
  MainMenu: null,
  ActionsMenu: null,
  QuickActions: null,
  HelpMenu: null,
  ZoomMenu: null,
  NavigationPanel: null,
  MenuPanel: null,
  TopPanel: null,
  SharePanel: null,
  MinimapToggle: null,
  Minimap: null,
  HelperButtons: null,
  DebugPanel: null,
  DebugMenu: null,
  KeyboardShortcutsDialog: null,
} as const;

export interface CanvasOverlayProps {
  spaceId: string;
  entities: Entity[];
  edges: Edge[];
  /** Universal-canvas Phase C — when true, this space is the user's
   *  blank workspace canvas (reasoning_settings.is_workspace === true)
   *  and the operational R&D-pipeline overlays / spawners should NOT
   *  mount. Workspaces only host WorkspaceRoomShape rooms; everything
   *  else (8 stage rooms, cascade connectors, KG hydrators, twin reveal,
   *  scene director, etc.) is meaningless without a pipeline run. */
  isWorkspace: boolean;
}

export const CanvasOverlayPropsContext = createContext<CanvasOverlayProps | null>(null);

function useCanvasOverlayProps(): CanvasOverlayProps {
  const v = useContext(CanvasOverlayPropsContext);
  if (!v) {
    // Defensive default — if InFrontOfTheCanvas mounts before the
    // provider (theoretically possible during a remount), render with
    // empty data so the overlay tree doesn't throw.
    return { spaceId: "", entities: [], edges: [], isWorkspace: false };
  }
  return v;
}

function CanvasOverlays() {
  const { spaceId, entities, edges, isWorkspace } = useCanvasOverlayProps();
  return (
    <>
      <ThreadTethersOverlay />
      {/* F4 / D14 — orthogonal flowchart tethers between paired
          downstream apps (Cognitive Game ↔ Cognitive Measurement).
          Mirrors the ThreadTethers pattern but renders solid +
          right-angle paths with rounded corners rather than dashed
          beziers. Solid stroke conveys structural relationship; the
          mid-pill label communicates pair semantics. */}
      <AppPairTetherOverlay spaceId={spaceId} />
      <CanvasLegendSidebar spaceId={spaceId} />
      {/* P4 — Research Library overview chip. Aggregates per-paper
          stats (entities + edges + novel/shared split) into a single
          collapsible chip top-left of the canvas. Auto-hides when
          no asset has produced anything. Click a row → zooms to
          that paper's contributions on canvas. */}
      {!isWorkspace && <ResearchLibraryChip />}
      {/* D8 — KG communities overview chip. Surfaces the modularity-
          greedy partitions the decompose pipeline computed (the
          GraphRAG-style hierarchical communities table). Auto-hides
          when no detection run has populated the table yet. Click a
          row → zooms to that community's entities on canvas. */}
      {!isWorkspace && <CommunitiesChip spaceId={spaceId} />}
      {/* M6 — Mediator Proposal Engine review surface. Auto-hides
          when no proposals are pending. Top-right floating chip;
          click → side drawer with approve/reject per proposal +
          "re-run bridge detection" button. */}
      {!isWorkspace && <CanvasBridgeGapsButton spaceId={spaceId} />}
      {/* Top-left chip surfacing preflight contract status:
            • not-yet-approved → bright "Open preflight" CTA
            • approved + matches → muted "Preflight approved" badge
            • approved + drifted → amber warning to re-approve
          Auto-hides when the space has too few entities for a contract. */}
      {!isWorkspace && <CanvasPreflightChip spaceId={spaceId} />}
      {SHOW_TOP_STAGE_INDICATOR && <CanvasStageIndicator />}
      {!isWorkspace && <CanvasLassoSystemButton spaceId={spaceId} />}
      {/* Phase 6C — sibling button: lasso → save-as-subject. Same
          extractor, atomic /from-lasso endpoint creates both the
          scoping System and the Subject in one POST. Spawns the
          SubjectCard via the same window-event bridge. */}
      {!isWorkspace && <CanvasLassoSubjectButton spaceId={spaceId} />}
      {/* Lasso → Summarize. Mounts to the LEFT of the system+subject
          buttons. Uses the unified shape-content extractor (handles
          all 41 shape types, not just entity-bearing ones), POSTs the
          items to /api/spaces/[id]/lasso-summarize, and on success
          drops a SummaryCardShape below the selection bbox with
          tldraw-arrow connectors back to each source. */}
      <CanvasLassoSummarizeButton spaceId={spaceId} />
      {/* Lasso → Chat. Mounts to the LEFT of the Summarize button.
          Opens a floating chat panel scoped to the current selection —
          the user can ask about patterns, gaps, hypotheses, or next
          steps and get grounded AI responses referencing the actual
          selected items. Self-contained state (no canvas root wiring). */}
      <CanvasLassoChatButton spaceId={spaceId} />
      {/* Tracks selection and dims/un-dims summary connector arrows so
          the fork only "lights up" when the user is interacting with
          the owning card or one of its sources. Returns null. */}
      <CanvasSummaryArrowFader />
      {/* Bridges summary-card:action window events (fired by the
          shape's Regenerate / Decompose / Pin buttons) to actual
          editor mutations + API calls. Mounted once per canvas. */}
      <CanvasSummaryCardActions spaceId={spaceId} />
      {/* Bridges canvas-room:extend-verb events (fired by the
          Room (+) button → CanvasRoomExtendPopover verb pick) to
          concrete sticky-note placements inside the target room.
          Auto-decompose picks up the stickies after IDLE_MS. */}
      <CanvasRoomExtendHandler />
      {/* Top-right chip pinned to the Lab Room. Aggregates variants
          across all apps in this space and pops a panel listing the
          top scorers + their champion status. Self-hides until the
          Lab Room exists on canvas. */}
      {!isWorkspace && <LabLeaderboardChip spaceId={spaceId} />}
      {/* Phase 2 — final-plan card bridge. Listens for
          final-plan-card:spawn (fired by useStrategyAuto.confirm)
          and final-plan-card:action (fired by the shape's header
          buttons + view-mode tabs). Spawns the card, regenerates
          the brief, switches view modes, and paints a flowchart
          when the user clicks the Flowchart tab. */}
      {!isWorkspace && <CanvasFinalPlanCardBridge spaceId={spaceId} />}
      {/* Phase 1.4 — fan-out connectors from the strategy hero card to
          every app card on canvas. Returns null; idempotent across
          re-renders. Arrows are tagged with meta.strategyAppFanout
          so the overlay can clean up stale connectors when shapes
          come and go. */}
      {!isWorkspace && <CanvasStrategyAppFanout spaceId={spaceId} />}
      {/* Two-phase image ingest bridge — listens for the
          ingested-file:vision-{start,complete,error} window events
          fired by useIngest's phase-2 dispatcher and updates the
          matching file-card shape's status badges. On success it
          also calls /api/canvas/materialize-from-image so the
          extracted entities + edges land next to the card. */}
      {!isWorkspace && <CanvasImageVisionBridge spaceId={spaceId} />}
      {/* Phase 4 — bridges the chrome-layer +Subject button (which
          lives outside the editor tree) to editor.createShapes
          inside the tree. Listens for the
          interaxis:spawn-subject-card window event. */}
      {!isWorkspace && <CanvasSubjectCardSpawner spaceId={spaceId} />}
      {/* Universal-canvas Phase A — listens for
          canvas-workspace:add-brainstorm window events from the
          CanvasWorkspaceRoomPicker chrome and spawns a
          WorkspaceRoomShape at the viewport center. First step toward
          making this canvas the universal workspace surface. */}
      <CanvasWorkspaceRoomSpawner />
      {/* Universal-canvas Phase C, Step 1 — on a workspace canvas's
          first ever open, seed brainstorm + strategy rooms (plus the
          provenance arrows between them) so the user sees their
          existing work instead of a blank canvas. Idempotent via
          reasoning_settings.auto_populated_at — runs at most once per
          workspace, ever. Pure side-effect; returns null. */}
      {isWorkspace && <CanvasWorkspaceAutoPopulate spaceId={spaceId} />}
      {/* Cinematic Phase 1 — the "twin is ready" climax. Watches for
          a twin-snapshot (or workspace-room kind=twin) being added to
          the canvas; when one lands, it pauses the painter's
          normal cadence, zooms the camera in, fades a "Your digital
          twin is ready" headline, then pulls back and offers an
          "Open the twin" CTA. Fires once per mount.
          NOTE: kept on workspace so that twin rooms pinned via "+ Add
          room" still trigger the cinematic when added. */}
      <CanvasTwinRevealOrchestrator spaceId={spaceId} />
      {/* Cinematic Phase 3 — chrome dimming during unfurl. Watches
          shape additions in the editor store; when shapes are being
          added in a burst (pipeline materialization, manual auth, etc.)
          sets `data-canvas-unfurl-active="true"` on the body. CSS
          rules in globals.css demote `.chrome-dimmable` tagged
          elements to 40% while the attribute is present. Auto-clears
          on 4 seconds of stillness. */}
      <CanvasActivityTracker />
      {/* Strategy hero card canvas-side expand. Listens for
          `strategy-hero:toggle-expand` from the hero shape, resizes
          the shape between collapsed/expanded footprints, reframes
          the camera, and toggles a body attribute so other canvas
          shapes dim during the expanded state. */}
      {!isWorkspace && <CanvasStrategyExpandResponder />}
      {/* Entity glow responder. When the user hovers a tactic row in
          the expanded strategy hero card, the source entities cited
          by that tactic pulse with a 1.5s glow halo on the canvas.
          Click → camera pans to the first cited entity. This is the
          "trace strategy back to KG" visualization. */}
      {!isWorkspace && <CanvasEntityGlowResponder />}
      {/* Cinematic Phase 4 — scene director. Watches for high-value
          shape spawns (synthesis cards, hypothesis ladders, strategy
          hero card) and queues a per-shape "spotlight" sequence:
          camera zooms to it, holds ~1.5s, returns to fit. Multiple
          spotlights queue up serially so bottleneck → leverage →
          risk read as a narrative sequence rather than landing on
          top of each other. Mutual-exclusion with the twin reveal
          orchestrator via the data-canvas-twin-reveal-active body
          attribute: the director pauses while the twin moment owns
          the camera. */}
      {!isWorkspace && <CanvasSceneDirector />}
      {/* Hydrator counterpart — fetches pre-existing subjects from
          the DB on mount and paints SubjectCard shapes for any that
          aren't already on the canvas. Required for template-
          materialized spaces (where subjects exist as DB rows
          before the canvas is ever opened) and lab-proposal-wizard
          approvals (same situation). Idempotent + filters dupes. */}
      {!isWorkspace && <CanvasSubjectCardHydrator spaceId={spaceId} />}
      {/* KG overview — for template-seeded spaces, paints a single
          compact mini-graph (KGFormationShape) summarizing the
          seeded entities + edges with the top-6 hubs and their
          real connecting edges. Replaces the old approach of
          painting every entity as a flat row of cards. Renders
          nothing for non-template spaces (where useSyncEntities
          stays disabled and the pipeline produces shells/synthesis
          cards). Idempotent. */}
      {!isWorkspace && (
        <CanvasKgOverviewSpawner
          spaceId={spaceId}
          entities={entities}
          edges={edges}
        />
      )}
      {/* Operational view seeder — A4 (operational whiteboard track).
          Reads durable data (twin-proposal ranked_strategies, twin-state
          macro) and reconstructs the persistent strategy-hero-card +
          twin-snapshot shapes if they're not already on the canvas.
          Idempotent + respects user dismissal via localStorage flag,
          matching the existing app-card / kg-overview cascade pattern.
          Universal-canvas Phase C — suppressed on workspace canvases,
          which start blank and only host user-pinned room artifacts. */}
      {!isWorkspace && <CanvasOperationalSeedSpawner spaceId={spaceId} />}
      {/* Room-transition connectors — B1 (operational whiteboard).
          Watches the editor's room shapes; once two consecutive cascade
          rooms exist (intake → landscape → kg → proposal → twin → lab
          → reflexive → results), places an animated arrow between
          them. Re-runs whenever a room is created, moved, or resized.
          Idempotent via deterministic shape IDs. */}
      {!isWorkspace && <CanvasRoomTransitionSpawner spaceId={spaceId} />}
      {/* Cascade artifact connectors — B2 + B3 (operational whiteboard).
          Watches for subject-card / strategy-hero-card / twin-snapshot
          / app-card shapes and draws persistent elbow arrows between
          them so the operational flow reads as
          persona → strategy-hero → twin-snapshot → app-card.
          Bindings track source/target positions automatically. */}
      {!isWorkspace && <CanvasCascadeConnectorSpawner spaceId={spaceId} />}
      {/* T2.1 — Relax layout button (docs/KG_DEPTH_CRITIQUE.md):
          user-triggered force-directed reflow over the main KG.
          Lives in CanvasOverlays so it has the tldraw editor context
          it needs to read shapes + bindings. Bottom-right above the
          bottom dock so it's discoverable without dominating. */}
      {!isWorkspace && (
        <div
          className="pointer-events-none absolute bottom-20 right-6 z-30"
          aria-label="Layout controls"
        >
          <RelaxLayoutButton />
        </div>
      )}
    </>
  );
}
CanvasOverlays.displayName = "CanvasOverlays";

// Module-scope constant — referentially stable across every render of
// InteraxisCanvas. tldraw won't remount its components subtree.
export const CANVAS_TLDRAW_COMPONENTS = {
  ...HIDDEN_TLDRAW_COMPONENTS,
  InFrontOfTheCanvas: CanvasOverlays,
} as const;
