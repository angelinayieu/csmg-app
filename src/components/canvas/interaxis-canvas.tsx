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

import type { Entity, Edge, Space } from "@/types";
import { KGNodeShapeUtil, KG_NODE_TIER_SIZE } from "./shapes/kg-node-shape";
import { KGFormationShapeUtil } from "./shapes/kg-formation-shape";
import { StickyNoteShapeUtil } from "./shapes/sticky-note-shape";
import { SynthesisCardShapeUtil } from "./shapes/synthesis-card-shape";
import { ClusterFrameShapeUtil } from "./shapes/cluster-frame-shape";
import { StrategyShapeUtil } from "./shapes/strategy-shape";
import { ReactionCardShapeUtil } from "./shapes/reaction-card-shape";
import { AppCardShapeUtil } from "./shapes/app-card-shape";
import { BridgeLinkShapeUtil } from "./shapes/bridge-link-shape";
import { CycleLoopShapeUtil } from "./shapes/cycle-loop-shape";
import { ClaimChipShapeUtil } from "./shapes/claim-chip-shape";
import { AxiomStoneShapeUtil } from "./shapes/axiom-stone-shape";
import { ConvergentFanShapeUtil } from "./shapes/convergent-fan-shape";
import { SignalFlagShapeUtil } from "./shapes/signal-flag-shape";
import { TwinSnapshotShapeUtil } from "./shapes/twin-snapshot-shape";
import { ObjectiveTreeShapeUtil } from "./shapes/objective-tree-shape";
import { SourceCardShapeUtil } from "./shapes/source-card-shape";
import { FileCardShapeUtil } from "./shapes/file-card-shape";
import { ThreadSnapshotShapeUtil } from "./shapes/thread-snapshot-shape";
import { ProposalSnapshotShapeUtil } from "./shapes/proposal-snapshot-shape";
import { ThreadNoteShapeUtil, THREAD_DEFAULT_W, THREAD_DEFAULT_H } from "./shapes/thread-note-shape";
import type { StickyNoteShape, KGNodeShape, StrategyShape, ThreadNoteShape } from "./shapes/types";
import { ThreadTethersOverlay } from "./chrome/thread-tethers-overlay";
import { useThreadPersistence } from "./hooks/use-thread-persistence";
import { CardSidecar } from "./sidecar/card-sidecar";
import { toast } from "@/lib/hooks/use-toast";
import { useClusterFrames } from "./hooks/use-cluster-frames";
import { entityToLayerId } from "@/lib/whiteboard/layer-config";
import { useSyncEntities } from "./hooks/use-sync-entities";
import { useCanvasPersistence } from "./hooks/use-canvas-persistence";
import { useCanvasAmbient } from "./hooks/use-canvas-ambient";
import { useMaterialize, type MaterializeResponse } from "./hooks/use-materialize";
import { useIngest, looksLikeUrl } from "./hooks/use-ingest";
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
import { CanvasReactionsContext } from "./canvas-reactions-context";
import {
  CanvasHierarchyContext,
  useBuildHierarchyIndex,
} from "./canvas-hierarchy-context";
import {
  AtmosphericZoom,
  type AtmosphericZoomHandle,
} from "@/components/shared/reactor-glass";
import { useRouter as useNextRouter } from "next/navigation";
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
import { CanvasOriginCard } from "./chrome/canvas-origin-card";
import { ProbabilitySpaceRail } from "./chrome/probability-space-rail";
import { CanvasReasoningStream } from "./chrome/canvas-reasoning-stream";
import { CanvasProposalRings } from "./chrome/canvas-proposal-rings";
import { CanvasAnalogRail } from "./chrome/canvas-analog-rail";
import { CanvasRunContextPanel } from "./chrome/canvas-run-context-panel";
import { CanvasChainCompletionBanner } from "./chrome/canvas-chain-completion-banner";
import { CanvasCreditExhaustionBanner } from "./chrome/canvas-credit-exhaustion-banner";
import { CanvasReasoningTracePanel } from "./chrome/canvas-reasoning-trace-panel";
import { CanvasLayerToggle } from "./chrome/canvas-layer-toggle";
import { CanvasProbabilityBadge } from "./chrome/canvas-probability-badge";
import { useLayerFilterState } from "./drawers/use-layer-filter-state";
import { PipelineEventPainter } from "./pipeline-event-painter";
import { CanvasErrorBoundary } from "./canvas-error-boundary";
import { EntityDetailDrawer } from "./drawers/entity-detail-drawer";
import { useEntityDetailState } from "./drawers/use-entity-detail-state";
import { EdgeDetailDrawer } from "./drawers/edge-detail-drawer";
import { useEdgeDetailState } from "./drawers/use-edge-detail-state";
import { CycleDetailDrawer } from "./drawers/cycle-detail-drawer";
import { useCycleDetailState } from "./drawers/use-cycle-detail-state";
import { usePathname, useSearchParams } from "next/navigation";
import { useSpaceData } from "@/contexts/space-data-context";

