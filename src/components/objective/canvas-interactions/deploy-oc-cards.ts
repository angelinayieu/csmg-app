// ── Deploy decomposed Feature/Variable cards onto the board ──
//
// Takes the output of /api/objective/[spaceId]/decompose-cards and lays it
// out as a SYSTEMS graph: subsystems = horizontal swimlanes, causal depth =
// left→right columns, dependencies = DIRECTED arrows. Replaces the old
// "features in a left column, variables in a right column, undirected dashed
// lines" placer, which produced crossing spaghetti that showed neither
// direction nor grouping. The layout math lives in layout-systems-graph;
// this module just materializes it as tldraw shapes.
//
// Decoupled from the board internals via DECOMPOSE_INTO_CARDS_EVENT so any
// trigger (button, command palette, card action) can request a decompose.

import {
  createShapeId,
  toRichText,
  type Editor,
  type TLArrowShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import type { OcCardShape, OcCardKind } from "../shapes/oc-card-shape";
import { layoutSystemsGraph } from "@/lib/objective-canvas/layout-systems-graph";
import { lowestClearTop } from "./placement";

/** Fire to ask the board to decompose the current objective into cards. */
export const DECOMPOSE_INTO_CARDS_EVENT = "objective-board:decompose-into-cards";
/** Fired by the board listener when a decompose run settles (ok or fail),
 *  so a trigger can clear its busy state. */
export const DECOMPOSE_DONE_EVENT = "objective-board:decompose-done";

export function requestDecomposeIntoCards() {
  window.dispatchEvent(new CustomEvent(DECOMPOSE_INTO_CARDS_EVENT));
}

export interface DeployCard {
  objectId: string;
  kind: OcCardKind;
  name: string;
  body: string;
  /** Cohesive cluster → its swimlane. Defaults to "Core" when absent. */
  subsystem?: string;
}
export interface DeployLink {
  fromObjectId: string;
  toObjectId: string;
  /** "feeds" → from drives to; "depends_on" → from needs to (flow reversed). */
  relation: string;
}

const CARD_W = 248;
const CARD_H = 176;
/** Vertical breathing room between a new decompose cluster and whatever sits
 *  above it — the objective head, or a previous generation. */
const GAP_BELOW = 120;

/** Lay the cards out as a swimlane × causal-layer systems graph, wire their
 *  directed connections, label the lanes, frame the result. Returns the
 *  created card shape ids. */
export function deployOcCards(
  editor: Editor,
  cards: DeployCard[],
  links: DeployLink[],
): TLShapeId[] {
  if (cards.length === 0) return [];

  // ── Causal direction. "feeds" flows from→to (a feature drives a variable);
  //    "depends_on" flows to→from (the variable is an input the feature
  //    needs). Normalizing here means every edge points downstream, so the
  //    layering + arrows read strictly left→right. ──
  const edges = links
    .map((l) =>
      l.relation === "depends_on"
        ? { from: l.toObjectId, to: l.fromObjectId }
        : { from: l.fromObjectId, to: l.toObjectId },
    )
    .filter((e) => e.from !== e.to);

  const layout = layoutSystemsGraph(
    cards.map((c) => ({ id: c.objectId, subsystem: c.subsystem || "Core" })),
    edges,
    { cardW: CARD_W, cardH: CARD_H, startX: 0, startY: 0 },
  );

  // Anchor the cluster horizontally centered on the viewport.
  const vp = editor.getViewportPageBounds();
  const anchorX = vp.center.x - layout.sinkX / 2;

  // Baseline: drop the cluster BELOW the objective + sharpening head cards so it
  // reads as a downstream layer (not piling on top of them).
  const headBottoms = editor
    .getCurrentPageShapes()
    .filter(
      (s) =>
        s.type === "objective-card" ||
        s.type === "room-card" ||
        s.type === "prompt-sharpening",
    )
    .map((s) => editor.getShapePageBounds(s.id)?.maxY)
    .filter((v): v is number => typeof v === "number");
  const preferredTop =
    headBottoms.length > 0 ? Math.max(...headBottoms) + GAP_BELOW : vp.center.y;

  // STRICT no-overlap rule: never spawn on top of an earlier generation (or any
  // shape) sharing this cluster's horizontal span — drop below the lowest one
  // with a margin. Lane labels sit a touch left of the cards, so pad the span's
  // left edge; sinkX is one layer-pitch past the rightmost card, covering it.
  const anchorY = lowestClearTop(
    editor,
    { left: anchorX - 16, right: anchorX + layout.sinkX },
    preferredTop,
    GAP_BELOW,
  );

  const idByObject = new Map<string, TLShapeId>();
  const cardIds: TLShapeId[] = [];
  const allCreated: TLShapeId[] = [];

  // ── Quiet swimlane labels (no boxes — a soft label + whitespace keep it
  //    minimal while making the subsystem grouping legible). ──
  for (const lane of layout.lanes) {
    const labelId = createShapeId();
    editor.createShape({
      id: labelId,
      type: "text",
      x: anchorX - 8,
      y: anchorY + lane.top - 34,
      props: {
        richText: toRichText(lane.subsystem),
        size: "s",
        color: "grey",
        font: "sans",
        textAlign: "start",
        autoSize: true,
        scale: 1,
      },
      meta: { ocLaneLabel: true },
    });
    allCreated.push(labelId);
  }

  // ── Feature / Variable oc-cards at their swimlane × layer position. ──
  for (const c of cards) {
    const p = layout.pos.get(c.objectId);
    if (!p) continue;
    const id = createShapeId();
    idByObject.set(c.objectId, id);
    cardIds.push(id);
    allCreated.push(id);
    editor.createShape<OcCardShape>({
      id,
      type: "oc-card",
      x: anchorX + p.x,
      y: anchorY + p.y,
      props: {
        w: CARD_W,
        h: CARD_H,
        kind: c.kind,
        name: c.name,
        body: c.body,
        objectId: c.objectId,
        metaCount: 0,
      },
    });
  }

  // ── Directed dependency arrows — clean, solid, small arrowhead; bound
  //    source-right → target-left so direction reads as the left→right flow. ──
  for (const e of edges) {
    const a = idByObject.get(e.from);
    const b = idByObject.get(e.to);
    if (!a || !b) continue;
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
      meta: { ocLink: true },
    };
    editor.createShapes([arrow]);
    allCreated.push(arrowId);
    editor.createBindings([
      {
        fromId: arrowId,
        toId: a,
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
        toId: b,
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
  }

  if (allCreated.length > 0) {
    editor.select(...allCreated);
    // Zoom with a generous inset so the cluster (esp. the left-edge swimlane
    // labels) clears the floating board chrome — Home/Goal/History/Settings
    // pills on the left, Library/Powerups on the right — instead of tucking
    // under it.
    const bounds = editor.getSelectionPageBounds();
    if (bounds) {
      editor.zoomToBounds(bounds, { inset: 130, animation: { duration: 300 } });
    } else {
      editor.zoomToSelection({ animation: { duration: 300 } });
    }
    editor.selectNone();
  }
  return cardIds;
}
