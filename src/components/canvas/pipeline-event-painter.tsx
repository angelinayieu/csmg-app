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

import { useEffect, useRef, useState } from "react";
import {
  createShapeId,
  toRichText,
  type Editor,
  type TLArrowShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import { type StreamedEvent } from "./hooks/use-structural-event-stream";
import { useRunEventStore } from "./hooks/run-event-store";
// PainterState shape + initial-state constructor live in their own
// file so the painter component, the camera orchestration, and any
// future paint-handler split can all share types without circular
// imports.
import { makeInitialState, type PainterState } from "./painter-state";
// Camera orchestration. fitViewportToUnfurl is the painter's only
// programmatic camera mover during a live run; it's gated by the
// followCamera + isPointing checks documented in painter-camera.ts.
import { fitViewportToUnfurl, MAX_FIT_DIMENSION } from "./painter-camera";
import type { StructuralEvent, ProbabilitySpaceAxis } from "@/types/pipeline-events";
import { PAINT_GLOBAL_GHOST_KG_NODES } from "@/lib/whiteboard/canvas-feature-flags";
import type {
  KGNodeShape,
  KGFormationShape,
  OriginPromptShape,
  ProbabilitySpaceShellShape,
  ProposalSnapshotShape,
  ProposalChainRibbonShape,
  ExperimentDesignCardShape,
  SynthesisIntersectionCardShape,
  AssetCardShape,
  SituationCardShape,
  StrategyHeroCardShape,
  RoomShape,
  TaxonomyCardShape,
  VariantCardShape,
  RootCauseTreeShape,
  DownstreamRealityShape,
  IVDecompositionShape,
  VariantCarouselShape,
  StageNodeShape,
} from "./shapes/types";
import {
  ORIGIN_PROMPT_DEFAULT_H,
  ORIGIN_PROMPT_DEFAULT_W,
} from "./shapes/origin-prompt-shape";
import {
  SPACE_SHELL_DEFAULT_H,
  SPACE_SHELL_DEFAULT_W,
} from "./shapes/probability-space-shell-shape";
import {
  STRATEGY_HERO_DEFAULT_W,
  STRATEGY_HERO_DEFAULT_H,
} from "./shapes/strategy-hero-card-shape";
import {
  STAGE_ROOMS,
  computeRoomBounds,
  buildRoomSubtitle,
  roomForEventType,
  placeInsideRoom,
  ROOM_PADDING,
  EMPTY_ROOM_COUNTS,
  type RoomCounts,
} from "@/lib/whiteboard/room-layout";
import { normalizeName as normalizeEntityName } from "@/lib/decomposition/extract-candidate-names";
import { HubTracker } from "@/lib/graph/hub-discovery";

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

// P0 #3 — dual cadence.
//
// SSE replays ALL persisted events on reconnect (including mid-run
// refresh + initial hydration of an in-progress run). If the backlog
// is large (say 100 events from a 60-second-old run) and we drain at
// the normal 50ms cadence, the user waits 5 seconds watching "history"
// replay before live events reach the canvas — and in the meantime,
// real new events arriving from the live stream queue behind the
// replay, making the unfurl feel laggy.
//
// Dual-cadence fix: if we enqueue more than BURST_THRESHOLD events in
// a single React commit (classic backlog signature — the initial
// useEffect fire delivers `events.length` items at once), we burst
// through them at BURST_STAGGER_MS. Live events arriving later come
// in one-or-two at a time and fall back to the normal STAGGER_MS.
//
// BURST_STAGGER_MS is low enough to feel like a flip-book (still
// staggered, not a single commit) but 5× faster than live cadence,
// so a 100-event backlog takes 1s instead of 5s.
const BURST_THRESHOLD = 12;
const BURST_STAGGER_MS = 10;

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
// T3.3 — subtree-width-aware fan factors. Without these, a parent at
// depth D has children at ±SIBLING_SPACING, but each of those children
// will itself have grandchildren at ±SIBLING_SPACING → two cousin
// subtrees mathematically overlap because the parent-pair gap (520)
// is less than each subtree's own reach (2 × 390 = 780). Inflating
// the gap at shallow depths by these factors prevents the collision
// without inflating dense leaf clusters.
//
// Depth 0 (roots under anchor):     2.5× spacing for each root's subtree
// Depth 1 (roots' children):        1.8× spacing for grandchildren
// Depth 2+ (denser leaf zones):     1.0× — original spacing is fine here
function fanFactor(depth: number): number {
  if (depth <= 0) return 2.5;
  if (depth === 1) return 1.8;
  return 1.0;
}

const VALID_CATEGORIES: KGNodeShape["props"]["category"][] = [
  "concrete",
  "abstract",
  "process",
  "relational",
  "epistemic",
  "fault",
];


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
// Project-Overview design pass — chain ribbon dimensions + vertical
// offset so it sits directly below the snapshot card with a 6px gap.
// Kept in sync with proposal-chain-ribbon-shape's RIBBON_DEFAULT_W/H.
const RIBBON_W = PROPOSAL_W;
const RIBBON_H = 52;
const RIBBON_VGAP = 6;

// Experiment design card (5-column IV/DV/Control/Process/Results layout).
// Sits under the chain ribbon for experiment-kind proposals only.
// Wider than the snapshot — anchors at the snapshot's x for right-side
// proposals (extends rightward) and at snapshot's right edge minus the
// design width for left-side proposals (extends leftward) so it never
// crosses back over the source entity.
const EXPERIMENT_DESIGN_W = 560;
const EXPERIMENT_DESIGN_H = 240;
const EXPERIMENT_DESIGN_VGAP = 8;

// ── KG Formation helpers (Project-Overview design pass) ──
//
// The live overview card sits above the anchor and mutates as events
// stream. Creation is lazy — first entity_added event paints it, so an
// empty run never shows an orphan card. Updates are debounced via the
// pulse counter so many edges in quick succession don't thrash React.

const KG_FORMATION_W = 360;
const KG_FORMATION_H = 280;
const KG_FORMATION_OFFSET_Y = 360; // above the anchor row
// HUB_MIN_DEGREE lives in @/lib/graph/hub-discovery so the live card,
// post-run context consumers, and future SpaceGraph highlights all
// agree on "what counts as a hub".

// Canvas lineage stack (bottom-up, y values are anchor-relative tops):
//   • kg-formation:  top = anchor.y - 360 (height 280, bottom -80)
//   • shell row:     top = anchor.y - 620 (height 200, bottom -420)
//   • origin prompt: top = anchor.y - 820 (height 140, bottom -680)
// Each band has a 60px gap above the next one down, so dotted tethers
// between them stay legible.
const SPACE_SHELL_VERTICAL_GAP = 60;
// Shell row TOP offset is 620 (see SPACE_SHELL_ROW_Y_OFFSET below).
// Origin bottom sits GAP above that; origin top is that + origin height.
const ORIGIN_PROMPT_OFFSET_Y = 620 + SPACE_SHELL_VERTICAL_GAP + ORIGIN_PROMPT_DEFAULT_H;

function ensureOriginPrompt(
  editor: Editor,
  state: PainterState,
  promptText: string | null,
): TLShapeId | null {
  // No prompt text = no card. Painter-run without intake context
  // (strategy-refresh, manual decompose, …) gracefully skips.
  if (!promptText || !promptText.trim()) return null;
  if (state.originPromptShapeId) return state.originPromptShapeId;
  if (!state.anchor) return null;
  const shapeId = createShapeId();
  try {
    // Place inside the `intake` room's content area, centered
    // horizontally, ~16px below the room header. Room bounds are
    // deterministic from the anchor so this works even when the room
    // shape itself hasn't been created yet (the painter creates it on
    // the first stage_boundary event; until then this position is
    // off-screen but consistent with where the room will land).
    const placement = placeInsideRoom(
      "intake",
      state.anchor,
      0,
      16,
    );
    editor.createShape<OriginPromptShape>({
      id: shapeId,
      type: "origin-prompt",
      x: placement.x - ORIGIN_PROMPT_DEFAULT_W / 2,
      y: placement.y,
      props: {
        w: ORIGIN_PROMPT_DEFAULT_W,
        h: ORIGIN_PROMPT_DEFAULT_H,
        promptText: promptText.trim(),
        runActive: true,
        accent: "#8B5CF6",
      },
    });
    state.originPromptShapeId = shapeId;
    recordChildBottomForStage(
      editor,
      state,
      "intake",
      placement.y + ORIGIN_PROMPT_DEFAULT_H,
    );
    // Fit the viewport so the user sees the prompt card immediately.
    // The painter's anchor lives at viewport midY − 100 but we just
    // placed origin-prompt ~820px above the anchor (well outside the
    // default viewport). Without an explicit fit, users see an empty
    // canvas until stage_boundary fires much later in the run.
    fitViewportToUnfurl(editor, state);
    return shapeId;
  } catch (err) {
    console.warn("[pipeline-painter] origin-prompt create failed:", err);
    return null;
  }
}

function ensureKGFormation(editor: Editor, state: PainterState) {
  if (state.kgFormationShapeId) return state.kgFormationShapeId;
  if (!state.anchor) return null;

  // Dedup across painter remounts: if our local state has no record of
  // a kg-formation shape but one already exists on the canvas (from a
  // restored snapshot or a hot reload that reset PainterState), adopt
  // it instead of stamping a duplicate. Mirrors the room dedup at
  // upsertRoomForStage. Without this, snapshot restore + new run can
  // produce two kg-formation cards at different anchor positions.
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== "kg-formation") continue;
    state.kgFormationShapeId = shape.id;
    return shape.id;
  }

  const shapeId = createShapeId();
  try {
    // Place inside the `kg` room — the live overview card lives here
    // so the user sees the entities + edges piling up inside the
    // "Knowledge graph" room that owns the stage. Centered, with a
    // ~16px gap below the room header.
    const placement = placeInsideRoom("kg", state.anchor, 0, 16);
    editor.createShape<KGFormationShape>({
      id: shapeId,
      type: "kg-formation",
      x: placement.x - KG_FORMATION_W / 2,
      y: placement.y,
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
    recordChildBottomForStage(
      editor,
      state,
      "kg",
      placement.y + KG_FORMATION_H,
    );
    // Tether UP to the origin-prompt so the entire downstream tree
    // reads as branching from the user's thought. Silent no-op when
    // there's no prompt (strategy-refresh, etc.) — kg-formation just
    // becomes the visible root in that case.
    if (state.originPromptShapeId) {
      tetherBetween(
        editor,
        state,
        state.originPromptShapeId,
        shapeId,
        "landscape",
      );
    }
    return shapeId;
  } catch (err) {
    console.warn("[pipeline-painter] kg-formation create failed:", err);
    return null;
  }
}

function bumpKGFormation(editor: Editor, state: PainterState) {
  const shapeId = state.kgFormationShapeId;
  if (!shapeId) return;

  // Counts come from the hub tracker — single source of truth that
  // works whether or not we're painting global ghost shapes (Phase
  // 1+ architecture: entities live in shells, not on the global
  // canvas). Preview-* entities aren't filtered separately because
  // the tracker's rebindEntity moves names to real ids on Pass 2
  // upgrade, so stale preview keys are an edge case (would need an
  // intentionally-discarded preview), not the normal path.
  const entityCount = state.hubTracker.entityCount();
  const edgeCount = state.hubTracker.edgeCount();

  // Hub math delegates to the shared tracker — same definition the
  // post-run context (computeHubsFromGraph) uses.
  const fullHubs = state.hubTracker.topHubs();
  const topHubs = fullHubs.map(({ name, degree }) => ({ name, degree }));
  const hubCount = state.hubTracker.hubCount();

  // Real edges among the visible top hubs — the kg-formation card
  // used to draw cosmetic all-pairs lines between visible hubs which
  // misled users into reading "every hub is connected to every
  // other hub." Now we pass the actual edges (by name pairs) and
  // the shape's renderer only draws lines that genuinely exist.
  const visibleIds = new Set(fullHubs.map((h) => h.entityId));
  const idToName = new Map(fullHubs.map((h) => [h.entityId, h.name]));
  const realPairs = state.hubTracker.edgesAmong(visibleIds).map((p) => ({
    a: idToName.get(p.source) ?? p.source,
    b: idToName.get(p.target) ?? p.target,
  }));

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
        hubEdgesJson: JSON.stringify(realPairs),
        pulse: state.kgFormationPulse,
      },
    });
  } catch (err) {
    // Shape may have been deleted by run-completion cleanup while an
    // event was still in flight — swallow.
    console.warn("[pipeline-painter] kg-formation update failed:", err);
  }
}

// ── Probability space shell helpers (intake axis lenses) ──────────
//
// Shells are tldraw shapes (not chrome) so they pan with the canvas
// and can be tethered to origin-prompt. Laid out in a horizontal
// row BETWEEN origin-prompt (above) and kg-formation (below) so the
// intake-stage lenses read as descending straight from the prompt.
//
// Each shell upserts on space_opened (idempotent). Later events —
// space_entity_added, space_edge_added, space_merge_begin,
// axis_scored — mutate the shell's JSON-packed props in place so
// React re-renders without duplicating shapes.

const SPACE_SHELL_ROW_Y_OFFSET = 620; // y = anchor.y - 620 (between origin and kg-formation)
const SPACE_SHELL_GAP = 24;
const SPACE_SHELL_MAX_PER_ROW = 5;

function spaceShellLayout(
  orderIndex: number,
  totalShells: number,
): { offsetX: number; rowOffsetY: number } {
  // Shells wrap to a second row once more than MAX_PER_ROW open in
  // a single run. Center-justify each row around the anchor column so
  // the fan reads symmetrically below the origin card.
  const perRow = Math.min(totalShells, SPACE_SHELL_MAX_PER_ROW);
  const row = Math.floor(orderIndex / SPACE_SHELL_MAX_PER_ROW);
  const col = orderIndex % SPACE_SHELL_MAX_PER_ROW;
  // Recompute per-row width so the LAST (possibly shorter) row also
  // centers correctly.
  const thisRowStart = row * SPACE_SHELL_MAX_PER_ROW;
  const thisRowCount = Math.min(
    totalShells - thisRowStart,
    SPACE_SHELL_MAX_PER_ROW,
  );
  const effectiveCols = thisRowCount || perRow;
  const totalRowW =
    effectiveCols * SPACE_SHELL_DEFAULT_W +
    Math.max(0, effectiveCols - 1) * SPACE_SHELL_GAP;
  const leftEdgeX = -totalRowW / 2;
  const offsetX =
    leftEdgeX + col * (SPACE_SHELL_DEFAULT_W + SPACE_SHELL_GAP);
  const rowOffsetY = row * (SPACE_SHELL_DEFAULT_H + SPACE_SHELL_GAP);
  return { offsetX, rowOffsetY };
}

function updateShellShape(
  editor: Editor,
  state: PainterState,
  spaceKey: string,
) {
  const shapeId = state.spaceShellShapeIds.get(spaceKey);
  const st = state.spaceShellState.get(spaceKey);
  if (!shapeId || !st) return;
  st.pulse++;
  try {
    editor.updateShape<ProbabilitySpaceShellShape>({
      id: shapeId,
      type: "probability-space-shell",
      props: {
        entitiesJson: JSON.stringify(st.entities),
        edgesJson: JSON.stringify(st.edges),
        merging: st.merging,
        scoreJson: st.score ? JSON.stringify(st.score) : "",
        failureJson: st.failure ? JSON.stringify(st.failure) : "",
        pulse: st.pulse,
      },
    });
  } catch (err) {
    console.warn("[pipeline-painter] space-shell update failed:", err);
  }
}