const SHAPE_UTILS = [
  KGNodeShapeUtil,
  // Project-Overview design pass — live landscape overview during a run
  KGFormationShapeUtil,
  StickyNoteShapeUtil,
  SynthesisCardShapeUtil,
  ClusterFrameShapeUtil,
  StrategyShapeUtil,
  ThreadNoteShapeUtil,
  // Phase A1.1 — universal asset catalog: reaction cards
  ReactionCardShapeUtil,
  // Phase A1.2 — universal asset catalog: app cards
  AppCardShapeUtil,
  // Phase A1.3 — universal asset catalog: bridge + cycle
  BridgeLinkShapeUtil,
  CycleLoopShapeUtil,
  // Phase A1.4a — universal asset catalog: claim + axiom
  ClaimChipShapeUtil,
  AxiomStoneShapeUtil,
  // Phase A1.4b — universal asset catalog: convergent + signal
  ConvergentFanShapeUtil,
  SignalFlagShapeUtil,
  // Phase A1.4c — universal asset catalog: twin snapshot
  TwinSnapshotShapeUtil,
  // Phase A1.7 — universal asset catalog: objective tree
  ObjectiveTreeShapeUtil,
  // Phase 2D — universal asset catalog: source card (external inputs)
  SourceCardShapeUtil,
  // Phase 2D — universal asset catalog: ingested file card
  FileCardShapeUtil,
  // Phase 2D — universal asset catalog: thread conversation snapshot
  ThreadSnapshotShapeUtil,
  // Phase 2E · PR 4 — forked proposal snapshot card painted live by
  // the pipeline event painter when proposal_ready events arrive
  ProposalSnapshotShapeUtil,
];

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

