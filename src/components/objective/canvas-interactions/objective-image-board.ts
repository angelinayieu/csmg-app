// ── Analyzed image → board materialization ──
//
// Drop an analyzed image as a card on the board, fanned out below-right of
// the objective card + connected with an arrow. Reuses the createShape +
// createBindings arrow recipe from prompt-sharpening-board.ts.

import {
  createShapeId,
  type Editor,
  type TLArrowShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import type { ObjectiveImageCardShape } from "../shapes/objective-image-card-shape";
import type { RoomCardShape } from "../shapes/room-card-shape";
import type { ImageCardDetail, UpdateImageCardDetail } from "../board-bus";
import { reserveSpace } from "./placement";

const CARD_W = 240;
const CARD_H = 172;

/** A solid, headed connector between two shapes (center → center). */
function connect(editor: Editor, fromId: TLShapeId, toId: TLShapeId): void {
  const arrowId = createShapeId();
  const arrow: TLShapePartial<TLArrowShape> = {
    id: arrowId,
    type: "arrow",
    props: { color: "grey", size: "s", dash: "solid", arrowheadEnd: "arrow" },
    meta: { imageArrow: true },
  };
  editor.createShapes([arrow]);
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
}

function findObjectiveCard(editor: Editor): TLShapeId | null {
  const shapes = editor.getCurrentPageShapes();
  const obj =
    shapes.find(
      (s) =>
        s.type === "room-card" &&
        (s as RoomCardShape).props.roomId === "__obj",
    ) ?? shapes.find((s) => s.type === "room-card");
  return obj ? obj.id : null;
}

/** Materialize an analyzed image as a card below the objective, fanned out
 *  in a row for multiples. Idempotent by imageFileId. */
export function deployImageCardOnBoard(
  editor: Editor,
  d: ImageCardDetail,
): void {
  const imageCards = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "objective-image-card");
  const existing = imageCards.find(
    (s) => (s as ObjectiveImageCardShape).props.imageFileId === d.imageFileId,
  ) as ObjectiveImageCardShape | undefined;
  if (existing) {
    // Already on the board — backfill objectId if the lazy /images
    // backfill resolved it after the card landed. Idempotent no-op
    // otherwise.
    if (d.objectId && !existing.props.objectId) {
      editor.updateShape<ObjectiveImageCardShape>({
        id: existing.id,
        type: "objective-image-card",
        props: { objectId: d.objectId },
      });
    }
    return;
  }

  const objId = findObjectiveCard(editor);
  const srcBounds = objId ? editor.getShapePageBounds(objId) : null;
  const vp = editor.getViewportPageBounds();

  // Fan out to the right of the sharpening card, wrapping every 4 — then settle
  // the slot into clear space (yield only, never shove existing work).
  const n = imageCards.length;
  const baseX = srcBounds ? srcBounds.maxX + 72 : vp.center.x;
  const baseY = srcBounds ? srcBounds.maxY + 56 : vp.center.y + 40;
  const slotX = baseX + (n % 4) * (CARD_W + 18);
  const slotY = baseY + Math.floor(n / 4) * (CARD_H + 40);
  const spot = reserveSpace(
    editor,
    { w: CARD_W, h: CARD_H },
    { anchorMidX: slotX + CARD_W / 2, preferredTop: slotY, gap: 24, allowPush: false },
  );
  const x = spot.x;
  const y = spot.y;

  const cardId = createShapeId();
  editor.createShape<ObjectiveImageCardShape>({
    id: cardId,
    type: "objective-image-card",
    x,
    y,
    props: {
      w: CARD_W,
      h: CARD_H,
      expanded: false,
      imageFileId: d.imageFileId,
      imageName: d.imageName,
      imageUrl: d.imageUrl,
      description: d.description,
      entityCount: d.entityCount,
      entitiesJson: d.entitiesJson,
      color: d.color || "#2563EB",
      objectId: d.objectId ?? "",
      analyzing: d.analyzing ?? false,
      analysisError: "",
    },
  });

  if (objId) connect(editor, objId, cardId);

  // Center on the first image only, so a burst of images doesn't keep
  // yanking the viewport.
  if (n === 0) {
    editor.select(cardId);
    editor.centerOnPoint(
      { x: x + CARD_W / 2, y: y + CARD_H / 2 },
      { animation: { duration: 300 } },
    );
  }
}

/** Patch a deployed image card in place — find by imageFileId === key and
 *  apply only the provided props. The canvas paste flow uses this to swap the
 *  temp client key for the real ingested_file_id + public URL (phase 1), fill
 *  the vision description/entities + flip `analyzing` off (phase 2), and
 *  backfill the objectId. No-op if the card isn't on this board. */
export function updateImageCardOnBoard(
  editor: Editor,
  d: UpdateImageCardDetail,
): void {
  const card = editor
    .getCurrentPageShapes()
    .find(
      (s) =>
        s.type === "objective-image-card" &&
        (s as ObjectiveImageCardShape).props.imageFileId === d.key,
    ) as ObjectiveImageCardShape | undefined;
  if (!card) return;
  // Drop undefined keys so we never clobber existing props with `undefined`.
  const props: Partial<ObjectiveImageCardShape["props"]> = {};
  for (const [k, v] of Object.entries(d.patch)) {
    if (v !== undefined) {
      (props as Record<string, unknown>)[k] = v;
    }
  }
  if (Object.keys(props).length === 0) return;
  editor.updateShape<ObjectiveImageCardShape>({
    id: card.id,
    type: "objective-image-card",
    props,
  });
}