function paintSpaceOpened(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "space_opened" }>,
  state: PainterState,
) {
  if (!state.anchor) return;
  // Idempotent: re-emissions of the same spaceKey refresh metadata but
  // never duplicate the shape.
  const existing = state.spaceShellShapeIds.get(event.spaceKey);
  if (existing) {
    const st = state.spaceShellState.get(event.spaceKey);
    if (st) {
      st.label = event.label;
      st.tagline = event.tagline;
      st.rationale = event.rationale;
      st.accent = event.accent;
      st.orderIndex = event.orderIndex;
      try {
        editor.updateShape<ProbabilitySpaceShellShape>({
          id: existing,
          type: "probability-space-shell",
          props: {
            label: st.label,
            tagline: st.tagline,
            rationale: st.rationale,
            accent: st.accent,
            orderIndex: st.orderIndex,
          },
        });
      } catch (err) {
        console.warn("[pipeline-painter] space-shell refresh failed:", err);
      }
    }
    return;
  }

  // Stash state; layout uses orderIndex + total count. The layout
  // snapshots "how many shells are open right now", so later
  // openings naturally pack correctly because their own index is
  // used for position.
  state.spaceShellState.set(event.spaceKey, {
    axis: event.axis,
    label: event.label,
    tagline: event.tagline,
    accent: event.accent,
    rationale: event.rationale,
    orderIndex: event.orderIndex,
    entities: [],
    edges: [],
    merging: false,
    score: null,
    failure: null,
    pulse: 0,
  });
  // Anticipate total shells by the highest orderIndex seen + 1, so
  // layouts don't shift every time a new shell lands.
  let maxOrder = event.orderIndex;
  for (const s of state.spaceShellState.values()) {
    if (s.orderIndex > maxOrder) maxOrder = s.orderIndex;
  }
  const totalShells = maxOrder + 1;
  const { offsetX, rowOffsetY } = spaceShellLayout(event.orderIndex, totalShells);

  const shapeId = createShapeId();
  try {
    // Place inside the `landscape` room. `spaceShellLayout()` already
    // computes a centered offsetX (column position within the row);
    // we just need to map the row's vertical offset to a position
    // inside the room's content area instead of an anchor-relative
    // band. ~16px below the room header so the lenses sit visually
    // inside their owning "Probability spaces" card.
    const placement = placeInsideRoom(
      "landscape",
      state.anchor,
      offsetX + SPACE_SHELL_DEFAULT_W / 2, // placeInsideRoom returns center; shell uses top-left
      16 + rowOffsetY,
    );
    editor.createShape<ProbabilitySpaceShellShape>({
      id: shapeId,
      type: "probability-space-shell",
      x: placement.x - SPACE_SHELL_DEFAULT_W / 2,
      y: placement.y,
      props: {
        w: SPACE_SHELL_DEFAULT_W,
        h: SPACE_SHELL_DEFAULT_H,
        spaceKey: event.spaceKey,
        axis: event.axis,
        label: event.label,
        tagline: event.tagline,
        accent: event.accent,
        rationale: event.rationale,
        orderIndex: event.orderIndex,
        entitiesJson: "[]",
        edgesJson: "[]",
        merging: false,
        scoreJson: "",
        pulse: 0,
      },
    });
    state.spaceShellShapeIds.set(event.spaceKey, shapeId);
    recordChildBottomForStage(
      editor,
      state,
      "landscape",
      placement.y + SPACE_SHELL_DEFAULT_H,
    );
    // Tether UP to origin-prompt so each lens reads as descending from
    // the user's thought. Silent no-op if origin-prompt wasn't painted
    // (runs with no intake text — shells become visual roots themselves).
    if (state.originPromptShapeId) {
      tetherBetween(
        editor,
        state,
        state.originPromptShapeId,
        shapeId,
        "lens",
      );
    }
    // Keep the camera following as the fan opens — debounced inside
    // fitViewportToUnfurl so a burst of opens produces one final sweep
    // instead of rapid-fire re-zooms.
    fitViewportToUnfurl(editor, state);
  } catch (err) {
    console.warn("[pipeline-painter] space-shell create failed:", err);
  }
}

function paintSpaceEntityAdded(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "space_entity_added" }>,
  state: PainterState,
) {
  const st = state.spaceShellState.get(event.spaceKey);
  if (!st) return; // space_opened arrives first under normal ordering
  // Dedupe by entityId — replay-safe.
  if (st.entities.some((e) => e.entityId === event.entityId)) return;
  st.entities.push({
    entityId: event.entityId,
    name: event.name,
    weight: event.weight,
    confidenceBasis: event.confidence_basis,
  });
  updateShellShape(editor, state, event.spaceKey);
  // Synthesis card reflects cross-axis convergence — recompute when
  // an axis gets a new entity so the ranking refreshes live during
  // the unfurl. No-op if the synthesis card hasn't been created yet
  // (it materializes on the first proposal_ready, which happens
  // post-axes anyway).
  if (state.synthesisCardShapeId) {
    ensureSynthesisCard(editor, state, /* spaceId */ "");
  }
}

function paintSpaceEdgeAdded(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "space_edge_added" }>,
  state: PainterState,
) {
  const st = state.spaceShellState.get(event.spaceKey);
  if (!st) return;
  st.edges.push({
    sourceEntityId: event.sourceEntityId,
    targetEntityId: event.targetEntityId,
    mechanism: event.mechanism,
    polarity: event.polarity,
    dynamics: event.dynamics,
    confidence: event.confidence,
  });
  updateShellShape(editor, state, event.spaceKey);
}

function paintSpaceMergeBegin(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "space_merge_begin" }>,
  state: PainterState,
) {
  for (const key of event.spaceKeys) {
    const st = state.spaceShellState.get(key);
    if (!st) continue;
    st.merging = true;
    updateShellShape(editor, state, key);
  }
}

function paintAxisScored(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "axis_scored" }>,
  state: PainterState,
) {
  const st = state.spaceShellState.get(event.spaceKey);
  if (!st) return;
  if (event.score === null) return; // null scores are "not scored" — leave empty
  st.score = {
    weighted: event.score,
    breakdown: event.breakdown,
    notes: event.notes,
  };
  updateShellShape(editor, state, event.spaceKey);
}

function paintAxisFailed(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "axis_failed" }>,
  state: PainterState,
) {
  const st = state.spaceShellState.get(event.spaceKey);
  if (!st) return;
  st.failure = {
    reason: event.reason,
    errorMessage: event.errorMessage,
  };
  updateShellShape(editor, state, event.spaceKey);
}

// ── Taxonomy card helpers (VP Project report — Phase 3) ────────────
//
// Painted once per run on `taxonomy_inferred`. Sits to the RIGHT of
// the KG formation card so the user can see "what's being modeled"
// next to "what variables are we varying". The card is upsert-style:
// re-emissions of the same event replace rather than duplicate.

const TAXONOMY_CARD_W = 360;
const TAXONOMY_CARD_H = 220;
// Offsets mirror KG_FORMATION_OFFSET_Y so both live cards sit on the
// same top band; taxonomy card is shifted right by its own width plus
// a gutter so they don't overlap.
const TAXONOMY_CARD_OFFSET_Y = 360;
// Shoulder-to-shoulder with kg-formation: shift by HALF of kg-formation's
// width plus half of taxonomy's own width plus a 32px gutter, so the two
// cards don't overlap horizontally. Previously used `W/2 + 32 = 212`
// which produced 148px of horizontal overlap with kg-formation (W=360,
// centered on anchor). The painter-visual audit flagged this as the
// single most-visible layout bug during intake.
const TAXONOMY_CARD_OFFSET_X =
  KG_FORMATION_W / 2 + TAXONOMY_CARD_W / 2 + 32;

// ── Asset chip + situation card painters ─────────────────────────
//
// Top-of-flow input layer. Asset chips render in a horizontal row to
// the right of the origin-prompt. The situation card lands inside the
// intake room, below the origin-prompt, so the room reads top-to-
// bottom as: prompt → current state.

const ASSET_CARD_W = 200;
const ASSET_CARD_H = 88;
const ASSET_CARD_GAP = 12;
const ASSET_CARD_ROW_X_OFFSET = 360; // distance from anchor.x to start of row
const ASSET_CARD_ROW_Y_OFFSET = -780; // above anchor (origin-prompt sits even higher)

const SITUATION_CARD_W = 560;
const SITUATION_CARD_H = 240;

const ASSET_CLASS_ACCENT_LOOKUP: Record<string, string> = {
  research_pdf: "#7C3AED",
  internal_doc: "#0891B2",
  dataset: "#059669",
  image_diagram: "#D97706",
  prior_analysis: "#9333EA",
  spec_sheet: "#2563EB",
  web_article: "#64748B",
  pasted_text: "#475569",
};

function paintAssetAdded(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "asset_added" }>,
  state: PainterState,
) {
  if (!state.anchor) return;
  // Idempotent — re-emission of the same asset upserts.
  if (state.assetCardShapeIds.has(event.assetId)) return;

  // Position in a horizontal row to the right of the origin-prompt.
  // Index by current chip count so each new chip slots after the prior.
  const idx = state.assetCardShapeIds.size;
  const x =
    state.anchor.x + ASSET_CARD_ROW_X_OFFSET + idx * (ASSET_CARD_W + ASSET_CARD_GAP);
  const y = state.anchor.y + ASSET_CARD_ROW_Y_OFFSET;
  const accent =
    ASSET_CLASS_ACCENT_LOOKUP[event.assetClass] ?? "#0891B2";

  const shapeId = createShapeId();
  try {
    editor.createShape<AssetCardShape>({
      id: shapeId,
      type: "asset-card",
      x,
      y,
      props: {
        w: ASSET_CARD_W,
        h: ASSET_CARD_H,
        assetId: event.assetId,
        spaceId: event.spaceId,
        sourceName: event.sourceName.slice(0, 80),
        assetClass: event.assetClass,
        charCount: event.charCount,
        accent,
        uploadedAt: event.uploadedAt,
      },
      meta: { source: "pipeline-event" },
    });
    state.assetCardShapeIds.set(event.assetId, shapeId);
  } catch (err) {
    console.warn("[pipeline-painter] asset card paint failed:", err);
  }
}

function paintSituationAnalyzed(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "situation_analyzed" }>,
  state: PainterState,
) {
  if (!state.anchor) return;
  const accent = "#0891B2"; // cyan — neutral "current state"

  const propsBase = {
    w: SITUATION_CARD_W,
    h: SITUATION_CARD_H,
    spaceId: event.spaceId,
    uncertaintyScore: event.uncertaintyScore,
    inputsCount: event.inputsCount,
    processStepsCount: event.processStepsCount,
    outputsCurrentCount: event.outputsCurrentCount,
    outputsTargetCount: event.outputsTargetCount,
    knownsCount: event.knownsCount,
    unknownsCount: event.unknownsCount,
    assetCount: event.assetCount,
    skippedReason: event.skippedReason ?? "",
    accent,
  };

  // Upsert — situation_analyzed should fire once per run, but if a
  // re-run lands without an intermediate sweep, idempotent update
  // beats stacking duplicates.
  if (state.situationCardShapeId) {
    try {
      editor.updateShape<SituationCardShape>({
        id: state.situationCardShapeId,
        type: "situation-card",
        props: {
          ...propsBase,
          version: ((event.unknownsCount + event.knownsCount) | 0) + 1,
        },
      });
    } catch (err) {
      console.warn("[pipeline-painter] situation card update failed:", err);
    }
    return;
  }

  const shapeId = createShapeId();
  // Place inside the `intake` room ("Understanding your situation"),
  // below the origin-prompt card so the room reads top-to-bottom as
  // prompt → current state. Was previously at a legacy fixed offset
  // (anchor.y - 700) that floated it ABOVE the entire room cascade,
  // which broke the "what's in the situational analysis room?" mental
  // model the cascade promises.
  const placement = placeInsideRoom(
    "intake",
    state.anchor,
    0,
    ORIGIN_PROMPT_DEFAULT_H + 24,
  );
  const x = placement.x - SITUATION_CARD_W / 2;
  const y = placement.y;
  try {
    editor.createShape<SituationCardShape>({
      id: shapeId,
      type: "situation-card",
      x,
      y,
      props: {
        ...propsBase,
        version: 1,
      },
      meta: { source: "pipeline-event" },
    });
    state.situationCardShapeId = shapeId;
    // Grow the intake room to enclose the card so it doesn't poke past
    // the room's bottom edge. The default intake height (280) only
    // fits the prompt; with the situation card we need ~prompt+card.
    recordChildBottomForStage(
      editor,
      state,
      "intake",
      y + SITUATION_CARD_H,
    );
  } catch (err) {
    console.warn("[pipeline-painter] situation card create failed:", err);
  }
}

function paintTaxonomy(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "taxonomy_inferred" }>,
  state: PainterState,
) {
  if (!state.anchor) return;
  const slotsJson = JSON.stringify(event.slots ?? []);
  const accent = event.slots?.[0]?.color ?? "#1a7aff";

  // Update-in-place if the painter already spawned a card on an
  // earlier re-emission (shouldn't happen today — domain-inferrer
  // fires once — but soft-upsert keeps the painter idempotent).
  if (state.taxonomyCardShapeId) {
    try {
      editor.updateShape<TaxonomyCardShape>({
        id: state.taxonomyCardShapeId,
        type: "taxonomy-card",
        props: {
          taxonomyId: event.taxonomyId,
          spaceId: event.spaceId,
          domainKey: event.domainKey,
          artifactNoun: event.artifactNoun,
          variantNoun: event.variantNoun,
          situationNoun: event.situationNoun,
          slotsJson,
          confidence: event.confidence,
          accent,
        },
      });
    } catch (err) {
      console.warn("[pipeline-painter] taxonomy-card update failed:", err);
    }
    return;
  }

  const shapeId = createShapeId();
  try {
    editor.createShape<TaxonomyCardShape>({
      id: shapeId,
      type: "taxonomy-card",
      // Positioned to the right of the KG formation overview card so
      // the two live artifacts read as a pair ("landscape | IVs").
      x: state.anchor.x + TAXONOMY_CARD_OFFSET_X,
      y: state.anchor.y - TAXONOMY_CARD_OFFSET_Y,
      props: {
        w: TAXONOMY_CARD_W,
        h: TAXONOMY_CARD_H,
        taxonomyId: event.taxonomyId,
        spaceId: event.spaceId,
        domainKey: event.domainKey,
        artifactNoun: event.artifactNoun,
        variantNoun: event.variantNoun,
        situationNoun: event.situationNoun,
        slotsJson,
        confidence: event.confidence,
        accent,
      },
    });
    state.taxonomyCardShapeId = shapeId;
    // Tether DOWN from the KG formation card so the IV card reads as
    // "derived from the landscape" rather than floating. Mirrors the
    // backlink pattern in paintAppResultReady. Silent no-op if kg-
    // formation hasn't painted yet (rare — entity events normally
    // ensureKGFormation well before taxonomy_inferred lands).
    if (state.kgFormationShapeId) {
      tetherBetween(editor, state, state.kgFormationShapeId, shapeId, "vars");
    }
  } catch (err) {
    console.warn("[pipeline-painter] taxonomy-card create failed:", err);
  }
}

