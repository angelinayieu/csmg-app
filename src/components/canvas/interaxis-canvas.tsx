"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Tldraw,
  type Editor,
  type TLArrowShape,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
  createShapeId,
  useValue,
} from "tldraw";
import "tldraw/tldraw.css";

import {
  createStickyAtCenter,
  createThreadOnShape,
  isTypingTarget,
  updateAssetCardStatus,
} from "./interaxis-canvas-helpers";
import type { Entity, Edge, Space } from "@/types";
import { KG_NODE_TIER_SIZE } from "./shapes/kg-node-shape";
import { RunEventStoreProvider } from "./hooks/run-event-store";
// Phase C — popover that opens when a room's (+) button is clicked.
// Listens for `canvas-room:extend` window events; dispatches
// `canvas-room:extend-verb` on selection.
import { CanvasRoomExtendPopover } from "./chrome/canvas-room-extend-popover";
// Aggregated tldraw shape utils. Adding a new custom shape: import
// its util into ./interaxis-canvas-shape-utils and append to the
// array — interaxis-canvas itself doesn't need to know.
import { SHAPE_UTILS } from "./interaxis-canvas-shape-utils";
import type { StickyNoteShape, KGNodeShape, StrategyShape } from "./shapes/types";
// CanvasOverlays + the components prop passed to <Tldraw>. Adding a
// new in-canvas overlay (chip, lasso button, hydrator, etc.) means
// importing it inside ./interaxis-canvas-overlays — interaxis-canvas
// itself only needs the context and the components constant.
import {
  CANVAS_TLDRAW_COMPONENTS,
  CanvasOverlayPropsContext,
  type CanvasOverlayProps,
} from "./interaxis-canvas-overlays";
import { useThreadPersistence } from "./hooks/use-thread-persistence";
import { CardSidecar } from "./sidecar/card-sidecar";
import { toast } from "@/lib/hooks/use-toast";
import { useClusterFrames } from "./hooks/use-cluster-frames";
import { entityToLayerId } from "@/lib/whiteboard/layer-config";
import { PAINT_GLOBAL_GHOST_KG_NODES } from "@/lib/whiteboard/canvas-feature-flags";
import { useSyncEntities } from "./hooks/use-sync-entities";
import { useCanvasPersistence } from "./hooks/use-canvas-persistence";
import { useCanvasAmbient } from "./hooks/use-canvas-ambient";
import { useMaterialize, type MaterializeResponse } from "./hooks/use-materialize";
import { useIngest, looksLikeUrl } from "./hooks/use-ingest";
import { useExtractionReview } from "./hooks/use-extraction-review";
import { ExtractionChecklistDrawer } from "./chrome/extraction-checklist-drawer";
import { useSynthesisSeeder } from "./hooks/use-synthesis-seeder";
import { useClusterNudges } from "./hooks/use-cluster-nudges";
import { useCanvasAcceptReject } from "./hooks/use-canvas-accept-reject";
import { useCanvasProbes } from "./hooks/use-canvas-probes";
import { useAutoDecompose } from "./hooks/use-auto-decompose";
import { useAutoClusterDetect } from "./hooks/use-auto-cluster-detect";
import { useAutoConnect } from "./hooks/use-auto-connect";
import { useRecursiveDecompose } from "./hooks/use-recursive-decompose";
import { useBrainstormSettings } from "@/lib/brainstorm/use-brainstorm-settings";
import {
  BrainstormPanel,
  hasAnyActiveFeature,
} from "./chrome/brainstorm-panel";
import { BrainstormToggleButton } from "./chrome/brainstorm-toggle-button";
import { BrainstormContextProvider } from "./brainstorm-context";
import {
  AdvancedContextPicker,
  type ContextOverride,
} from "./chrome/advanced-context-picker";
import { CanvasTopBar } from "./chrome/canvas-topbar";
import { CanvasCreditChip } from "./chrome/canvas-credit-chip";
import { CanvasToolDock, type CanvasTool } from "./chrome/canvas-tool-dock";
import { CanvasHudRail, type HudRailContext, type HudRailEntity } from "./chrome/canvas-hud-rail";
import { CanvasBottomDock } from "./chrome/canvas-bottom-dock";
import { CanvasGhostChip } from "./chrome/canvas-ghost-chip";
import { CanvasNudgeChip } from "./chrome/canvas-nudge-chip";
import { CanvasCommandPalette, type PaletteCommandId } from "./chrome/canvas-command-palette";
import { CanvasShortcutHelp } from "./chrome/canvas-shortcut-help";
import { ENTITY_DRAG_MIME, type EntityDragPayload } from "./chrome/canvas-asset-drawer";
import {
  STRATEGY_ALTERNATIVE_DRAG_MIME,
  strategyAlternativeShapeIdSeed,
  STRATEGY_ALT_COMPACT_W,
  STRATEGY_ALT_COMPACT_H,
  type StrategyAlternativeDragPayload,
} from "./shapes/strategy-alternative-shape";
import {
  STRATEGY_OBJECTIVE_DRAG_MIME,
  strategyObjectiveShapeIdSeed,
  type StrategyObjectiveDragPayload,
} from "./strategy-objective-drag";
import {
  STRATEGY_OBJECTIVE_COMPACT_W,
  STRATEGY_OBJECTIVE_COMPACT_H,
} from "./shapes/strategy-objective-shape";
import { StrategyCanvasPresenceProvider } from "./strategy-canvas-presence-context";
import type {
  StrategyAlternativeCardShape,
  StrategyObjectiveCardShape,
} from "./shapes/types";
import { CanvasAssetDrawerV2 } from "./chrome/canvas-asset-drawer-v2";
import { CanvasAssetCatalogProvider } from "./library/canvas-asset-catalog-context";
import {
  LIBRARY_ASSET_MIME,
  type LibraryAssetPayload,
} from "./library/types";
import { getAssetClass } from "./library/asset-class-registry";
import { CanvasClusterProposalChip } from "./chrome/canvas-cluster-proposal-chip";
import { CanvasProbabilityRings } from "./chrome/canvas-probability-rings";
import { useProbabilitySpaceChildren } from "./hooks/use-probability-space-children";
import { useCanvasBridges } from "./hooks/use-canvas-bridges";
import { useCanvasCombination } from "./hooks/use-canvas-combination";
import { useReactionLookup, useSaveReaction } from "./hooks/use-reactions";
import { useSpaceReactions } from "./hooks/use-space-reactions";
import { useSpaceSubjectScopes } from "./hooks/use-space-subject-scopes";
import { CanvasSubjectScopesContext } from "./canvas-subject-scopes-context";
import { useAssetDerivedEntities } from "./hooks/use-asset-derived-entities";
import { CanvasAssetDerivedEntitiesContext } from "./canvas-asset-derived-entities-context";
import { CanvasReactionsContext } from "./canvas-reactions-context";
import {
  CanvasHierarchyContext,
  useBuildHierarchyIndex,
} from "./canvas-hierarchy-context";
import { CardConnectModeProvider } from "./card-connect-mode-context";
import {
  AtmosphericZoom,
  type AtmosphericZoomHandle,
} from "@/components/shared/reactor-glass";
import { useRouter as useNextRouter } from "next/navigation";
import {
  setCanvasNavigator,
  setCanvasDispatcher,
  setCanvasExtractionReviewer,
  setCanvasStickyPinner,
} from "@/lib/canvas/canvas-bus";
import { useAIReceipts } from "./hooks/use-ai-receipts";
import {
  CanvasAIReceipts,
  AIReceiptsInlineTrigger,
} from "./chrome/canvas-ai-receipts";
import { CanvasCombinationCard } from "./chrome/canvas-combination-card";
import { useDrawerState } from "./drawers/use-drawer-state";
import { DrawerTriggers } from "./drawers/drawer-triggers";
import { SynthesisDrawer } from "./drawers/synthesis-drawer";
import { IntelligenceDrawer } from "./drawers/intelligence-drawer";
import { InventoryDrawer } from "./drawers/inventory-drawer";
import { TwinDrawer } from "./drawers/twin-drawer";
import { StrategyDrawer } from "./drawers/strategy-drawer";
import { ObjectivesDrawer } from "./drawers/objectives-drawer";
import { ProbabilityDrawer } from "./drawers/probability-drawer";
import { GraphDrawer } from "./drawers/graph-drawer";
import { CanvasEventHud } from "./chrome/canvas-event-hud";
import { WhileYouWaitChip } from "./chrome/while-you-wait-chip";
import { PreliminaryInsightsPanel } from "./chrome/preliminary-insights-panel";
import { CanvasRunSignalsBanner } from "./chrome/canvas-run-signals-banner";
import { CanvasReasoningStream } from "./chrome/canvas-reasoning-stream";
import { CanvasProposalRings } from "./chrome/canvas-proposal-rings";
import { CanvasAnalogRail } from "./chrome/canvas-analog-rail";
import { CanvasRunContextPanel } from "./chrome/canvas-run-context-panel";
import { CanvasChainCompletionBanner } from "./chrome/canvas-chain-completion-banner";
import { CanvasCreditExhaustionBanner } from "./chrome/canvas-credit-exhaustion-banner";
import { CanvasReasoningTracePanel } from "./chrome/canvas-reasoning-trace-panel";
import { StrategyHeroBar } from "./chrome/strategy-hero-bar";
import { CanvasLayerToggle } from "./chrome/canvas-layer-toggle";
import { CanvasProbabilityBadge } from "./chrome/canvas-probability-badge";
import { useLayerFilterState } from "./drawers/use-layer-filter-state";
import { PipelineEventPainter } from "./pipeline-event-painter";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";
import { CanvasErrorBoundary } from "./canvas-error-boundary";
import { EntityDetailDrawer } from "./drawers/entity-detail-drawer";
import { useEntityDetailState } from "./drawers/use-entity-detail-state";
import { EdgeDetailDrawer } from "./drawers/edge-detail-drawer";
import { useEdgeDetailState } from "./drawers/use-edge-detail-state";
import { CycleDetailDrawer } from "./drawers/cycle-detail-drawer";
import { useCycleDetailState } from "./drawers/use-cycle-detail-state";
import { usePathname, useSearchParams } from "next/navigation";
import { useSpaceData } from "@/contexts/space-data-context";



export interface InteraxisCanvasProps {
  space: Space;
  entities: Entity[];
  edges: Edge[];
  /** Additional entities from sibling spaces for the library drawer. */
  libraryEntities?: Entity[];
  /** space_id → display name, used by the library drawer's grouping. */
  libraryspaceNames?: Map<string, string>;
}

