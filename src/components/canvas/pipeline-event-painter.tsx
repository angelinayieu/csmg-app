"use client";

// ── Pipeline event painter ──
//
// Watches the structural event stream for the currently-active pipeline
// run and paints ghost tldraw shapes as events arrive. The memory rule
// (feedback_structural_events_only) says canvas renders ONLY persisted-
// artifact events — so each ghost here corresponds to a real
// entities/edges/cycles row that just landed in Postgres.
//
// Reuses the existing KG-node shape's `isGhost` prop (already designed
// for "exists in DB but not yet user-confirmed") rather than adding a
// new shape type. Edges use tldraw's built-in arrow shape, styled dashed
// + grey to match the ghost aesthetic. Cycles toggle `isConvergence` on
// the involved ghost nodes so the shape util renders its cycle accent.
// Bridges (cross-layer connections research produces) paint as gold
// dashed arrows with a distinct accent so they stand out from ordinary
// edges in dense graphs.
//
// On run completion: delete ghost shapes immediately and invoke the
// parent's `onCompleted` callback — InteraxisCanvas uses this to call
// `refreshEntities()` so real kg-node shapes placed by useSyncEntities
// replace the ghosts in the same tick. No linger, no page reload.
//
// Returns null — this component only side-effects the editor. Mount it
// inside InteraxisCanvas with `editor` from state.