// ── Variant card helpers (VP Project report — Phase 3, Batch 2e) ──
//
// Painted on `variant_proposed` events from the writer-path. The
// factory and scorer both emit these — factory with null aggregate
// scores, scorer with them filled — so the painter upserts on
// variantId. Cards fan out in a row below the taxonomy card using
// alternatingOffset, same geometry strategy as root entities.

const VARIANT_CARD_W = 260;
const VARIANT_CARD_H = 148;
// Distance below the taxonomy card row to the variant flashcard row.
// TAXONOMY_CARD_OFFSET_Y − (VARIANT_CARD_OFFSET_Y) = vertical gap; we
// want variants a touch below the taxonomy card with ~20px clearance.
const VARIANT_CARD_OFFSET_Y = TAXONOMY_CARD_OFFSET_Y - TAXONOMY_CARD_H - 24;
// Centered on the taxonomy-card column (right of anchor). Lets the
// "taxonomy → variants" pair read as a single VP Project column.
const VARIANT_CARD_CENTER_X = TAXONOMY_CARD_OFFSET_X;
const VARIANT_CARD_SPACING = VARIANT_CARD_W + 24;

function paintVariant(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "variant_proposed" }>,
  state: PainterState,
) {
  if (!state.anchor) return;

  const props: VariantCardShape["props"] = {
    w: VARIANT_CARD_W,
    h: VARIANT_CARD_H,
    variantId: event.variantId,
    spaceId: event.spaceId,
    appId: event.appId,
    label: event.label.slice(0, 160),
    status: event.status.slice(0, 32),
    summary: event.summary ? event.summary.slice(0, 240) : null,
    shortId: event.shortId,
    situationKey: event.situationKey,
    aggregateQuality: event.aggregateQuality,
    aggregateLift: event.aggregateLift,
    accent: event.accentColor,
  };

  // Upsert: factory emits first (null aggregates), scorer re-emits
  // with them filled. Keeping the same shape id in place avoids a
  // "card pops out / pops back in" flash when scores arrive.
  const existingId = state.variantCardShapeIds.get(event.variantId);
  if (existingId) {
    try {
      editor.updateShape<VariantCardShape>({
        id: existingId,
        type: "variant-card",
        props,
      });
    } catch (err) {
      console.warn("[pipeline-painter] variant-card update failed:", err);
    }
    return;
  }

  const idx = state.variantCount;
  state.variantCount++;
  const x =
    state.anchor.x +
    VARIANT_CARD_CENTER_X +
    alternatingOffset(idx, VARIANT_CARD_SPACING) -
    VARIANT_CARD_W / 2;
  const y = state.anchor.y - VARIANT_CARD_OFFSET_Y;

  const shapeId = createShapeId();
  try {
    editor.createShape<VariantCardShape>({
      id: shapeId,
      type: "variant-card",
      x,
      y,
      props,
    });
    state.variantCardShapeIds.set(event.variantId, shapeId);
    // Tether the FIRST variant up to the taxonomy card so the deck
    // reads as "materialized from these IVs". Later variants rely on
    // sibling proximity — drawing an arrow from every one of them
    // to the same taxonomy-card produces a crossing fan that obscures
    // the deck more than it clarifies lineage.
    if (idx === 0 && state.taxonomyCardShapeId) {
      tetherBetween(
        editor,
        state,
        state.taxonomyCardShapeId,
        shapeId,
        "materialized",
      );
    }
  } catch (err) {
    console.warn("[pipeline-painter] variant-card create failed:", err);
  }
}

// ── Sprint B — narrative row bands ─────────────────────────────────
//
// The canvas tells a story top-to-bottom: intake → KG formation →
// root cause → app formation → experiment → decomposed variants →
// synthesis. Each band is ROW_PITCH apart so the user reads the
// pipeline as a chain of tableau frames rather than an orbital swarm.
//
// Existing shapes (kg-node ghosts, kg-formation card, taxonomy card,
// variant cards, root-cause tree, proposals) still paint with their
// earlier orbital offsets — those were tuned around the anchor and
// moving them would break their long-standing choreography. The row
// bands below are for the Sprint A wrap-what-exists shapes (app-
// result, iv-decomposition, variant-carousel, stage-node) whose
// events didn't have a spatial identity before this pass.
//
// Rows are signed integers relative to the anchor (the kg-ghost band
// = row 0). Negative = above anchor, positive = below. rowY(row)
// converts row index to page Y using state.anchor. centerX() returns
// a shape's top-left X given the desired shape width, so shapes land
// centered on the anchor column.

const ROW_PITCH = 520;

/** Narrative band for each Sprint A shape type. */
const ROW_APP_FORMATION = 1;   // app-result — downstream reality card
const ROW_EXPERIMENT = 2;      // iv-decomposition — the active variant's IV rings
const ROW_VARIANTS_BAND = 3;   // variant-carousel — whole deck
const ROW_SYNTHESIS = 4;       // stage-node chains

function rowY(anchorY: number, row: number): number {
  return anchorY + row * ROW_PITCH;
}

function centerX(anchorX: number, shapeW: number): number {
  return anchorX - shapeW / 2;
}

// Dimensions for the Sprint A shapes (matched to their getDefaultProps).
const APP_RESULT_W = 560;
const APP_RESULT_H = 360;
const IV_DECOMP_W = 560;
const IV_DECOMP_H = 280;
const VARIANT_CAROUSEL_W = 680;
const VARIANT_CAROUSEL_H = 340;
// Stage-node dims come from CAUSAL_LAYOUT (shared with the ReactFlow
// trace view); per-chain vertical pitch leaves ~60px of breathing
// room between chains within the synthesis row.
const STAGE_NODE_W = 180;
const STAGE_NODE_H = 110;
const STAGE_X_PITCH = STAGE_NODE_W + 60;
const STAGE_CHAIN_V_PITCH = STAGE_NODE_H + 60;

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
   * User's intake text for this run (spaces.input_text). Painter
   * creates an `origin-prompt` tldraw shape carrying this text on the
   * first event so downstream shapes can tether up to it, turning the
   * canvas into a readable "thought → landscape → branches" lineage.
   * Null for runs without an intake prompt (e.g. strategy-refresh) —
   * painter skips the shape and kg-formation becomes the visible root.
   */
  originPromptText?: string | null;
  /**
   * When truthy, ghosts are not painted. Pass this when another code
   * path is responsible for placing these shapes (e.g. a parent-canvas
   * sync is already live). Defaults to false.
   */
  disabled?: boolean;
  /**
   * Phase B (intake redesign) — current space UUID. Required by the
   * strategy hero card painter so the spawned shape can construct its
   * swap-rank API URL and "Open detail" navigation. The painter is
   * rendered inside /app/space/[id]/whiteboard so the parent always
   * knows this; passed in explicitly rather than scraped from
   * window.location to keep the painter testable.
   */
  spaceId?: string | null;
  /**
   * Fires once when the run's SSE stream reports a terminal status
   * (completed OR failed). InteraxisCanvas wires this to
   * `useSpaceData().refreshEntities()` so the authoritative kg-nodes
   * replace the ghosts in the same tick.
   */
  onCompleted?: () => void | Promise<unknown>;
  /**
   * Fires every time a `signature_deepened` event paints a new ring,
   * with the painter's accumulated signature state for the entity.
   * InteraxisCanvas wires this to `useSpaceData().patchEntitySignature`
   * so the constellation widget / detail drawer / any other surface
   * reading `entity.node_signature` reflects ring growth in real time
   * (gap #13). Translation from the painter's camelCase ring shape to
   * NodeSignature snake_case happens at the call site in InteraxisCanvas.
   */
  onSignatureProgress?: (
    entityId: string,
    signature: {
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
  ) => void;
}

