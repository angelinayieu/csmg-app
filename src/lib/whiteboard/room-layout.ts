// ── Room layout (Phase C — cascade rooms) ──────────────────────────────
//
// Maps each pipeline stage to a "room" — a wide translucent backdrop
// that sits behind the existing pipeline-painter shapes and visually
// groups them into a top-down cascade. The cascade reads as:
//
//   ╔══════════════════════════════════════════════╗
//   ║  ① Understanding your situation              ║  intake stage
//   ║     ↳ origin prompt + assets + situation     ║
//   ╚══════════════════════════════════════════════╝
//                       │
//                       ▼ (animated connector)
//   ╔══════════════════════════════════════════════╗
//   ║  ② Probability spaces                        ║  landscape stage
//   ║     ↳ N axis lenses                          ║
//   ╚══════════════════════════════════════════════╝
//                       │
//                       ▼
//   ╔══════════════════════════════════════════════╗
//   ║  ③ Knowledge graph                           ║  kg stage
//   ║     ↳ N entities · M edges · K cycles        ║
//   ╚══════════════════════════════════════════════╝
//                       │
//                       ▼
//   ╔══════════════════════════════════════════════╗
//   ║  ④ Strategies                                ║  proposal stage
//   ║     ↳ ranked + hero card                     ║
//   ╚══════════════════════════════════════════════╝
//
// Each room has:
//   - Stable Y position based on its stage's position in the canonical
//     order. Bands don't shift when later stages arrive, so the
//     unfurl reads as an additive sequence rather than a layout
//     re-flow that disorients the user mid-run.
//   - A user-facing title (NOT the pipeline's internal stage name).
//   - A subtitle template that renders the live count of artifacts
//     (e.g., "4 lenses · 23 entities so far") so the user can see
//     progress at a glance without zooming in.
//   - A canonical accent color tied to the stage so each room reads
//     as visually distinct from its neighbors.
//
// Coordinates are in the same page-space tldraw uses; the painter
// already anchors at viewport mid-x and offsets vertically from
// state.anchor.y (which is set on the first event of the run).

import type { PipelineStage } from "@/types/pipeline-events";

/** User-facing room metadata. */
export interface StageRoomMeta {
  /** Stable position in the cascade (0-indexed, top to bottom). */
  order: number;
  /** Title shown in the room's header. User-facing, not the pipeline
   *  internal name (e.g., "Probability spaces", not "landscape"). */
  title: string;
  /** Plain-language explanation of what's happening in this room.
   *  Renders below the title in a smaller font. */
  description: string;
  /** Hex accent color. Drives the badge tint, header underline, and
   *  the connector glow when this room is active. */
  accent: string;
  /** A roman-numeral-ish glyph for the room badge (① ② ③ …). The
   *  glyph plus the title comprises the "room number" signpost. */
  glyph: string;
}

/**
 * The canonical room sequence. Order here drives the cascade Y-axis
 * positioning — stage_boundary events for these stages spawn rooms
 * in this order regardless of arrival order on the wire (the painter
 * uses the `order` field, not event arrival time).
 *
 * Stages NOT in this map (e.g., transient sub-stages emitted by
 * specific generators) don't get rooms; they paint inside the
 * room belonging to their parent stage.
 */
export const STAGE_ROOMS: Record<PipelineStage, StageRoomMeta> = {
  intake: {
    order: 0,
    title: "Understanding your situation",
    description:
      "Reading your prompt, parsing what you brought, and framing the question.",
    accent: "#8B5CF6",
    glyph: "①",
  },
  landscape: {
    order: 1,
    title: "Probability spaces",
    description:
      "Opening the dimensions that matter for this question — actors, scenarios, risk, …",
    accent: "#0891B2",
    glyph: "②",
  },
  kg: {
    order: 2,
    title: "Knowledge graph",
    description:
      "Decomposing the situation into entities, causal edges, and feedback cycles.",
    accent: "#10B981",
    glyph: "③",
  },
  proposal: {
    order: 3,
    title: "Strategies",
    description:
      "Synthesizing ranked strategies with the supporting reasoning that produced each one.",
    accent: "#D97706",
    glyph: "④",
  },
  lab: {
    order: 4,
    title: "Lab simulations",
    description:
      "Stress-testing strategies with Monte Carlo runs and counterfactual variants.",
    accent: "#EC4899",
    glyph: "⑤",
  },
  results: {
    order: 5,
    title: "Results",
    description: "Final synthesis and approved next actions.",
    accent: "#475569",
    glyph: "⑥",
  },
};

// ── Geometry ──────────────────────────────────────────────────────────
//
// All room boxes share a single width so the cascade has a clean
// vertical edge. Heights vary per stage based on what tends to land
// in each band (intake gets 240, KG gets 700 because the layered
// entity grid is tall, etc.). These are SOFT defaults — the painter
// can grow a room dynamically if more shapes than expected land
// inside it, but starting wide enough means the visual rarely
// shifts mid-run.