import { useEffect, useRef } from "react";
import {
  createShapeId,
  type Editor,
  type TLArrowShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import { useStructuralEventStream, type StreamedEvent } from "./hooks/use-structural-event-stream";
import type { StructuralEvent } from "@/types/pipeline-events";
import type { KGNodeShape, KGFormationShape, ProposalSnapshotShape } from "./shapes/types";
import { normalizeName as normalizeEntityName } from "@/lib/decomposition/extract-candidate-names";

// ── Stagger cadence ──
// Decompose emits its ~15-40 entity_added events in one DB batch, which
// the SSE poll then delivers to this hook as a single large `events`
// delta. Painting all of them in the same React commit skips straight
// to "finished graph" — no animation, no "cards flowing" feel. We pace
// the paint loop with a setTimeout so each persisted artifact lands on
// the canvas ~50ms after the previous one. Order is preserved via
// `sequence` (the stream already sorts), so edges always arrive after
// their endpoints and bind correctly.
//
// Phase 2E tune: reduced from 80ms → 50ms. At 80ms a 30-entity run
// took 2.4s just to paint; at 50ms it's 1.5s — noticeably snappier
// while still reading as staggered animation (not a blur).
const STAGGER_MS = 50;

const GHOST_TIER: KGNodeShape["props"]["tier"] = "support";
const GHOST_W = 220;
const GHOST_H = 112;

// Tree layout spacing — roots fan horizontally from anchor; children
// stack beneath their parent in a balanced-alternating pattern
// (center → right → left → far right → far left…). The spacings are
// generous enough to prevent adjacent subtrees from overlapping when
// decompose emits typical 5-15 entity batches. Arbitrary 2-3 wide
// subtrees may occasionally touch; a full force-layout pass
// post-completion (from useSyncEntities) is the final word.
const ROOT_SPACING = 320;
const SIBLING_SPACING = 260;
const DEPTH_ROW_HEIGHT = 180;

const VALID_CATEGORIES: KGNodeShape["props"]["category"][] = [
  "concrete",
  "abstract",
  "process",
  "relational",
  "epistemic",
  "fault",
];

/**
 * Painter state bundled into a single object so callbacks can share it
 * without a dozen separate refs. Kept inside a useRef() on the component.
 */
interface GhostPosition {
  x: number;
  y: number;
  depth: number;
}

interface PainterState {
  /** Highest sequence enqueued into the paint queue. */
  lastEnqueuedSeq: number;
  /**
   * Pending events waiting to be painted. Drained at `STAGGER_MS`
   * cadence by the drain timer so bulk-emitted batches animate.
   */
  queue: StreamedEvent[];
  /** Active setTimeout id for the drain loop; null when idle. */
  drainTimer: ReturnType<typeof setTimeout> | null;
  /** entity UUID → ghost kg-node shape id */
  ghostsByEntity: Map<string, TLShapeId>;
  /**
   * Normalized entity name → shape id of a *preview* ghost painted from
   * Pass 1 streaming (synthetic `preview-*` UUID). When Pass 2's real
   * entity_added event lands with a matching name, the painter deletes
   * the preview shape and paints the real entity in its place so the
   * user keeps seeing continuous geometry instead of a flicker.
   */
  previewsByName: Map<string, { shapeId: TLShapeId; entityId: string }>;
  /** edge pair key "src→tgt" → ghost arrow shape id */
  ghostEdgesByPair: Map<string, TLShapeId>;
  /** bridge pair key "src→tgt" → ghost bridge-arrow shape id */
  ghostBridgesByPair: Map<string, TLShapeId>;
  /** entity UUID → computed tree position (for sibling math on children). */
  positionsByEntity: Map<string, GhostPosition>;
  /** parent UUID → how many children of that parent have been placed. */
  childCountByParent: Map<string, number>;
  /** Count of root-level (no parent) nodes placed so far. */
  rootCount: number;
  anchor: { x: number; y: number } | null;
  /** Phase 2E · PR 4 — proposal ID → painted snapshot shape id.
   *  Prevents duplicate paints when the same proposal re-broadcasts. */
  proposalsById: Map<string, TLShapeId>;
  /** Counter used to alternate left/right side placement of
   *  proposals anchored to the same entity. */
  proposalCount: number;
  // ── Project-Overview design pass — live KG formation overview ──
  /** tldraw id of the live "Knowledge Graph formation" card, or null
   *  until the first entity lands. Painter creates lazily on first
   *  entity_added rather than up-front so empty runs don't paint an
   *  orphan card. */
  kgFormationShapeId: TLShapeId | null;
  /** Thin dashed connectors from the KG formation card to each
   *  proposal-snapshot. Gives the user a visible "forked out of the
   *  landscape" line per proposal — the origin-chain the design
   *  reference showed via the vertical stage timeline. */
  originArrowIds: TLShapeId[];
  /** entity UUID → current degree (in + out). Bumped on every
   *  edge_added so the "top hubs" computation is O(1). */
  degreesByEntity: Map<string, number>;
  /** entity UUID → cached display name. Needed so we can rebuild the
   *  hubs list from degreesByEntity without another lookup. */
  namesByEntity: Map<string, string>;
  /** Monotonic pulse counter written onto the KG formation shape so
   *  React re-renders even when counts don't visually change. */
  kgFormationPulse: number;
}

// ── Phase 2E · PR 4 — proposal kind → accent ──
// Matches the ProposalSnapshotShape's KIND_META color assignments
// so the forked card + its connector arrow read as a single unit.
const PROPOSAL_ACCENT: Record<
  "strategy" | "experiment" | "variant",
  string
> = {
  strategy: "#D97706",
  experiment: "#0891B2",
  variant: "#8B5CF6",
};

const PROPOSAL_W = 260;
const PROPOSAL_H = 140;
// Distance between target entity's edge and proposal's edge. Wide
// enough that the dashed connector reads cleanly; close enough that
// the pair feels like a unit.
const PROPOSAL_SIDE_OFFSET = 80;

function makeInitialState(): PainterState {
  return {
    lastEnqueuedSeq: 0,
    queue: [],
    drainTimer: null,
    ghostsByEntity: new Map(),
    previewsByName: new Map(),
    ghostEdgesByPair: new Map(),
    ghostBridgesByPair: new Map(),
    positionsByEntity: new Map(),
    childCountByParent: new Map(),
    rootCount: 0,
    anchor: null,
    proposalsById: new Map(),
    proposalCount: 0,
    kgFormationShapeId: null,
    originArrowIds: [],
    degreesByEntity: new Map(),
    namesByEntity: new Map(),
    kgFormationPulse: 0,
  };
}

// ── KG Formation helpers (Project-Overview design pass) ──
//
// The live overview card sits above the anchor and mutates as events
// stream. Creation is lazy — first entity_added event paints it, so an
// empty run never shows an orphan card. Updates are debounced via the
// pulse counter so many edges in quick succession don't thrash React.

const KG_FORMATION_W = 360;
const KG_FORMATION_H = 280;
const KG_FORMATION_OFFSET_Y = 360; // above the anchor row
const HUB_MIN_DEGREE = 2; // a node with ≥2 connections counts as a hub

function ensureKGFormation(editor: Editor, state: PainterState) {
  if (state.kgFormationShapeId) return state.kgFormationShapeId;
  if (!state.anchor) return null;
  const shapeId = createShapeId();
  try {
    editor.createShape<KGFormationShape>({
      id: shapeId,
      type: "kg-formation",
      x: state.anchor.x - KG_FORMATION_W / 2,
      y: state.anchor.y - KG_FORMATION_OFFSET_Y,
      props: {
        w: KG_FORMATION_W,
        h: KG_FORMATION_H,
        entityCount: 0,
        edgeCount: 0,
        hubCount: 0,
        hubsJson: "[]",
        pulse: 0,
        accent: "#2563eb",
      },
    });
    state.kgFormationShapeId = shapeId;
    return shapeId;
  } catch (err) {
    console.warn("[pipeline-painter] kg-formation create failed:", err);
    return null;
  }
}

function bumpKGFormation(editor: Editor, state: PainterState) {
  const shapeId = state.kgFormationShapeId;
  if (!shapeId) return;
  // Count persisted (non-preview) entities only — preview ghosts are
  // transient. This matches what the design reference shows: the
  // confirmed-landscape count, not the speculative one.
  let entityCount = 0;
  for (const id of state.ghostsByEntity.keys()) {
    if (!id.startsWith("preview-")) entityCount++;
  }
  // Count real edges (bridges kept separate by their own map).
  const edgeCount = state.ghostEdgesByPair.size;

  // Top-6 hubs by degree — stable sort so equal-degree ties preserve
  // insertion order. Hub list feeds the mini-graph in the shape view.
  const hubEntries: Array<{ name: string; degree: number }> = [];
  for (const [entityId, degree] of state.degreesByEntity) {
    if (degree < HUB_MIN_DEGREE) continue;
    const name = state.namesByEntity.get(entityId);
    if (!name) continue;
    hubEntries.push({ name, degree });
  }
  hubEntries.sort((a, b) => b.degree - a.degree);
  const topHubs = hubEntries.slice(0, 6);
  const hubCount = hubEntries.length;

  state.kgFormationPulse++;
  try {
    editor.updateShape<KGFormationShape>({
      id: shapeId,
      type: "kg-formation",
      props: {
        entityCount,
        edgeCount,
        hubCount,
        hubsJson: JSON.stringify(topHubs),
        pulse: state.kgFormationPulse,
      },
    });
  } catch (err) {
    // Shape may have been deleted by run-completion cleanup while an
    // event was still in flight — swallow.
    console.warn("[pipeline-painter] kg-formation update failed:", err);
  }
}

/**
 * Balanced-alternating offset from a center point. Index 0 sits at
 * center, 1 to the right, 2 to the left, 3 far right, 4 far left, etc.
 * Gives a visible fan-out instead of a rightward drift when a parent
 * has many children arriving in sequence.
 */
function alternatingOffset(index: number, spacing: number): number {
  if (index === 0) return 0;
  const magnitude = Math.ceil(index / 2) * spacing;
  const sign = index % 2 === 1 ? 1 : -1;
  return magnitude * sign;
}

interface PipelineEventPainterProps {
  editor: Editor | null;
  runId: string | null;
  /**
   * When truthy, ghosts are not painted. Pass this when another code
   * path is responsible for placing these shapes (e.g. a parent-canvas
   * sync is already live). Defaults to false.
   */
  disabled?: boolean;
  /**
   * Fires once when the run's SSE stream reports a terminal status
   * (completed OR failed). InteraxisCanvas wires this to
   * `useSpaceData().refreshEntities()` so the authoritative kg-nodes
   * replace the ghosts in the same tick.
   */
  onCompleted?: () => void | Promise<unknown>;
}

export function PipelineEventPainter({
  editor,
  runId,
  disabled,
  onCompleted,
}: PipelineEventPainterProps) {
  const { events, status } = useStructuralEventStream(runId);
  const stateRef = useRef<PainterState>(makeInitialState());

  // Enqueue newly-arrived events onto the stagger queue + ensure the
  // drain loop is running. The ACTUAL paint happens in the drain
  // callback so that a bulk SSE delivery animates across time instead
  // of collapsing into a single React commit.
  useEffect(() => {
    if (!editor || disabled || !runId) return;
    if (events.length === 0) return;

    const state = stateRef.current;

    if (!state.anchor) {
      const vp = editor.getViewportPageBounds();
      state.anchor = { x: vp.midX, y: vp.midY - 100 };
    }

    // Append any events we haven't enqueued yet. The stream hook
    // already sorts by sequence, so a simple high-water filter
    // preserves order.
    let enqueued = 0;
    for (const streamed of events) {
      if (streamed.sequence <= state.lastEnqueuedSeq) continue;
      state.queue.push(streamed);
      state.lastEnqueuedSeq = streamed.sequence;
      enqueued++;
    }
    if (enqueued === 0) return;

    // Boot the drain loop if it isn't already running. The loop
    // re-schedules itself as long as the queue has items.
    if (state.drainTimer === null) {
      const drain = () => {
        const s = stateRef.current;
        const next = s.queue.shift();
        if (!next) {
          s.drainTimer = null;
          return;
        }
        try {
          paintEvent(editor, next.event, s);
        } catch (err) {
          console.warn("[pipeline-painter] paint failed:", err);
        }
        s.drainTimer = setTimeout(drain, STAGGER_MS);
      };
      state.drainTimer = setTimeout(drain, 0);
    }
  }, [events, editor, disabled, runId]);

  // When the runId changes, reset the painter's state — a new run
  // starts painting fresh from a new anchor. Cancel any in-flight
  // drain timer from the previous run so its queued paints don't
  // bleed into the new run.
  useEffect(() => {
    const prev = stateRef.current;
    if (prev.drainTimer !== null) {
      clearTimeout(prev.drainTimer);
    }
    stateRef.current = makeInitialState();
  }, [runId]);

  // Drain timer must also clear on unmount to avoid "setState on
  // unmounted" warnings — paintEvent touches the tldraw editor, which
  // may be disposed on route change.
  useEffect(() => {
    return () => {
      const s = stateRef.current;
      if (s.drainTimer !== null) {
        clearTimeout(s.drainTimer);
        s.drainTimer = null;
      }
    };
  }, []);

  // Terminal-status handler: delete ghosts + fire the refresh callback
  // simultaneously. The parent's onCompleted (wired to
  // useSpaceData().refreshEntities()) re-fetches the authoritative
  // entity/edge list — useSyncEntities then paints real kg-nodes at
  // proper tier-layered positions in the same tick the ghosts vanish.
  useEffect(() => {
    if (!editor) return;
    if (status !== "completed" && status !== "failed") return;

    const state = stateRef.current;
    // Cancel any in-flight stagger drain — the run is done; further
    // paints would just be deleted by the cleanup below.
    if (state.drainTimer !== null) {
      clearTimeout(state.drainTimer);
      state.drainTimer = null;
    }
    state.queue = [];

    const shapeIds: TLShapeId[] = [
      // Delete arrows first — they have bindings to the node shapes.
      ...state.ghostEdgesByPair.values(),
      ...state.ghostBridgesByPair.values(),
      // Project-Overview origin connectors bound to the KG formation
      // card + proposal snapshots. Must delete before the shapes
      // themselves to avoid dangling binding errors.
      ...state.originArrowIds,
      // Phase 2E · PR 4 — proposal snapshots + their connector arrows
      // clean up alongside ghosts. Proposals remain accessible via the
      // right-rail canvas-proposal-rings overlay; their forked-card
      // presence was for the run duration only. Connector arrows
      // bound to now-deleted ghost shapes would otherwise dangle.
      ...state.proposalsById.values(),
      ...state.ghostsByEntity.values(),
      // Project-Overview live landscape — ephemeral, lives only during
      // the run. The post-run canvas has the real KG visible via the
      // sync-entities layout, so keeping this overlay would double-
      // count the information.
      ...(state.kgFormationShapeId ? [state.kgFormationShapeId] : []),
    ];
    if (shapeIds.length > 0) {
      try {
        editor.deleteShapes(shapeIds);
      } catch (err) {
        console.warn("[pipeline-painter] cleanup failed:", err);
      }
    }
    state.ghostsByEntity.clear();
    state.previewsByName.clear();
    state.ghostEdgesByPair.clear();
    state.ghostBridgesByPair.clear();
    state.proposalsById.clear();
    state.proposalCount = 0;
    state.positionsByEntity.clear();
    state.childCountByParent.clear();
    state.rootCount = 0;
    // Project-Overview live landscape — clear so next run starts fresh.
    state.kgFormationShapeId = null;
    state.degreesByEntity.clear();
    state.namesByEntity.clear();
    state.kgFormationPulse = 0;
    state.originArrowIds = [];

    if (onCompleted) {
      try {
        const maybePromise = onCompleted();
        if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
          (maybePromise as Promise<unknown>).catch((err) =>
            console.warn("[pipeline-painter] onCompleted rejected:", err),
          );
        }
      } catch (err) {
        console.warn("[pipeline-painter] onCompleted threw:", err);
      }
    }
  }, [status, editor, onCompleted]);

  return null;
}