export function InteraxisCanvas({
  space,
  entities,
  edges,
  libraryEntities,
  libraryspaceNames,
}: InteraxisCanvasProps) {
  const [editor, setEditor] = useState<Editor | null>(null);

  // Stable context value for the InFrontOfTheCanvas overlay tree.
  // Re-creating the object only when entities/edges length changes is
  // enough — overlays consume length/array contents directly, not the
  // object identity, so this minimizes context-driven re-renders
  // without remounting the overlay components themselves.
  const overlayPropsValue = useMemo<CanvasOverlayProps>(
    () => ({ spaceId: space.id, entities, edges }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [space.id, entities.length, edges.length],
  );
  const [tool, setTool] = useState<CanvasTool>("select");

  // Arc 5A: thread-note persistence. Two-way sync between tldraw
  // ThreadNoteShapes and the shape_threads table. Errors surface via toast.
  useThreadPersistence({
    spaceId: space.id,
    editor,
    onError: (msg) => toast.error("Comment thread sync failed", { description: msg }),
  });
  const [hudCollapsed, setHudCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [decomposing, setDecomposing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [snapOn, setSnapOn] = useState(true);
  const [autoAI, setAutoAI] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [ringsOpen, setRingsOpen] = useState(true);

  // Phase 2D — Brainstorm AI partner: per-space toggleable features
  // (auto-connect / deep search / manual connect / scheduled scan /
  // cluster-to-canvas / cluster-from-notes). Settings persist in
  // localStorage keyed by space id. Only `clusterToCanvas` is wired
  // through to behavior in this phase; other toggles ship with UI
  // + honest status badges and wait for their primitives to land.
  const brainstorm = useBrainstormSettings(space.id);
  const [brainstormPanelOpen, setBrainstormPanelOpen] = useState(false);
  const [advancedContextOpen, setAdvancedContextOpen] = useState(false);
  const [contextOverride, setContextOverride] = useState<ContextOverride | null>(null);
  // Wave 2: URL-param-driven drawers (synthesis / intelligence / inventory).
  // Redirects from deleted standalone pages arrive with ?drawer=&tab= so the
  // drawer opens on first render. Triggers in the top bar toggle the same state.
  const drawerState = useDrawerState();

  // Phase 1 Step 2 — live pipeline run HUD. Driven by ?run=<uuid> so
  // the decompose POST can redirect-or-append the param after starting
  // a run and the canvas picks up the SSE stream automatically.
  const runPathname = usePathname();
  const runSearchParams = useSearchParams();
  const runRouter = useNextRouter();
  const activeRunId = runSearchParams.get("run");
  const dismissRun = useCallback(() => {
    const params = new URLSearchParams(runSearchParams.toString());
    params.delete("run");
    const qs = params.toString();
    runRouter.replace(qs ? `${runPathname}?${qs}` : runPathname, {
      scroll: false,
    });
  }, [runPathname, runSearchParams, runRouter]);

  // When a pipeline run ends, tell the space-data context to re-fetch
  // entities/edges. This triggers useSyncEntities below to paint the
  // authoritative kg-nodes at proper tier positions, replacing the
  // ghost grid the painter was showing during the run.
  const spaceDataCtx = useSpaceData();
  const refreshSpaceEntities = spaceDataCtx.refreshEntities;
  const patchEntitySignature = spaceDataCtx.patchEntitySignature;
  // Counter bumped whenever a pipeline run terminates. Consumed by
  // the credit chip so the balance updates the moment a commit or
  // cancel lands — without this the user sees stale balance until
  // the chip's 30s poll fires.
  const [creditRefreshKey, setCreditRefreshKey] = useState(0);
  const onPipelineRunCompleted = useCallback(() => {
    refreshSpaceEntities().catch((err) =>
      console.warn("[interaxis] refreshEntities failed:", err),
    );
    setCreditRefreshKey((k) => k + 1);
  }, [refreshSpaceEntities]);

  // Gap #13 — live ring growth during streaming runs. The painter fires
  // this every signature_deepened event with the painter's accumulated
  // ring set; we translate camelCase (sourceAxis) → snake_case
  // (source_axis) BasisElement and splice it onto the matching
  // entity in the live store. Constellation widgets / ring overlays
  // re-render against the new node_signature within the same React
  // commit cycle, so the user sees the ring grow without waiting for
  // the post-run refreshEntities() round-trip.
  const onSignatureProgress = useCallback(
    (
      entityId: string,
      snapshot: {
        canonicalCode: string;
        rings: Array<{
          index: number;
          code: string;
          label: string;
          sourceAxis: ProbabilitySpaceAxis | null;
          contribution: number;
          confidence: number;
          controllability: "direct" | "indirect" | "uncontrollable";
        }>;
        residualUncertainty: number;
        version: number;
      },
    ) => {
      const basis = snapshot.rings.map((r) => ({
        index: r.index,
        code: r.code,
        label: r.label,
        source_axis: r.sourceAxis,
        contribution: r.contribution,
        confidence: r.confidence,
        controllability: r.controllability,
      }));
      patchEntitySignature(entityId, {
        canonical_code: snapshot.canonicalCode,
        rings: snapshot.rings.length,
        residual_uncertainty: snapshot.residualUncertainty,
        version: snapshot.version,
        basis,
      });
    },
    [patchEntitySignature],
  );
  const [hoveredRingChildId, setHoveredRingChildId] = useState<string | null>(null);
  const [ringsDecomposeLoading, setRingsDecomposeLoading] = useState(false);
  const [combinationSlot, setCombinationSlot] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // ── Entity lookup (server-loaded entities) ──
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  // ── Library drawer: merged entity list + space-name map ──
  // Pulls current-space entities first, then any extra library entities
  // (sibling spaces for space-scoped canvas, cross-space universe for
  // /app/canvas). Dedupes by UUID.
  const libraryAllEntities = useMemo<Entity[]>(() => {
    if (!libraryEntities || libraryEntities.length === 0) return entities;
    const byId = new Map<string, Entity>();
    for (const e of entities) byId.set(e.id, e);
    for (const e of libraryEntities) if (!byId.has(e.id)) byId.set(e.id, e);
    return Array.from(byId.values());
  }, [entities, libraryEntities]);

  const librarySpaceNames = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    if (libraryspaceNames) for (const [k, v] of libraryspaceNames) m.set(k, v);
    if (!m.has(space.id)) m.set(space.id, space.name);
    return m;
  }, [libraryspaceNames, space.id, space.name]);

  // ── Layer filter (Internal / External / All) ──
  // URL-param backed. When not "all", iterate kg-node shapes and
  // dim the ones whose entity doesn't match the current layer so
  // the user can look at the graph through one lens at a time.
  // Opacity is tldraw's top-level shape prop — cheap, reversible,
  // doesn't touch shape identity so clicks + selection still work.
  const { filter: layerFilter } = useLayerFilterState();
  useEffect(() => {
    if (!editor) return;
    const shapesToUpdate: Array<{ id: import("tldraw").TLShapeId; type: "kg-node"; opacity: number }> = [];
    for (const s of editor.getCurrentPageShapes()) {
      if (s.type !== "kg-node") continue;
      const ks = s as KGNodeShape;
      const entity = entityById.get(ks.props.entityId);
      // knowledge_layer: internal | conceptual | external | bridge.
      // "Internal" view shows internal + conceptual. "External" view
      // shows external + bridge.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layer = (entity as any)?.knowledge_layer as string | null | undefined;
      let matches = true;
      if (layerFilter === "internal") {
        matches = layer === "internal" || layer === "conceptual" || !layer;
      } else if (layerFilter === "external") {
        matches = layer === "external" || layer === "bridge";
      }
      const targetOpacity = matches ? 1 : 0.15;
      if (Math.abs((ks.opacity ?? 1) - targetOpacity) > 0.01) {
        shapesToUpdate.push({ id: ks.id, type: "kg-node", opacity: targetOpacity });
      }
    }
    if (shapesToUpdate.length > 0) {
      editor.updateShapes(shapesToUpdate);
    }
  }, [editor, layerFilter, entityById, entities]);

  // Reactive set of entity UUIDs already placed on the canvas so the
  // drawer can render a check next to those rows.
  const placedEntityIds = useValue<Set<string>>(
    "placed entity ids",
    () => {
      if (!editor) return new Set();
      const ids = new Set<string>();
      for (const s of editor.getCurrentPageShapes()) {
        if (s.type === "kg-node") {
          const eid = (s as KGNodeShape).props.entityId;
          if (eid) ids.add(eid);
        }
      }
      return ids;
    },
    [editor],
  );

  // Phase A1.0 — universal placed-id set for the v2 library drawer.
  // Stringified shape ids so the drawer can `.has(shapeId)` without
  // knowing which class each shape belongs to.
  const placedShapeIds = useValue<Set<string>>(
    "placed shape ids",
    () => {
      if (!editor) return new Set();
      const ids = new Set<string>();
      for (const s of editor.getCurrentPageShapes()) {
        ids.add(s.id);
      }
      return ids;
    },
    [editor],
  );

  // Strategy hero bar — set of (entryRank) values for which a
  // strategy-alternative-card already lives on the canvas. Drives the
  // "ON CANVAS" pill on each hero-bar card.
  const placedStrategyAltRanks = useValue<Set<number>>(
    "placed strategy-alt ranks",
    () => {
      if (!editor) return new Set();
      const ranks = new Set<number>();
      for (const s of editor.getCurrentPageShapes()) {
        if (s.type === "strategy-alternative-card") {
          const rank = (s.props as { entryRank?: unknown }).entryRank;
          if (typeof rank === "number") ranks.add(rank);
        }
      }
      return ranks;
    },
    [editor],
  );

  const handleZoomToStrategyAlt = useCallback(
    (entryRank: number) => {
      if (!editor || !space?.id) return;
      const shapeId = createShapeId(
        strategyAlternativeShapeIdSeed(space.id, entryRank),
      );
      const shape = editor.getShape(shapeId);
      if (shape) {
        editor.select(shapeId);
        editor.zoomToSelection({ animation: { duration: 250 } });
      }
    },
    [editor, space?.id],
  );

  // Strategy drawer ↔ canvas presence — set of CascadeObjective.id
  // values for which a strategy-objective-card lives on the page.
  // Drives the "● ON CANVAS" pill in the cascade view.
  const placedStrategyObjectiveIds = useValue<Set<string>>(
    "placed strategy-objective ids",
    () => {
      if (!editor) return new Set();
      const ids = new Set<string>();
      for (const s of editor.getCurrentPageShapes()) {
        if (s.type === "strategy-objective-card") {
          const oid = (s.props as { objectiveId?: unknown }).objectiveId;
          if (typeof oid === "string") ids.add(oid);
        }
      }
      return ids;
    },
    [editor],
  );

  const handleZoomToStrategyObjective = useCallback(
    (objectiveId: string) => {
      if (!editor || !space?.id) return;
      const shapeId = createShapeId(
        strategyObjectiveShapeIdSeed(space.id, objectiveId),
      );
      const shape = editor.getShape(shapeId);
      if (shape) {
        editor.select(shapeId);
        editor.zoomToSelection({ animation: { duration: 250 } });
      }
    },
    [editor, space?.id],
  );

  const strategyCanvasPresence = useMemo(
    () => ({
      objectiveIds: placedStrategyObjectiveIds,
      zoomToObjective: handleZoomToStrategyObjective,
    }),
    [placedStrategyObjectiveIds, handleZoomToStrategyObjective],
  );

  // ── Sync KG entities + edges into tldraw on first mount ──
  // Disabled on the main whiteboard. Previous behavior seeded every
  // entity onto the canvas as a kg-node shape, producing a flat row
  // of 25-76 cards that crashes tldraw on pan/zoom. Pipeline-driven
  // spaces surface entities inside their owning probability-space-
  // shells; template-seeded spaces surface a single KG-formation
  // card (a compact mini-graph viz with hub circles + connector
  // lines) spawned by canvas-kg-overview-spawner. For full entity
  // browsing, users navigate to /app/space/[id]/entities via the
  // topbar Entities chip, OR open a subject's lab to see the
  // connected KG inside the chamber.
  useSyncEntities(editor, { entities, edges, enabled: false });

  // ── Auto-surface synthesis insights as cards on the canvas ──
  useSynthesisSeeder(editor, { space, entities, enabled: true });

  // ── Server-backed autosave ──
  // Memoize the opts object so the hook's restore-effect doesn't see a
  // brand-new object reference on every render (which would re-fire
  // the effect's cleanup → setup cycle). The internal restoredRef
  // guard already prevents re-restore, but stabilizing the dep is
  // cleaner and avoids any future foot-gun.
  const persistenceOpts = useMemo(
    () => ({ spaceId: space.id, currentRunId: activeRunId }),
    [space.id, activeRunId],
  );
  const { status: saveStatus } = useCanvasPersistence(editor, persistenceOpts);

  // ── Per-ghost predicted edge IDs (for accept/reject) ──
  // Kept in a ref so we don't trigger re-renders on update. Keyed by
  // tldraw shape id.
  const predictedEdgeIdsByShape = useRef(new Map<string, string[]>());

  // ── Fullscreen ──
  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      await el.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── Root-cause tree → entity-ghost focus bridge ─────────────────────
  //
  // The RootCauseTreeShape dispatches a window CustomEvent when a user
  // clicks a node inside its SVG. Listener here resolves the entityId
  // to a kg-node shape on the canvas and pans/zooms to it. Keeps the
  // shape self-contained (no prop drilling of editor / entities) while
  // still hooking the shape clicks into tldraw's viewport system.
  useEffect(() => {
    if (!editor) return;
    const onFocus = (ev: Event) => {
      try {
        const detail = (ev as CustomEvent<{ entityId?: string }>).detail;
        const entityId = detail?.entityId;
        if (!entityId) return;
        // Find any shape on the canvas whose props reference this
        // entity uuid. kg-node shapes carry entityId on their props;
        // other shapes (e.g. proposals) may reference it via
        // targetEntityId. We prefer kg-node matches.
        const shapes = editor.getCurrentPageShapes();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const match = shapes.find((s: any) => {
          const p = s.props ?? {};
          return (
            (s.type === "kg-node" && p.entityId === entityId) ||
            (typeof p.entityId === "string" && p.entityId === entityId)
          );
        });
        if (!match) return;
        // Pan + zoom to the shape. tldraw's zoomToBounds handles
        // smooth animation; we pad a bit so the node isn't flush
        // against the edges.
        const b = editor.getShapePageBounds(match.id);
        if (!b) return;
        editor.zoomToBounds(b, { animation: { duration: 400 }, inset: 140 });
        editor.select(match.id);
      } catch (err) {
        console.warn("[root-cause-tree] focus bridge failed:", err);
      }
    };
    window.addEventListener("root-cause-tree:focus", onFocus as EventListener);
    return () =>
      window.removeEventListener("root-cause-tree:focus", onFocus as EventListener);
  }, [editor]);

  // ── Snap mode (Phase 5) ──
  // Initialize from tldraw user prefs on mount, then push our state down.
  useEffect(() => {
    if (!editor) return;
    setSnapOn(editor.user.getIsSnapMode());
  }, [editor]);

  const toggleSnap = useCallback(() => {
    if (!editor) return;
    const next = !editor.user.getIsSnapMode();
    editor.user.updateUserPreferences({ isSnapMode: next });
    setSnapOn(next);
  }, [editor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      // ⌘K / Ctrl-K → open palette (works even when typing in inputs? keep typing guard)
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (e.key === "f" && !e.metaKey && !e.ctrlKey) {
        toggleFullscreen();
      }
      if (e.key === "l" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setLibraryOpen((v) => !v);
      }
      // Arc 5A: C creates a thread on the selected shape. R replies
      // to a selected thread note (same effect; R is kept as a distinct
      // muscle-memory mapping when you're already inside a thread chain).
      if ((e.key === "c" || e.key === "r") && !e.metaKey && !e.ctrlKey) {
        if (!editor) return;
        const selected = editor.getSelectedShapes();
        if (selected.length !== 1) return;
        // "R" only operates on thread notes
        if (e.key === "r" && selected[0].type !== "thread-note") return;
        e.preventDefault();
        createThreadOnShape(editor, selected[0]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen, editor]);

  // ── Tool dock → tldraw ──
  useEffect(() => {
    if (!editor) return;
    switch (tool) {
      case "select":
        editor.setCurrentTool("select");
        break;
      case "hand":
        editor.setCurrentTool("hand");
        break;
      case "sticky":
        createStickyAtCenter(editor, { text: "" });
        setTool("select");
        break;
      case "shape":
        editor.setCurrentTool("geo");
        break;
      case "arrow":
        editor.setCurrentTool("arrow");
        break;
      case "text":
        editor.setCurrentTool("text");
        break;
      case "draw":
        editor.setCurrentTool("draw");
        break;
      case "library":
        setLibraryOpen((v) => !v);
        setTool("select");
        break;
      case "comment": {
        // Arc 5A: create a thread on the currently-selected shape. If
        // nothing is selected, do nothing — the comment tool only makes
        // sense anchored to a parent shape.
        const selected = editor.getSelectedShapes();
        if (selected.length === 1) {
          createThreadOnShape(editor, selected[0]);
        }
        setTool("select");
        break;
      }
      case "ai":
        setTool("select");
        break;
    }
  }, [editor, tool]);

  // ── Selection (reactive) ──
  const selectedShapes = useValue<TLShape[]>(
    "selected shapes",
    () => (editor ? editor.getSelectedShapes() : []),
    [editor],
  );

  const activeSticky = useMemo<StickyNoteShape | null>(() => {
    const s = selectedShapes.find((x) => x.type === "sticky-note");
    return (s ?? null) as StickyNoteShape | null;
  }, [selectedShapes]);

  const selectedEntity = useMemo<Entity | null>(() => {
    const kgShape = selectedShapes.find((x) => x.type === "kg-node") as KGNodeShape | undefined;
    if (!kgShape) return null;
    return entityById.get(kgShape.props.entityId) ?? null;
  }, [selectedShapes, entityById]);

  // Phase 1 Step 22 — arrow shapes (edges) carry their DB id in the
  // tldraw shape id as `shape:edge-<uuid>` (see useSyncEntities's
  // `shapeIdForEdge`). Parse that back out when an arrow is selected
  // so we can open the edge-detail drawer. Ghost arrows from the
  // painter have non-conforming ids and simply don't match — so
  // users can't open drawers for in-flight ghosts, which is correct.
  const selectedEdgeId = useMemo<string | null>(() => {
    const arrow = selectedShapes.find((x) => x.type === "arrow");
    if (!arrow) return null;
    // tldraw prefixes all ids with "shape:"; stripping that gives
    // "edge-<uuid>" on real edges.
    const raw = String(arrow.id);
    const withoutPrefix = raw.startsWith("shape:") ? raw.slice(6) : raw;
    if (!withoutPrefix.startsWith("edge-")) return null;
    return withoutPrefix.slice("edge-".length) || null;
  }, [selectedShapes]);

  const selectedCycleId = useMemo<string | null>(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cycleShape = selectedShapes.find((x) => x.type === "cycle-loop") as any;
    if (!cycleShape) return null;
    const cid = cycleShape.props?.cycleId;
    return typeof cid === "string" && cid.length > 0 ? cid : null;
  }, [selectedShapes]);

  // ── Entity-detail drawer wiring ──
  // URL-param state drives the drawer so links like
  // `?entity=<uuid>` deep-link a user straight into the detail for
  // that node. Selecting a kg-node on the canvas mirrors its id into
  // the URL — one click to inspect, X button (or empty selection with
  // the param already dropped) to dismiss.
  const {
    entityId: entityDetailId,
    openEntity,
    closeEntity,
  } = useEntityDetailState();
  useEffect(() => {
    if (!selectedEntity) return;
    if (entityDetailId === selectedEntity.id) return;
    openEntity(selectedEntity.id);
  }, [selectedEntity, entityDetailId, openEntity]);

  // ── Edge + cycle drawer wiring (symmetric with entity drawer) ──
  const { edgeId: edgeDetailId, openEdge, closeEdge } = useEdgeDetailState();
  useEffect(() => {
    if (!selectedEdgeId) return;
    if (edgeDetailId === selectedEdgeId) return;
    openEdge(selectedEdgeId);
  }, [selectedEdgeId, edgeDetailId, openEdge]);

  const { cycleId: cycleDetailId, openCycle, closeCycle } = useCycleDetailState();
  useEffect(() => {
    if (!selectedCycleId) return;
    if (cycleDetailId === selectedCycleId) return;
    openCycle(selectedCycleId);
  }, [selectedCycleId, cycleDetailId, openCycle]);

  // ── Ambient AI (Phase 2: real endpoint with debounced fetch) ──
  const ambientText =
    activeSticky?.props.text?.trim() ||
    selectedEntity?.name ||
    "";

  // Gate ambient lookups behind the brainstorm master toggle. When the
  // user disables brainstorming we stop firing network calls for ambient
  // questions/entities so the feature is truly off — not just hidden.
  const { loading: ambientLoading, result: ambient } = useCanvasAmbient({
    spaceId: space.id,
    text: ambientText,
    enabled: brainstorm.settings.enabled && !!(activeSticky || selectedEntity),
  });

  const relatedEntitiesForRail = useMemo<HudRailEntity[]>(() => {
    if (!ambient) return [];
    return ambient.relatedEntities.filter((e) => e.id !== selectedEntity?.id);
  }, [ambient, selectedEntity]);

  // ── Phase 4: LLM-backed probe questions ──
  // Fires only after the user pauses typing. Falls back to ambient's
  // heuristic probes until the LLM result arrives.
  const probeNearby = useMemo(
    () =>
      relatedEntitiesForRail.slice(0, 6).map((e) => ({
        name: e.name,
        description: e.description ?? undefined,
      })),
    [relatedEntitiesForRail],
  );
  // Also gated behind the brainstorm master toggle — probes call the
  // LLM so they should be suppressed when the user turns brainstorm off.
  const { questions: llmProbes, loading: probesLoading } = useCanvasProbes({
    spaceId: space.id,
    text: ambientText,
    nearby: probeNearby,
    enabled: brainstorm.settings.enabled && !!(activeSticky || selectedEntity),
  });
  const displayedQuestions = llmProbes.length > 0 ? llmProbes : ambient?.questions ?? [];

  const hudCtx: HudRailContext = {
    activeShape: activeSticky,
    selectedEntity,
    relatedEntities: relatedEntitiesForRail,
    suggestedQuestions: displayedQuestions,
    canDecompose: !!activeSticky && activeSticky.props.text.trim().length > 0,
    loading: decomposing || ambientLoading || probesLoading,
  };

  // ── Real materialize + ingest + accept/reject ──
  const { materialize } = useMaterialize(space.id);
  // Pass spaceId so /api/ingest attaches uploaded files to this
  // space — required for the HITL extraction-review flow which
  // pivots on space ownership at /preview + /extract auth checks.
  const { ingestUrl, ingestFile } = useIngest(space.id);
  // HITL extraction-review state machine (drawer open, current
  // preview, extract/skip actions). Mounted at canvas root so
  // asset-card shapes can fire it via canvas-bus regardless of
  // their position in the tldraw tree.
  const extractionReview = useExtractionReview();

  // When the preview loads, flip the asset card's badge from
  // "Awaiting review" to "N candidates ready" so the user sees
  // progress without needing to keep the drawer open. Watches
  // both preview presence and assetId so we don't write stale
  // counts onto a card if the user closed and re-opened a
  // different asset's drawer.
  useEffect(() => {
    if (!editor) return;
    const aId = extractionReview.assetId;
    const preview = extractionReview.preview;
    if (!aId || !preview) return;
    updateAssetCardStatus(editor, aId, {
      extractionStatus: "previewed",
      previewCandidateCount: preview.total_count,
    });
  }, [editor, extractionReview.assetId, extractionReview.preview]);
  const { accept: acceptGhost, reject: rejectGhost, pending: ghostPending } =
    useCanvasAcceptReject(space.id);

  // ── Cluster nudges (under-decomposed hubs) ──
  const clusterNudges = useClusterNudges(editor, { entities, edges, enabled: true });
  const [nudgeBusyFor, setNudgeBusyFor] = useState<string | null>(null);

  // Drop a single KG-node shape on the canvas for a materialized entity.
  // If the response contained predicted edges, draw dashed arrows.
  const placeMaterializedEntity = useCallback(
    (
      response: MaterializeResponse,
      atPage: { x: number; y: number },
      sourceShapeId?: StickyNoteShape["id"] | null,
    ) => {
      if (!editor) return;
      const { entity: e, predicted_edges } = response;

      const shapeId = createShapeId(`kg-${e.id}`);
      // If the sync hook already placed this id (rare — fresh id), skip
      if (editor.getShape(shapeId)) return;

      const tier = "support" as const;
      const { TIER_WIDTH, TIER_HEIGHT } = KG_NODE_TIER_SIZE;
      const w = TIER_WIDTH[tier];
      const h = TIER_HEIGHT[tier];

      // Normalize the server's raw layer string (system/domain/thread/...)
      // into the L0-L4 enum the shape validator expects. `entityToLayerId`
      // falls back to "L2" for unknown inputs so we never trip validation.
      const normalizedLayer = entityToLayerId({
        layer: e.layer ?? null,
        entity_category: (e.entity_category as string) ?? null,
      });

      editor.markHistoryStoppingPoint(`materialize-${e.id}`);
      editor.createShape<KGNodeShape>({
        id: shapeId,
        type: "kg-node",
        x: atPage.x - w / 2,
        y: atPage.y - h / 2,
        props: {
          w,
          h,
          entityId: e.id,
          name: e.name,
          description: e.description ?? "",
          layer: normalizedLayer,
          category: (e.entity_category as string) ?? "concrete",
          tier,
          weight: Math.round(((e.confidence ?? 0.7) as number) * 100),
          isLeverage: false,
          isRisk: false,
          isBottleneck: false,
          isConvergence: false,
          isGhost: true, // Phase 3: materialize as ghost, user accepts or rejects.
          confirmedPulse: 0,
        },
      });

      // Remember predicted edge ids for accept/reject
      predictedEdgeIdsByShape.current.set(
        shapeId,
        (predicted_edges ?? []).map((e2) => e2.id),
      );

      // Draw predicted arrows to existing shapes
      for (const edge of predicted_edges ?? []) {
        const otherUuid =
          edge.source_entity_id === e.id ? edge.target_entity_id : edge.source_entity_id;
        const otherShapeId = createShapeId(`kg-${otherUuid}`);
        const other = editor.getShape(otherShapeId);
        if (!other) continue;

        const fromId = edge.source_entity_id === e.id ? shapeId : otherShapeId;
        const toId = edge.target_entity_id === e.id ? shapeId : otherShapeId;
        const arrowId = createShapeId();
        const arrowShape: TLShapePartial<TLArrowShape> = {
          id: arrowId,
          type: "arrow",
          props: {
            color: "grey",
            size: "s",
            dash: "dashed",
          },
        };
        editor.createShapes([arrowShape]);
        try {
          editor.createBindings([
            {
              fromId: arrowId,
              toId: fromId,
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
              toId: toId,
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
        } catch {
          // binding API may have differed — non-fatal
        }
      }

      // Clean up source sticky (optional: keep it). Here we keep the sticky
      // and link it visually via a soft arrow, so the user can see the
      // provenance of the new node.
      if (sourceShapeId) {
        try {
          const linkArrow = createShapeId();
          editor.createShapes([
            {
              id: linkArrow,
              type: "arrow",
              props: { color: "light-violet", size: "s", dash: "dotted" },
            } satisfies TLShapePartial<TLArrowShape>,
          ]);
          editor.createBindings([
            {
              fromId: linkArrow,
              toId: sourceShapeId,
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
              fromId: linkArrow,
              toId: shapeId,
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
        } catch {
          // non-fatal
        }
      }

      editor.select(shapeId);
    },
    [editor],
  );

  // ── Decompose sticky → real entity ──
  const handleDecompose = useCallback(async () => {
    if (!editor || !activeSticky || decomposing) return;
    const text = activeSticky.props.text.trim();
    if (text.length < 3) return;

    setDecomposing(true);
    editor.updateShape<StickyNoteShape>({
      id: activeSticky.id,
      type: "sticky-note",
      props: { aiTagged: true },
    });

    const stickyBounds = editor.getShapePageBounds(activeSticky.id);
    const placement = stickyBounds
      ? { x: Math.round(stickyBounds.maxX + 140), y: Math.round(stickyBounds.midY) }
      : undefined;

    const response = await materialize(text, placement);

    editor.updateShape<StickyNoteShape>({
      id: activeSticky.id,
      type: "sticky-note",
      props: {
        aiTagged: false,
        entityId: response?.entity.id ?? null,
      },
    });

    if (response && placement) {
      placeMaterializedEntity(response, placement, activeSticky.id);
    }

    setDecomposing(false);
  }, [editor, activeSticky, decomposing, materialize, placeMaterializedEntity]);

  // ⌘↵ / Ctrl-↵ → decompose active sticky. Fires even when the sticky's
  // textarea is focused (so the user can type then submit directly).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        if (activeSticky && activeSticky.props.text.trim().length >= 3) {
          e.preventDefault();
          handleDecompose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeSticky, handleDecompose]);

  const handleJumpToEntity = useCallback(
    (entity: HudRailEntity) => {
      if (!editor) return;
      const shapeId = createShapeId(`kg-${entity.id}`);
      const shape = editor.getShape(shapeId);
      if (!shape) return;
      editor.select(shapeId);
      editor.zoomToSelection({ animation: { duration: 300 } });
    },
    [editor],
  );

  const handleAppendQuestion = useCallback(
    (q: string) => {
      if (!editor || !activeSticky) return;
      const merged = activeSticky.props.text
        ? `${activeSticky.props.text}\n\n${q}`
        : q;
      editor.updateShape<StickyNoteShape>({
        id: activeSticky.id,
        type: "sticky-note",
        props: { text: merged },
      });
    },
    [editor, activeSticky],
  );

  // ── Phase 9a/b: Probability-space rings (now multi-selection aware) ──
  // For every selected KG entity, anchor a rings overlay at its shape
  // midpoint. Multi-select is the canonical trigger for intersection
  // analysis: when two cards are both selected, we compute shared
  // indicators between their probability spaces and draw a bridge arc.
  const ringsAnchors = useValue(
    "rings anchors",
    () => {
      if (!editor) return [];
      // Architecture redesign — kg-node selection-based ring overlays
      // are dead in the new architecture (no kg-node ghosts on the
      // global canvas). Short-circuit so we don't waste a per-tick
      // iteration on shapes that won't exist. The Phase 1 mini-graph
      // inside each shell already shows entity weight + degree, and
      // the entity-detail drawer's ego view (Phase 6) renders the
      // upstream/downstream picture per entity. The "ring overlay
      // anchored to multi-selected kg-nodes" UX is superseded by
      // those two surfaces.
      if (!PAINT_GLOBAL_GHOST_KG_NODES) return [];
      const sel = editor.getSelectedShapes();
      const rect = rootRef.current?.getBoundingClientRect();
      const cam = editor.getCamera();
      const anchors: Array<{
        screenX: number;
        screenY: number;
        zoom: number;
        entityId: string;
        shapeId: string;
      }> = [];
      for (const s of sel) {
        if (s.type !== "kg-node") continue;
        const kg = s as KGNodeShape;
        const bounds = editor.getShapePageBounds(kg.id);
        if (!bounds) continue;
        const screen = editor.pageToScreen({ x: bounds.midX, y: bounds.midY });
        anchors.push({
          screenX: screen.x - (rect?.left ?? 0),
          screenY: screen.y - (rect?.top ?? 0),
          zoom: cam.z,
          entityId: kg.props.entityId,
          shapeId: kg.id as string,
        });
      }
      return anchors;
    },
    [editor],
  );

  // Primary anchor = first selected KG node. Used for hover-trace dim
  // (which takes a single "parent context") and decompose-more actions.
  const ringsAnchor = ringsAnchors[0] ?? null;
  const ringsParent = useMemo<Entity | null>(() => {
    if (!ringsAnchor) return null;
    return entityById.get(ringsAnchor.entityId) ?? null;
  }, [ringsAnchor, entityById]);

  const ringsTree = useProbabilitySpaceChildren({
    parent: ringsParent,
    allEntities: libraryAllEntities,
  });

  // Trees for ALL selected KG entities (for multi-select rings rendering).
  const ringsTrees = useMemo(() => {
    return ringsAnchors
      .map((a) => {
        const parent = entityById.get(a.entityId);
        if (!parent) return null;
        const byParent = new Map<string, Entity[]>();
        for (const e of libraryAllEntities) {
          const prov = e.provenance as { parent_entity_id?: string | null } | null;
          const pid = prov?.parent_entity_id;
          if (!pid) continue;
          if (!byParent.has(pid)) byParent.set(pid, []);
          byParent.get(pid)!.push(e);
        }
        const directChildren = byParent.get(parent.id) ?? [];
        return {
          anchor: a,
          tree: {
            parent,
            children: directChildren.map((c) => ({
              entity: c,
              relationship: null,
              grandchildren: byParent.get(c.id) ?? [],
            })),
            isEmpty: directChildren.length === 0,
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [ringsAnchors, entityById, libraryAllEntities]);

  // ── Phase 9b.3: Shared-indicator bridges ──
  // For every pair of selected KG rings, find indicator children shared
  // between them (either same entity_id or same normalized name). Each
  // match becomes a bridge arc between the two rings.
  const ringBridges = useMemo(() => {
    if (ringsTrees.length < 2) return [] as Array<{
      fromAnchor: (typeof ringsAnchors)[number];
      toAnchor: (typeof ringsAnchors)[number];
      sharedName: string;
    }>;

    const out: Array<{
      fromAnchor: (typeof ringsAnchors)[number];
      toAnchor: (typeof ringsAnchors)[number];
      sharedName: string;
    }> = [];

    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

    for (let i = 0; i < ringsTrees.length; i++) {
      const a = ringsTrees[i];
      const aNames = new Map<string, string>();
      for (const c of a.tree.children) {
        aNames.set(norm(c.entity.name), c.entity.name);
        aNames.set(c.entity.id, c.entity.name);
      }
      for (let j = i + 1; j < ringsTrees.length; j++) {
        const b = ringsTrees[j];
        for (const c of b.tree.children) {
          if (aNames.has(norm(c.entity.name)) || aNames.has(c.entity.id)) {
            out.push({
              fromAnchor: a.anchor,
              toAnchor: b.anchor,
              sharedName: c.entity.name,
            });
            break; // one bridge per pair is enough visually
          }
        }
      }
    }

    return out;
  }, [ringsTrees, ringsAnchors]);

  const handleRingChildClick = useCallback(
    (e: Entity, shiftKey: boolean) => {
      if (shiftKey) {
        // Phase 9c.2: toggle membership in the combination slot.
        setCombinationSlot((prev) => {
          if (prev.includes(e.id)) return prev.filter((x) => x !== e.id);
          if (prev.length >= 4) return [...prev.slice(1), e.id];
          return [...prev, e.id];
        });
        return;
      }
      if (!editor) return;
      const shapeId = createShapeId(`kg-${e.id}`);
      const shape = editor.getShape(shapeId);
      if (shape) {
        editor.select(shapeId);
        editor.zoomToSelection({ animation: { duration: 300 } });
      }
    },
    [editor],
  );

  const combinationSlotSet = useMemo(() => new Set(combinationSlot), [combinationSlot]);

  // Phase 9c.2: Interpret the current combination slot via LLM.
  const { result: combinationResult, loading: combinationLoading, error: combinationError } =
    useCanvasCombination({ spaceId: space.id, entityIds: combinationSlot });

  // Phase 11: lookup persisted Reaction for this slot; save action.
  const { reaction: savedReaction } = useReactionLookup({
    spaceId: space.id,
    entityIds: combinationSlot,
    enabled: combinationSlot.length >= 2,
  });
  const { save: saveReaction, saving: savingReaction } = useSaveReaction();
  // Local flag flips to `true` optimistically right after save so the card
  // reflects the change before the lookup round-trips.
  const [recentlySavedKey, setRecentlySavedKey] = useState<string | null>(null);

  // Phase 30: space-wide reaction index. Every KG node card reads from
  // this via CanvasReactionsContext to render a reaction badge. Refresh
  // key advances after every save so the canvas immediately reflects new
  // reactions without a page reload.
  const [reactionsRefreshKey, setReactionsRefreshKey] = useState(0);
  const reactionsIndex = useSpaceReactions(space.id, reactionsRefreshKey);
  const reactionsContextValue = useMemo(
    () => ({ spaceId: space.id, index: reactionsIndex }),
    [space.id, reactionsIndex],
  );

  // F2 / D14 — subject-scope index. Per-entity map of "which Twins
  // (Subjects) scope this entity?" so kg-node-shape can render scope
  // rings indicating Twin participation. Mirrors the reactions pattern.
  const [subjectScopesRefreshKey] = useState(0);
  const subjectScopesIndex = useSpaceSubjectScopes(
    space.id,
    subjectScopesRefreshKey,
  );
  const subjectScopesContextValue = useMemo(
    () => ({ spaceId: space.id, index: subjectScopesIndex }),
    [space.id, subjectScopesIndex],
  );

  // P1 / D14 — asset-derived-entities index. Per-asset list of
  // entities extracted from each asset (PDF, dataset, etc.). Consumed
  // by AssetCardShape's "👁 highlight on canvas" button.
  const [assetDerivedRefreshKey] = useState(0);
  const assetDerivedIndex = useAssetDerivedEntities(
    space.id,
    assetDerivedRefreshKey,
  );
  const assetDerivedContextValue = useMemo(
    () => ({ spaceId: space.id, index: assetDerivedIndex }),
    [space.id, assetDerivedIndex],
  );

  // Phase 32: per-entity hierarchy index. Lets every KG node card show a
  // depth glyph indicating how many decomposed proxy indicators live
  // inside it — so the "every entity is an opening into a probability
  // space" claim reads visibly at rest, not only on click. Built from
  // the entity list already in memory; no new fetch.
  const hierarchyContextValue = useBuildHierarchyIndex(entities);

  // Phase 44: AI receipts — local ledger of what the AI did in this
  // space. Wired into decompose + ingest call sites below so any
  // auto-action produces a dismissable receipt in the drawer.
  const aiReceipts = useAIReceipts(space.id);
  // Phase 48: hoist open/close so the trigger can live in the top bar.
  const [aiReceiptsOpen, setAiReceiptsOpen] = useState(false);

  // Phase 48: quiet-mode — hide all overlay chrome so the whiteboard
  // feels like a clean Miro canvas. Toggled with `Q`. Leaves the tool
  // dock visible (it's the core verb) but hides the top bar, HUD rail,
  // bottom dock, AI Receipts trigger, nudges, palette chips. A small
  // restore chip appears top-right so users can get back out.
  const [quietMode, setQuietMode] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "q" && e.key !== "Q") return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      ) {
        return; // don't hijack key in text fields
      }
      e.preventDefault();
      setQuietMode((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Phase 34: atmospheric-zoom handshake for canvas → lab. When the user
  // clicks a Lab chip on the probability rings, we bloom a radial dark
  // scrim from the click point, then navigate ~300ms later so the
  // transition reads as "zooming into" the specimen rather than a page
  // swap. Route-level view transitions (Next.js) would be nicer, but
  // this works cross-browser today.
  const atmosphericZoomRef = useRef<AtmosphericZoomHandle | null>(null);
  const nextRouter = useNextRouter();
  const handleLabNavigate = useCallback(
    (href: string, clientX: number, clientY: number) => {
      const handle = atmosphericZoomRef.current;
      if (!handle) {
        // Primitive not mounted — let the link navigate normally.
        return false;
      }
      handle.show(clientX, clientY);
      // Give the scrim one frame to paint, then kick off navigation.
      // Next handles the actual page swap; the scrim fades out when
      // the canvas unmounts.
      window.setTimeout(() => {
        nextRouter.push(href);
      }, 320);
      return true;
    },
    [nextRouter],
  );

  // Sprint B.5 — register the canvas bus hooks so tldraw shape utils
  // (DownstreamRealityShapeUtil, VariantCarouselShapeUtil, etc.) can
  // navigate + dispatch without holding a React hook. Shape-class
  // `onDoubleClick` handlers fire outside the React tree, so they
  // can't call `useRouter()`; they call `canvasNavigate()` instead,
  // which routes through the singleton we register here.
  //
  // Dispatcher routes by actionKey:
  //   • activate   → POST /api/experiment-variants/[variantId]/activate
  //                  (variant carousel double-click in the canvas
  //                  actually flips is_active in the DB now)
  //   • focus      → navigate to /app/space/:id/app/:appId
  //                  (focus_variant maps to "open the detail page")
  //   • everything else → {ok:false, reason:"unhandled-on-canvas"}
  //
  // Any thrown error inside the dispatcher is caught by canvas-bus and
  // returned as {ok:false, reason} — widgets can surface failure state
  // without their own try/catch.
  useEffect(() => {
    const unregisterNav = setCanvasNavigator((href) => {
      nextRouter.push(href);
    });
    // HITL extraction-review trigger — asset-card shapes call
    // canvasOpenExtractionReview() to open the drawer for review.
    // Registered alongside nav + dispatch so the canvas-bus contract
    // stays single-host. Cleanup on unmount in the same return below.
    const unregisterReviewer = setCanvasExtractionReviewer((input) => {
      void extractionReview.open(input);
    });
    // Sticky-pinner — strategy drawer + other chrome panels can pin
    // highlighted text onto the canvas as a yellow sticky. AutoDecompose
    // picks it up after its standard idle window; the user gets ghost
    // KG nodes appearing nearby a few seconds later.
    const unregisterStickyPinner = setCanvasStickyPinner(({ text }) => {
      if (!editor) return;
      createStickyAtCenter(editor, { text, color: "yellow" });
    });
    const unregisterDispatch = setCanvasDispatcher(async (call) => {
      const { actionKey, payload, spaceId, appId } = call;
      if (actionKey === "activate") {
        const variantId = (payload as { variantId?: string } | undefined)
          ?.variantId;
        if (!variantId) {
          return { ok: false, reason: "missing-variantId" };
        }
        try {
          const res = await fetch(
            `/api/experiment-variants/${variantId}/activate`,
            { method: "POST" },
          );
          if (!res.ok) {
            return { ok: false, reason: `http-${res.status}` };
          }
          return { ok: true };
        } catch (err) {
          return {
            ok: false,
            reason: err instanceof Error ? err.message : "fetch-threw",
          };
        }
      }
      if (actionKey === "focus") {
        // focus_variant on the canvas is a navigation: open the app
        // detail page where the full carousel + dispatcher lives.
        if (spaceId && appId) {
          nextRouter.push(`/app/space/${spaceId}/app/${appId}`);
          return { ok: true };
        }
        return { ok: false, reason: "no-app-route" };
      }
      return { ok: false, reason: "unhandled-on-canvas" };
    });
    return () => {
      unregisterNav();
      unregisterDispatch();
      unregisterReviewer();
      unregisterStickyPinner();
    };
    // extractionReview.open is stable across renders (useCallback in
    // the hook); intentionally NOT in deps so we don't re-register on
    // every render. nextRouter is stable per Next 16's app router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextRouter, editor]);

  // Phase 31: return-from-lab focus. The lab's Exit button writes
  // `?focus=<entityId>&rings=1` into the canvas URL. On mount we read
  // that, select the shape, zoom to it, and open its probability rings
  // so the user lands back on the canvas with the same context they
  // left with — closes the fractal navigation loop. The URL is cleaned
  // after applying so a page refresh doesn't re-focus indefinitely.
  const focusAppliedRef = useRef(false);
  useEffect(() => {
    if (!editor || focusAppliedRef.current) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const focusId = params.get("focus");
    const ringsFlag = params.get("rings") === "1";
    if (!focusId) return;
    const shapeId = createShapeId(`kg-${focusId}`);
    const shape = editor.getShape(shapeId);
    if (!shape) {
      // Entities might still be syncing into tldraw. Try again after a
      // few frames before giving up (max ~1.5s). This is bounded so we
      // never loop forever on a bad id.
      const start = performance.now();
      const retry = () => {
        if (!editor) return;
        const found = editor.getShape(shapeId);
        if (found) applyFocus();
        else if (performance.now() - start < 1500) requestAnimationFrame(retry);
        else focusAppliedRef.current = true;
      };
      requestAnimationFrame(retry);
      return;
    }
    applyFocus();

    function applyFocus() {
      if (!editor) return;
      focusAppliedRef.current = true;
      editor.select(shapeId);
      try {
        editor.zoomToSelection({ animation: { duration: 320 } });
      } catch {
        /* zoom unsupported in some tldraw setups — selection alone is fine */
      }
      if (ringsFlag) setRingsOpen(true);
      // Strip the params so refresh is idempotent.
      const cleaned = new URLSearchParams(window.location.search);
      cleaned.delete("focus");
      cleaned.delete("rings");
      const qs = cleaned.toString();
      const nextUrl =
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState(null, "", nextUrl);
    }
  }, [editor, entities]);
  const combinationSlotKey = combinationSlot.slice().sort().join("|");
  const combinationIsSaved =
    !!savedReaction || recentlySavedKey === combinationSlotKey;

  const handleSaveReaction = useCallback(async () => {
    if (!combinationResult || combinationSlot.length < 2) return;
    const saved = await saveReaction({
      spaceId: space.id,
      name: combinationResult.title,
      reactionType: combinationResult.novelty,
      entityIds: combinationSlot,
      probability: 0.7,
      mechanism: combinationResult.mechanism ?? null,
      implication: combinationResult.implication ?? null,
      probes: combinationResult.probes ?? null,
      sourceTag: "llm",
      provenance: {
        source_endpoint: "/api/canvas/combination",
        source_entities: combinationResult.source_entities.map((e) => e.id),
        saved_at: new Date().toISOString(),
      },
    });
    if (saved) {
      setRecentlySavedKey(combinationSlotKey);
      // Phase 30: bump so the space-wide reactions index re-fetches and
      // the new reaction's badge appears on the participating cards.
      setReactionsRefreshKey((k) => k + 1);
    }
  }, [combinationResult, combinationSlot, saveReaction, space.id, combinationSlotKey]);

  // Reset optimistic "saved" flag when the slot changes
  useEffect(() => {
    setRecentlySavedKey(null);
  }, [combinationSlotKey]);

  // Clear slot when rings close
  useEffect(() => {
    if (!ringsOpen) setCombinationSlot([]);
  }, [ringsOpen]);

  // Phase 9c.1: Cross-space semantic bridges for the primary selected KG.
  const { bridges: semanticBridges, loading: bridgesLoading } = useCanvasBridges({
    spaceId: space.id,
    entityId: ringsOpen ? ringsParent?.id ?? null : null,
    enabled: !!ringsParent,
  });
  void bridgesLoading;

  // ── Phase 9b.1: Hover-trace canvas dim ──
  // When a ring segment is hovered, dim every canvas shape that isn't a
  // "member" of the reasoning trace (the parent shape, the indicator
  // shape, and any arrows bound between them). Uses tldraw's `run` with
  // history=ignore so hover doesn't pollute undo.
  useEffect(() => {
    if (!editor) return;

    const allShapes = editor.getCurrentPageShapes();

    if (!hoveredRingChildId || !ringsParent) {
      // Reset all opacities in one batch
      const needsReset = allShapes.filter((s) => s.opacity !== 1);
      if (needsReset.length === 0) return;
      editor.run(
        () => {
          // tldraw's discriminated-union inference breaks past ~20 shape
          // types in the registry (A1.4b pushed us there). This update
          // only writes `opacity` — a base shape prop shared by every
          // variant — so we cast to the broadest Parameters<...> type.
          editor.updateShapes(
            needsReset.map((s) => ({
              id: s.id,
              type: s.type,
              opacity: 1,
            })) as Parameters<typeof editor.updateShapes>[0],
          );
        },
        { history: "ignore" },
      );
      return;
    }

    const parentShapeId = createShapeId(`kg-${ringsParent.id}`);
    const childShapeId = createShapeId(`kg-${hoveredRingChildId}`);

    // Member set: parent, child, plus any arrows bound between them
    const memberIds = new Set<string>([
      parentShapeId as string,
      childShapeId as string,
    ]);

    // Find arrows that bridge parent and child
    try {
      const parentBindings = editor.getBindingsToShape(parentShapeId, "arrow");
      const childBindings = editor.getBindingsToShape(childShapeId, "arrow");
      const parentArrows = new Set(parentBindings.map((b) => b.fromId as string));
      for (const b of childBindings) {
        if (parentArrows.has(b.fromId as string)) {
          memberIds.add(b.fromId as string);
        }
      }
    } catch {
      /* binding API may not be present — non-fatal */
    }

    const updates = allShapes
      .map((s) => {
        const isMember = memberIds.has(s.id as string);
        const targetOpacity = isMember ? 1 : 0.22;
        if (s.opacity === targetOpacity) return null;
        return { id: s.id, type: s.type, opacity: targetOpacity };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (updates.length === 0) return;
    editor.run(
      () => {
        // Same cast rationale as above — opacity-only, shared prop.
        editor.updateShapes(
          updates as Parameters<typeof editor.updateShapes>[0],
        );
      },
      { history: "ignore" },
    );
  }, [editor, hoveredRingChildId, ringsParent]);

  const handleRingDecomposeMore = useCallback(async () => {
    if (!editor || !ringsParent || ringsDecomposeLoading) return;
    setRingsDecomposeLoading(true);
    try {
      const res = await fetch("/api/canvas/recursive-decompose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: space.id, entityId: ringsParent.id }),
      });
      if (!res.ok) return;
      // Phase 44 — log a receipt before the reload; localStorage
      // persists across the reload so it's visible in the drawer
      // immediately after the new children render.
      try {
        const data = (await res.json().catch(() => null)) as {
          children?: Array<{ id: string; name?: string }>;
        } | null;
        const newIds = data?.children?.map((c) => c.id) ?? [];
        aiReceipts.log({
          kind: "decompose",
          title: `Decomposed "${ringsParent.name}"`,
          detail:
            newIds.length > 0
              ? `Produced ${newIds.length} proxy ${newIds.length === 1 ? "indicator" : "indicators"}.`
              : "No new subunits discovered.",
          entity_ids: [ringsParent.id, ...newIds],
          undoable: newIds.length > 0,
          // Phase 46 — undo removes the children we just created; the
          // parent is preserved (it existed before this action).
          undo_target_ids: newIds,
        });
      } catch {
        /* receipt is best-effort; never block the reload */
      }
      window.location.reload();
    } finally {
      setRingsDecomposeLoading(false);
    }
  }, [editor, ringsParent, ringsDecomposeLoading, space.id, aiReceipts]);

  // Escape closes the rings overlay for the current selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ringsOpen && !paletteOpen && !helpOpen) {
        setRingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ringsOpen, paletteOpen, helpOpen]);

  // When the user clicks a different shape, re-open rings automatically.
  useEffect(() => {
    if (ringsParent) setRingsOpen(true);
  }, [ringsParent]);

  // ── Ghost accept/reject (Phase 3) ──
  const activeGhost = useMemo<KGNodeShape | null>(() => {
    const g = selectedShapes.find(
      (s) => s.type === "kg-node" && (s as KGNodeShape).props.isGhost,
    ) as KGNodeShape | undefined;
    return g ?? null;
  }, [selectedShapes]);

  // Palette disabled-state — reactive on selection.
  const paletteCommandsState = useMemo(
    () => ({
      "decompose-active": activeSticky
        ? undefined
        : { disabled: true, disabledReason: "Select a sticky note first" },
      "group-selection":
        selectedShapes.length >= 2
          ? undefined
          : { disabled: true, disabledReason: "Select 2+ shapes first" },
    }),
    [activeSticky, selectedShapes.length],
  );

  // Ghost chip screen position (reactive to camera + shape)
  const ghostChipScreenPos = useValue(
    "ghost chip screen pos",
    () => {
      if (!editor || !activeGhost) return null;
      const bounds = editor.getShapePageBounds(activeGhost.id);
      if (!bounds) return null;
      return editor.pageToScreen({ x: bounds.midX, y: bounds.minY });
    },
    [editor, activeGhost?.id],
  );

  const handleAcceptGhost = useCallback(async () => {
    if (!editor || !activeGhost) return;
    const shapeId = activeGhost.id;
    const edgeIds = predictedEdgeIdsByShape.current.get(shapeId) ?? [];
    const ok = await acceptGhost(activeGhost.props.entityId, edgeIds);
    if (!ok) return;
    editor.markHistoryStoppingPoint(`accept-${activeGhost.props.entityId}`);
    editor.updateShape<KGNodeShape>({
      id: shapeId,
      type: "kg-node",
      props: { isGhost: false },
    });
    predictedEdgeIdsByShape.current.delete(shapeId);
  }, [editor, activeGhost, acceptGhost]);

  const handleRejectGhost = useCallback(async () => {
    if (!editor || !activeGhost) return;
    const shapeId = activeGhost.id;
    const edgeIds = predictedEdgeIdsByShape.current.get(shapeId) ?? [];
    const ok = await rejectGhost(activeGhost.props.entityId, edgeIds);
    if (!ok) return;
    editor.markHistoryStoppingPoint(`reject-${activeGhost.props.entityId}`);
    // Remove any arrow shapes bound to this shape, then the shape itself
    const bindings = editor.getBindingsToShape(shapeId, "arrow");
    const arrowIds = bindings.map((b) => b.fromId);
    if (arrowIds.length > 0) editor.deleteShapes(arrowIds);
    editor.deleteShapes([shapeId]);
    predictedEdgeIdsByShape.current.delete(shapeId);
  }, [editor, activeGhost, rejectGhost]);

  // ── Cluster nudge → decompose hub ──
  const handleNudgeDecompose = useCallback(
    async (entityUuid: string, name: string) => {
      if (!editor || nudgeBusyFor) return;
      setNudgeBusyFor(entityUuid);
      const shapeId = createShapeId(`kg-${entityUuid}`);
      const bounds = editor.getShapePageBounds(shapeId);
      const placement = bounds
        ? { x: Math.round(bounds.midX), y: Math.round(bounds.maxY + 160) }
        : undefined;
      const response = await materialize(
        `Decompose "${name}": identify 2-3 concrete sub-components or mechanisms.`,
        placement,
      );
      if (response && placement) placeMaterializedEntity(response, placement);
      setNudgeBusyFor(null);
    },
    [editor, nudgeBusyFor, materialize, placeMaterializedEntity],
  );

  // ── Phase 6.1 + 8.1: Auto-decompose on idle (stickies + hubs) ──
  //
  // Stickies the user has typed into but left idle auto-fire into a
  // real KG node via handleDecompose (which uses the same materialize
  // → ghost → accept/reject flow as the manual Decompose button, but
  // with the active sticky selected).
  const { state: autoAIState, lastTargetName: autoAILastTarget } = useAutoDecompose({
    editor,
    enabled: autoAI,
    nudges: clusterNudges,
    fireHub: async (n) => {
      await handleNudgeDecompose(n.entityId, n.name);
    },
    fireSticky: async (shape) => {
      if (!editor) return;
      // Route through the same materialize pipeline handleDecompose
      // uses, so ghost + predicted edges + sticky-tagging all apply.
      editor.setSelectedShapes([shape.id]);
      // handleDecompose reads `activeSticky` from selection — give the
      // reactive subscription a tick to catch up before we fire.
      await new Promise((r) => setTimeout(r, 50));
      await handleDecompose();
    },
  });

  // ── Phase 8.2: Recursive decomposition ──
  //
  // When Auto-AI is on, newly-materialized ghost KG nodes (from sticky
  // decompose, drop-to-analyze, etc.) get a second-pass decomposition
  // into 2-3 proxy indicators — ghost children arc'd below the parent.
  // Depth-capped at 2 so we don't runaway-chain.
  const initialEntityIdSet = useMemo(
    () => new Set(entities.map((e) => e.id)),
    [entities],
  );
  useRecursiveDecompose({
    editor,
    spaceId: space.id,
    enabled: autoAI,
    initialSkipIds: initialEntityIdSet,
  });

  // ── Cluster frames (Phase 5) ──
  const { createCluster } = useClusterFrames(editor);
  const handleGroupSelection = createCluster;

  // ── Auto-cluster proposals (Phase 7) ──
  // Active when Auto-AI is on. Detects 3+ spatially close KG nodes that
  // aren't already in a cluster and surfaces a single "Cluster these N"
  // chip near the centroid. Dismissed proposals remembered per-session
  // by the set of member shape ids so they don't re-pop instantly.
  const [dismissedClusters, setDismissedClusters] = useState<Set<string>>(new Set());
  // Phase 2D — the `clusterToCanvas` brainstorm toggle is the first
  // feature wired through to behavior. When either the legacy autoAI
  // flag is on OR the user has explicitly enabled brainstorm +
  // cluster-to-canvas, the prospector runs. Either path produces the
  // same proposals; the brainstorm panel just gives users explicit
  // control.
  const clusterDetectEnabled =
    autoAI ||
    (brainstorm.settings.enabled && brainstorm.settings.clusterToCanvas);
  const rawProposals = useAutoClusterDetect(editor, clusterDetectEnabled);

  // Phase 2D — the `autoConnect` brainstorm toggle. Scans sticky
  // pairs by local lexical similarity (Jaccard on tokenized text)
  // and auto-materializes dashed gray arrows for thematic overlaps.
  // Pure local compute — zero network cost. Debounced 2s after last
  // edit so scans don't fire on every keystroke.
  useAutoConnect({
    editor,
    enabled: brainstorm.settings.enabled && brainstorm.settings.autoConnect,
  });

  // ── "Why connected" tooltip for auto-connect arrows ────────────────
  // Polls the tldraw hovered shape ID and reads meta from the shape to
  // show a small overlay explaining the connection when the user hovers
  // a dashed auto-connect arrow.
  const [autoConnectHover, setAutoConnectHover] = useState<{
    x: number; y: number;
    similarity: number;
    sharedTokens: string[];
  } | null>(null);

  useEffect(() => {
    if (!editor) return;
    // scope: "document" — camera changes don't affect what's hovered, only
    // shape edits do. Previously "session" fired on every pan/zoom frame
    // and, because nothing here was wrapped in try/catch, a single throw
    // from getShape/pageToScreen against a shape the painter had just
    // deleted would unwind to CanvasErrorBoundary mid-pan and show the
    // "Canvas crashed" card. Defensive try/catch + setState bailout keeps
    // the listener cheap and crash-proof.
    const setHoverNullStable = () =>
      setAutoConnectHover((prev) => (prev === null ? prev : null));
    const recompute = () => {
      try {
        const hoveredId = editor.getHoveredShapeId();
        if (!hoveredId) return setHoverNullStable();
        const shape = editor.getShape(hoveredId);
        if (!shape || shape.type !== "arrow") return setHoverNullStable();
        const meta = (shape.meta ?? {}) as Record<string, unknown>;
        if (meta.source !== "auto-connect") return setHoverNullStable();
        const bounds = editor.getShapePageBounds(hoveredId);
        if (!bounds) return setHoverNullStable();
        const screenPt = editor.pageToScreen({ x: bounds.midX, y: bounds.minY - 8 });
        const nextSharedTokens = (meta.sharedTokens as string[]) ?? [];
        const nextSimilarity = (meta.similarity as number) ?? 0;
        setAutoConnectHover((prev) => {
          if (
            prev &&
            prev.x === screenPt.x &&
            prev.y === screenPt.y &&
            prev.similarity === nextSimilarity &&
            prev.sharedTokens.length === nextSharedTokens.length &&
            prev.sharedTokens.every((t, i) => t === nextSharedTokens[i])
          ) {
            return prev;
          }
          return {
            x: screenPt.x,
            y: screenPt.y,
            similarity: nextSimilarity,
            sharedTokens: nextSharedTokens,
          };
        });
      } catch {
        // Painter may delete a shape between the hover read and the bounds
        // read; treat as "nothing hovered" rather than tearing down the
        // whole canvas via the error boundary.
        setHoverNullStable();
      }
    };
    const unsubscribe = editor.store.listen(recompute, { scope: "document" });
    return () => unsubscribe();
  }, [editor]);
  const clusterProposals = useMemo(
    () =>
      rawProposals.filter((p) => {
        const key = p.shapeIds.slice().sort().join("|");
        return !dismissedClusters.has(key);
      }),
    [rawProposals, dismissedClusters],
  );
  const acceptClusterProposal = useCallback(
    (shapeIds: string[]) => {
      if (!editor) return;
      editor.setSelectedShapes(shapeIds as unknown as Parameters<typeof editor.setSelectedShapes>[0]);
      createCluster();
    },
    [editor, createCluster],
  );

  // ── Export canvas to PNG (downloads via blob URL) ──
  const handleExportPng = useCallback(async () => {
    if (!editor) return;
    const shapeIds = [...editor.getCurrentPageShapeIds()];
    if (shapeIds.length === 0) return;
    try {
      const { blob } = await editor.toImage(shapeIds, {
        format: "png",
        background: true,
        padding: 32,
        scale: 2,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${space.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-canvas.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn("[canvas/export-png]", err);
    }
  }, [editor, space.name]);

  // ── Palette command dispatcher ──
  const handlePaletteCommand = useCallback(
    (id: PaletteCommandId) => {
      switch (id) {
        case "new-sticky":
          if (editor) createStickyAtCenter(editor, { text: "" });
          break;
        case "group-selection":
          handleGroupSelection();
          break;
        case "toggle-fullscreen":
          toggleFullscreen();
          break;
        case "decompose-active":
          handleDecompose();
          break;
        case "export-png":
          handleExportPng();
          break;
        case "run-synthesis":
          // Route to existing synthesis endpoint. Not implemented here — it
          // triggers a heavy server-side pass; the existing /synthesis page
          // handles that flow.
          window.location.href = `/app/space/${space.id}/synthesis`;
          break;
        case "help-shortcuts":
          setHelpOpen(true);
          break;
      }
    },
    [editor, handleGroupSelection, toggleFullscreen, handleDecompose, handleExportPng, space.id],
  );

  // ── Group selection shortcut (G) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleGroupSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleGroupSelection]);

  // ── Ingest+materialize helper shared by bottom dock + canvas drop ──
  //
  // Runs all file ingest+materialize calls in parallel. Each file gets its
  // own viewport slot (horizontal offset) so nodes don't overlap. As each
  // completes it places its shape on the canvas — earlier files don't
  // block later ones.
  const ingestAndMaterialize = useCallback(
    async (files: File[], dropPage?: { x: number; y: number }) => {
      if (!editor) return;
      const viewport = editor.getViewportPageBounds();
      const origin = dropPage ?? { x: Math.round(viewport.midX), y: Math.round(viewport.midY) };
      // Phase 44 — collect created entity ids + source names for a
      // single batch receipt after the whole drop resolves.
      const created: Array<{ id: string; name: string }> = [];
      const sourceNames: string[] = [];
      await Promise.all(
        files.map(async (f, idx) => {
          const dropAt = { x: origin.x + idx * 340, y: origin.y };
          const ingested = await ingestFile(f);
          if (!ingested) return;

          // ── HITL auto-open for research-class assets ─────────
          //
          // Research PDFs and internal docs benefit most from the
          // user controlling extraction (effect sizes vs methods
          // vs claims). For these classes we SKIP the auto-
          // materialize call and open the review drawer instead;
          // the drawer's commit produces the entities. For other
          // classes (image, dataset, web_article, pasted_text,
          // spec_sheet) we keep the legacy auto-materialize
          // behavior — those are usually one-shot context drops
          // that don't need granular review.
          //
          // Only fires when the asset persisted with an
          // ingested_file_id (without it the /preview route can't
          // target the row). Falls back to legacy materialize if
          // ingestedFileId is null.
          const shouldReview =
            ingested.ingestedFileId &&
            (ingested.assetClass === "research_pdf" ||
              ingested.assetClass === "internal_doc");

          if (shouldReview) {
            // Defer to the extraction-review drawer. The asset card
            // will be painted by pipeline-event-painter on
            // asset_added (already fires from /api/ingest).
            // Open the drawer so the user can review.
            void extractionReview.open({
              assetId: ingested.ingestedFileId!,
              assetName: ingested.sourceName,
              assetClass: ingested.assetClass ?? null,
            });
            sourceNames.push(ingested.sourceName);
            return; // Skip the legacy materialize path below.
          }

          const response = await materialize(
            `${ingested.sourceName}\n\n${ingested.text.slice(0, 4000)}`,
            dropAt,
          );
          if (response) {
            placeMaterializedEntity(response, dropAt);
            sourceNames.push(ingested.sourceName);
            // response shape: we don't know its exact signature here —
            // best-effort extract of the new entity's id/name.
            const r = response as unknown as {
              entity?: { id?: string; name?: string };
              id?: string;
              name?: string;
            };
            const newId = r.entity?.id ?? r.id;
            const newName = r.entity?.name ?? r.name ?? ingested.sourceName;
            if (typeof newId === "string") {
              created.push({ id: newId, name: String(newName) });
            }
          }
        }),
      );
      if (created.length > 0) {
        const createdIds = created.map((c) => c.id);
        aiReceipts.log({
          kind: "ingest",
          title:
            created.length === 1
              ? `Materialized "${created[0].name}"`
              : `Materialized ${created.length} entities from ${files.length} ${files.length === 1 ? "file" : "files"}`,
          detail:
            sourceNames.length > 0
              ? `Sources: ${sourceNames.slice(0, 3).join(", ")}${sourceNames.length > 3 ? ` +${sourceNames.length - 3} more` : ""}`
              : null,
          entity_ids: createdIds,
          undoable: true,
          // Phase 46 — undo removes every materialized entity.
          undo_target_ids: createdIds,
        });
      }
    },
    [editor, ingestFile, materialize, placeMaterializedEntity, aiReceipts, extractionReview],
  );

  // ── Bottom dock submit: text/URL/files → materialize ──
  const handleBottomSubmit = useCallback(
    async (text: string, files: File[]) => {
      if (!editor) return;

      const viewport = editor.getViewportPageBounds();
      const center = { x: Math.round(viewport.midX), y: Math.round(viewport.midY) };

      setDecomposing(true);
      try {
        // 1. Text or URL submission
        if (text) {
          if (looksLikeUrl(text)) {
            const ingested = await ingestUrl(text);
            if (ingested) {
              const response = await materialize(
                `${ingested.sourceName}\n\n${ingested.text.slice(0, 4000)}`,
                center,
              );
              if (response) placeMaterializedEntity(response, center);
            }
          } else {
            const response = await materialize(text, center);
            if (response) placeMaterializedEntity(response, center);
          }
        }

        // 2. File submissions — each becomes its own KG node
        await ingestAndMaterialize(files, center);
      } finally {
        setDecomposing(false);
      }
    },
    [editor, ingestUrl, ingestFile, materialize, placeMaterializedEntity],
  );

  // ── Place an existing entity as a KG-node shape (library drop) ──
  // Unlike materialize, this doesn't create a new DB row — the entity
  // already exists. We just drop a shape that points to its UUID.
  const placeEntityShape = useCallback(
    (payload: EntityDragPayload, atPage: { x: number; y: number }) => {
      if (!editor) return;
      const shapeId = createShapeId(`kg-${payload.id}`);
      if (editor.getShape(shapeId)) {
        // Already on canvas — just select + center the existing shape.
        editor.select(shapeId);
        editor.zoomToSelection({ animation: { duration: 300 } });
        return;
      }
      const tier = "support" as const;
      const { TIER_WIDTH, TIER_HEIGHT } = KG_NODE_TIER_SIZE;
      const w = TIER_WIDTH[tier];
      const h = TIER_HEIGHT[tier];
      const normalizedLayer = entityToLayerId({
        layer: payload.layer,
        entity_category: payload.entity_category,
      });
      editor.markHistoryStoppingPoint(`drop-entity-${payload.id}`);
      editor.createShape<KGNodeShape>({
        id: shapeId,
        type: "kg-node",
        x: atPage.x - w / 2,
        y: atPage.y - h / 2,
        props: {
          w,
          h,
          entityId: payload.id,
          name: payload.name,
          description: payload.description ?? "",
          layer: normalizedLayer,
          category: payload.entity_category ?? "concrete",
          tier,
          weight: Math.round(((payload.confidence ?? 0.7) as number) * 100),
          isLeverage: false,
          isRisk: false,
          isBottleneck: false,
          isConvergence: false,
          isGhost: false,
          confirmedPulse: 0,
        },
      });
      editor.select(shapeId);
    },
    [editor],
  );

  // ── Arc 4 Phase B/C: place a strategy snapshot as a StrategyShape ──────
  // Mirrors placeEntityShape. Dedupes by shapeId so navigating back with
  // the same ?place_strategy={id} param twice just centers the existing
  // shape instead of stacking duplicates.
  const placeStrategyShape = useCallback(
    (
      snapshot: import("@/app/api/spaces/[id]/strategy-snapshots/route").StrategySnapshotSummary,
      atPage: { x: number; y: number },
      readyScore?: number | null,
      confidence?: number | null,
    ) => {
      if (!editor) return;
      const shapeId = createShapeId(`strategy-${snapshot.id}`);
      if (editor.getShape(shapeId)) {
        editor.select(shapeId);
        editor.zoomToSelection({ animation: { duration: 300 } });
        return;
      }
      const w = 220;
      const h = 120;
      editor.markHistoryStoppingPoint(`drop-strategy-${snapshot.id}`);
      editor.createShape<StrategyShape>({
        id: shapeId,
        type: "strategy-card",
        x: Math.round(atPage.x - w / 2),
        y: Math.round(atPage.y - h / 2),
        props: {
          w,
          h,
          snapshotId: snapshot.id,
          version: snapshot.version,
          label: snapshot.label,
          title: snapshot.title ?? "Untitled strategy",
          status: snapshot.status,
          readyScore: readyScore ?? null,
          tacticCount: snapshot.tactic_count,
          confidence: confidence ?? null,
          expanded: false,
        },
      });
      editor.select(shapeId);
      editor.zoomToSelection({ animation: { duration: 300 } });
    },
    [editor],
  );

  // ── Drag-drop on canvas: files (ingest) OR entity payloads (place shape) ──
  // Phase 41: track the drop point in *root-relative pixels* so the
  // bloom animation + processing ghost can anchor there.
  const [dropPoint, setDropPoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dropBurstKey, setDropBurstKey] = useState(0);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    const hasFiles = types.includes("Files");
    const hasEntity = types.includes(ENTITY_DRAG_MIME);
    // Phase A1.0 — accept the unified library MIME envelope too.
    const hasAsset = types.includes(LIBRARY_ASSET_MIME);
    const hasStrategyAlt = types.includes(STRATEGY_ALTERNATIVE_DRAG_MIME);
    const hasStrategyObjective = types.includes(STRATEGY_OBJECTIVE_DRAG_MIME);
    if (
      !hasFiles &&
      !hasEntity &&
      !hasAsset &&
      !hasStrategyAlt &&
      !hasStrategyObjective
    )
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (hasFiles) setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) setIsDragOver(false);
  }, []);
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!editor) return;
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const pagePt = editor.screenToPage({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });

      // Phase 41: record where the drop happened in root-local px so
      // the bloom burst and processing ghost render at that spot.
      const burstX = e.clientX - rect.left;
      const burstY = e.clientY - rect.top;

      // ── Strategy alternative drop (from StrategyHeroBar) ──
      // Hero-bar entries aren't library items (they're live ranked
      // proposals), so they ride a dedicated MIME. Dedupe by
      // (spaceId, rank) so re-dropping the same alternative selects
      // the existing card instead of stacking.
      const strategyAltRaw = e.dataTransfer.getData(STRATEGY_ALTERNATIVE_DRAG_MIME);
      if (strategyAltRaw) {
        e.preventDefault();
        try {
          const payload = JSON.parse(strategyAltRaw) as StrategyAlternativeDragPayload;
          const shapeId = createShapeId(
            strategyAlternativeShapeIdSeed(payload.spaceId, payload.entryRank),
          );
          const existing = editor.getShape(shapeId);
          if (existing) {
            editor.select(shapeId);
            editor.zoomToSelection({ animation: { duration: 200 } });
          } else {
            const w = STRATEGY_ALT_COMPACT_W;
            const h = STRATEGY_ALT_COMPACT_H;
            editor.createShape<StrategyAlternativeCardShape>({
              id: shapeId,
              type: "strategy-alternative-card",
              x: Math.round(pagePt.x - w / 2),
              y: Math.round(pagePt.y - h / 2),
              props: {
                w,
                h,
                spaceId: payload.spaceId,
                entryRank: payload.entryRank,
                posture: payload.posture,
                title: payload.title,
                summary: payload.summary,
                confidence: payload.confidence,
                wasPrimary: payload.isPrimary,
                pinnedAt: new Date().toISOString(),
                expanded: false,
              },
            });
            editor.select(shapeId);
          }
        } catch (err) {
          console.warn("[canvas] strategy-alternative drop parse failed", err);
        }
        return;
      }

      // ── Strategy objective drop (from cascade view in strategy drawer) ──
      // Same dedupe-by-id pattern as alternatives: re-dragging the same
      // objective focuses the existing card instead of stacking.
      const strategyObjRaw = e.dataTransfer.getData(STRATEGY_OBJECTIVE_DRAG_MIME);
      if (strategyObjRaw) {
        e.preventDefault();
        try {
          const payload = JSON.parse(strategyObjRaw) as StrategyObjectiveDragPayload;
          const shapeId = createShapeId(
            strategyObjectiveShapeIdSeed(payload.spaceId, payload.objectiveId),
          );
          const existing = editor.getShape(shapeId);
          if (existing) {
            editor.select(shapeId);
            editor.zoomToSelection({ animation: { duration: 200 } });
          } else {
            const w = STRATEGY_OBJECTIVE_COMPACT_W;
            const h = STRATEGY_OBJECTIVE_COMPACT_H;
            editor.createShape<StrategyObjectiveCardShape>({
              id: shapeId,
              type: "strategy-objective-card",
              x: Math.round(pagePt.x - w / 2),
              y: Math.round(pagePt.y - h / 2),
              props: {
                w,
                h,
                spaceId: payload.spaceId,
                objectiveId: payload.objectiveId,
                title: payload.title,
                description: payload.description,
                progressPct: payload.progressPct,
                tag: payload.tag,
                valueLabel: payload.valueLabel,
                paletteKey: payload.paletteKey,
                perspectiveLabel: payload.perspectiveLabel,
                pinnedAt: new Date().toISOString(),
              },
            });
            editor.select(shapeId);
          }
        } catch (err) {
          console.warn("[canvas] strategy-objective drop parse failed", err);
        }
        return;
      }

      // ── Phase A1.0 — universal asset catalog drop ──
      // Single dispatcher driven by the asset class registry. New
      // classes are added by registering in `library/asset-class-registry.ts`,
      // not by editing this branch.
      const assetRaw = e.dataTransfer.getData(LIBRARY_ASSET_MIME);
      if (assetRaw) {
        e.preventDefault();
        try {
          const payload = JSON.parse(assetRaw) as LibraryAssetPayload;
          const def = getAssetClass(payload.class);
          if (def) {
            // Entity drops still go through the legacy placeEntityShape
            // for now so probe-children/ghost-state behavior is preserved.
            // Phase A1.5 will collapse this path.
            if (payload.class === "entity") {
              const ext = (payload.extras ?? {}) as Record<string, unknown>;
              const legacy: EntityDragPayload = {
                id: payload.id,
                name: payload.preview.title,
                description: (payload.preview.subtitle as string | null) ?? null,
                entity_category:
                  (typeof ext.entity_category === "string"
                    ? ext.entity_category
                    : null) as string | null,
                layer:
                  (typeof ext.layer === "string"
                    ? ext.layer
                    : null) as string | null,
                importance:
                  (typeof ext.importance === "string"
                    ? ext.importance
                    : null) as string | null,
                confidence:
                  typeof ext.confidence === "number" ? ext.confidence : null,
                space_id: payload.spaceId,
              };
              placeEntityShape(legacy, {
                x: Math.round(pagePt.x),
                y: Math.round(pagePt.y),
              });
            } else {
              const built = def.toShapeProps(payload);
              if (built) {
                const shapeId = createShapeId(
                  def.shapeIdForItem
                    ? def.shapeIdForItem(payload.id)
                    : `${payload.class}-${payload.id}`,
                );
                // Skip if the shape is already on the board (re-drop).
                if (!editor.getShape(shapeId)) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  editor.createShapes([
                    {
                      id: shapeId,
                      type: built.type,
                      x: Math.round(pagePt.x - built.w / 2),
                      y: Math.round(pagePt.y - built.h / 2),
                      props: { ...built.props, w: built.w, h: built.h },
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    } as any,
                  ]);
                  editor.select(shapeId);
                }
              }
            }
          } else {
            console.warn("[canvas] unknown asset class on drop", payload.class);
          }
        } catch (err) {
          console.warn("[canvas] asset drop parse failed", err);
        }
        return;
      }

      // Legacy entity payload (compat window — Phase A1.5 removes).
      const entityRaw = e.dataTransfer.getData(ENTITY_DRAG_MIME);
      if (entityRaw) {
        e.preventDefault();
        try {
          const payload = JSON.parse(entityRaw) as EntityDragPayload;
          placeEntityShape(payload, { x: Math.round(pagePt.x), y: Math.round(pagePt.y) });
        } catch (err) {
          console.warn("[canvas] entity drop parse failed", err);
        }
        return;
      }

      // File uploads → ingest + materialize
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      setIsDragOver(false);
      // Phase 41 — fire the bloom + anchor the processing ghost.
      setDropPoint({ x: burstX, y: burstY });
      setDropBurstKey((k) => k + 1); // re-fires animation on repeated drops
      setDecomposing(true);
      try {
        await ingestAndMaterialize(files, { x: Math.round(pagePt.x), y: Math.round(pagePt.y) });
      } finally {
        setDecomposing(false);
        // Keep the bloom visible briefly after processing so users see
        // the materialized entity against the dissipating glow.
        window.setTimeout(() => setDropPoint(null), 600);
      }
    },
    [editor, ingestAndMaterialize, placeEntityShape],
  );

  // ── Arc 4 Phase C: consume ?place_strategy={snapshot_id} on mount ──────
  // The strategy page "Open in canvas" button navigates here with the
  // snapshot id in the query string. We fetch the snapshot list, find the
  // match, and drop a StrategyShape at the viewport center. Afterwards we
  // strip the param from the URL so a refresh doesn't re-drop.
  useEffect(() => {
    if (!editor) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const snapshotId = params.get("place_strategy");
    if (!snapshotId) return;

    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(
          `/api/spaces/${space.id}/strategy-snapshots`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as import("@/app/api/spaces/[id]/strategy-snapshots/route").StrategySnapshotsResponse;
        if (cancelled) return;
        const snapshot = data.snapshots.find((s) => s.id === snapshotId);
        if (!snapshot) {
          console.warn(`[place_strategy] snapshot ${snapshotId} not found in space ${space.id}`);
          return;
        }
        const viewport = editor.getViewportPageBounds();
        const center = {
          x: viewport.x + viewport.w / 2,
          y: viewport.y + viewport.h / 2,
        };
        placeStrategyShape(snapshot, center);
      } catch (err) {
        console.warn("[place_strategy] failed:", err);
      } finally {
        // Strip the param either way; leaving it would re-fire the drop
        // on every remount.
        if (!cancelled && typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.delete("place_strategy");
          window.history.replaceState({}, "", url.toString());
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // Only run once per editor-mount + space change. Re-fetches on space nav.
  }, [editor, space.id, placeStrategyShape]);

  return (
    <CanvasAssetCatalogProvider spaceId={space.id}>
    <CanvasHierarchyContext.Provider value={hierarchyContextValue}>
    <CanvasReactionsContext.Provider value={reactionsContextValue}>
    <CanvasSubjectScopesContext.Provider value={subjectScopesContextValue}>
    <CanvasAssetDerivedEntitiesContext.Provider value={assetDerivedContextValue}>
    <CardConnectModeProvider>
    <div
      ref={rootRef}
      className="relative h-full w-full"
      style={{
        background:
          "radial-gradient(circle at 30% 20%, #F8FAFF 0%, #F0F4FB 40%, #E9EEF8 100%)",
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Single SSE owner (T3.1). Every descendant that needs live
          run events reads from this store via useRunEventStore() /
          selectors. Replaces the prior pattern where ~9 components
          each opened their own EventSource to the same run stream
          (pipeline audit 2026-04-24). */}
      <RunEventStoreProvider runId={activeRunId}>
      <BrainstormContextProvider
        settings={brainstorm.settings}
        spaceId={space.id}
      >
        {/* Phase 1 Step 23 — canvas error boundary. Catches any throw
            from tldraw, shape utils, the pipeline painter, or
            downstream canvas components. On error: renders a
            recoverable fallback with Retry + Reload. Prevents the
            white-screen failure mode where a single bad shape-util
            event would tear down the whole whiteboard view. */}
        <CanvasErrorBoundary>
          {/* IMPORTANT: do NOT set tldraw's built-in `persistenceKey`
              here. We own persistence via useCanvasPersistence
              (server-backed via /api/canvas/[spaceId], with a
              localStorage offline mirror). tldraw's persistenceKey
              activates a SECOND persistence layer on IndexedDB plus a
              cross-tab BroadcastChannel — and the two layers race.
              On pan/zoom/edit, tldraw's reactor reconciles the store
              against its IndexedDB snapshot, which (on a fresh
              browser, after a cache clear, or across tabs) is empty
              or stale → it WIPES every shape that loadSnapshot()
              placed from the server. That's the "everything
              disappears when I move the canvas" bug. One source of
              truth: the server. Do not re-add this prop. */}
          <CanvasOverlayPropsContext.Provider value={overlayPropsValue}>
            <Tldraw
              // tldraw v3+ enforces production licensing: when no key is
              // provided AND tldraw thinks it's running in production
              // (https + non-localhost + NODE_ENV=production), it hides
              // the entire editor surface after 5s via its LicenseGate
              // component (returns <div style={{display:"none"}}/>). The
              // shapes stay in the store but the canvas goes blank — same
              // visual signature as "every card just disappeared" with
              // sidebar chrome intact. Wire NEXT_PUBLIC_TLDRAW_LICENSE_KEY
              // here so a free dev license (from tldraw.dev) keeps the
              // editor visible in any deployment. Local dev usually
              // bypasses the gate via the localhost check, but having this
              // wired means we never fight the license-hide path again.
              licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
              shapeUtils={SHAPE_UTILS}
              components={CANVAS_TLDRAW_COMPONENTS}
              onMount={(e) => setEditor(e)}
            />
          </CanvasOverlayPropsContext.Provider>
        </CanvasErrorBoundary>
      </BrainstormContextProvider>

      {/* Arc 5B: per-card AI sidecar. Renders on the right edge when the
          user has a single shape selected; hides (with a slide-out animation)
          when selection clears or grows. Takes the first selected shape —
          multi-select intentionally does not show the sidecar because the
          context would be ambiguous. */}
      <CardSidecar
        editor={editor}
        selectedShape={selectedShapes.length === 1 ? selectedShapes[0] : null}
        spaceId={space.id}
        onClose={() => editor?.selectNone()}
      />

      {/* Phase 41 — drop-zone treatment (Reactor Glass). A dark-green
          radial vignette invites the drop; a reactor-glass tile floats
          in the center announcing what will happen. */}
      {isDragOver && (
        <>
          <div className="canvas-drop-scrim" />
          <div
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
          >
            <div
              className="reactor-glass"
              data-elevation="engaged"
              data-tint="green"
              style={{
                padding: "18px 26px",
                borderStyle: "dashed",
                borderColor: "rgba(74, 222, 128, 0.45)",
                textAlign: "center",
                maxWidth: 380,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  color: "#4ade80",
                  marginBottom: 4,
                }}
              >
                ◉ Drop to analyze
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#e8edf4",
                  lineHeight: 1.3,
                  marginBottom: 4,
                }}
              >
                Materialize as knowledge
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: "#a8b3c4",
                  lineHeight: 1.5,
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                  letterSpacing: "0.06em",
                }}
              >
                PDF · DOCX · MD · TXT · Images →{" "}
                <span style={{ color: "#4ade80" }}>KG node</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Phase 41 — drop-point bloom burst. Fires once per drop;
          `dropBurstKey` forces remount so the CSS animation restarts
          when the user drops again without lifting. */}
      {dropPoint && (
        <div
          key={dropBurstKey}
          className="canvas-drop-burst"
          style={
            {
              "--bx": `${dropPoint.x}px`,
              "--by": `${dropPoint.y}px`,
            } as React.CSSProperties
          }
        />
      )}

      {/* Phase 41 — processing ghost. Stays at the drop point while
          the ingest pipeline is running; shimmer sweeps across it to
          signal "the system is working here." Disappears ~600ms after
          decomposing flips to false so users see the new entity against
          the dissipating glow. */}
      {dropPoint && decomposing && (
        <div
          className="canvas-drop-ghost"
          style={
            {
              "--bx": `${dropPoint.x}px`,
              "--by": `${dropPoint.y}px`,
            } as React.CSSProperties
          }
        >
          <div
            style={{
              position: "relative",
              zIndex: 1,
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "#4ade80",
              marginBottom: 4,
            }}
          >
            ∿ Materializing
          </div>
          <div
            style={{
              position: "relative",
              zIndex: 1,
              fontSize: 11,
              color: "#a8b3c4",
              lineHeight: 1.5,
            }}
          >
            Extracting · decomposing · placing
          </div>
        </div>
      )}

      {/* Phase 48 — quiet mode hides overlays but keeps the tool dock
          (the core verb) + the AI Receipts drawer state so the user
          can still dismiss an open drawer. Quiet state surfaces a
          tiny Restore chip top-right. */}
      {!quietMode && (
        <CanvasTopBar
          spaceId={space.id}
          spaceName={space.name}
          entityCount={entities.length}
          edgeCount={edges.length}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          saveStatus={saveStatus}
          snapOn={snapOn}
          onToggleSnap={toggleSnap}
          autoAI={autoAI}
          onToggleAutoAI={() => setAutoAI((v) => !v)}
          autoAIState={autoAIState}
          autoAILastTarget={autoAILastTarget}
          extraTriggers={
            <>
              <DrawerTriggers
                activeDrawer={drawerState.drawer}
                onOpen={(id) => drawerState.openDrawer(id)}
              />
              <div className="h-4 w-px bg-gray-200" />
              {/* Phase 1 Step 25 — credit-balance chip. Shows remaining
                  credits + runs-remaining tone; click → /app/credits.
                  Refreshes automatically when a pipeline run terminates
                  (via creditRefreshKey) so deductions land visibly. */}
              <CanvasCreditChip refreshKey={creditRefreshKey} />
              <div className="h-4 w-px bg-gray-200" />
              <AIReceiptsInlineTrigger
                receipts={aiReceipts}
                open={aiReceiptsOpen}
                onOpenChange={setAiReceiptsOpen}
              />
            </>
          }
        />
      )}

      {/* Phase 2D — Brainstorm right-rail panel. The toggle button
          itself lives in the consolidated TopRightChromeStack below
          (so Probability / Layer / Brainstorm chips share one column
          with consistent spacing instead of stacking via hardcoded
          `top:` values that overlap each other).
          Hidden in quiet mode (same pattern as the TopBar). */}
      {!quietMode && (
        <>
          <BrainstormPanel
            open={brainstormPanelOpen}
            onClose={() => setBrainstormPanelOpen(false)}
            settings={brainstorm}
            // Unified panel: ambient context flows in here so the
            // separate HUD rail is no longer rendered standalone.
            hudCtx={hudCtx}
            onDecompose={handleDecompose}
            onJumpToEntity={handleJumpToEntity}
            onAppendQuestion={handleAppendQuestion}
          />
        </>
      )}

      {/* Wave 2 — right-side drawers for absorbed standalone pages.
          Open via top-bar triggers OR via redirect URL params
          (?drawer=synthesis&tab=leverage etc.). All three are
          mount-controlled; content only renders when open. */}
      <SynthesisDrawer
        open={drawerState.drawer === "synthesis"}
        onClose={drawerState.closeDrawer}
        activeTab={drawerState.tab}
        onTabChange={drawerState.setTab}
      />
      <IntelligenceDrawer
        open={drawerState.drawer === "intelligence"}
        onClose={drawerState.closeDrawer}
        activeTab={drawerState.tab}
        onTabChange={drawerState.setTab}
      />
      <InventoryDrawer
        open={drawerState.drawer === "inventory"}
        onClose={drawerState.closeDrawer}
        activeTab={drawerState.tab}
        onTabChange={drawerState.setTab}
      />
      <TwinDrawer
        open={drawerState.drawer === "twin"}
        onClose={drawerState.closeDrawer}
        activeTab={drawerState.tab}
        onTabChange={drawerState.setTab}
      />
      <StrategyCanvasPresenceProvider value={strategyCanvasPresence}>
        <StrategyDrawer
          open={drawerState.drawer === "strategy"}
          onClose={drawerState.closeDrawer}
          activeTab={drawerState.tab}
          onTabChange={drawerState.setTab}
        />
      </StrategyCanvasPresenceProvider>
      <ObjectivesDrawer
        open={drawerState.drawer === "objectives"}
        onClose={drawerState.closeDrawer}
        activeTab={drawerState.tab}
        onTabChange={drawerState.setTab}
      />
      <ProbabilityDrawer
        open={drawerState.drawer === "probability"}
        onClose={drawerState.closeDrawer}
        activeTab={drawerState.tab}
        onTabChange={drawerState.setTab}
      />
      <GraphDrawer
        open={drawerState.drawer === "graph"}
        onClose={drawerState.closeDrawer}
        activeTab={drawerState.tab}
        onTabChange={drawerState.setTab}
      />
      {/* HITL extraction-review drawer. Opened by asset-card shapes
          via canvas-bus when the user clicks "Review extraction" on
          an asset whose extraction_status is 'previewed' or
          'pending_preview'. Closes on extract success / skip /
          backdrop click. Only renders when a preview is loaded —
          while the /preview POST is in flight (previewLoading=true)
          we render a minimal placeholder so the drawer doesn't pop
          into existence with empty content. */}
      {extractionReview.isOpen && extractionReview.preview && (
        <ExtractionChecklistDrawer
          preview={extractionReview.preview}
          assetName={extractionReview.assetName ?? "Asset"}
          assetClass={extractionReview.assetClass}
          open={extractionReview.isOpen}
          onClose={extractionReview.close}
          onExtract={async (selected, focus) => {
            // Reflect the in-flight commit visibly on the asset
            // card before the network roundtrip completes — pulls
            // the badge into the "Extracting…" state immediately.
            const aId = extractionReview.assetId;
            if (editor && aId) {
              updateAssetCardStatus(editor, aId, {
                extractionStatus: "extracting",
              });
            }
            const result = await extractionReview.extract(selected, focus);
            // On success, paint the final state. The result carries
            // entity_ids[] (already-deduped) — we display its
            // length as the entity count.
            if (editor && aId && result) {
              updateAssetCardStatus(editor, aId, {
                extractionStatus: "extracted",
                extractedEntityCount: result.entity_ids.length,
              });
              // Pull the freshly-committed entities into the canvas
              // state so use-sync-entities paints them as real KG
              // nodes. Without this the drawer closes and the user
              // sees the asset card flip to "✓ extracted" but no new
              // nodes until next page reload — confusing.
              if (refreshSpaceEntities) {
                refreshSpaceEntities().catch((err) =>
                  console.warn(
                    "[extraction-review] refreshEntities failed:",
                    err,
                  ),
                );
              }
            }
          }}
          onSkip={async () => {
            const aId = extractionReview.assetId;
            await extractionReview.skip();
            if (editor && aId) {
              updateAssetCardStatus(editor, aId, {
                extractionStatus: "skipped",
              });
            }
          }}
        />
      )}
      {extractionReview.isOpen && extractionReview.previewLoading && (
        <div
          className="fixed right-0 top-0 z-[70] flex h-screen w-[520px] max-w-full flex-col items-center justify-center border-l border-slate-200 bg-white shadow-2xl"
          role="status"
          aria-live="polite"
        >
          <div className="text-[12px] font-semibold text-slate-500">
            Generating extraction preview…
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Reading {extractionReview.assetName ?? "asset"}
          </div>
        </div>
      )}

      {/* Multitask hint — shows when a pipeline run goes idle (long
          stages can run for minutes). Reminds the user that the
          canvas isn't blocked during research/synthesis: existing
          entities are interactive, brainstorm rail is open, etc. */}
      <WhileYouWaitChip />

      {/* Preliminary topology insights — surfaces hubs, bridge
          candidates, isolated clusters, and feedback loops the moment
          Decompose finishes (no LLM cost, pure graph algorithms over
          the entities + edges already in the DB). Auto-collapses
          once synthesis_data lands and the richer LLM-synthesized
          cards take over. */}
      {!brainstormPanelOpen && (
        <PreliminaryInsightsPanel
          editor={editor}
          space={space}
          entities={entities}
          edges={edges}
        />
      )}

      {/* Phase 1 Step 2 — live pipeline-run HUD. Mounts only when the
          URL carries ?run=<uuid>; connects to the SSE stream and shows
          the current stage + counts of persisted artifacts as the
          pipeline emits structural events. */}
      <CanvasEventHud
        runId={activeRunId}
        onClose={dismissRun}
        onResume={
          // Continue the SAME run via decompose's rehydrate path
          // (existingSpaceId + existingRunId). No new space, no new
          // credits — preferred over Retry. SSE re-opens on the same
          // runId so no navigation needed.
          activeRunId && space?.id
            ? async () => {
                try {
                  const res = await fetch("/api/pipeline/decompose", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      text: space.input_text ?? "",
                      existingSpaceId: space.id,
                      existingRunId: activeRunId,
                      autoAdvance: true,
                    }),
                  });
                  if (!res.ok) {
                    console.warn(
                      "[resume] decompose returned",
                      res.status,
                    );
                  }
                } catch (err) {
                  console.warn("[resume] failed (non-fatal):", err);
                }
              }
            : undefined
        }
        onRetry={
          // U4 (docs/KG_DEPTH_CRITIQUE.md audit) — re-fire the
          // bootstrap with the same prompt + reasoning_settings.
          // Bootstrap creates a NEW space (existing spaceId is not
          // reusable — see route signature); we navigate the user to
          // the new run on success. Disabled when there's no input
          // text on this space (legacy data, manually-created
          // workspaces).
          space?.input_text
            ? async () => {
                try {
                  const res = await fetch("/api/intake/bootstrap", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      text: space.input_text,
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      reasoning_settings: (space as any).reasoning_settings ?? null,
                    }),
                  });
                  if (!res.ok) {
                    console.warn(
                      "[retry] bootstrap returned",
                      res.status,
                    );
                    return;
                  }
                  const data = (await res.json()) as {
                    spaceId?: string;
                    runId?: string;
                  };
                  if (data.spaceId && data.runId) {
                    // Navigate via Next router so the canvas re-mounts
                    // with the new run/space context.
                    nextRouter.push(
                      `/app/space/${data.spaceId}/whiteboard?run=${data.runId}`,
                    );
                  }
                } catch (err) {
                  console.warn("[retry] failed (non-fatal):", err);
                }
              }
            : undefined
        }
      />

      {/* Run-level signal pills — surfaces target_outcome_identified
          (once per run, 20s auto-fade pill) and layer_coverage_gap
          (sticky warning until dismissed). Both events used to be
          silently dropped because no consumer listened. */}
      <CanvasRunSignalsBanner runId={activeRunId} />

      {/* T1.1 — Strategy hero bar (docs/KG_DEPTH_CRITIQUE.md):
          surfaces the synthesized strategy(ies) at the TOP of the
          canvas viewport so users don't have to scroll past 90s of
          KG unfurl to find them. Renders top-N side-by-side cards
          (not chip-swapped) so users can compare at a glance. The
          existing in-canvas strategy-hero-card-shape continues to
          paint at y=1080 as a draggable canvas anchor — this bar is
          the always-visible promo, the shape is the canvas tether. */}
      <StrategyHeroBar
        spaceId={space.id}
        runId={activeRunId}
        placedRanks={placedStrategyAltRanks}
        onZoomToRank={handleZoomToStrategyAlt}
      />

      {/* Origin prompt card is now a real tldraw shape (`origin-prompt`,
          painted by PipelineEventPainter at the top of the canvas) so
          downstream shapes can tether up to it and the whole canvas
          reads as a tree from the user's thought. The prior chrome
          CanvasOriginCard — viewport-pinned, couldn't be an arrow
          endpoint — was retired. See origin-prompt-shape.tsx. */}

      {/* Probability space shells are now real tldraw shapes
          (`probability-space-shell`) painted by the pipeline painter
          on `space_opened` events. Shells pan/zoom with the canvas
          and tether UP to origin-prompt so the intake lenses read as
          descending from the user's thought. The prior chrome
          ProbabilitySpaceRail — viewport-pinned, ate drags that
          should have reached tldraw for pan, and couldn't be arrow
          endpoints — was retired. See probability-space-shell-shape.tsx. */}

      {/* Phase 2E · PR 3 — live AI reasoning stream. Tucks into the
          top-left corner (below top bar, right of tool dock) as a
          quiet glass console. Appears when reasoning_chunk events
          flow, auto-fades 8s after the last chunk. Supporting info —
          never competes with the main graph hierarchy. */}
      <CanvasReasoningStream runId={activeRunId} />

      {/* Top-right chrome stack — consolidates the three small
          right-edge chips into one flex column so they stack with
          consistent gaps regardless of which are visible. Replaces
          three independent `absolute right-4 top-{16,68,112}`
          positions that were overlapping each other (Probability
          badge at 64-96px collided with Layer toggle at 68-112px).
          Hidden when the brainstorm panel is open since the panel
          covers this column anyway and the user closes it from the
          panel header.
          - CanvasProbabilityBadge: rendered only when probability
            spaces have been computed (post-decompose synthesis).
          - CanvasLayerToggle: rendered only when there's at least
            one entity to filter (`knowledge_layer` tagging).
          - BrainstormToggleButton: always present so the user can
            open the brainstorm panel; its visual state reflects
            whether brainstorm features are active. */}
      {!quietMode && !brainstormPanelOpen && (
        <div className="pointer-events-none absolute right-4 top-16 z-30 flex flex-col items-end gap-2">
          <CanvasProbabilityBadge />
          <CanvasLayerToggle hasAnyEntity={entities.length > 0} />
          <BrainstormToggleButton
            open={brainstormPanelOpen}
            onToggle={() => {
              setBrainstormPanelOpen((v) => !v);
              // First-time open also enables brainstorm mode so the
              // panel doesn't feel inert — user can toggle the
              // master switch off inside the panel if they just
              // want to peek.
              if (!brainstormPanelOpen && !brainstorm.settings.enabled) {
                brainstorm.update({ enabled: true });
              }
            }}
            settings={brainstorm.settings}
            active={hasAnyActiveFeature(brainstorm.settings)}
          />
        </div>
      )}

      {/* Phase 1 Step 7 — proposal rings overlay. Consumes the same SSE
          stream and renders a right-side stack of cards for each
          proposal_ready event that carried a Monte-Carlo distribution.
          Shows p10→p90 certainty bar + median tick + confidence %
          derived from stddev. Sample-derived uncertainty replacing
          LLM confidence theater on the strategy cards. */}
      {!brainstormPanelOpen && (
        <CanvasProposalRings runId={activeRunId} />
      )}

      {/* Phase 2H — cross-domain structural analogs overlay. Left-side
          stack mirroring the proposal rings; consumes the same SSE
          stream and renders one card per structural_analog_found
          event with LLM-generated entity pairings + insight. */}
      <CanvasAnalogRail runId={activeRunId} />

      {/* Phase 1 Step 8 — run-context audit panel. Fetches the
          structured summary from /api/pipeline/runs/[runId]/context,
          shows collapsed-by-default totals + expand for full stage
          timeline, proposals with distributions, entity + source
          lists. Polls every 8s while running; stops when terminal. */}
      <CanvasRunContextPanel runId={activeRunId} spaceId={space.id} />

      {/* Phase 1 Step 19 — reasoning trace. Subscribes to streaming
          `reasoning_chunk` events from the pipeline's LLM passes and
          renders the model's actual output as it types, with a token-
          progress bar and candidate-concept chips extracted from the
          streaming text. Closes the "silent spinner" gap: the user sees
          the AI's reasoning within 1-2s of submit instead of 60s later. */}
      <CanvasReasoningTracePanel runId={activeRunId} />

      {/* Entity-detail drawer — opens when ?entity=<uuid> is in the URL,
          auto-populated by selecting a kg-node. Wraps the existing
          NodeDetail component (evidence basis, manifold dimensions,
          temporal validity, connected edges with conditions, provenance,
          navigation deep-links) — the full richness of the entity row
          that the flat canvas card can't fit. */}
      <EntityDetailDrawer
        entityId={entityDetailId}
        entityMap={entityById}
        cycles={[]}
        spaceId={space.id}
        onClose={closeEntity}
      />

      {/* Phase 1 Step 22 — edge + cycle drawers. Symmetric with the
          entity drawer: click any arrow or cycle-loop on the canvas,
          drawer opens with the full DB row (dynamics, polarity,
          conditions, topology, utility, evidence claims for edges;
          classification, growth_type, multiplier, ordered ring for
          cycles). Every rigorous artifact the LLM extracts is now
          inspectable with one click. */}
      <EdgeDetailDrawer edgeId={edgeDetailId} onClose={closeEdge} />
      <CycleDetailDrawer cycleId={cycleDetailId} onClose={closeCycle} />

      {/* Phase 1 Step 15 — chain-completion banner. Surfaces the
          "strategy ready — materialize apps" CTA the moment auto-
          advance finishes, closing the discoverability gap flagged
          in the audit (no clear next step post-chain). Hides itself
          once the strategy is confirmed OR if the run didn't produce
          a strategy artifact. */}
      <CanvasChainCompletionBanner
        runId={activeRunId}
        spaceId={space.id}
      />

      {/* Phase 1 Step 24 — credit-exhaustion banner. Detects when the
          run errored out due to LLM provider quota exhaustion and
          surfaces a CTA to /app/credits. Closes the "pipeline hangs
          silently on 402" failure mode. Non-blocking: user can still
          interact with the canvas; banner is dismissible. */}
      <CanvasCreditExhaustionBanner runId={activeRunId} />

      {/* Ghost painter — same SSE stream, but instead of counters it
          paints translucent kg-node shapes on the canvas as each
          entity_added event arrives (plus dashed arrows for edges and
          isConvergence highlights for cycles). On run completion the
          painter deletes its ghosts + calls onCompleted, which kicks
          a refreshEntities() so useSyncEntities below paints the real
          kg-nodes at proper tier-layered positions. */}
      <PipelineEventPainter
        editor={editor}
        runId={activeRunId}
        originPromptText={
          (space as unknown as { input_text?: string | null }).input_text ?? null
        }
        // Phase B (intake redesign) — pass spaceId so the painter can
        // populate the strategy hero card's spaceId prop, which the
        // shape needs for its swap-rank API call and detail-page link.
        spaceId={space?.id ?? null}
        onCompleted={onPipelineRunCompleted}
        onSignatureProgress={onSignatureProgress}
      />

      <CanvasToolDock active={tool} libraryOpen={libraryOpen} onSelect={setTool} />

      {/* Phase C — listens for `canvas-room:extend` window events fired
          by each cascade-room's (+) button and opens an Apple-style
          verb menu (add info / ask query / sub-objective / generate
          more) at the click point. Verb dispatches `canvas-room:extend-verb`
          for future endpoint wiring. */}
      <CanvasRoomExtendPopover />

      {/* Phase 48 — quiet-mode restore chip. Tiny top-right affordance
          that lives outside the top bar so the canvas still feels
          clean. Pressing Q again toggles back. */}
      {quietMode && (
        <button
          type="button"
          onClick={() => setQuietMode(false)}
          title="Exit quiet mode (Q)"
          className="pointer-events-auto absolute top-3 right-3 z-30 rounded-full border border-gray-200/70 bg-white/85 px-2.5 py-1 text-[10px] font-semibold text-gray-500 shadow-sm backdrop-blur-md transition-colors hover:border-blue-200 hover:text-blue-700"
        >
          Quiet · <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[9px] text-gray-500">Q</kbd>
        </button>
      )}

      {/* Asset library drawer — Phase A1.1 v2: universal asset catalog
          with tabs for entities, reactions, and (future) apps,
          strategies, axioms, claims, bridges, cycles, etc.
          Backwards-compat: legacy v1 also kept until full parity verified. */}
      <CanvasAssetDrawerV2
        open={libraryOpen}
        entities={libraryAllEntities}
        placedShapeIds={placedShapeIds}
        spaceNameById={librarySpaceNames}
        onClose={() => setLibraryOpen(false)}
      />
      {/* HUD rail absorbed into BrainstormPanel above (unified AI
          Companion). When the panel is closed and ambient content is
          available, show a small pulsing indicator button that opens
          the panel — so the user knows suggestions are ready. */}
      {!quietMode && brainstorm.settings.enabled && !brainstormPanelOpen && (hudCtx.activeShape || hudCtx.selectedEntity) && (
        <button
          onClick={() => setBrainstormPanelOpen(true)}
          className="pointer-events-auto absolute right-4 z-30 flex items-center gap-1.5 rounded-full border border-purple-200/70 bg-white/90 px-3 py-1.5 shadow-md backdrop-blur-md transition-all hover:bg-white hover:shadow-lg"
          style={{ top: "30%" }}
          title="Open AI companion"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-500" />
          </span>
          <span className="text-[11px] font-semibold text-purple-700">
            {hudCtx.loading ? "Thinking…" : `${hudCtx.suggestedQuestions.length > 0 ? hudCtx.suggestedQuestions.length + " probes" : hudCtx.relatedEntities.length + " related"}`}
          </span>
        </button>
      )}
      {!quietMode && (
        <CanvasBottomDock
          onSubmit={handleBottomSubmit}
          loading={decomposing}
          memorySettings={brainstorm.settings.memory}
          onMemorySettingsChange={(patch) =>
            brainstorm.update({ memory: { ...brainstorm.settings.memory, ...patch } })
          }
          onOpenAdvancedContext={() => setAdvancedContextOpen(true)}
          hasContextOverride={!!(contextOverride?.customText || contextOverride?.sourceOverrides || contextOverride?.scopeOverride)}
        />
      )}

      {/* Advanced context picker — slide-up sheet for one-shot context overrides */}
      <AdvancedContextPicker
        open={advancedContextOpen}
        onClose={() => setAdvancedContextOpen(false)}
        memorySettings={brainstorm.settings.memory}
        onApply={(override) => setContextOverride(override)}
        activeOverride={contextOverride}
      />

      {/* "Why connected" tooltip for auto-connect arrows */}
      {autoConnectHover && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{ left: autoConnectHover.x, top: autoConnectHover.y - 8 }}
        >
          <div className="flex flex-col gap-1 rounded-xl border border-gray-200/80 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-md">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
              <span className="text-[10.5px] font-bold text-gray-700">
                AI connection · {autoConnectHover.similarity}% overlap
              </span>
            </div>
            {autoConnectHover.sharedTokens.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {autoConnectHover.sharedTokens.map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            <p className="text-[9.5px] text-gray-400">
              Delete this arrow to dismiss the suggestion.
            </p>
          </div>
        </div>
      )}

      {/* Ghost accept/reject chip (Phase 3) */}
      {activeGhost && ghostChipScreenPos && (
        <CanvasGhostChip
          screenX={ghostChipScreenPos.x}
          screenY={ghostChipScreenPos.y}
          entityName={activeGhost.props.name}
          pending={ghostPending}
          onAccept={handleAcceptGhost}
          onReject={handleRejectGhost}
        />
      )}

      {/* Under-decomposed hub nudges (Phase 3) */}
      {clusterNudges.map((n) => (
        <CanvasNudgeChip
          key={n.entityId}
          screenX={n.screenX}
          screenY={n.screenY}
          name={n.name}
          missingChildren={n.missingChildren}
          busy={nudgeBusyFor === n.entityId}
          onDecompose={() => handleNudgeDecompose(n.entityId, n.name)}
        />
      ))}

      {/* Command palette (Phase 4) */}
      <CanvasCommandPalette
        open={paletteOpen}
        entities={entities}
        commandsState={paletteCommandsState}
        onClose={() => setPaletteOpen(false)}
        onJumpToEntity={(entity) => {
          const e = entityById.get(entity.id);
          if (e) handleJumpToEntity(e);
        }}
        onRunCommand={handlePaletteCommand}
      />

      {/* Probability-space rings (Phase 9a/b) — one per selected KG entity */}
      {ringsOpen &&
        ringsTrees.map(({ tree, anchor }) => (
          <CanvasProbabilityRings
            key={anchor.shapeId}
            tree={tree}
            screenX={anchor.screenX}
            screenY={anchor.screenY}
            zoom={anchor.zoom}
            loading={ringsDecomposeLoading && tree.parent.id === ringsParent?.id}
            hoveredChildId={hoveredRingChildId}
            combinationSlot={combinationSlotSet}
            // Phase 12: Route to this entity's Lab — only when the entity
            // lives in a real space (skip for universal/ephemeral shapes).
            labHref={
              tree.parent.space_id
                ? `/app/space/${tree.parent.space_id}/entity/${tree.parent.id}/lab`
                : undefined
            }
            onChildHover={setHoveredRingChildId}
            onChildClick={handleRingChildClick}
            onDecomposeMore={handleRingDecomposeMore}
            onLabNavigate={handleLabNavigate}
            onClose={() => setRingsOpen(false)}
          />
        ))}

      {/* Combination interpretation card (Phase 9c.2 + Phase 11 save) */}
      {ringsOpen && combinationSlot.length >= 2 && ringsAnchor && (
        <CanvasCombinationCard
          midScreenX={ringsAnchor.screenX + 260}
          midScreenY={Math.max(160, ringsAnchor.screenY - 160)}
          loading={combinationLoading}
          error={combinationError}
          result={combinationResult}
          sourceCount={combinationSlot.length}
          saved={combinationIsSaved}
          saving={savingReaction}
          onClose={() => setCombinationSlot([])}
          onAppendProbe={
            activeSticky
              ? (q) => handleAppendQuestion(q)
              : undefined
          }
          onSaveReaction={handleSaveReaction}
        />
      )}

      {/* Cross-space semantic bridges (Phase 9c.1) */}
      {ringsOpen && ringsAnchor && semanticBridges.length > 0 && (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            left: ringsAnchor.screenX + 320,
            top: ringsAnchor.screenY + 60,
            transform: `scale(${ringsAnchor.zoom})`,
            transformOrigin: "top left",
          }}
        >
          <div className="pointer-events-auto flex flex-col gap-1 rounded-xl border border-amber-200 bg-white/95 p-1.5 shadow-md backdrop-blur-md">
            <div className="px-1.5 pt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-amber-700">
              Cross-space bridges
            </div>
            {semanticBridges.slice(0, 4).map((b) => (
              <button
                key={b.target_uuid}
                onClick={() => {
                  // Navigate to the target space's dashboard (canvas route was
                  // retired in route consolidation). window.location ensures
                  // the destination space context mounts cleanly.
                  window.location.href = `/app/space/${b.target_space_id}`;
                }}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[10.5px] transition-colors hover:bg-amber-50"
                title={`Match reason: ${b.match_reason}. Open target space's canvas.`}
              >
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-semibold text-gray-900">
                    {b.target_name}
                  </span>
                  <span className="block truncate text-[9px] text-gray-500">
                    in {b.target_space_name}
                  </span>
                </span>
                <span className="text-[9px] font-bold text-amber-700">
                  {Math.round(b.similarity * 100)}%
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Shared-indicator bridge arcs (Phase 9b.3) */}
      {ringsOpen && ringBridges.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 z-10"
          width="100%"
          height="100%"
        >
          {ringBridges.map((b, i) => {
            const midX = (b.fromAnchor.screenX + b.toAnchor.screenX) / 2;
            const midY = (b.fromAnchor.screenY + b.toAnchor.screenY) / 2;
            const dx = b.toAnchor.screenX - b.fromAnchor.screenX;
            const dy = b.toAnchor.screenY - b.fromAnchor.screenY;
            const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            // Orthogonal offset for a gentle arc
            const offsetX = (-dy / len) * 40;
            const offsetY = (dx / len) * 40;
            const ctrlX = midX + offsetX;
            const ctrlY = midY + offsetY;
            return (
              <g key={`bridge-${i}`}>
                <path
                  d={`M ${b.fromAnchor.screenX} ${b.fromAnchor.screenY} Q ${ctrlX} ${ctrlY} ${b.toAnchor.screenX} ${b.toAnchor.screenY}`}
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  opacity={0.6}
                />
                <text
                  x={ctrlX}
                  y={ctrlY - 6}
                  textAnchor="middle"
                  className="fill-amber-700"
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    paintOrder: "stroke",
                    stroke: "white",
                    strokeWidth: 3,
                  }}
                >
                  shared: {b.sharedName}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {/* Auto-cluster proposal chip (Phase 7) */}
      {clusterProposals.map((p) => {
        const key = p.shapeIds.slice().sort().join("|");
        return (
          <CanvasClusterProposalChip
            key={key}
            screenX={p.screenX}
            screenY={p.screenY}
            size={p.size}
            dominantLayer={p.dominantLayer}
            onAccept={() => acceptClusterProposal(p.shapeIds)}
            onDismiss={() =>
              setDismissedClusters((prev) => {
                const next = new Set(prev);
                next.add(key);
                return next;
              })
            }
          />
        );
      })}

      {/* Keyboard shortcut help (Phase 4) */}
      <CanvasShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Phase 34 — atmospheric zoom scrim, triggered on canvas→lab nav.
          Rendered at fixed root so it sits above everything, including
          the tldraw layer. Idle/hidden by default. */}
      <AtmosphericZoom ref={atmosphericZoomRef} />

      {/* Phase 44 — AI Receipts drawer. Phase 48 — trigger lives in
          the top bar (see `extraTriggers`), so we hide the floating
          button here. The drawer itself still renders controlled via
          the hoisted open state. */}
      <CanvasAIReceipts
        receipts={aiReceipts}
        open={aiReceiptsOpen}
        onOpenChange={setAiReceiptsOpen}
        hideTrigger
      />
      </RunEventStoreProvider>
    </div>
    </CardConnectModeProvider>
    </CanvasAssetDerivedEntitiesContext.Provider>
    </CanvasSubjectScopesContext.Provider>
    </CanvasReactionsContext.Provider>
    </CanvasHierarchyContext.Provider>
    </CanvasAssetCatalogProvider>
  );
}

// Module-scope helpers extracted to ./interaxis-canvas-helpers.ts —
// pure functions over an editor + plain args, no component state. See
// that file for createStickyAtCenter, createThreadOnShape,
// isTypingTarget, updateAssetCardStatus.