export function PipelineEventPainter({
  editor,
  runId,
  originPromptText,
  disabled,
  spaceId,
  onCompleted,
  onSignatureProgress,
}: PipelineEventPainterProps) {
  const { events, status } = useRunEventStore();
  const stateRef = useRef<PainterState>(makeInitialState());
  // Sprint B.5 — React-visible mirror of PainterState.followCamera so
  // the "Follow downstream" chip can re-render when follow flips. The
  // sync-pointing function lives in the detector effect below; paint
  // functions read from state.followCamera directly (no React churn
  // per event), the chip reads from this useState (one render per
  // toggle). Two sources, kept in lockstep.
  const [followCamera, setFollowCamera] = useState(true);
  // Hold the latest onSignatureProgress in a ref so the drain loop can
  // invoke the freshest callback without re-running its mount effect
  // every render. Callers typically pass an inline arrow — without the
  // ref we'd thrash the setTimeout chain on each render of the parent.
  const sigProgressRef = useRef(onSignatureProgress);
  useEffect(() => {
    sigProgressRef.current = onSignatureProgress;
  }, [onSignatureProgress]);
  // Same pattern for prompt text — kept in a ref so the drain loop's
  // ensureOriginPrompt call always reads the latest prop value without
  // re-arming the mount effect.
  const originPromptTextRef = useRef(originPromptText);
  useEffect(() => {
    originPromptTextRef.current = originPromptText;
  }, [originPromptText]);
  // Same pattern for spaceId — the strategy hero card spawn needs it
  // to populate its prop, and the painter receives spaceId from the
  // canvas mount which only changes on space switch. We mirror it
  // into PainterState on every render so the proposal_ready handler
  // (deeply nested + not React-aware) always reads the latest value.
  useEffect(() => {
    stateRef.current.strategyHeroSpaceId = spaceId ?? null;
  }, [spaceId]);

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

    // Paint the origin-prompt card once the anchor exists, so downstream
    // shapes (kg-formation, taxonomy, root-cause, …) can tether up to
    // it. Idempotent — re-entry during the same run is a no-op.
    ensureOriginPrompt(editor, state, originPromptTextRef.current ?? null);

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

    // P0 #3 — burst detection. A single commit enqueueing ≥ BURST_THRESHOLD
    // events is the signature of a backlog replay (initial mount while a
    // run is mid-flight, or a refresh). Mark those events as burst-pace
    // so the drain loop clears them fast before cadence returns to live
    // STAGGER_MS for trailing events.
    if (enqueued >= BURST_THRESHOLD) {
      state.burstRemaining = Math.max(state.burstRemaining, enqueued);
    }

    // Boot the drain loop if it isn't already running. The loop
    // re-schedules itself as long as the queue has items. Delay for
    // the NEXT drain is chosen based on burstRemaining.
    if (state.drainTimer === null) {
      const drain = () => {
        const s = stateRef.current;
        const next = s.queue.shift();
        if (!next) {
          s.drainTimer = null;
          return;
        }
        try {
          paintEvent(editor, next.event, s, {
            onSignatureProgress: sigProgressRef.current,
          });
        } catch (err) {
          console.warn("[pipeline-painter] paint failed:", err);
        }
        const nextCadence = s.burstRemaining > 0 ? BURST_STAGGER_MS : STAGGER_MS;
        if (s.burstRemaining > 0) s.burstRemaining--;
        s.drainTimer = setTimeout(drain, nextCadence);
      };
      state.drainTimer = setTimeout(drain, 0);
    }
  }, [events, editor, disabled, runId]);

  // When the runId changes, reset the painter's state — a new run
  // starts painting fresh from a new anchor. Cancel any in-flight
  // drain timer from the previous run so its queued paints don't
  // bleed into the new run.
  //
  // ── Cross-run cleanup sweep ────────────────────────────────
  // The painter's state initializes empty on every run, but the
  // tldraw store survives across runs (use-canvas-persistence
  // restores the prior snapshot on mount). That mismatch is what
  // produced the "two prompt cards / two kg-formation cards / two
  // sets of axis shells" duplication: prior-run painter shapes were
  // still in the store; the new run's painter had no record of
  // them; it painted fresh ones at near-identical coordinates.
  //
  // Fix: before the new run starts emitting paints, walk the store
  // and delete every shape tagged as painter-emitted. We tag with
  // `meta.source` on creation; the sweep matches any of the known
  // painter source tags. Persistent narrative artifacts (entity
  // catalog rows, app-detail widgets, root-cause-tree, stage-nodes)
  // are NOT tagged and therefore survive the sweep — only the
  // run-scoped emission overlay is cleared.
  useEffect(() => {
    if (!editor) return;
    if (!runId) return;
    const prev = stateRef.current;
    if (prev.drainTimer !== null) {
      clearTimeout(prev.drainTimer);
    }
    if (prev.cameraFitTimer !== null) {
      clearTimeout(prev.cameraFitTimer);
    }
    stateRef.current = makeInitialState();

    try {
      // Type-based sweep — every shape whose type is in this set is
      // exclusively a painter-emit and should re-paint fresh on every
      // run. Robust against un-tagged createShape calls.
      const PAINTER_SHAPE_TYPES = new Set([
        "origin-prompt",
        "kg-formation",
        "probability-space-shell",
        "taxonomy-card",
        "variant-card",
        "proposal-snapshot",
        "proposal-chain-ribbon",
        "experiment-design-card",
        "root-cause-tree",
        "synthesis-intersection-card",
        "asset-card",
        "situation-card",
      ]);
      // Connector arrows + ribbons that the painter tags with a
      // source string — sweep these too, otherwise dangling arrows
      // bound to deleted endpoints become "ghost lines."
      const PAINTER_SOURCE_TAGS = new Set([
        "pipeline-event",
        "proposal-connector",
        "proposal-origin-connector",
        "stage-chain",
        "row-tether",
      ]);
      const stale: TLShapeId[] = [];
      for (const s of editor.getCurrentPageShapes()) {
        if (PAINTER_SHAPE_TYPES.has(s.type)) {
          stale.push(s.id);
          continue;
        }
        const src = (s.meta as { source?: unknown } | undefined)?.source;
        if (typeof src === "string" && PAINTER_SOURCE_TAGS.has(src)) {
          stale.push(s.id);
          continue;
        }
        // Ghost kg-nodes from a prior interrupted run — committed
        // entities (isGhost=false) sync from the entities table via
        // useSyncEntities and stay; ghosts are run-scoped and stale.
        if (s.type === "kg-node") {
          const props = (s as { props?: { isGhost?: unknown } }).props;
          if (props?.isGhost === true) stale.push(s.id);
        }
      }
      if (stale.length > 0) {
        editor.deleteShapes(stale);
      }
    } catch (err) {
      // Non-fatal — duplication is a visual issue, not a correctness
      // issue. If the sweep throws, the new run still paints; user
      // just sees the duplicates again.
      console.warn("[pipeline-painter] cross-run sweep failed:", err);
    }
  }, [runId, editor]);

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
      if (s.cameraFitTimer !== null) {
        clearTimeout(s.cameraFitTimer);
        s.cameraFitTimer = null;
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

    // P0 #2 — final cinematic fit. Before committing the ghosts,
    // frame the whole graph so the "commit" transition happens in
    // full view rather than off-screen. Immediate (not debounced)
    // because we want it to run before the ghost-commit update.
    const fitShapeIds: TLShapeId[] = [
      ...state.ghostsByEntity.values(),
      // Sprint B — include the narrative row shapes in the final fit
      // so the camera frames the whole story (intake → synthesis), not
      // just the kg-ghost band at the top.
      ...state.appResultShapesByAppId.values(),
      ...(state.ivDecompositionShapeId ? [state.ivDecompositionShapeId] : []),
      ...(state.variantCarouselShapeId ? [state.variantCarouselShapeId] : []),
      ...state.stageNodeShapesByKey.values(),
    ];
    // Respect the user's pan: if they panned/zoomed away from the
    // unfurl during the run, don't yank them back when it completes.
    // Same gate fitViewportToUnfurl uses for incremental fits — was
    // missing here, which is why a user who pans mid-run would still
    // get their view torn out from under them at completion.
    const userControllingCamera =
      !state.followCamera || editor.inputs.isPointing;
    if (fitShapeIds.length > 0 && !userControllingCamera) {
      const boundsList = fitShapeIds
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is NonNullable<typeof b> => b !== null);
      if (boundsList.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const b of boundsList) {
          if (b.minX < minX) minX = b.minX;
          if (b.minY < minY) minY = b.minY;
          if (b.maxX > maxX) maxX = b.maxX;
          if (b.maxY > maxY) maxY = b.maxY;
        }
        const PAD = 140;
        const w = maxX - minX + PAD * 2;
        const h = maxY - minY + PAD * 2;
        if (w > MAX_FIT_DIMENSION || h > MAX_FIT_DIMENSION) {
          console.warn(
            `[pipeline-painter] skipping final fit — bounds ${Math.round(w)}×${Math.round(h)} exceeds cap ${MAX_FIT_DIMENSION}`,
          );
        } else {
          try {
            editor.zoomToBounds(
              { x: minX - PAD, y: minY - PAD, w, h },
              { animation: { duration: 700 }, inset: 40 },
            );
          } catch (err) {
            console.warn("[pipeline-painter] final fit failed:", err);
          }
        }
      }
    }

    // P0 #1 — Smooth ghost→real transition.
    //
    // Previously we deleted ghost kg-nodes here and let useSyncEntities
    // re-lay them out in a flat grid after refreshEntities(). That caused
    // a 30-card reorganization at the exact moment the unfurl finished —
    // the worst possible time for a layout jump, since it undoes the
    // entire reveal animation.
    //
    // New flow: ghost kg-nodes STAY in place. We just flip isGhost→false
    // on each, which fires the shape's existing 200ms opacity + saturate
    // transition (kg-node-shape.tsx line 236). The user sees the same
    // cards they watched arrive, now "committed" (fully opaque, full
    // color, no dashed border). useSyncEntities below reconciles real
    // props (leverage, tier, layer) onto the same shapes without
    // moving them — see the new `syncExistingProps` effect there.
    //
    // Decorative run-scoped overlays (edges, bridges, proposals, ribbons,
    // formation/taxonomy/variant cards) still get removed — those were
    // the transient choreography; the final graph is the entities alone.
    const ghostKgNodePatches: TLShapePartial<KGNodeShape>[] = [];
    for (const shapeId of state.ghostsByEntity.values()) {
      ghostKgNodePatches.push({
        id: shapeId,
        type: "kg-node",
        props: { isGhost: false },
      });
    }
    if (ghostKgNodePatches.length > 0) {
      try {
        editor.updateShapes(ghostKgNodePatches);
      } catch (err) {
        console.warn("[pipeline-painter] ghost commit failed:", err);
      }
    }

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
      // Project-Overview design pass — chain ribbons live alongside
      // their snapshot cards and share the same run-scoped lifetime.
      ...state.chainRibbonsByProposal.values(),
      // 5-column experiment-design cards painted only for
      // experiment-kind proposals; same run-scoped lifetime.
      ...state.experimentDesignByProposal.values(),
      // Synthesis intersection card — single per run, anchors all
      // the proposals. Cleared with the rest so a fresh run can
      // re-paint with new convergence data.
      ...(state.synthesisCardShapeId ? [state.synthesisCardShapeId] : []),
      // Asset chips + situation card — input layer. Cleared on run
      // completion so a fresh run paints fresh asset chips for any
      // newly-uploaded files and re-runs the situation analyzer.
      ...state.assetCardShapeIds.values(),
      ...(state.situationCardShapeId ? [state.situationCardShapeId] : []),
      // Project-Overview live landscape — ephemeral, lives only during
      // the run. The post-run canvas has the real KG visible via the
      // sync-entities layout, so keeping this overlay would double-
      // count the information.
      ...(state.kgFormationShapeId ? [state.kgFormationShapeId] : []),
      // VP Project report (Phase 3) — the taxonomy card is also run-
      // scoped. After completion the canonical row in
      // `experiment_taxonomies` drives the App page's IV decomposition
      // widget, so we don't need the canvas ghost hanging around.
      ...(state.taxonomyCardShapeId ? [state.taxonomyCardShapeId] : []),
      // VP Project report (Phase 3, Batch 2e) — variant flashcards are
      // ghost geometry only. The canonical source is
      // `experiment_variants` + the VariantCarousel widget on the App
      // detail page, which hydrates directly on mount.
      ...state.variantCardShapeIds.values(),
      // Sprint B — row tether arrows are transient breadcrumbs, drawn
      // to help the user read the vertical flow during the unfurl.
      // After the run completes the shapes themselves are enough; the
      // tethers would clutter the post-run canvas.
      ...state.rowTetherArrowIds,
    ];
    // Sprint A shapes themselves (app-result, iv-decomposition,
    // variant-carousel, stage-nodes) PERSIST — they are the committed
    // narrative artifacts, not decorative overlays. Stage-chain arrows
    // also persist because they form the causal spine of each chain.
    if (shapeIds.length > 0) {
      try {
        editor.deleteShapes(shapeIds);
      } catch (err) {
        console.warn("[pipeline-painter] cleanup failed:", err);
      }
    }
    // Note: ghostsByEntity NOT cleared — the shapes persist (committed).
    // Clearing here would leak the shape ids but also prevent a re-run on
    // the same canvas from detecting pre-existing ghosts. Acceptable
    // trade — one run per canvas mount is the typical flow.
    state.ghostsByEntity.clear();
    state.previewsByName.clear();
    state.ghostEdgesByPair.clear();
    state.ghostBridgesByPair.clear();
    state.proposalsById.clear();
    state.chainRibbonsByProposal.clear();
    state.experimentDesignByProposal.clear();
    state.synthesisCardShapeId = null;
    state.synthesisAppsCount = 0;
    state.assetCardShapeIds.clear();
    state.situationCardShapeId = null;
    state.proposalCount = 0;
    state.positionsByEntity.clear();
    state.childCountByParent.clear();
    state.rootCount = 0;
    // Project-Overview live landscape — clear so next run starts fresh.
    state.kgFormationShapeId = null;
    state.hubTracker.clear();
    state.kgFormationPulse = 0;
    state.originArrowIds = [];
    // Origin prompt PERSISTS post-run so returning users still see
    // what drove this canvas (matches the prior chrome CanvasOriginCard
    // behavior). Flip runActive=false so its styling calms down; keep
    // the id reference so a re-run in-session upserts rather than
    // stacking a duplicate. The tether to kg-formation is in
    // rowTetherArrowIds and gets cleaned above, so we don't leave a
    // dangling arrow pointing at a deleted shape.
    if (state.originPromptShapeId) {
      try {
        editor.updateShape<OriginPromptShape>({
          id: state.originPromptShapeId,
          type: "origin-prompt",
          props: { runActive: false },
        });
      } catch (err) {
        console.warn("[pipeline-painter] origin-prompt quiet-down failed:", err);
      }
    }
    // VP Project report (Phase 3) — taxonomy card is run-scoped, same
    // lifecycle as the formation card above.
    state.taxonomyCardShapeId = null;
    // Probability space shells PERSIST post-run — they're part of the
    // canvas narrative (origin → lenses → KG → downstream) that users
    // come back to. Clear the bookkeeping maps so a fresh run creates
    // new shells without stacking, and quiet-down styling by flipping
    // `merging` to hold the post-run visual state.
    for (const [spaceKey, shapeId] of state.spaceShellShapeIds) {
      const st = state.spaceShellState.get(spaceKey);
      try {
        editor.updateShape<ProbabilitySpaceShellShape>({
          id: shapeId,
          type: "probability-space-shell",
          props: {
            merging: st?.merging ?? true,
          },
        });
      } catch (err) {
        console.warn(
          "[pipeline-painter] space-shell quiet-down failed:",
          err,
        );
      }
    }
    state.spaceShellShapeIds.clear();
    state.spaceShellState.clear();
    // Variant flashcards — clear the upsert map + counter so the next
    // run starts fresh. The rows in experiment_variants persist; the
    // canvas ghosts do not.
    state.variantCardShapeIds.clear();
    state.variantCount = 0;
    // Sprint B — tether arrays are deleted; clear the tracker so a
    // subsequent run's tethers don't stack up in memory. Sprint A
    // shape maps keep their ids so a repeat-run can upsert in place
    // rather than stacking duplicate cards.
    state.rowTetherArrowIds = [];

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

  // Sprint B.5 — user-pan detector. Runs only while a run is live
  // (status "connecting" | "open"). Samples editor.getCamera() every
  // POLL_MS and compares against the last-seen snapshot. If the camera
  // moved AND the move didn't fall inside a programmatic window (set
  // by fitViewportToUnfurl around its own zoomToBounds calls), treat
  // it as user input → flip followCamera off.
  //
  // 60ms keeps detection latency under one animation frame at 60Hz.
  // The fit functions also synchronously check `editor.inputs.isPointing`
  // so a fit can't fire while the user is mid-pan even if the detector
  // hasn't yet flipped followCamera; the polling here just makes sure
  // followCamera stays correct after the user releases the pointer.
  //
  // When the run ends or the component unmounts, we clear the
  // interval and RESET follow to true so the next run starts fresh.
  useEffect(() => {
    if (!editor) return;
    const state = stateRef.current;
    const isLive = status === "connecting" || status === "open";
    if (!isLive) {
      // Run ended — reset follow for the next run.
      if (!state.followCamera) {
        state.followCamera = true;
        setFollowCamera(true);
      }
      state.lastSeenCamera = null;
      return;
    }
    // Prime the snapshot once when the run begins.
    if (state.lastSeenCamera === null) {
      try {
        state.lastSeenCamera = editor.getCamera();
      } catch {
        /* ignore */
      }
    }
    const EPSILON = 0.5;
    const interval = setInterval(() => {
      if (!state.followCamera) return; // already off; nothing to detect
      if (Date.now() < state.programmaticCameraUntil) return; // our own anim
      let cam;
      try {
        cam = editor.getCamera();
      } catch {
        return;
      }
      const last = state.lastSeenCamera;
      if (!last) {
        state.lastSeenCamera = { x: cam.x, y: cam.y, z: cam.z };
        return;
      }
      const moved =
        Math.abs(cam.x - last.x) > EPSILON ||
        Math.abs(cam.y - last.y) > EPSILON ||
        Math.abs(cam.z - last.z) > 0.001;
      if (moved) {
        state.followCamera = false;
        setFollowCamera(false);
      }
      state.lastSeenCamera = { x: cam.x, y: cam.y, z: cam.z };
    }, 60);
    return () => clearInterval(interval);
  }, [editor, status]);

  // Sprint B.5 — "Follow downstream" chip. Shows bottom-center ONLY
  // when the user has drifted away from the unfurl during an active
  // run. Single purpose, single click: re-arms follow mode and
  // immediately triggers a fit so the camera glides back to the
  // current narrative frontier.
  const isRunActive = status === "connecting" || status === "open";
  const showFollowChip = isRunActive && !followCamera;
  const handleResumeFollow = () => {
    if (!editor) return;
    const state = stateRef.current;
    state.followCamera = true;
    // Prime lastSeenCamera so the next detector tick doesn't see
    // the not-yet-animated-from camera as "user moved it" and flip
    // us back off immediately.
    try {
      state.lastSeenCamera = editor.getCamera();
    } catch {
      /* ignore */
    }
    setFollowCamera(true);
    fitViewportToUnfurl(editor, state);
  };

  if (!showFollowChip) return null;
  return (
    <button
      type="button"
      onClick={handleResumeFollow}
      title="Re-follow the downstream unfurl"
      className="pointer-events-auto absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-indigo-200/70 bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 shadow-md backdrop-blur-md transition-colors hover:border-indigo-400 hover:text-indigo-900"
    >
      <span aria-hidden="true" className="text-[13px] leading-none">↓</span>
      Follow downstream
    </button>
  );
}

// ── Root-cause tree helpers ──────────────────────────────────────────
//
// The tree is a single composed overlay shape; we merge info from two
// event types into it:
//   - root_cause_identified → topRoots, reachable/convergence/root counts,
//                              goal ids. Triggers creation if absent.
//   - why_chain_deepened    → driversTotal, userControllableCount,
//                              fanIn edges (augmenting the upstream chain).
// Positioned above-left of the anchor so it sits in a reserved lane
// distinct from the KG-formation and taxonomy-card columns. Cleared on
// run completion like other per-run overlays.

const ROOT_CAUSE_TREE_W = 720;
const ROOT_CAUSE_TREE_H = 440;
// Distance from the anchor. Tree sits UPPER-LEFT of the anchor row so
// it doesn't collide with the KG formation card (which sits directly
// above the anchor) or the proposal column on the right.
const ROOT_CAUSE_TREE_OFFSET_X = -(ROOT_CAUSE_TREE_W + 80);
const ROOT_CAUSE_TREE_OFFSET_Y = 380;

function upsertRootCauseTree(editor: Editor, state: PainterState) {
  if (!state.rootCauseTreeState) return;
  const s = state.rootCauseTreeState;
  const props: RootCauseTreeShape["props"] = {
    w: ROOT_CAUSE_TREE_W,
    h: ROOT_CAUSE_TREE_H,
    spaceId: "", // filled by the event payload; painter doesn't know it
    title: s.goalNames.length > 0
      ? `Why → ${s.goalNames[0]}${s.goalNames.length > 1 ? ` + ${s.goalNames.length - 1} more` : ""}`
      : "Root-cause tree",
    goalEntityIds: s.goalEntityIds,
    goalNames: s.goalNames,
    nodesJson: JSON.stringify(s.nodes),
    edgesJson: JSON.stringify(s.edges),
    reachableCount: s.reachableCount,
    convergencePoints: s.convergencePoints,
    rootCandidates: s.rootCandidates,
    driversTotal: s.driversTotal,
    userControllableCount: s.userControllableCount,
    accent: "#7C3AED",
    version: s.version,
  };

  if (state.rootCauseTreeShapeId) {
    try {
      editor.updateShape<RootCauseTreeShape>({
        id: state.rootCauseTreeShapeId,
        type: "root-cause-tree",
        props,
      });
    } catch (err) {
      console.warn("[pipeline-painter] root-cause-tree update failed:", err);
    }
    return;
  }

  if (!state.anchor) return; // painter needs an anchor to position; try again on next event
  const shapeId = createShapeId();
  try {
    editor.createShape<RootCauseTreeShape>({
      id: shapeId,
      type: "root-cause-tree",
      x: state.anchor.x + ROOT_CAUSE_TREE_OFFSET_X,
      y: state.anchor.y - ROOT_CAUSE_TREE_OFFSET_Y,
      props,
    });
    state.rootCauseTreeShapeId = shapeId;
    // Tether the tree up to kg-formation so "drilling for root causes"
    // reads as descending from the landscape rather than appearing in
    // isolation off to the upper-left. Silent no-op if the formation
    // card hasn't painted yet.
    if (state.kgFormationShapeId) {
      tetherBetween(
        editor,
        state,
        state.kgFormationShapeId,
        shapeId,
        "drilled",
      );
    }
  } catch (err) {
    console.warn("[pipeline-painter] root-cause-tree create failed:", err);
  }
}