// Arc 5A: tether overlay renders above the canvas background, below shapes,
// inside the editor context so it can `useEditor()`. Kept separate from
// HIDDEN_TLDRAW_COMPONENTS so the "hide stock UI" intent stays readable.
const CANVAS_TLDRAW_COMPONENTS = {
  ...HIDDEN_TLDRAW_COMPONENTS,
  InFrontOfTheCanvas: ThreadTethersOverlay,
} as const;

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

  // ── Sync KG entities + edges into tldraw on first mount ──
  useSyncEntities(editor, { entities, edges, enabled: true });

  // ── Auto-surface synthesis insights as cards on the canvas ──
  useSynthesisSeeder(editor, { space, entities, enabled: true });

  // ── Server-backed autosave ──
  const { status: saveStatus } = useCanvasPersistence(editor, { spaceId: space.id });

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

  const { loading: ambientLoading, result: ambient } = useCanvasAmbient({
    spaceId: space.id,
    text: ambientText,
    enabled: !!(activeSticky || selectedEntity),
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
  const { questions: llmProbes, loading: probesLoading } = useCanvasProbes({
    spaceId: space.id,
    text: ambientText,
    nearby: probeNearby,
    enabled: !!(activeSticky || selectedEntity),
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
  const { ingestUrl, ingestFile } = useIngest();
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
    [editor, ingestFile, materialize, placeMaterializedEntity, aiReceipts],
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
    if (!hasFiles && !hasEntity && !hasAsset) return;
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
      <BrainstormContextProvider
        value={{ settings: brainstorm.settings, spaceId: space.id }}
      >
        {/* Phase 1 Step 23 — canvas error boundary. Catches any throw
            from tldraw, shape utils, the pipeline painter, or
            downstream canvas components. On error: renders a
            recoverable fallback with Retry + Reload. Prevents the
            white-screen failure mode where a single bad shape-util
            event would tear down the whole whiteboard view. */}
        <CanvasErrorBoundary>
          <Tldraw
            shapeUtils={SHAPE_UTILS}
            components={CANVAS_TLDRAW_COMPONENTS}
            onMount={(e) => setEditor(e)}
            persistenceKey={`interaxis-canvas-${space.id}`}
          />
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

      {/* Phase 2D — Brainstorm entry button + right-rail panel.
          Hidden in quiet mode (same pattern as the TopBar). */}
      {!quietMode && (
        <>
          <BrainstormToggleButton
            open={brainstormPanelOpen}
            onToggle={() => {
              setBrainstormPanelOpen((v) => !v);
              // First-time open also enables brainstorm mode so the
              // panel doesn't feel inert — user can toggle the master
              // switch off inside the panel if they just want to peek.
              if (!brainstormPanelOpen && !brainstorm.settings.enabled) {
                brainstorm.update({ enabled: true });
              }
            }}
            settings={brainstorm.settings}
            active={hasAnyActiveFeature(brainstorm.settings)}
          />
          <BrainstormPanel
            open={brainstormPanelOpen}
            onClose={() => setBrainstormPanelOpen(false)}
            settings={brainstorm}
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
      <StrategyDrawer
        open={drawerState.drawer === "strategy"}
        onClose={drawerState.closeDrawer}
        activeTab={drawerState.tab}
        onTabChange={drawerState.setTab}
      />
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

      {/* Phase 1 Step 2 — live pipeline-run HUD. Mounts only when the
          URL carries ?run=<uuid>; connects to the SSE stream and shows
          the current stage + counts of persisted artifacts as the
          pipeline emits structural events. */}
      <CanvasEventHud runId={activeRunId} onClose={dismissRun} />

      {/* Phase 2E — origin prompt card. Keeps the user's original
          intake text anchored at top-center during a run so the
          tree of entities materializing below reads as "growing from
          this thought". Falls quiet once the run completes and auto-
          collapses 10s later. Rendered whether or not a run is
          active so returning users still see the origin thought. */}
      {(space as unknown as { input_text?: string | null }).input_text && (
        <CanvasOriginCard
          inputText={
            (space as unknown as { input_text?: string | null }).input_text ?? null
          }
          runActive={Boolean(activeRunId)}
          entityCount={entities.length}
        />
      )}

      {/* Phase 2E · Tier 2 — probability space rail. Subscribes to
          the same SSE stream + renders one floating glass shell per
          axis the frame extractor opened for this run. Shells fan
          out below the origin card, fill in as per-axis generators
          emit space_entity_added events (follow-up phase), then fade
          / converge during the merge animation. Rendered only when
          a run is active so returning users see a clean canvas. */}
      {activeRunId && <ProbabilitySpaceRail runId={activeRunId} />}

      {/* Phase 2E · PR 3 — live AI reasoning stream. Tucks into the
          top-left corner (below top bar, right of tool dock) as a
          quiet glass console. Appears when reasoning_chunk events
          flow, auto-fades 8s after the last chunk. Supporting info —
          never competes with the main graph hierarchy. */}
      <CanvasReasoningStream runId={activeRunId} />

      {/* Phase 1 Step 20 — layer filter toggle. Uses the existing
          `knowledge_layer` tagging on entities to surface the
          internal (decomposition) vs external (research) landscape
          layers as separable views. Hides when there are no
          entities yet — nothing to filter. */}
      <CanvasLayerToggle hasAnyEntity={entities.length > 0} />

      {/* Phase 1 Step 21 — probability spaces badge. Surfaces the
          probability_spaces + space_intersections data that the
          strategy engine already persists into synthesis_data. One
          click opens the Probability drawer focused on Spaces tab,
          where IntersectionHeatmap + ProbabilitySpaceModule render
          the full picture. Closes the "we compute this but no one
          knows" discoverability gap. */}
      <CanvasProbabilityBadge />

      {/* Phase 1 Step 7 — proposal rings overlay. Consumes the same SSE
          stream and renders a right-side stack of cards for each
          proposal_ready event that carried a Monte-Carlo distribution.
          Shows p10→p90 certainty bar + median tick + confidence %
          derived from stddev. Sample-derived uncertainty replacing
          LLM confidence theater on the strategy cards. */}
      <CanvasProposalRings runId={activeRunId} />

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
        onCompleted={onPipelineRunCompleted}
      />

      <CanvasToolDock active={tool} libraryOpen={libraryOpen} onSelect={setTool} />

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
      {!quietMode && (
        <CanvasHudRail
          ctx={hudCtx}
          collapsed={hudCollapsed}
          onToggleCollapsed={() => setHudCollapsed((v) => !v)}
          onDecompose={handleDecompose}
          onJumpToEntity={handleJumpToEntity}
          onAppendQuestion={handleAppendQuestion}
        />
      )}
      {!quietMode && (
        <CanvasBottomDock onSubmit={handleBottomSubmit} loading={decomposing} />
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
    </div>
    </CanvasReactionsContext.Provider>
    </CanvasHierarchyContext.Provider>
    </CanvasAssetCatalogProvider>
  );
}

// ── helpers ──

function createStickyAtCenter(
  editor: Editor,
  opts: { text: string; color?: StickyNoteShape["props"]["color"]; offset?: { x: number; y: number } },
) {
  const viewport = editor.getViewportPageBounds();
  const cx = viewport.midX + (opts.offset?.x ?? 0);
  const cy = viewport.midY + (opts.offset?.y ?? 0);
  const id = createShapeId();
  editor.createShape<StickyNoteShape>({
    id,
    type: "sticky-note",
    x: cx - 100 + (Math.random() - 0.5) * 24,
    y: cy - 100 + (Math.random() - 0.5) * 24,
    props: {
      w: 200,
      h: 200,
      text: opts.text,
      color: opts.color ?? "yellow",
      dimension: null,
      aiTagged: false,
      entityId: null,
    },
  });
  editor.select(id);
  if (opts.text === "") {
    editor.setEditingShape(id);
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

// ── Arc 5A: thread-note creation helper ────────────────────────────────
//
// Drops a ThreadNoteShape tethered to the given parent shape and enters
// edit mode. Chooses accent color from the parent's visible palette so
// the tether + accent bar inherit meaningfully:
//   • kg-node: category-derived indigo default
//   • sticky-note: hard-coded border color per color prop
//   • strategy-card: status accent
//   • thread-note: inherit parent's accent (reply chain)
//   • anything else: indigo fallback
//
// Placement: below-right of the parent with a small random jitter so
// rapid repeat-C doesn't stack threads on top of each other. Depth
// increments when parent is already a thread.
function createThreadOnShape(
  editor: Editor,
  parentShape: TLShape,
): TLShapeId | null {
  // Accent derivation
  let accentHex = "#6366F1"; // indigo-500 default
  if (parentShape.type === "sticky-note") {
    const p = parentShape as StickyNoteShape;
    const map: Record<StickyNoteShape["props"]["color"], string> = {
      yellow: "#F59E0B",
      pink: "#EC4899",
      blue: "#3B82F6",
      green: "#10B981",
      purple: "#8B5CF6",
    };
    accentHex = map[p.props.color] ?? accentHex;
  } else if (parentShape.type === "strategy-card") {
    const p = parentShape as StrategyShape;
    const statusMap = {
      confirmed: "#10B981",
      reviewing: "#F59E0B",
      generated: "#6366F1",
      superseded: "#9CA3AF",
    } as const;
    accentHex = statusMap[p.props.status] ?? accentHex;
  } else if (parentShape.type === "thread-note") {
    accentHex = (parentShape as ThreadNoteShape).props.accentHex || accentHex;
  }

  // Depth + root tracing
  let parentShapeId: string | null;
  let rootShapeId: string;
  let depth: number;
  if (parentShape.type === "thread-note") {
    const t = parentShape as ThreadNoteShape;
    parentShapeId = t.id;
    rootShapeId = t.props.rootShapeId || t.id;
    depth = t.props.depth + 1;
  } else {
    parentShapeId = null;
    rootShapeId = parentShape.id;
    depth = 0;
  }

  // Placement: below-right of parent
  const bounds = editor.getShapePageBounds(parentShape.id);
  if (!bounds) return null;
  const jitter = (Math.random() - 0.5) * 18;
  const x = Math.round(bounds.x + bounds.w + 24 + jitter);
  const y = Math.round(bounds.y + jitter);

  const id = createShapeId();
  editor.markHistoryStoppingPoint(`thread-create-${parentShape.id}`);
  editor.createShape<ThreadNoteShape>({
    id,
    type: "thread-note",
    x,
    y,
    props: {
      w: THREAD_DEFAULT_W,
      h: THREAD_DEFAULT_H,
      threadId: "",
      text: "",
      parentShapeId,
      rootShapeId,
      depth,
      accentHex,
      authorDisplay: "",
      createdAtIso: new Date().toISOString(),
      pending: true,
    },
  });
  editor.select(id);
  editor.setEditingShape(id);
  return id;
}
