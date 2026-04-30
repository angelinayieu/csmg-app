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
import { CanvasStageIndicator } from "./chrome/canvas-stage-indicator";
import { CanvasLassoSystemButton } from "./chrome/canvas-lasso-system-button";
import { CanvasLassoSubjectButton } from "./chrome/canvas-lasso-subject-button";
import { CanvasSubjectCardSpawner } from "./chrome/canvas-subject-card-spawner";
import { CanvasSubjectCardHydrator } from "./chrome/canvas-subject-card-hydrator";
import { CanvasKgOverviewSpawner } from "./chrome/canvas-kg-overview-spawner";
import { RelaxLayoutButton } from "./chrome/relax-layout-button";

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
}

export const CanvasOverlayPropsContext = createContext<CanvasOverlayProps | null>(null);

function useCanvasOverlayProps(): CanvasOverlayProps {
  const v = useContext(CanvasOverlayPropsContext);
  if (!v) {
    // Defensive default — if InFrontOfTheCanvas mounts before the
    // provider (theoretically possible during a remount), render with
    // empty data so the overlay tree doesn't throw.
    return { spaceId: "", entities: [], edges: [] };
  }
  return v;
}

function CanvasOverlays() {
  const { spaceId, entities, edges } = useCanvasOverlayProps();
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
      <ResearchLibraryChip />
      {/* D8 — KG communities overview chip. Surfaces the modularity-
          greedy partitions the decompose pipeline computed (the
          GraphRAG-style hierarchical communities table). Auto-hides
          when no detection run has populated the table yet. Click a
          row → zooms to that community's entities on canvas. */}
      <CommunitiesChip spaceId={spaceId} />
      <CanvasStageIndicator />
      <CanvasLassoSystemButton spaceId={spaceId} />
      {/* Phase 6C — sibling button: lasso → save-as-subject. Same
          extractor, atomic /from-lasso endpoint creates both the
          scoping System and the Subject in one POST. Spawns the
          SubjectCard via the same window-event bridge. */}
      <CanvasLassoSubjectButton spaceId={spaceId} />
      {/* Phase 4 — bridges the chrome-layer +Subject button (which
          lives outside the editor tree) to editor.createShapes
          inside the tree. Listens for the
          interaxis:spawn-subject-card window event. */}
      <CanvasSubjectCardSpawner spaceId={spaceId} />
      {/* Hydrator counterpart — fetches pre-existing subjects from
          the DB on mount and paints SubjectCard shapes for any that
          aren't already on the canvas. Required for template-
          materialized spaces (where subjects exist as DB rows
          before the canvas is ever opened) and lab-proposal-wizard
          approvals (same situation). Idempotent + filters dupes. */}
      <CanvasSubjectCardHydrator spaceId={spaceId} />
      {/* KG overview — for template-seeded spaces, paints a single
          compact mini-graph (KGFormationShape) summarizing the
          seeded entities + edges with the top-6 hubs and their
          real connecting edges. Replaces the old approach of
          painting every entity as a flat row of cards. Renders
          nothing for non-template spaces (where useSyncEntities
          stays disabled and the pipeline produces shells/synthesis
          cards). Idempotent. */}
      <CanvasKgOverviewSpawner
        spaceId={spaceId}
        entities={entities}
        edges={edges}
      />
      {/* T2.1 — Relax layout button (docs/KG_DEPTH_CRITIQUE.md):
          user-triggered force-directed reflow over the main KG.
          Lives in CanvasOverlays so it has the tldraw editor context
          it needs to read shapes + bindings. Bottom-right above the
          bottom dock so it's discoverable without dominating. */}
      <div
        className="pointer-events-none absolute bottom-20 right-6 z-30"
        aria-label="Layout controls"
      >
        <RelaxLayoutButton />
      </div>
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