function paintRootCauseIdentified(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "root_cause_identified" }>,
  state: PainterState,
) {
  // Build the merged tree state from the event's topRoots. Depth comes
  // directly from the event; convergesCount comes from convergesChains
  // length. We don't know goal NAMES from this event (it only carries
  // ids), so we pull names from the painter's existing ghostsByEntity
  // bookkeeping if available, else fall back to "Goal N".
  const goalNames = event.goalEntityIds.map((gid, idx) => {
    // Try to find a ghost we painted earlier whose props.name we cached.
    // The painter doesn't track entity name by uuid directly; we rely
    // on the tldraw shape lookup via ghostsByEntity.
    const shapeId = state.ghostsByEntity.get(gid);
    if (shapeId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shape = editor.getShape(shapeId) as any;
        const nm = shape?.props?.name;
        if (typeof nm === "string" && nm.trim()) return nm;
      } catch {
        /* ignore */
      }
    }
    return `Goal ${idx + 1}`;
  });

  // Nodes: goals are injected by the shape itself at depth 0; we only
  // feed the topRoots here. The shape's groupByDepth handles merging.
  const nodes = event.topRoots.map((r) => ({
    id: r.entityId,
    name: lookupEntityName(editor, state, r.entityId) ?? "(entity)",
    depth: Math.max(1, r.causalDepth),
    convergesCount: r.convergesChains.length,
    rootScore: r.rootScore,
    // `is_root_candidate` would require a DB field lookup — we treat
    // any node reached from >=2 chains OR with maximum depth in the
    // event set as the keystone set worth flagging. A future version
    // should pass is_root_candidate through the event explicitly.
    isRoot: r.convergesChains.length >= 2,
  }));

  // Edges: we don't have the intermediate chain in the event payload
  // (trace carries ENDS, not paths). So we approximate by connecting
  // each root directly to each goal it converges on — this gives the
  // user the fan-in visual even though intermediates aren't drawn.
  // When why_chain_deepened arrives, we'll have real driver→driver
  // edges to layer in on top.
  const edges: Array<{ source: string; target: string }> = [];
  for (const r of event.topRoots) {
    for (const gid of r.convergesChains) {
      edges.push({ source: r.entityId, target: gid });
    }
  }

  const prev = state.rootCauseTreeState;
  state.rootCauseTreeState = {
    nodes,
    edges,
    goalEntityIds: event.goalEntityIds,
    goalNames,
    reachableCount: event.reachableCount,
    convergencePoints: event.convergencePoints,
    rootCandidates: event.rootCandidates,
    driversTotal: prev?.driversTotal ?? 0,
    userControllableCount: prev?.userControllableCount ?? 0,
    version: (prev?.version ?? 0) + 1,
  };
  upsertRootCauseTree(editor, state);
}

function paintWhyChainDeepened(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "why_chain_deepened" }>,
  state: PainterState,
) {
  // Why-chain fires BEFORE root-trace in the pipeline chain (see
  // synthesize/route.ts temporal order). So when this event arrives
  // the tree state may not exist yet. Initialize a minimal skeleton
  // we'll flesh out when root_cause_identified lands.
  if (!state.rootCauseTreeState) {
    state.rootCauseTreeState = {
      nodes: [],
      edges: [],
      goalEntityIds: [],
      goalNames: [],
      reachableCount: 0,
      convergencePoints: 0,
      rootCandidates: 0,
      driversTotal: 0,
      userControllableCount: 0,
      version: 0,
    };
  }
  const s = state.rootCauseTreeState;
  s.driversTotal += event.driversAdded;
  s.userControllableCount += event.userControllableCount;

  // Append topDrivers as upstream nodes. cause_level 1/2/3 maps to
  // visual depth 1/2/3 RELATIVE to the thread they hang off. Without
  // knowing which goal a given thread feeds, we can't link the driver
  // into the goal column precisely — so we add the node to the pool
  // and the shape's layout algorithm will place it in the appropriate
  // depth column. Intermediate edges between drivers and their parent
  // thread aren't carried in the event payload (they're persisted to
  // the DB); the shape-level fan-in still reads correctly because
  // the goal→root edges from root_cause_identified carry the gestalt.
  for (const d of event.topDrivers) {
    if (s.nodes.some((n) => n.id === d.entityId)) continue;
    s.nodes.push({
      id: d.entityId,
      name: d.name,
      depth: d.causeLevel + 1, // +1 so level-1 drivers sit one column left of the thread
      convergesCount: 1,
      rootScore: 0.5,
      isRoot: d.causeLevel === 3,
      stopReason: d.stopReason,
      causeLevel: d.causeLevel,
    });
  }
  s.version += 1;
  upsertRootCauseTree(editor, state);
}

// Helper: resolve entity name from a ghost we already painted, if any.
function lookupEntityName(
  editor: Editor,
  state: PainterState,
  entityId: string,
): string | null {
  const shapeId = state.ghostsByEntity.get(entityId);
  if (!shapeId) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shape = editor.getShape(shapeId) as any;
    const nm = shape?.props?.name;
    return typeof nm === "string" && nm.trim() ? nm : null;
  } catch {
    return null;
  }
}

// ── Sprint B — Sprint A shape paint handlers ───────────────────────
//
// Each handler drops (or upserts) its shape at the narrative row band
// defined above. On first create it also tethers to the nearest
// upstream shape with a labeled dotted arrow so the user can read the
// vertical flow even when individual cards are scrolled out of view.
// Tethers are optional: when no upstream exists yet (order scrambled
// by replay), we skip silently — on later paints from the upstream
// row, the tether is drawn downward onto the existing card.

/** Labeled dendrogram-style tether from a parent shape to a child.
 *  Uses tldraw's elbow routing so arrows run as right-angle segments
 *  (parent bottom → down → across → child top), producing a readable
 *  org-chart / tree instead of a cat's cradle of diagonals.
 *
 *  Visuals tuned 2026-04-24 after the user said the canvas looked
 *  "unprofessional" — solid instead of dotted, single end-arrowhead
 *  (no start head), small size, with an explicit `kind: "elbow"`. */
function tetherBetween(
  editor: Editor,
  state: PainterState,
  fromId: TLShapeId,
  toId: TLShapeId,
  label: string,
) {
  const arrowId = createShapeId();
  try {
    const arrow: TLShapePartial<TLArrowShape> = {
      id: arrowId,
      type: "arrow",
      props: {
        color: "grey",
        size: "s",
        // Sans gives the tether labels ("lens", "landscape", etc.) a
        // clean, professional read instead of tldraw's default
        // handwritten "draw" font that looks like raw user text.
        font: "sans",
        labelColor: "grey",
        dash: "solid",
        kind: "elbow",
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        richText: toRichText(label),
      },
      meta: { source: "row-tether" },
    };
    editor.createShapes([arrow]);
    editor.createBindings([
      {
        fromId: arrowId,
        toId: fromId,
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
        toId: toId,
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
    state.rowTetherArrowIds.push(arrowId);
  } catch (err) {
    console.warn("[pipeline-painter] row tether failed:", err);
  }
}

function paintAppResultReady(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "app_result_ready" }>,
  state: PainterState,
) {
  if (!state.anchor) return;
  const appKey = event.appId ?? `__space__:${event.spaceId}`;
  const props: DownstreamRealityShape["props"] = {
    w: APP_RESULT_W,
    h: APP_RESULT_H,
    spaceId: event.spaceId,
    appId: event.appId,
    title: event.title,
    realityJson: event.realityJson,
    variantsJson: event.variantsJson,
    taxonomyJson: event.taxonomyJson,
    accent: event.accent,
    version: event.version,
  };

  const existingId = state.appResultShapesByAppId.get(appKey);
  if (existingId) {
    try {
      editor.updateShape<DownstreamRealityShape>({
        id: existingId,
        type: "downstream-reality",
        props,
      });
    } catch (err) {
      console.warn("[pipeline-painter] app-result update failed:", err);
    }
    return;
  }

  const shapeId = createShapeId();
  const x = centerX(state.anchor.x, APP_RESULT_W);
  const y = rowY(state.anchor.y, ROW_APP_FORMATION);
  try {
    editor.createShape<DownstreamRealityShape>({
      id: shapeId,
      type: "downstream-reality",
      x,
      y,
      props,
    });
    state.appResultShapesByAppId.set(appKey, shapeId);

    // Cross-row tether: if the KG-formation card (intake landscape)
    // already exists, link it downward. Reads as "landscape scored
    // into app reality".
    if (state.kgFormationShapeId) {
      tetherBetween(
        editor,
        state,
        state.kgFormationShapeId,
        shapeId,
        "scored",
      );
    }

    // Sprint B.5 follow-up — writer-path emits this event well after
    // its single `stage_boundary(enter)`, so the camera would otherwise
    // stay locked upstream while this card drops 520px below the
    // anchor (ROW_APP_FORMATION). Kick a re-fit; the 120ms debounce
    // inside fitViewportToUnfurl coalesces it with the adjacent
    // iv-decomposition / variant-deck creates into one cinematic sweep.
    fitViewportToUnfurl(editor, state);
  } catch (err) {
    console.warn("[pipeline-painter] app-result create failed:", err);
  }
}

function paintIVDecompositionReady(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "iv_decomposition_ready" }>,
  state: PainterState,
) {
  if (!state.anchor) return;
  const props: IVDecompositionShape["props"] = {
    w: IV_DECOMP_W,
    h: IV_DECOMP_H,
    spaceId: event.spaceId,
    appId: event.appId,
    title: event.title,
    dense: event.dense,
    variantJson: event.variantJson,
    taxonomyJson: event.taxonomyJson,
    accent: event.accent,
    version: event.version,
  };

  if (state.ivDecompositionShapeId) {
    try {
      editor.updateShape<IVDecompositionShape>({
        id: state.ivDecompositionShapeId,
        type: "iv-decomposition",
        props,
      });
    } catch (err) {
      console.warn("[pipeline-painter] iv-decomposition update failed:", err);
    }
    return;
  }

  const shapeId = createShapeId();
  const x = centerX(state.anchor.x, IV_DECOMP_W);
  const y = rowY(state.anchor.y, ROW_EXPERIMENT);
  try {
    editor.createShape<IVDecompositionShape>({
      id: shapeId,
      type: "iv-decomposition",
      x,
      y,
      props,
    });
    state.ivDecompositionShapeId = shapeId;

    // Tether from app-result (same appId if present, else first
    // painted). Reads as "reality decomposed into IVs".
    const appKey = event.appId ?? `__space__:${event.spaceId}`;
    const upstream =
      state.appResultShapesByAppId.get(appKey) ??
      state.appResultShapesByAppId.values().next().value ??
      null;
    if (upstream) {
      tetherBetween(editor, state, upstream, shapeId, "decomposed");
    }

    // Sprint B.5 follow-up — see paintAppResultReady for why this is
    // necessary. This card lands 1040px below anchor (ROW_EXPERIMENT),
    // deeper than the prior camera fit; without the re-fit the user
    // wouldn't see the rings land without a manual pan.
    fitViewportToUnfurl(editor, state);
  } catch (err) {
    console.warn("[pipeline-painter] iv-decomposition create failed:", err);
  }
}

function paintVariantDeckReady(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "variant_deck_ready" }>,
  state: PainterState,
) {
  if (!state.anchor) return;
  const props: VariantCarouselShape["props"] = {
    w: VARIANT_CAROUSEL_W,
    h: VARIANT_CAROUSEL_H,
    spaceId: event.spaceId,
    appId: event.appId,
    title: event.title,
    variantsJson: event.variantsJson,
    taxonomyJson: event.taxonomyJson,
    accent: event.accent,
    version: event.version,
  };

  if (state.variantCarouselShapeId) {
    try {
      editor.updateShape<VariantCarouselShape>({
        id: state.variantCarouselShapeId,
        type: "variant-carousel",
        props,
      });
    } catch (err) {
      console.warn("[pipeline-painter] variant-carousel update failed:", err);
    }
    return;
  }

  const shapeId = createShapeId();
  const x = centerX(state.anchor.x, VARIANT_CAROUSEL_W);
  const y = rowY(state.anchor.y, ROW_VARIANTS_BAND);
  try {
    editor.createShape<VariantCarouselShape>({
      id: shapeId,
      type: "variant-carousel",
      x,
      y,
      props,
    });
    state.variantCarouselShapeId = shapeId;

    // Tether from iv-decomposition if present. Reads as "IVs
    // materialized into variants".
    if (state.ivDecompositionShapeId) {
      tetherBetween(
        editor,
        state,
        state.ivDecompositionShapeId,
        shapeId,
        "materialized",
      );
    }

    // Sprint B.5 follow-up — carousel lands 1560px below anchor
    // (ROW_VARIANTS_BAND). Re-fit so the user sees it drop in. Coalesces
    // with the adjacent app-result / iv-decomposition re-fits under
    // the 120ms debounce into one downward sweep.
    fitViewportToUnfurl(editor, state);
  } catch (err) {
    console.warn("[pipeline-painter] variant-carousel create failed:", err);
  }
}