function paintEvent(
  editor: Editor,
  event: StructuralEvent,
  state: PainterState,
) {
  switch (event.type) {
    case "entity_added":
      paintEntity(editor, event, state);
      return;
    case "edge_added":
      paintEdge(editor, event, state);
      return;
    case "cycle_detected":
      paintCycle(editor, event, state);
      return;
    case "bridge_formed":
      paintBridge(editor, event, state);
      return;
    case "proposal_ready":
      // Phase 2E · PR 4 — fork the proposal off its target entity
      // as a dashed-connected snapshot card. Only paints when the
      // proposal carries a targetEntityId already on the canvas.
      // Orphan proposals (no target) still flow to the existing
      // canvas-proposal-rings overlay as before.
      paintProposal(editor, event, state);
      return;
    default:
      // stage_boundary / source_cited / prediction_recorded — HUD
      // + overlay panels only, no canvas geometry. Sources +
      // predictions don't have spatial identity.
      return;
  }
}

function paintEntity(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "entity_added" }>,
  state: PainterState,
) {
  if (state.ghostsByEntity.has(event.entityId)) return;
  if (!state.anchor) return;

  const isPreview = event.entityId.startsWith("preview-");
  const normalizedName = normalizeEntityName(event.name);

  // Preview dedup: if this is a real entity_added (Pass 2) and a preview
  // with the same normalized name was painted during Pass 1, keep the
  // existing shape's position but rebind it to the real entityId. That
  // removes the "preview fades, real pops in new spot" flicker — the
  // entity stays exactly where the user first saw it, just upgraded.
  if (!isPreview && normalizedName) {
    const existingPreview = state.previewsByName.get(normalizedName);
    if (existingPreview) {
      const previewPos = state.positionsByEntity.get(existingPreview.entityId);
      // Update tldraw shape props with the real entityId + real metadata.
      try {
        editor.updateShape<KGNodeShape>({
          id: existingPreview.shapeId,
          type: "kg-node",
          props: {
            entityId: event.entityId,
            name: event.name.slice(0, 80),
            category: normalizeCategory(event.entityCategory),
            tier: tierForImportance(event.importance),
          },
        });
      } catch {
        // updateShape can throw if the shape was removed mid-flight;
        // fall through and paint fresh below.
      }
      // Rewire state: the preview's synthetic id goes away, the real id
      // takes over the same shape + position.
      const oldId = existingPreview.entityId;
      state.previewsByName.delete(normalizedName);
      state.ghostsByEntity.delete(oldId);
      state.positionsByEntity.delete(oldId);
      state.ghostsByEntity.set(event.entityId, existingPreview.shapeId);
      if (previewPos) {
        state.positionsByEntity.set(event.entityId, previewPos);
      }
      // Preview-edge dedup: any preview edges that referenced this
      // preview entity as src or tgt must be dropped — Pass 2's real
      // edges arrive keyed by the new real UUIDs, and without this
      // cleanup the painter would stack a second arrow between the
      // same two shapes (double-draw). Delete the arrow shapes + the
      // map entries so paintEdge() redraws fresh when real edges land.
      const staleEdgeKeys: string[] = [];
      const staleArrowIds: TLShapeId[] = [];
      for (const [key, arrowId] of state.ghostEdgesByPair) {
        if (key.startsWith(`${oldId}→`) || key.endsWith(`→${oldId}`)) {
          staleEdgeKeys.push(key);
          staleArrowIds.push(arrowId);
        }
      }
      if (staleArrowIds.length > 0) {
        try {
          editor.deleteShapes(staleArrowIds);
        } catch {
          // shape may already be gone — fall through; map cleanup still needed
        }
        for (const key of staleEdgeKeys) state.ghostEdgesByPair.delete(key);
      }
      return;
    }
  }

  // Tree layout: place children beneath their parent in an alternating
  // fan (center → right → left → far right → far left…). Root nodes
  // (parentEntityId missing OR parent not yet painted) fan horizontally
  // around the anchor. This is the "decomposition forks out as it
  // unfurls" visual the grid layout was blocking.
  const parentId = event.parentEntityId ?? null;
  const parentPos = parentId ? state.positionsByEntity.get(parentId) : null;

  let x: number;
  let y: number;
  let depth: number;

  if (parentPos) {
    const siblingIdx = state.childCountByParent.get(parentId!) ?? 0;
    state.childCountByParent.set(parentId!, siblingIdx + 1);
    depth = parentPos.depth + 1;
    x = parentPos.x + alternatingOffset(siblingIdx, SIBLING_SPACING);
    y = parentPos.y + DEPTH_ROW_HEIGHT;
  } else {
    const rootIdx = state.rootCount;
    state.rootCount++;
    depth = 0;
    x = state.anchor.x + alternatingOffset(rootIdx, ROOT_SPACING);
    y = state.anchor.y;
  }

  const category = normalizeCategory(event.entityCategory);
  const tier = tierForImportance(event.importance);

  const shapeId = createShapeId();
  editor.createShape<KGNodeShape>({
    id: shapeId,
    type: "kg-node",
    x,
    y,
    props: {
      w: GHOST_W,
      h: GHOST_H,
      entityId: event.entityId,
      name: event.name.slice(0, 80),
      description: "",
      layer: "L2",
      category,
      tier,
      weight: 0.5,
      isLeverage: false,
      isRisk: false,
      isBottleneck: false,
      isConvergence: false,
      isGhost: true,
    },
  });
  state.ghostsByEntity.set(event.entityId, shapeId);
  state.positionsByEntity.set(event.entityId, { x, y, depth });
  state.namesByEntity.set(event.entityId, event.name);
  if (isPreview && normalizedName) {
    state.previewsByName.set(normalizedName, {
      shapeId,
      entityId: event.entityId,
    });
  }

  // Project-Overview live landscape — lazy create on first real entity,
  // then bump counts. Previews keep their own ghost but don't swell the
  // landscape card so the displayed count matches persisted artifacts.
  ensureKGFormation(editor, state);
  if (!isPreview) bumpKGFormation(editor, state);
}

