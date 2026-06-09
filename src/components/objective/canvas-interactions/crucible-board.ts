// ── Crucible card → board materialization ──
//
// Drop the Crucible interrogation card onto the board next to the objective,
// right after promote. Idempotent — one Crucible card per board. The card
// self-polls /api/objective/[id]/crucible to run the loop, so this helper only
// places the shape; it carries no loop state.

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import { reserveSpace } from "./placement";
import {
  CRUCIBLE_COLOR,
  type CrucibleCardShape,
} from "../shapes/crucible-card-shape";
import type { RoomCardShape } from "../shapes/room-card-shape";
import type { CrucibleCardDetail } from "../board-bus";

const CARD_W = 392;
const CARD_H = 460;

/** Find the objective card on the board (objective-card, or the seeded
 *  "__obj" room-card in minimal mode). */
function findObjectiveCard(editor: Editor): TLShapeId | null {
  const shapes = editor.getCurrentPageShapes();
  const obj =
    shapes.find((s) => s.type === "objective-card") ??
    shapes.find(
      (s) =>
        s.type === "room-card" &&
        (s as RoomCardShape).props.roomId === "__obj",
    );
  return obj ? obj.id : null;
}

/** Materialize the Crucible card to the RIGHT of the objective (so it sits
 *  beside the sharpening stack that forks DOWN). Idempotent. */
export function deployCrucibleOnBoard(
  editor: Editor,
  d: CrucibleCardDetail,
): void {
  // One per board — focus the existing one instead of duplicating.
  const existing = editor
    .getCurrentPageShapes()
    .find((s) => s.type === "crucible-card");
  if (existing) {
    editor.select(existing.id);
    return;
  }

  const objId = findObjectiveCard(editor);
  const srcBounds = objId ? editor.getShapePageBounds(objId) : null;
  const vp = editor.getViewportPageBounds();
  // Beside the objective (its right), top-aligned — the sharpening cards take
  // the column below the objective; the Crucible takes the right lane.
  const preferredLeft = srcBounds ? srcBounds.maxX + 64 : vp.center.x + 64;
  const preferredTop = srcBounds ? srcBounds.minY : vp.center.y - CARD_H / 2;
  const spot = reserveSpace(
    editor,
    { w: CARD_W, h: CARD_H },
    {
      anchorMidX: preferredLeft + CARD_W / 2,
      preferredTop,
      gap: 40,
      allowPush: false,
    },
  );

  const id = createShapeId();
  editor.createShape<CrucibleCardShape>({
    id,
    type: "crucible-card",
    x: spot.x,
    y: spot.y,
    props: {
      w: CARD_W,
      h: CARD_H,
      spaceId: d.spaceId,
      color: d.color || CRUCIBLE_COLOR,
    },
  });
  editor.select(id);
  editor.centerOnPoint(
    { x: spot.x + CARD_W / 2, y: spot.y + CARD_H / 2 },
    { animation: { duration: 320 } },
  );
}