function paintCausalStageReady(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "causal_stage_ready" }>,
  state: PainterState,
) {
  if (!state.anchor) return;
  const key = `${event.chainId}:${event.stageIndex}`;
  const props: StageNodeShape["props"] = {
    w: STAGE_NODE_W,
    h: STAGE_NODE_H,
    spaceId: event.spaceId,
    chainId: event.chainId,
    chainName: event.chainName,
    chainRank: event.chainRank,
    stageIndex: event.stageIndex,
    kind: event.kind,
    title: event.title,
    meta: event.meta,
    confidence: event.confidence,
    verified: event.verified,
    valueLabel: event.valueLabel,
    entityId: event.entityId,
    isTerminal: event.isTerminal,
    convergingCount: event.convergingCount,
  };

  // Upsert if already painted (same chain+index re-emits).
  const existingId = state.stageNodeShapesByKey.get(key);
  if (existingId) {
    try {
      editor.updateShape<StageNodeShape>({
        id: existingId,
        type: "stage-node",
        props,
      });
    } catch (err) {
      console.warn("[pipeline-painter] stage-node update failed:", err);
    }
    return;
  }

  // Each chain sits on its own sub-band within the synthesis row.
  // chainRank is 1-indexed; row 0 for rank 1 keeps the top chain
  // aligned with rowY(SYNTHESIS).
  const chainRow = Math.max(0, event.chainRank - 1);
  const baseY = rowY(state.anchor.y, ROW_SYNTHESIS) + chainRow * STAGE_CHAIN_V_PITCH;

  // Stages unfurl left-to-right within their chain row. Use
  // stageIndex to position so out-of-order emissions still land in
  // the right slot. Center the mid-stage (index 2-3 of a 6-stage
  // chain) on the anchor column so long chains balance.
  const centerOffset = -2.5 * STAGE_X_PITCH;
  const x = state.anchor.x + centerOffset + event.stageIndex * STAGE_X_PITCH;
  const y = baseY;

  const shapeId = createShapeId();
  try {
    editor.createShape<StageNodeShape>({
      id: shapeId,
      type: "stage-node",
      x,
      y,
      props,
    });
    state.stageNodeShapesByKey.set(key, shapeId);
    const chainList = state.stageNodesByChain.get(event.chainId) ?? [];
    chainList.push(shapeId);
    state.stageNodesByChain.set(event.chainId, chainList);

    // Wire arrow from the previous stage in this chain if it exists.
    // Inter-stage arrows are solid + accented so they read as the
    // causal spine — no label (stages within the synthesis row don't
    // cross rows, so no breadcrumb needed).
    if (event.stageIndex > 0) {
      const prevKey = `${event.chainId}:${event.stageIndex - 1}`;
      const prevShapeId = state.stageNodeShapesByKey.get(prevKey);
      const arrowKey = `${event.chainId}:${event.stageIndex - 1}→${event.stageIndex}`;
      if (prevShapeId && !state.stageArrowsByKey.has(arrowKey)) {
        const arrowId = createShapeId();
        try {
          const arrow: TLShapePartial<TLArrowShape> = {
            id: arrowId,
            type: "arrow",
            props: {
              color: "grey",
              size: "s",
              dash: "solid",
            },
            meta: { source: "stage-chain" },
          };
          editor.createShapes([arrow]);
          editor.createBindings([
            {
              fromId: arrowId,
              toId: prevShapeId,
              type: "arrow",
              props: {
                terminal: "start",
                normalizedAnchor: { x: 1, y: 0.5 },
                isExact: false,
                isPrecise: true,
              },
              meta: {},
            },
            {
              fromId: arrowId,
              toId: shapeId,
              type: "arrow",
              props: {
                terminal: "end",
                normalizedAnchor: { x: 0, y: 0.5 },
                isExact: false,
                isPrecise: true,
              },
              meta: {},
            },
          ]);
          state.stageArrowsByKey.set(arrowKey, arrowId);
        } catch (err) {
          console.warn("[pipeline-painter] stage arrow failed:", err);
        }
      }
    }

    // First stage of the top-ranked chain gets a tether from the
    // variant-carousel (if painted) labeled "analyzed" — anchors the
    // synthesis band to the variant row.
    if (event.stageIndex === 0 && event.chainRank === 1 && state.variantCarouselShapeId) {
      tetherBetween(
        editor,
        state,
        state.variantCarouselShapeId,
        shapeId,
        "analyzed",
      );
    }

    // Sprint B.5 follow-up — stage nodes land on ROW_SYNTHESIS
    // (anchor.y + 2080px) and stream in one-per-stage per chain.
    // The 120ms debounce coalesces a burst of stages into one sweep
    // while still letting the frame expand left-to-right as each
    // new stage arrives beyond the prior rightmost card.
    fitViewportToUnfurl(editor, state);
  } catch (err) {
    console.warn("[pipeline-painter] stage-node create failed:", err);
  }
}

interface PaintHooks {
  onSignatureProgress?: PipelineEventPainterProps["onSignatureProgress"];
}

function paintEvent(
  editor: Editor,
  event: StructuralEvent,
  state: PainterState,
  hooks: PaintHooks = {},
) {
  // Phase C (cascade rooms) — bump the room count for whichever
  // stage this event belongs to BEFORE the actual paint runs. This
  // way the room subtitle ("23 entities · 45 edges so far") stays
  // in sync with what's visible on the canvas. Soft no-op when the
  // event type doesn't have a clear room home.
  bumpRoomCountFor(editor, event, state);

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
    case "root_cause_identified":
      paintRootCauseIdentified(editor, event, state);
      return;
    case "why_chain_deepened":
      paintWhyChainDeepened(editor, event, state);
      return;
    case "proposal_ready":
      // Phase 2E · PR 4 — fork the proposal off its target entity
      // as a dashed-connected snapshot card. Only paints when the
      // proposal carries a targetEntityId already on the canvas.
      // Orphan proposals (no target) still flow to the existing
      // canvas-proposal-rings overlay as before.
      paintProposal(editor, event, state);
      return;
    case "taxonomy_inferred":
      // VP Project report (Phase 3) — paint the IV taxonomy overview
      // card. Idempotent upsert: re-emissions update in place. Tethers
      // DOWN from kg-formation inside paintTaxonomy so the card reads
      // as a descendant of the landscape rather than floating in space.
      paintTaxonomy(editor, event, state);
      return;
    case "space_opened":
      // Intake axis lens (ACTORS / TIMELINE / CULTURAL / ASSUMPTIONS /
      // RISK / …). Paints a probability-space-shell card and tethers
      // it up to origin-prompt. Previously these lived as a chrome
      // ProbabilitySpaceRail overlay — moved on-canvas so shells pan
      // with the viewport and connect to the lineage tree.
      paintSpaceOpened(editor, event, state);
      return;
    case "space_entity_added":
      paintSpaceEntityAdded(editor, event, state);
      return;
    case "space_edge_added":
      paintSpaceEdgeAdded(editor, event, state);
      return;
    case "space_merge_begin":
      paintSpaceMergeBegin(editor, event, state);
      return;
    case "space_merge_complete":
      // Merge summary arrives but the shells themselves stay on canvas
      // as a read-only record of the intake lenses. No paint action;
      // kept for future breadcrumb surface if we want one.
      return;
    case "axis_scored":
      paintAxisScored(editor, event, state);
      return;
    case "axis_failed":
      // Flip the shell out of "opening…" into a visible error state
      // when the axis generator hard-fails or returns thin output
      // (pipeline audit 2026-04-24). Without this handler the shell
      // spun forever.
      paintAxisFailed(editor, event, state);
      return;
    case "cross_space_link":
      // Global entity appeared in 2+ axes — no shape-level paint yet
      // (leverage ring highlighting is a Phase-2 polish item); the
      // structural event is still forwarded so future passes can hook
      // in without a stream refactor.
      return;
    case "variant_proposed":
      // VP Project report (Phase 3, Batch 2e) — paint a compact
      // flashcard per materialized variant. Upsert-by-variantId so
      // the factory's first emit (null scores) + the scorer's later
      // emit (with scores) land on the same card.
      paintVariant(editor, event, state);
      return;
    case "asset_added":
      // Top-of-flow input layer — chip per uploaded file. Painted
      // alongside the origin-prompt so the canvas reads as
      // "prompt + the assets we have to work with."
      paintAssetAdded(editor, event, state);
      return;
    case "situation_analyzed":
      // Current-state baseline card. Sits below the asset row +
      // origin-prompt, above the probability-space-shells. Drives
      // the "informed by situation" tether to frame-extractor.
      paintSituationAnalyzed(editor, event, state);
      return;
    case "signature_deepened":
      // Batch 7 — stash signature progression in state so Batch 8's
      // ring painter can read it when the three-panel UI lands.
      // Intentionally no geometry yet; the entity's ghost already
      // exists from its `entity_added` event, and the ring overlay
      // renders on a future pass once the shape util is in place.
      trackSignatureDeepened(event, state, hooks.onSignatureProgress);
      return;
    case "app_result_ready":
    case "iv_decomposition_ready":
    case "variant_deck_ready":
      // Architecture redesign — these three widgets (downstream
      // reality heatmap, IV decomposition rings, variant carousel)
      // were originally painted as canvas shapes during the run.
      // After the canvas-clutter audit (3+ overlapping run-time
      // shape types competing for whiteboard real estate), the
      // decision was to render them ONLY on the per-app detail
      // page (/app/space/[id]/app/[appId]/whiteboard), where the
      // AppRenderer + manifest already binds them as widgets.
      //
      // The events still fire from writer-path; the per-app page
      // hydrates from `experiment_variants` + `latent_variables` +
      // `variant_outcome_scores` directly, so dropping the canvas
      // paint costs nothing in terms of data visibility — the user
      // just gets a less cluttered whiteboard.
      //
      // Keeping the case clauses (no-op) instead of removing them
      // so the StructuralEvent switch stays exhaustive; otherwise
      // TS would complain about an unhandled discriminant.
      return;
    case "causal_stage_ready":
      // Sprint B — one stage card per causal chain stage; lays out
      // horizontally within the synthesis row. Inter-stage arrows
      // form the causal spine.
      //
      // NOTE (pipeline audit 2026-04-24): no backend currently emits
      // `causal_stage_ready` — grep confirms zero call sites. This
      // handler + the `paintCausalStageReady` helper + its state
      // fields (`stageNodeShapesByKey`, `stageNodesByChain`,
      // `stageArrowsByKey`) are effectively dead code until the
      // synthesize chain wires an emitter. Keeping them wired so
      // they're ready the moment the backend lands — logging if
      // the event ever arrives so we see the link-up happen.
      console.info(
        "[pipeline-painter] causal_stage_ready received — painter emitter is now live",
      );
      paintCausalStageReady(editor, event, state);
      return;
    case "stage_boundary":
      // Phase C (cascade rooms) — spawn / update the room for this
      // stage. On phase=enter we ensure the room exists (idempotent)
      // and mark it active. On phase=exit we mark it complete. The
      // room is sent to back so subsequent painted shapes layer
      // visually on top of it.
      upsertRoomForStage(editor, event.stage, event.phase, state);

      // P0 #2 — cinematic re-frame (existing behavior, preserved).
      // Every time the pipeline crosses a stage boundary, re-fit the
      // viewport to the bounding box of everything the painter has
      // placed so far. Gives the user a "breath" moment — camera
      // glides to show the growing graph, then the next stage's
      // shapes stream into the now-visible frame. Without this, the
      // viewport stays locked at the intake anchor and later stages
      // paint off-screen; the user has to pan manually to find the
      // proposals / root-cause tree / taxonomy card.
      //
      // Only trigger on `phase === "enter"` so we fit at the start
      // of each stage (when new shapes are about to arrive), not at
      // the end (which would fight the subsequent zoom).
      if (event.phase === "enter") {
        fitViewportToUnfurl(editor, state);
      }
      return;
    case "kg_plan_proposed":
      // The propose-plan route emits this SSE event the moment the
      // plan row lands in DB. Translate it into a window-level
      // CustomEvent so KgPlanReviewGate can pop the review card up
      // immediately instead of waiting up to 5s for its polling
      // fallback to discover the new plan.
      //
      // No tldraw shape painted — the plan card is a chrome overlay,
      // not a canvas object. The gate listens for this exact event
      // name in src/components/canvas/chrome/kg-plan-review-gate.tsx.
      if (typeof window !== "undefined") {
        try {
          const planEvent = event as Extract<
            StructuralEvent,
            { type: "kg_plan_proposed" }
          > & { spaceId?: string };
          window.dispatchEvent(
            new CustomEvent("interaxis:kg-plan-proposed", {
              detail: {
                spaceId: planEvent.spaceId ?? null,
                planId: planEvent.planId,
              },
            }),
          );
        } catch (err) {
          console.warn(
            "[painter] kg_plan_proposed window event dispatch failed:",
            err,
          );
        }
      }
      return;
    default:
      // Audit fix (docs/KG_DEPTH_CRITIQUE.md): the prior default
      // silently swallowed every unhandled event type. That created
      // a class of invisible bugs — adding a new StructuralEvent
      // variant wouldn't trigger any compile error, and the event
      // would simply disappear at runtime. The fix is twofold:
      //
      //   1. console.warn surfaces the unhandled type at runtime so
      //      we get a visible signal during dev.
      //   2. The `_exhaustive: never` assertion turns this into a
      //      COMPILE error the next time anyone adds an event type
      //      to the StructuralEvent union without wiring a case
      //      here. Today some types are intentional no-ops on the
      //      canvas (source_cited, prediction_recorded, target_outcome_identified,
      //      layer_coverage_gap, measurement_coverage_gap, memory_context_loaded,
      //      reasoning_chunk, community_detected, structural_analog_found,
      //      strategy_consensus_ready). To preserve that without losing
      //      the type-check, we cast through `unknown` so the
      //      compile-error promise is "the FIRST time we add a type
      //      that isn't already accounted for in this default arm,"
      //      not retroactively. New work should add explicit
      //      no-op cases above this line; the cast is a deliberate
      //      band-aid until the StructuralEvent union is partitioned
      //      into "canvas-bound" vs "chrome-only" subsets.
      //
      // Known intentional no-ops (do not surface as warnings):
      //   - source_cited
      //   - prediction_recorded
      const t = (event as { type?: string }).type;
      const NO_OP_TYPES = new Set([
        "source_cited",
        "prediction_recorded",
        // Chrome-only: these have HUD/banner/panel consumers and
        // intentionally don't paint a tldraw shape.
        "target_outcome_identified",
        "layer_coverage_gap",
        "measurement_coverage_gap",
        "memory_context_loaded",
        "reasoning_chunk",
        // Emitted but not yet wired to the canvas — visible
        // dormancy worth tracking but not noisy on every event.
        "community_detected",
        "structural_analog_found",
        "strategy_consensus_ready",
        "causal_stage_ready",
      ]);
      if (typeof t === "string" && !NO_OP_TYPES.has(t)) {
        console.warn(
          `[pipeline-event-painter] unhandled event type "${t}" — add a case above the default to paint it, or add to NO_OP_TYPES if it's intentional chrome-only.`,
          event,
        );
      }
      return;
  }
}


function trackSignatureDeepened(
  event: Extract<StructuralEvent, { type: "signature_deepened" }>,
  state: PainterState,
  onProgress?: PipelineEventPainterProps["onSignatureProgress"],
) {
  // Append-only: each event represents one additional ring. If the
  // event's ring index matches the current stashed ring count we
  // append; otherwise we initialize a fresh entry from the event
  // (handles out-of-order delivery by treating the event as
  // authoritative for the rings it carries + any prior rings up to
  // addedRing.index).
  const existing = state.signaturesByEntity.get(event.entityId);
  if (!existing) {
    // First event for this entity — start at index 0. The emitter
    // always sends rings in order, so addedRing.index should be 0
    // when we hit this branch; if it isn't, we still seed with what
    // the event knows so the UI never shows a hole.
    state.signaturesByEntity.set(event.entityId, {
      canonicalCode: event.canonicalCode,
      rings: [event.addedRing],
      residualUncertainty: event.residualUncertainty,
      version: event.version,
    });
  } else {
    // Idempotent: if a ring with the same index already exists, treat
    // this as a re-broadcast and update in place.
    const existingAtIndex = existing.rings.find((r) => r.index === event.addedRing.index);
    if (existingAtIndex) {
      Object.assign(existingAtIndex, event.addedRing);
    } else {
      existing.rings.push(event.addedRing);
      existing.rings.sort((a, b) => a.index - b.index);
    }
    existing.canonicalCode = event.canonicalCode;
    existing.residualUncertainty = event.residualUncertainty;
    existing.version = event.version;
  }

  // Notify the parent with the freshly-merged accumulated state so the
  // SpaceDataContext can splice it onto the matching entity in liveEntities.
  // Read from the just-updated map entry (not the local var) so the seed
  // branch above and this branch both surface a consistent snapshot.
  if (onProgress) {
    const snapshot = state.signaturesByEntity.get(event.entityId);
    if (snapshot) {
      try {
        onProgress(event.entityId, {
          canonicalCode: snapshot.canonicalCode,
          rings: snapshot.rings.map((r) => ({
            ...r,
            sourceAxis: r.sourceAxis as ProbabilitySpaceAxis | null,
          })),
          residualUncertainty: snapshot.residualUncertainty,
          version: snapshot.version,
        });
      } catch (err) {
        console.warn("[pipeline-painter] onSignatureProgress threw:", err);
      }
    }
  }
}