// ── Edge style mapping ──
// tldraw arrow colors/dash styles are a fixed enum, so we map the
// semantic encoding (polarity, dimension) onto those slots. This is
// what makes the canvas read as "legit generation" instead of "all
// edges look the same" — a positive causal link is green+solid, a
// negative inhibition is red+solid, a structural relationship is
// grey+dashed, etc.
type ArrowColor = TLArrowShape["props"]["color"];
type ArrowDash = TLArrowShape["props"]["dash"];

function colorForPolarity(polarity: string | null | undefined): ArrowColor {
  if (polarity === "positive") return "green";
  if (polarity === "negative") return "red";
  return "grey";
}

function dashForDimension(dimension: string | null | undefined): ArrowDash {
  if (dimension === "causal") return "solid";
  if (dimension === "temporal") return "dotted";
  // structural / functional / fallback — dashed reads as "connective"
  return "dashed";
}

function paintEdge(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "edge_added" }>,
  state: PainterState,
) {
  // Only draw edges between entities we've already ghosted. Research-
  // layer edges often connect to already-persisted internal entities
  // that weren't streamed — skip those silently.
  const fromShape = state.ghostsByEntity.get(event.sourceEntityId);
  const toShape = state.ghostsByEntity.get(event.targetEntityId);
  if (!fromShape || !toShape) return;

  const pairKey = `${event.sourceEntityId}→${event.targetEntityId}`;
  if (state.ghostEdgesByPair.has(pairKey)) return;

  const isPreview = event.edgeId.startsWith("preview-");
  const arrowId = createShapeId();
  try {
    const arrow: TLShapePartial<TLArrowShape> = {
      id: arrowId,
      type: "arrow",
      props: {
        // Preview (Pass 1 regex-derived) edges always read as tentative
        // grey-dashed; real (Pass 2) edges encode polarity + dimension.
        color: isPreview ? "grey" : colorForPolarity(event.polarity),
        size: "s",
        dash: isPreview ? "dashed" : dashForDimension(event.dimension),
      },
    };
    editor.createShapes([arrow]);
    editor.createBindings([
      {
        fromId: arrowId,
        toId: fromShape,
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
        toId: toShape,
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
    state.ghostEdgesByPair.set(pairKey, arrowId);

    // Project-Overview live landscape — bump degree on both endpoints
    // (treat edges as undirected for hub discovery) and repaint counts.
    const prevSrc = state.degreesByEntity.get(event.sourceEntityId) ?? 0;
    const prevTgt = state.degreesByEntity.get(event.targetEntityId) ?? 0;
    state.degreesByEntity.set(event.sourceEntityId, prevSrc + 1);
    state.degreesByEntity.set(event.targetEntityId, prevTgt + 1);
    bumpKGFormation(editor, state);
  } catch (err) {
    console.warn("[pipeline-painter] arrow binding failed:", err);
  }
}

function paintBridge(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "bridge_formed" }>,
  state: PainterState,
) {
  // Bridges span cross-layer relationships the research / synthesis
  // stages discovered. We only paint when both endpoints are already
  // ghosted — the bridge_formed event may also fire for pre-existing
  // internal entities that weren't streamed as ghosts this run, and
  // those aren't meaningful to visualize here.
  const fromShape = state.ghostsByEntity.get(event.sourceEntityId);
  const toShape = state.ghostsByEntity.get(event.targetEntityId);
  if (!fromShape || !toShape) return;

  const pairKey = `${event.sourceEntityId}→${event.targetEntityId}`;
  if (state.ghostBridgesByPair.has(pairKey)) return;

  const arrowId = createShapeId();
  try {
    const arrow: TLShapePartial<TLArrowShape> = {
      id: arrowId,
      type: "arrow",
      props: {
        // Gold/yellow separates bridges from the grey/dashed regular
        // edges the prior paintEdge() function draws. Size 'm' gives
        // them slightly more weight so the cross-layer relationship
        // reads as a distinct class at a glance.
        color: "yellow",
        size: "m",
        dash: "dashed",
      },
    };
    editor.createShapes([arrow]);
    editor.createBindings([
      {
        fromId: arrowId,
        toId: fromShape,
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
        toId: toShape,
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
    state.ghostBridgesByPair.set(pairKey, arrowId);
  } catch (err) {
    console.warn("[pipeline-painter] bridge binding failed:", err);
  }
}

// ── Phase 2E · PR 4 — paint forked proposal snapshots ──
//
// A `proposal_ready` event with a `targetEntityId` that's already
// been painted as a ghost on the canvas becomes a
// "proposal-snapshot" shape docked to the side of its target, with
// a dashed amber arrow connecting the two. Alternating left/right
// side placement (via `state.proposalCount`) keeps the composition
// balanced when multiple proposals fork off sibling entities.
//
// Proposals without a `targetEntityId`, or with a target that
// hasn't been ghosted, fall through silently — the existing
// `canvas-proposal-rings` right-rail overlay still picks them up.

function paintProposal(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "proposal_ready" }>,
  state: PainterState,
) {
  if (!event.targetEntityId) return;
  if (state.proposalsById.has(event.proposalId)) return;

  const targetShapeId = state.ghostsByEntity.get(event.targetEntityId);
  const targetPos = state.positionsByEntity.get(event.targetEntityId);
  if (!targetShapeId || !targetPos) return;

  // Alternate left/right so subsequent proposals fan to both sides.
  const side: "left" | "right" = state.proposalCount % 2 === 0 ? "right" : "left";

  // Ghost KG nodes are GHOST_W (220) wide, so a right-side proposal
  // starts at `targetPos.x + GHOST_W + PROPOSAL_SIDE_OFFSET`;
  // left-side proposals start at `targetPos.x - PROPOSAL_W -
  // PROPOSAL_SIDE_OFFSET`.
  const proposalX =
    side === "right"
      ? targetPos.x + GHOST_W + PROPOSAL_SIDE_OFFSET
      : targetPos.x - PROPOSAL_W - PROPOSAL_SIDE_OFFSET;
  const proposalY =
    targetPos.y + (GHOST_H - PROPOSAL_H) / 2; // vertically centered on target

  const accent = PROPOSAL_ACCENT[event.kind] ?? "#D97706";
  const proposalShapeId = createShapeId();
  const arrowId = createShapeId();

  try {
    const proposal: TLShapePartial<ProposalSnapshotShape> = {
      id: proposalShapeId,
      type: "proposal-snapshot",
      x: proposalX,
      y: proposalY,
      props: {
        w: PROPOSAL_W,
        h: PROPOSAL_H,
        proposalId: event.proposalId,
        kind: event.kind,
        title: event.title,
        headline: event.headline ?? "",
        targetEntityId: event.targetEntityId,
        p10: event.distribution?.p10 ?? null,
        p50: event.distribution?.p50 ?? null,
        p90: event.distribution?.p90 ?? null,
        accent,
        // PR 5 — carry axis provenance onto the shape so the shape
        // util can render axis badges. Defaults to empty array when
        // the event doesn't carry the field (legacy events or
        // emitters that predate PR 5).
        axesUsed: event.axes_used ?? [],
      },
      meta: { source: "pipeline-event" },
    };
    editor.createShapes([proposal]);

    // Dashed amber connector from target entity → proposal card.
    // Anchor points pick the entity's side that faces the proposal
    // (x: 0 or 1) so the arrow exits naturally.
    const arrow: TLShapePartial<TLArrowShape> = {
      id: arrowId,
      type: "arrow",
      props: {
        color: "orange",
        size: "s",
        dash: "dashed",
      },
      meta: { source: "proposal-connector" },
    };
    editor.createShapes([arrow]);
    editor.createBindings([
      {
        fromId: arrowId,
        toId: targetShapeId,
        type: "arrow",
        props: {
          terminal: "start",
          normalizedAnchor: {
            x: side === "right" ? 1 : 0,
            y: 0.5,
          },
          isExact: false,
          isPrecise: true,
        },
        meta: {},
      },
      {
        fromId: arrowId,
        toId: proposalShapeId,
        type: "arrow",
        props: {
          terminal: "end",
          normalizedAnchor: {
            x: side === "right" ? 0 : 1,
            y: 0.5,
          },
          isExact: false,
          isPrecise: true,
        },
        meta: {},
      },
    ]);

    state.proposalsById.set(event.proposalId, proposalShapeId);
    state.proposalCount += 1;

    // Project-Overview design pass — thin dotted connector from the
    // live KG formation card ("the landscape") to this proposal, so
    // the user sees each fork trace back to the originating context.
    // Proposal→entity arrow handles the near-field chain; this one
    // handles the far-field "where did this come from" question the
    // design reference made explicit via the vertical timeline.
    if (state.kgFormationShapeId) {
      const originArrowId = createShapeId();
      try {
        const originArrow: TLShapePartial<TLArrowShape> = {
          id: originArrowId,
          type: "arrow",
          props: {
            color: "grey",
            size: "s",
            dash: "dotted",
          },
          meta: { source: "proposal-origin-connector" },
        };
        editor.createShapes([originArrow]);
        editor.createBindings([
          {
            fromId: originArrowId,
            toId: state.kgFormationShapeId,
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
            fromId: originArrowId,
            toId: proposalShapeId,
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
        state.originArrowIds.push(originArrowId);
      } catch (err) {
        // Non-fatal — the near-field entity arrow is the primary link.
        console.warn("[pipeline-painter] origin connector failed:", err);
      }
    }
  } catch (err) {
    console.warn("[pipeline-painter] proposal paint failed:", err);
  }
}

function paintCycle(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "cycle_detected" }>,
  state: PainterState,
) {
  // Flip isConvergence on each ghost in the cycle — the KG-node shape
  // util renders this as a distinct accent. If an entity in the cycle
  // wasn't streamed as a ghost (pre-existing internal entity), skip it.
  for (const entityId of event.entityIds) {
    const shapeId = state.ghostsByEntity.get(entityId);
    if (!shapeId) continue;
    try {
      editor.updateShape<KGNodeShape>({
        id: shapeId,
        type: "kg-node",
        props: { isConvergence: true },
      });
    } catch (err) {
      console.warn("[pipeline-painter] cycle highlight failed:", err);
    }
  }
}

function normalizeCategory(
  raw: string | null | undefined,
): KGNodeShape["props"]["category"] {
  if (!raw) return "concrete";
  const found = VALID_CATEGORIES.find((c) => c === raw);
  return found ?? "concrete";
}

function tierForImportance(
  importance: string | null | undefined,
): KGNodeShape["props"]["tier"] {
  if (importance === "fundamental" || importance === "critical") return "key";
  if (importance === "important") return "support";
  if (importance === "minor") return "peripheral";
  return GHOST_TIER;
}