/** Horizontal extent of every room. Generous enough to cover the
 *  widest natural unfurl (the layered KG grid). */
export const ROOM_W = 1900;

/** Per-stage starting height. Painter can extend if needed. Exported
 *  so canvas-side helpers (e.g., the final-plan-card bridge that
 *  creates the results Room outside the SSE event stream) can size
 *  rooms consistently with the painter. */
export const STAGE_HEIGHT: Record<PipelineStage, number> = {
  intake: 280,
  landscape: 420,
  kg: 700,
  proposal: 540,
  lab: 460,
  results: 320,
};

/** Vertical breathing room between rooms — enough that the connector
 *  line + arrow head reads cleanly between them. */
export const ROOM_GAP = 100;

/** Y offset of the very first room from the painter's anchor. The
 *  painter places state.anchor.y near viewport mid-y; rooms start a
 *  bit above that so the first room's header is roughly at viewport
 *  top during the first paint. */
export const FIRST_ROOM_Y_OFFSET = -200;

/** Padding inside each room — header, body, footer. Used by the room
 *  shape's view component for layout, exposed here so the painter
 *  knows where to place children. */
export const ROOM_PADDING = {
  top: 64, // header bar
  bottom: 36,
  left: 24,
  right: 24,
};

/**
 * Compute the absolute (x, y, width, height) for a room belonging
 * to `stage`, assuming the painter's anchor is at `anchor`. Result
 * is deterministic — same anchor + same stage → same coordinates,
 * so re-paints don't shift rooms.
 */
export function computeRoomBounds(
  stage: PipelineStage,
  anchor: { x: number; y: number },
): { x: number; y: number; w: number; h: number } {
  const meta = STAGE_ROOMS[stage];
  // Sum heights + gaps for every room above this one in the order.
  let yOffset = FIRST_ROOM_Y_OFFSET;
  for (const otherStage of Object.keys(STAGE_ROOMS) as PipelineStage[]) {
    const other = STAGE_ROOMS[otherStage];
    if (other.order >= meta.order) continue;
    yOffset += STAGE_HEIGHT[otherStage] + ROOM_GAP;
  }
  return {
    x: anchor.x - ROOM_W / 2,
    y: anchor.y + yOffset,
    w: ROOM_W,
    h: STAGE_HEIGHT[stage],
  };
}

/**
 * Compute an absolute (x, y) coordinate inside a room's content area
 * given an offset relative to the room's interior. Use this for any
 * painter-managed shape that should visually live "inside" its
 * stage's room (kg-formation, probability shells, origin-prompt,
 * future proposal/lab cards).
 *
 * `offsetXFromCenter` is centered on the room's horizontal midline.
 * `offsetYFromTop` is measured from the top of the content area
 * (i.e., already past ROOM_PADDING.top so the header doesn't overlap).
 *
 * @example
 *   // Place kg-formation 24px down from the kg room's content top,
 *   // centered horizontally:
 *   const { x, y } = placeInsideRoom("kg", anchor, 0, 24);
 */
export function placeInsideRoom(
  stage: PipelineStage,
  anchor: { x: number; y: number },
  offsetXFromCenter: number,
  offsetYFromTop: number,
): { x: number; y: number } {
  const bounds = computeRoomBounds(stage, anchor);
  return {
    x: bounds.x + bounds.w / 2 + offsetXFromCenter,
    y: bounds.y + ROOM_PADDING.top + offsetYFromTop,
  };
}

/**
 * Inverse of `placeInsideRoom` — returns the (x, y) for a shape's
 * top-left corner given desired centered placement inside a room.
 * Subtracts half the shape's width/height so callers can think in
 * terms of "where do I want the shape's CENTER to land."
 */
export function placeCenteredInsideRoom(
  stage: PipelineStage,
  anchor: { x: number; y: number },
  shapeW: number,
  shapeH: number,
  offsetXFromCenter: number,
  offsetYFromTop: number,
): { x: number; y: number } {
  const inner = placeInsideRoom(stage, anchor, offsetXFromCenter, offsetYFromTop);
  return {
    x: inner.x - shapeW / 2,
    y: inner.y, // top-aligned by default; callers can pass extra y offset
  };
}

/**
 * Connector line endpoint for an arrow that drops from `fromStage`
 * to `toStage`. Used by the painter when drawing the vertical
 * connector between adjacent rooms.
 */
