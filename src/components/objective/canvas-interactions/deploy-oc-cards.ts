// ── Deploy decomposed Feature/Variable cards onto the board ──
//
// Takes the output of /api/objective/[spaceId]/decompose-cards and lays it
// out as oc-card shapes: features in a left column, variables in a right
// column, with calm dashed arrows for their connections. Decoupled from the
// board internals via DECOMPOSE_INTO_CARDS_EVENT so any trigger (button,
// command palette, card action) can request a decompose.

import {
  createShapeId,
  type Editor,
  type TLArrowShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import type { OcCardShape, OcCardKind } from "../shapes/oc-card-shape";

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
}
export interface DeployLink {
  fromObjectId: string;
  toObjectId: string;
  relation: string;
}

const CARD_W = 248;
// Spawn height fits the card's clamped face (2-line name + 3-line body +
// footer) so nothing is cropped on spawn, and the row pitch leaves slack for
// the shape's useAutoFitHeight to grow a touch without overlapping the next
// row. Keep in sync with OcCardShapeUtil.getDefaultProps.
const CARD_H = 176;
const GAP_Y = 26;
const COL_GAP = 220;

/** Lay out the cards, wire their connections, frame the result. Returns the
 *  created card shape ids. */
export function deployOcCards(
  editor: Editor,
  cards: DeployCard[],
  links: DeployLink[],
): TLShapeId[] {
  if (cards.length === 0) return [];
  const features = cards.filter((c) => c.kind === "feature");
  const variables = cards.filter((c) => c.kind === "variable");
  const vp = editor.getViewportPageBounds();
  const idByObject = new Map<string, TLShapeId>();
  const created: TLShapeId[] = [];

  // Anchor the cluster BELOW the objective + sharpening cards so it reads as
  // a downstream layer instead of piling on top of them (the overlap bug).
  const existingBottoms = editor
    .getCurrentPageShapes()
    .filter(
      (s) =>
        s.type === "objective-card" ||
        s.type === "room-card" ||
        s.type === "prompt-sharpening",
    )
    .map((s) => editor.getShapePageBounds(s.id)?.maxY)
    .filter((v): v is number => typeof v === "number");
  const startY =
    existingBottoms.length > 0
      ? Math.max(...existingBottoms) + 96
      : vp.center.y;

  const placeColumn = (list: DeployCard[], x: number) => {
    // Both columns top-align at startY (below the upstream cards) so the
    // feature→variable links read cleanly in their own downstream band.
    let y = startY;
    for (const c of list) {
      const id = createShapeId();
      idByObject.set(c.objectId, id);
      created.push(id);
      editor.createShape<OcCardShape>({
        id,
        type: "oc-card",
        x,
        y,
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
      y += CARD_H + GAP_Y;
    }
  };

  placeColumn(features, vp.center.x - CARD_W - COL_GAP / 2);
  placeColumn(variables, vp.center.x + COL_GAP / 2);

  // Connections — calm dashed arrows (feature → variable).
  for (const l of links) {
    const a = idByObject.get(l.fromObjectId);
    const b = idByObject.get(l.toObjectId);
    if (!a || !b) continue;
    const arrowId = createShapeId();
    const arrow: TLShapePartial<TLArrowShape> = {
      id: arrowId,
      type: "arrow",
      props: {
        color: "grey",
        size: "s",
        dash: "dashed",
        // Clean connector — no arrowheads + a soft curve, matching the
        // sharpening connectors. Bound feature right-edge → variable
        // left-edge so links read as a tidy left→right flow, not a
        // center-to-center criss-cross.
        arrowheadStart: "none",
        arrowheadEnd: "none",
        bend: 26,
      },
      meta: { ocLink: true },
    };
    editor.createShapes([arrow]);
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

  if (created.length > 0) {
    editor.select(...created);
    editor.zoomToSelection({ animation: { duration: 300 } });
    editor.selectNone();
  }
  return created;
}