// Architecture redesign — global ghost kg-node layer disabled.
// See src/lib/whiteboard/canvas-feature-flags.ts for full doc.
// Imported (not redeclared locally) so all dependent canvas features
// (auto-cluster, probability-rings) flip in lockstep when the flag
// changes.

function paintEntity(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "entity_added" }>,
  state: PainterState,
) {
  if (state.ghostsByEntity.has(event.entityId)) return;
  if (!state.anchor) return;
  if (!PAINT_GLOBAL_GHOST_KG_NODES) {
    // Still register the entity in the hub tracker so cross-axis
    // entity-name lookups continue to resolve (used by the synthesis
    // card's convergence math when multiple shells reference the
    // same name). Other painters that depended on a kg-node shape
    // existing (paintEdge, paintCycle, paintBridge) gracefully
    // no-op when state.ghostsByEntity has no entry — that's the
    // intended outcome: edges/cycles/bridges live inside their
    // axis shell now, not as standalone canvas geometry.
    state.hubTracker.addEntity(event.entityId, event.name);
    return;
  }

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
        // P0 #4 — bump confirmedPulse so the shape's view fires a
        // one-shot "identity-confirm" animation. Read the current
        // value off the live shape (may already be > 0 from a prior
        // upgrade) and increment. Without this the preview→real
        // upgrade is visually invisible — same position, same
        // shape, just different text, which confuses the user about
        // which cards were tentative vs locked.
        let nextPulse = 1;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const prev = editor.getShape(existingPreview.shapeId) as any;
          const curr = Number(prev?.props?.confirmedPulse ?? 0);
          nextPulse = (Number.isFinite(curr) ? curr : 0) + 1;
        } catch {
          /* ignore — fall back to 1 */
        }
        editor.updateShape<KGNodeShape>({
          id: existingPreview.shapeId,
          type: "kg-node",
          props: {
            entityId: event.entityId,
            name: event.name.slice(0, 80),
            category: normalizeCategory(event.entityCategory),
            tier: tierForImportance(event.importance),
            confirmedPulse: nextPulse,
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
      // Shared hub tracker — move any degree accumulated during the
      // preview window onto the real UUID so Pass 2 edges don't reset
      // the hub ranking of nodes that were already busy in Pass 1.
      state.hubTracker.rebindEntity(oldId, event.entityId, event.name);
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
    // Use depth-dependent fan factor so grandchildren subtrees don't
    // collide at the cousin level (audit T3.3).
    const effectiveSpacing = SIBLING_SPACING * fanFactor(depth);
    x = parentPos.x + alternatingOffset(siblingIdx, effectiveSpacing);
    y = parentPos.y + DEPTH_ROW_HEIGHT;
  } else {
    const rootIdx = state.rootCount;
    state.rootCount++;
    depth = 0;
    // Roots use their own spacing AND the depth-0 fan factor so each
    // root's entire subtree has horizontal breathing room.
    const effectiveRootSpacing = ROOT_SPACING * fanFactor(0);
    x = state.anchor.x + alternatingOffset(rootIdx, effectiveRootSpacing);
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
      confirmedPulse: 0,
    },
  });
  state.ghostsByEntity.set(event.entityId, shapeId);
  state.positionsByEntity.set(event.entityId, { x, y, depth });
  // Shared hub tracker — name gets registered so later edges can look
  // it up by the real UUID. Previews get registered under their
  // synthetic id too; rebindEntity moves their degree when Pass 2
  // upgrades the preview.
  state.hubTracker.addEntity(event.entityId, event.name);
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

// Phase 3 — encode edge confidence as arrow stroke size. Reads:
//   strong, well-evidenced edges look HEAVIER on canvas
//   weak / hypothetical edges look LIGHTER
// Tldraw arrow size enum is fixed to s/m/l/xl so we bin into 4
// tiers. Preview edges always render at "s" (already handled at
// the call site) so this only fires for materialized edges.
type ArrowSize = TLArrowShape["props"]["size"];
function sizeForConfidence(confidence: number | null | undefined): ArrowSize {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return "s";
  if (confidence >= 0.85) return "xl";
  if (confidence >= 0.65) return "l";
  if (confidence >= 0.4) return "m";
  return "s";
}

function paintEdge(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "edge_added" }>,
  state: PainterState,
) {
  // Track hub data + bump kg-formation card BEFORE the
  // ghost-existence check. With global ghost kg-nodes off the
  // tldraw-arrow path below short-circuits, but we still want the
  // kg-formation card to show honest counts + real hub-pair edges.
  // Pre-emptive call ensures the live count ticks up regardless of
  // whether the visual arrow is drawn.
  state.hubTracker.addEdge(event.sourceEntityId, event.targetEntityId);
  bumpKGFormation(editor, state);

  // Only draw a tldraw arrow between entities we've already ghosted.
  // Research-layer edges often connect to already-persisted internal
  // entities that weren't streamed — skip those silently. With the
  // global ghost layer disabled (canvas-feature-flags.ts), this
  // condition is true for every event and the arrow rendering is
  // skipped entirely; the hub tracker still got its update above.
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
        // grey-dashed; real (Pass 2) edges encode polarity + dimension
        // + confidence (size). High-confidence edges render heavier
        // so a researcher's eye lands on the load-bearing structure
        // before the speculative cross-links.
        color: isPreview ? "grey" : colorForPolarity(event.polarity),
        size: isPreview ? "s" : sizeForConfidence(event.confidence),
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
    // (Note: hubTracker.addEdge + bumpKGFormation happen at the top
    // of this function, before the ghost-existence check, so they
    // run even when ghosts are disabled.)
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

// ── Synthesis intersection card ──
//
// Architecture redesign: instead of forking proposals off individual
// entity ghosts (which produced a noisy global cloud), proposals now
// anchor on a single synthesis card. The card sits below the row of
// probability-space-shells and shows entities ranked by cross-axis
// convergence. Proposals fan out from this card alternating left
// and right, exactly as before, but the composition becomes:
//
//   prompt → axis landscapes → SYNTHESIS CARD → proposals
//
// Cleanly cohesive instead of "20 cards floating around 25 entities."

const SYNTHESIS_W = 540;
const SYNTHESIS_H = 320;
const SYNTHESIS_Y_OFFSET = -60; // sits at anchor.y - 60 (just below shells row)

interface ConvergenceRow {
  entityId: string;
  name: string;
  compositeScore: number;
  convergenceCount: number;
  axes: Array<{ axis: string; accent: string; weight: number }>;
}

/** Compute top-N entities by cross-axis convergence from
 *  state.spaceShellState. Pure function so it can be reused on
 *  every shell update without keeping derived state in sync. */
function computeConvergenceRows(state: PainterState, topN = 8): ConvergenceRow[] {
  // entityId → { name, axes[] }
  const byEntity = new Map<
    string,
    {
      name: string;
      axes: Array<{ axis: string; accent: string; weight: number }>;
    }
  >();
  for (const shell of state.spaceShellState.values()) {
    for (const e of shell.entities) {
      const prev = byEntity.get(e.entityId);
      const axisRow = {
        axis: shell.axis,
        accent: shell.accent,
        weight: e.weight,
      };
      if (prev) {
        // Avoid duplicating the same axis (defensive — shells should
        // dedupe on entity_added).
        if (!prev.axes.some((a) => a.axis === shell.axis)) {
          prev.axes.push(axisRow);
        }
      } else {
        byEntity.set(e.entityId, { name: e.name, axes: [axisRow] });
      }
    }
  }
  const rows: ConvergenceRow[] = [];
  for (const [entityId, agg] of byEntity.entries()) {
    if (agg.axes.length < 2) continue; // intersection requires ≥2 axes
    const avgWeight =
      agg.axes.reduce((sum, a) => sum + a.weight, 0) / agg.axes.length;
    // Convergence boost: each additional axis adds 25% to the score
    // up to a cap of 2x. Rewards entities that appear in many lenses.
    const convergenceMultiplier = Math.min(2, 1 + 0.25 * (agg.axes.length - 1));
    const compositeScore = Math.min(1, avgWeight * convergenceMultiplier);
    rows.push({
      entityId,
      name: agg.name,
      compositeScore,
      convergenceCount: agg.axes.length,
      axes: agg.axes,
    });
  }
  rows.sort((a, b) => b.compositeScore - a.compositeScore);
  return rows.slice(0, topN);
}

/** Create the synthesis card if it doesn't yet exist; otherwise
 *  upsert convergence + appsCount onto it. Idempotent. */
function ensureSynthesisCard(
  editor: Editor,
  state: PainterState,
  spaceId: string,
): TLShapeId | null {
  if (!state.anchor) return null;
  const rows = computeConvergenceRows(state, 8);
  const totalAxes = state.spaceShellState.size;
  const isComputing = totalAxes === 0 || rows.length === 0;
  const rowsJson = JSON.stringify(rows);

  if (state.synthesisCardShapeId) {
    try {
      editor.updateShape<SynthesisIntersectionCardShape>({
        id: state.synthesisCardShapeId,
        type: "synthesis-intersection-card",
        props: {
          totalAxes,
          rowsJson,
          isComputing,
          appsProposedCount: state.synthesisAppsCount,
          version: (state.proposalCount + state.spaceShellState.size + 1) | 0,
        },
      });
    } catch (err) {
      console.warn("[pipeline-painter] synthesis card update failed:", err);
    }
    return state.synthesisCardShapeId;
  }

  const shapeId = createShapeId();
  const x = state.anchor.x - SYNTHESIS_W / 2;
  const y = state.anchor.y + SYNTHESIS_Y_OFFSET;
  try {
    editor.createShape<SynthesisIntersectionCardShape>({
      id: shapeId,
      type: "synthesis-intersection-card",
      x,
      y,
      props: {
        w: SYNTHESIS_W,
        h: SYNTHESIS_H,
        spaceId,
        title: "Synthesis · final ranking",
        totalAxes,
        rowsJson,
        appsProposedCount: 0,
        isComputing,
        accent: "#7C3AED",
        version: 1,
      },
    });
    state.synthesisCardShapeId = shapeId;
    return shapeId;
  } catch (err) {
    console.warn("[pipeline-painter] synthesis card create failed:", err);
    return null;
  }
}

// ── Cascade rooms (Phase C) ──
//
// Spawn (or refresh) the room shape for `stage`. Idempotent — re-emits
// of the same stage_boundary phase update the existing shape's state
// in place rather than spawning duplicates.
//
// Rooms sit BEHIND every other painter shape so the existing painted
// content reads as "inside" the room without us needing to actually
// nest tldraw children. Achieved with `editor.sendToBack` immediately
// after creation.

/**
 * Record that a child shape now occupies down to `childBottomY` inside
 * `stage`'s room, and grow the room's height if it's not already
 * tall enough to enclose that y. Idempotent — repeat calls with a
 * smaller y are no-ops. Pulled out of the placement helpers so callers
 * can call it after creating any shape inside a room (kg-formation,
 * shells, origin-prompt, future cards).
 *
 * The +ROOM_PADDING.bottom buffer keeps the bottom edge from kissing
 * the last shape — the room's footer chrome and the connector arrow
 * to the next room need a bit of breathing room.
 */
function recordChildBottomForStage(
  editor: Editor,
  state: PainterState,
  stage: string,
  childBottomY: number,
) {
  const prev = state.roomChildMaxY.get(stage) ?? -Infinity;
  if (childBottomY <= prev) return;
  state.roomChildMaxY.set(stage, childBottomY);

  const roomId = state.roomShapeIds.get(stage);
  if (!roomId) return; // room not painted yet — height will be applied on its first paint
  const room = editor.getShape(roomId);
  if (!room) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props = (room as any).props as { h?: number } | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const y = (room as any).y as number;
  const currentH = typeof props?.h === "number" ? props.h : 0;
  const requiredH = childBottomY - y + ROOM_PADDING.bottom;
  if (requiredH <= currentH) return;
  try {
    editor.updateShape({
      id: roomId,
      type: "room",
      props: { h: requiredH },
    });
  } catch (err) {
    console.warn("[pipeline-painter] room auto-resize failed:", err);
  }
}

function upsertRoomForStage(
  editor: Editor,
  stage: string,
  phase: "enter" | "exit",
  state: PainterState,
) {
  if (!state.anchor) return;
  const meta = STAGE_ROOMS[stage as keyof typeof STAGE_ROOMS];
  if (!meta) return; // unknown / sub-stage — no room

  let existingId = state.roomShapeIds.get(stage);
  // Dedup across painter remounts: if our local state doesn't know
  // about a room for this stage but one already exists on the canvas
  // (e.g., user navigated away and back; hot-reload reset the painter
  // ref), adopt it instead of creating a duplicate. This is what
  // produced the "two Knowledge graph rooms with different counts"
  // visual in earlier reports — a fresh painter spawned a second room
  // because it had no record of the first.
  if (!existingId) {
    for (const shape of editor.getCurrentPageShapes()) {
      if (shape.type !== "room") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (shape as any).props as { stage?: string } | undefined;
      if (props?.stage === stage) {
        existingId = shape.id;
        state.roomShapeIds.set(stage, shape.id);
        break;
      }
    }
  }
  const newState = phase === "exit" ? "complete" : "active";

  // Initialize counts if this is the first time we've seen this stage.
  if (!state.roomCounts.has(stage)) {
    state.roomCounts.set(stage, { ...EMPTY_ROOM_COUNTS });
  }
  const counts = state.roomCounts.get(stage)!;
  const subtitle = buildRoomSubtitle(
    stage as keyof typeof STAGE_ROOMS,
    counts,
  );

  if (existingId) {
    try {
      editor.updateShape<RoomShape>({
        id: existingId,
        type: "room",
        props: {
          state: newState,
          subtitle,
          pulse: Date.now() % 1_000_000,
        },
      });
    } catch (err) {
      console.warn("[pipeline-painter] room update failed:", err);
    }
    return;
  }

  // First spawn for this stage. Compute deterministic bounds from
  // the room layout helper so rooms always land in the same vertical
  // slot regardless of arrival order.
  const bounds = computeRoomBounds(
    stage as keyof typeof STAGE_ROOMS,
    state.anchor,
  );
  // If children for this stage already painted before the room (the
  // common case — kg-formation paints on first entity_added, but
  // stage_boundary lands immediately after), grow the room's initial
  // height so the children we already placed are enclosed.
  const recordedMaxY = state.roomChildMaxY.get(stage);
  const requiredH =
    recordedMaxY != null
      ? Math.max(bounds.h, recordedMaxY - bounds.y + ROOM_PADDING.bottom)
      : bounds.h;
  const shapeId = createShapeId();
  try {
    const room: TLShapePartial<RoomShape> = {
      id: shapeId,
      type: "room",
      x: bounds.x,
      y: bounds.y,
      props: {
        w: bounds.w,
        h: requiredH,
        stage: stage as RoomShape["props"]["stage"],
        state: newState,
        subtitle,
        pulse: 0,
        spawnedAt: Date.now(),
        spaceId: state.strategyHeroSpaceId ?? "",
      },
      meta: { source: "pipeline-event:room" },
    };
    editor.createShapes([room]);
    state.roomShapeIds.set(stage, shapeId);
    // Send to back so subsequent painted shapes layer visually on top
    // of the room — gives the "shapes inside the room" reading without
    // actual tldraw nesting.
    editor.sendToBack([shapeId]);
  } catch (err) {
    console.warn("[pipeline-painter] room create failed:", err);
  }
}

/**
 * Mutate the live counts for whichever room owns this event's stage,
 * then re-render the room subtitle. Cheap — no shape lookup unless
 * the event maps to a known room stage AND the room actually exists.
 */
function bumpRoomCountFor(
  editor: Editor,
  event: StructuralEvent,
  state: PainterState,
) {
  const stage = roomForEventType(event.type);
  if (!stage) return;
  if (!state.roomCounts.has(stage)) {
    state.roomCounts.set(stage, { ...EMPTY_ROOM_COUNTS });
  }
  const counts = state.roomCounts.get(stage)!;

  switch (event.type) {
    case "entity_added":
      counts.entities += 1;
      break;
    case "edge_added":
      counts.edges += 1;
      break;
    case "cycle_detected":
      counts.cycles += 1;
      break;
    case "bridge_formed":
      counts.bridges += 1;
      break;
    case "asset_added":
      counts.assets += 1;
      break;
    case "space_opened":
      counts.axes += 1;
      break;
    case "axis_scored":
    case "axis_failed":
      counts.axesScored += 1;
      break;
    case "proposal_ready":
      counts.proposals += 1;
      break;
    case "variant_proposed":
      counts.variants += 1;
      break;
    case "prediction_recorded":
      counts.predictions += 1;
      break;
    default:
      return;
  }

  const roomId = state.roomShapeIds.get(stage);
  if (!roomId) return;
  try {
    editor.updateShape<RoomShape>({
      id: roomId,
      type: "room",
      props: {
        subtitle: buildRoomSubtitle(stage, counts),
        pulse: Date.now() % 1_000_000,
      },
    });
  } catch (err) {
    console.warn("[pipeline-painter] room subtitle update failed:", err);
  }
}

// ── Strategy hero card (Phase B intake redesign) ──
//
// The persistent on-canvas surface for the user's #1 strategy.
// Anchored bottom-center of the unfurl so it stays visible regardless
// of which axis lens or proposal the user is inspecting. Spawned
// idempotently on the first strategy-kind proposal_ready event;
// subsequent events refresh the preview props in place.
//
// This intentionally does NOT fork off the synthesis card or any
// individual entity ghost. The strategy is the OUTPUT of the whole
// pipeline; it deserves its own pinned surface, not a place in the
// arrow tree.

function upsertStrategyHero(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "proposal_ready" }>,
  state: PainterState,
) {
  const spaceId = state.strategyHeroSpaceId;
  if (!spaceId || !state.anchor) return;

  // Confidence: proposal_ready doesn't carry a confidence field,
  // so leave it null on the initial render. The shape's on-mount
  // fetch of the full StrategyBatch hydrates the real
  // recommendation.confidence value, and the shape will re-render
  // with the % chip visible at that point.
  const confidence: number | null = null;

  // Headline → summary (the rigorous "reasoning" lives behind a
  // detail click in the existing strategy page; the hero card just
  // shows the one-liner).
  const summary = (event.headline ?? "").trim();
  const title = (event.title ?? "").trim() || "Strategy generating…";

  // Posture: not on the event payload either; use a sensible default
  // so the accent color can be derived. The shape will override this
  // once it fetches the full StrategyBatch (which has posture per
  // ranked entry).
  const posture = "cautious_validation";

  // Bottom-center anchor. We compute relative to the painter's anchor
  // (canvas center-ish) — placed below the synthesis row so it sits
  // at the visual end of the unfurl.
  const heroX = state.anchor.x - STRATEGY_HERO_DEFAULT_W / 2;
  const heroY = state.anchor.y + 1080; // below proposal row + ribbons

  if (state.strategyHeroShapeId) {
    // Refresh preview props in place — no shape duplication.
    try {
      editor.updateShape<StrategyHeroCardShape>({
        id: state.strategyHeroShapeId,
        type: "strategy-hero-card",
        props: {
          activeTitle: title,
          activeSummary: summary,
          activeConfidence: confidence,
          activePosture: posture,
          // Bump pulse so the view component knows to refetch.
          pulse: (Date.now() % 1_000_000),
        },
      });
    } catch (err) {
      console.warn("[pipeline-painter] strategy-hero refresh failed:", err);
    }
    return;
  }

  // First strategy proposal — create the hero shape.
  const heroShapeId = createShapeId();
  try {
    const hero: TLShapePartial<StrategyHeroCardShape> = {
      id: heroShapeId,
      type: "strategy-hero-card",
      x: heroX,
      y: heroY,
      props: {
        w: STRATEGY_HERO_DEFAULT_W,
        h: STRATEGY_HERO_DEFAULT_H,
        spaceId,
        // totalRanks: we don't know yet from a single proposal_ready;
        // start with 3 (the default strategyCount) and let the shape's
        // on-mount fetch correct it from the actual batch length.
        totalRanks: 3,
        activeRank: 1,
        activeTitle: title,
        activeSummary: summary,
        activeConfidence: confidence,
        activePosture: posture,
        pulse: 0,
      },
      meta: { source: "pipeline-event:strategy-hero" },
    };
    editor.createShapes([hero]);
    state.strategyHeroShapeId = heroShapeId;
  } catch (err) {
    console.warn("[pipeline-painter] strategy-hero create failed:", err);
  }
}

