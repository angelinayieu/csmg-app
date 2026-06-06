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
  type TLShapeId,
} from "tldraw";
import type { OcCardShape, OcCardKind } from "../shapes/oc-card-shape";
import { layoutSystemsGraph } from "@/lib/objective-canvas/layout-systems-graph";
import { reserveSpace } from "./placement";
import { frameForkedGroup } from "./group-frame";
import { deployFlowConnector } from "./flow-connector-board";

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

  const vp = editor.getViewportPageBounds();

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

  // Hybrid push-then-yield: reserve a clear region for the WHOLE systems graph,
  // pushing earlier generations aside or relocating the cluster — never on top.
  // sinkX is one layer-pitch past the rightmost card; pad the left for the
  // swimlane labels (they sit ~8px left of the cards) and use the graph's full
  // height so the reservation covers every lane.
  const graphH =
    Math.max(CARD_H, ...[...layout.pos.values()].map((p) => p.y + CARD_H));
  const spot = reserveSpace(
    editor,
    { w: layout.sinkX + 16, h: graphH },
    { anchorMidX: vp.center.x, preferredTop, gap: GAP_BELOW },
  );
  const anchorX = spot.x + 8;
  const anchorY = spot.y;

  const idByObject = new Map<string, TLShapeId>();
  const cardIds: TLShapeId[] = [];
  const laneLabelIds: TLShapeId[] = [];
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
    laneLabelIds.push(labelId);
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

  // ── Directed dependency wires — the REAL flow-connector (green-out / pink-in
  //    ports + green→pink gradient), source → target downstream. A board reactor
  //    keeps them synced so they move with the cards. Replaces the old native
  //    grey arrows for ONE consistent connector style across the board. ──
  for (const e of edges) {
    const a = idByObject.get(e.from);
    const b = idByObject.get(e.to);
    if (!a || !b) continue;
    const wireId = deployFlowConnector(editor, a, b);
    if (wireId) allCreated.push(wireId);
  }

  // ── Grouping underlay + fork connector ── wrap the whole decomposition in a
  //    frosted backdrop (so it reads as ONE system, not loose cards) and tether
  //    it back to the objective it was forked out of. The frame goes to the back
  //    inside the helper; include it in the selection so the fit-zoom frames it.
  const objectiveSource =
    editor.getCurrentPageShapes().find((s) => s.type === "objective-card") ??
    editor.getCurrentPageShapes().find((s) => s.type === "room-card");
  const frameId = frameForkedGroup(editor, {
    childIds: [...cardIds, ...laneLabelIds],
    sourceShapeId: objectiveSource?.id ?? null,
    label: "Decomposition",
    accent: "#7C3AED",
  });
  if (frameId) allCreated.push(frameId);

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