export function computeConnectorPoints(
  fromStage: PipelineStage,
  toStage: PipelineStage,
  anchor: { x: number; y: number },
): { x1: number; y1: number; x2: number; y2: number } | null {
  const fromMeta = STAGE_ROOMS[fromStage];
  const toMeta = STAGE_ROOMS[toStage];
  if (!fromMeta || !toMeta) return null;
  if (fromMeta.order + 1 !== toMeta.order) return null; // not adjacent
  const from = computeRoomBounds(fromStage, anchor);
  const to = computeRoomBounds(toStage, anchor);
  return {
    x1: from.x + from.w / 2,
    y1: from.y + from.h,
    x2: to.x + to.w / 2,
    y2: to.y,
  };
}

/**
 * Resolve which room a newly-painted shape (e.g., a kg-node, an
 * asset card, a probability-space-shell) belongs to based on the
 * pipeline event type that produced it. Returns null when the event
 * doesn't have a clear room home (the painter then leaves it alone).
 *
 * The painter uses this to:
 *   - place new shapes inside their owning room's bounds
 *   - bump the room's child count (drives the subtitle text)
 *   - send the room to back so subsequent shapes sit visually inside
 */
export function roomForEventType(
  eventType: string,
): PipelineStage | null {
  switch (eventType) {
    case "asset_added":
    case "situation_analyzed":
    case "memory_context_loaded":
    case "taxonomy_inferred":
      return "intake";
    case "space_opened":
    case "space_entity_added":
    case "space_edge_added":
    case "axis_scored":
    case "axis_failed":
    case "space_merge_begin":
    case "space_merge_complete":
      return "landscape";
    case "entity_added":
    case "edge_added":
    case "cycle_detected":
    case "bridge_formed":
    case "signature_deepened":
    case "root_cause_identified":
    case "why_chain_deepened":
      return "kg";
    case "proposal_ready":
    case "structural_analog_found":
    case "strategy_consensus_ready":
    case "target_outcome_identified":
      return "proposal";
    case "variant_proposed":
    case "iv_decomposition_ready":
    case "variant_deck_ready":
    case "causal_stage_ready":
    case "app_result_ready":
      return "lab";
    case "prediction_recorded":
    case "source_cited":
      return "results";
    default:
      return null;
  }
}

// ── Subtitle templates ────────────────────────────────────────────────
//
// Each room shows a live "X entities · Y edges so far" count below
// the title. The template builders below take a counts object and
// return a single short string. These run on every relevant event
// (cheap — just string formatting) so the subtitle stays current.

export interface RoomCounts {
  entities: number;
  edges: number;
  cycles: number;
  axes: number;
  axesScored: number;
  proposals: number;
  variants: number;
  bridges: number;
  assets: number;
  predictions: number;
}

export function buildRoomSubtitle(
  stage: PipelineStage,
  counts: RoomCounts,
): string {
  switch (stage) {
    case "intake": {
      const parts: string[] = [];
      if (counts.assets > 0) {
        parts.push(`${counts.assets} ${counts.assets === 1 ? "asset" : "assets"}`);
      }
      if (parts.length === 0) return "Reading your prompt…";
      return parts.join(" · ");
    }
    case "landscape": {
      if (counts.axes === 0) return "Opening lenses…";
      if (counts.axesScored < counts.axes) {
        return `${counts.axesScored}/${counts.axes} lenses scored`;
      }
      return `${counts.axes} ${counts.axes === 1 ? "lens" : "lenses"} ready`;
    }
    case "kg": {
      if (counts.entities === 0) return "Decomposing…";
      const parts: string[] = [];
      parts.push(`${counts.entities} ${counts.entities === 1 ? "entity" : "entities"}`);
      if (counts.edges > 0) parts.push(`${counts.edges} ${counts.edges === 1 ? "edge" : "edges"}`);
      if (counts.cycles > 0) parts.push(`${counts.cycles} ${counts.cycles === 1 ? "cycle" : "cycles"}`);
      if (counts.bridges > 0) parts.push(`${counts.bridges} ${counts.bridges === 1 ? "bridge" : "bridges"}`);
      return parts.join(" · ");
    }
    case "proposal": {
      if (counts.proposals === 0) return "Synthesizing strategies…";
      return `${counts.proposals} ${counts.proposals === 1 ? "strategy" : "strategies"} ranked`;
    }
    case "lab": {
      if (counts.variants === 0) return "Running simulations…";
      return `${counts.variants} ${counts.variants === 1 ? "variant" : "variants"}`;
    }
    case "results": {
      if (counts.predictions === 0) return "Final synthesis…";
      return `${counts.predictions} ${counts.predictions === 1 ? "prediction" : "predictions"} recorded`;
    }
  }
}

export const EMPTY_ROOM_COUNTS: RoomCounts = {
  entities: 0,
  edges: 0,
  cycles: 0,
  axes: 0,
  axesScored: 0,
  proposals: 0,
  variants: 0,
  bridges: 0,
  assets: 0,
  predictions: 0,
};