// ── Forked proposal snapshots ──
//
// A `proposal_ready` event becomes a "proposal-snapshot" shape docked
// to the side of the synthesis card with a dashed amber arrow
// connecting the two. Alternating left/right side placement keeps
// the composition balanced when multiple proposals materialize.
//
// Anchoring change (architecture redesign): proposals USED to fork
// off individual entity ghosts (one snapshot per target entity).
// They now fork off the SYNTHESIS CARD — the post-axes anchor — so
// the canvas reads as `prompt → landscapes → synthesis → proposals`
// instead of "scattered cards near scattered entities."

function paintProposal(
  editor: Editor,
  event: Extract<StructuralEvent, { type: "proposal_ready" }>,
  state: PainterState,
) {
  if (state.proposalsById.has(event.proposalId)) return;
  if (!state.anchor) return;

  // ── Phase B (intake redesign) — STRATEGY HERO CARD ─────────────
  // The first strategy-kind proposal of the run spawns a persistent
  // hero card anchored bottom-center of the unfurl. Subsequent
  // proposals do NOT spawn new heros — instead the existing card's
  // preview props (title/summary/confidence/posture) get refreshed
  // in-place. The shape itself fetches the full StrategyBatch on
  // mount via /api/spaces/[id]/twin-proposal so deep details stay
  // fresh without inflating the tldraw doc.
  //
  // Skip when:
  //   - kind isn't "strategy" (experiments + variants don't get heros)
  //   - spaceId isn't known (canvas mounted outside /app/space/[id]/)
  if (event.kind === "strategy" && state.strategyHeroSpaceId) {
    upsertStrategyHero(editor, event, state);
  }

  // Ensure synthesis card exists. We pass through the event's space
  // context implicitly — proposal_ready always belongs to the run's
  // space. Card creation is idempotent.
  const synthesisId = ensureSynthesisCard(editor, state, /* spaceId */ "");
  if (!synthesisId) return;

  // Alternate left/right so subsequent proposals fan to both sides.
  const side: "left" | "right" = state.proposalCount % 2 === 0 ? "right" : "left";

  // Anchor proposalX/Y around the synthesis card. Right-side proposals
  // sit to the right of the card; left-side to the left. Vertically
  // staggered so multiple proposals on the same side don't overlap.
  const synthesisX = state.anchor.x - SYNTHESIS_W / 2;
  const synthesisY = state.anchor.y + SYNTHESIS_Y_OFFSET;
  const stackIndex = Math.floor(state.proposalCount / 2);
  const stackVOffset = stackIndex * (PROPOSAL_H + RIBBON_H + EXPERIMENT_DESIGN_H + 60);
  const proposalX =
    side === "right"
      ? synthesisX + SYNTHESIS_W + PROPOSAL_SIDE_OFFSET
      : synthesisX - PROPOSAL_W - PROPOSAL_SIDE_OFFSET;
  const proposalY = synthesisY + stackVOffset;
  const targetShapeId = synthesisId;

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
        // Distribution provenance — "mc_simulation" when the emitter
        // ran a real MC engine, "llm_estimate" for LLM-self-reported,
        // "" for legacy events predating the provenance field. The
        // shape renderer shows a ⚡ icon when this is a real sim and a
        // ✎ icon when it's an LLM estimate.
        distributionProvenance: event.distribution?.provenance ?? "",
        distributionSampleCount: event.distribution?.sampleCount ?? null,
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
    state.synthesisAppsCount += 1;
    // Bump the appsProposedCount footer on the synthesis card so the
    // user sees the running tally tick up as proposals stream in.
    ensureSynthesisCard(editor, state, /* spaceId */ "");

    // Project-Overview design pass — if the emitter attached a chain
    // summary, paint a reasoning-chain ribbon directly below the
    // proposal snapshot. The ribbon visualizes the upstream → target
    // breadcrumb + signed lift the design reference put on every
    // proposal row. Skipped silently when chain is absent (legacy
    // events, or emitters that couldn't resolve a chain) — the
    // snapshot card on its own is still a valid visual.
    if (event.chain && event.chain.nodeNames.length > 0) {
      const ribbonId = createShapeId();
      try {
        const ribbon: TLShapePartial<ProposalChainRibbonShape> = {
          id: ribbonId,
          type: "proposal-chain-ribbon",
          x: proposalX,
          y: proposalY + PROPOSAL_H + RIBBON_VGAP,
          props: {
            w: RIBBON_W,
            h: RIBBON_H,
            proposalId: event.proposalId,
            kind: event.kind,
            shortId: event.chain.shortId ?? "",
            // Cap at 6 on the wire so the shape's internal truncation
            // logic is the only thing deciding what to show.
            nodeNames: event.chain.nodeNames.slice(0, 6),
            lift: typeof event.chain.lift === "number" ? event.chain.lift : null,
            constraintLabel: event.chain.constraintLabel ?? null,
            accent,
          },
          meta: { source: "pipeline-event" },
        };
        editor.createShapes([ribbon]);
        state.chainRibbonsByProposal.set(event.proposalId, ribbonId);
      } catch (err) {
        // Non-fatal — the proposal card above still conveys the
        // proposal, the ribbon is a bonus.
        console.warn("[pipeline-painter] chain ribbon paint failed:", err);
      }
    }

    // ── Experiment-design card (5-column IV/DV/Control/Process/Results) ──
    //
    // Only for kind="experiment" — strategies and free-floating
    // variants don't fit the IV/DV framing as cleanly (a strategy is
    // multiple experiments composed; a variant is a comparison within
    // a single experiment). Spawn directly under the chain ribbon when
    // it exists, otherwise directly under the snapshot.
    //
    // Inputs are reshuffled from the same proposal_ready payload the
    // snapshot card already used:
    //   IV column   — chain.nodeNames except the last (causal upstream)
    //                 OR proposal title fallback
    //   DV column   — chain.nodeNames last entry (the target)
    //   Control     — DoWhy refute baseline label when present, else
    //                 a generic "no-intervention world" placeholder
    //   Process     — chain.nodeNames + dowhy.identify.kind +
    //                 dowhy.refute.verdict
    //   Results     — distribution {p10,p50,p90} + provenance + samples
    if (event.kind === "experiment") {
      const designId = createShapeId();
      try {
        const ribbonY = proposalY + PROPOSAL_H + RIBBON_VGAP;
        const designY =
          event.chain && event.chain.nodeNames.length > 0
            ? ribbonY + RIBBON_H + EXPERIMENT_DESIGN_VGAP
            : proposalY + PROPOSAL_H + EXPERIMENT_DESIGN_VGAP;
        // Right-side proposals: anchor at proposalX so the wide card
        // extends rightward away from the entity.
        // Left-side proposals: right-align with proposal so the card
        // extends leftward (away from the entity).
        const designX =
          side === "right"
            ? proposalX
            : proposalX + PROPOSAL_W - EXPERIMENT_DESIGN_W;

        const chainNames = event.chain?.nodeNames ?? [];
        const dvName =
          chainNames.length > 0 ? chainNames[chainNames.length - 1] : null;
        const ivNames =
          chainNames.length > 1 ? chainNames.slice(0, -1) : [];
        const dowhy = event.dowhy;
        const identifyKind = dowhy?.identify?.kind ?? "";
        const refuteVerdict = dowhy?.refute?.verdict ?? "";
        // Control label: prefer a DoWhy-derived baseline description
        // (when refute landed) else fall back to a placeholder. The
        // contract type doesn't currently surface a baseline-label
        // field, so we synthesize one from refute.verdict; future
        // emitters can attach a richer label without breaking the
        // shape's prop schema.
        const controlLabel = dowhy?.refute
          ? "no-intervention baseline (placebo MC)"
          : "";

        const design: TLShapePartial<ExperimentDesignCardShape> = {
          id: designId,
          type: "experiment-design-card",
          x: designX,
          y: designY,
          props: {
            w: EXPERIMENT_DESIGN_W,
            h: EXPERIMENT_DESIGN_H,
            proposalId: event.proposalId,
            // proposal_ready for kind="experiment" carries the apps.id
            // as proposalId per app-generator.ts emission. Keep both
            // fields so a future click-through can navigate to the
            // app dashboard without ambiguity.
            appId: event.proposalId,
            title: event.title,
            hypothesis: "",
            ivNames,
            dvName,
            controlLabel,
            processChain: chainNames.slice(0, 5),
            identifyKind,
            refuteVerdict,
            p10: event.distribution?.p10 ?? null,
            p50: event.distribution?.p50 ?? null,
            p90: event.distribution?.p90 ?? null,
            distributionProvenance: event.distribution?.provenance ?? "",
            distributionSampleCount:
              event.distribution?.sampleCount ?? null,
            accent,
          },
          meta: { source: "pipeline-event" },
        };
        editor.createShapes([design]);
        state.experimentDesignByProposal.set(event.proposalId, designId);
      } catch (err) {
        // Non-fatal — the snapshot + ribbon above still convey the
        // proposal. The design card is a richer layer that some runs
        // may skip if shape creation fails.
        console.warn(
          "[pipeline-painter] experiment-design card paint failed:",
          err,
        );
      }
    }

    // (Architecture redesign — the kg-formation→proposal "origin
    // connector" arrow used to fire here. Now redundant: every
    // proposal already has its primary arrow to the synthesis card,
    // and the synthesis card itself sits in the canonical spot
    // between the axis-shells row and the proposal fan. Two arrows
    // per proposal was visual noise.)
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
