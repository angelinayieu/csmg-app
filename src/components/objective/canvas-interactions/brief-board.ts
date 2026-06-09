// ── Objective brief card → board materialization ──
//
// Drop the composed Objective Brief card on the board. Idempotent — one brief
// per board (re-triggering focuses + refreshes the existing one). Placed below
// the objective card (the brief is its synthesis). Self-fetches /brief.

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import { reserveSpace } from "./placement";
import {
  BRIEF_COLOR,
  type ObjectiveBriefCardShape,
} from "../shapes/objective-brief-card-shape";
import type { RoomCardShape } from "../shapes/room-card-shape";
import type { ObjectiveBriefCardDetail } from "../board-bus";

const CARD_W = 420;
const CARD_H = 540;

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

export function deployObjectiveBriefOnBoard(
  editor: Editor,
  d: ObjectiveBriefCardDetail,
): void {
  const existing = editor
    .getCurrentPageShapes()
    .find((s) => s.type === "objective-brief-card");
  if (existing) {
    editor.select(existing.id);
    const b = editor.getShapePageBounds(existing.id);
    if (b)
      editor.centerOnPoint({ x: b.midX, y: b.midY }, { animation: { duration: 280 } });
    return;
  }

  const objId = findObjectiveCard(editor);
  const srcBounds = objId ? editor.getShapePageBounds(objId) : null;
  const vp = editor.getViewportPageBounds();
  // Below the objective, offset left so it doesn't collide with the sharpening
  // column or the Crucible card on the right.
  const cx = srcBounds ? srcBounds.midX - CARD_W - 80 : vp.center.x - CARD_W / 2;
  const preferredTop = srcBounds ? srcBounds.maxY + 56 : vp.center.y;
  const spot = reserveSpace(
    editor,
    { w: CARD_W, h: CARD_H },
    { anchorMidX: cx + CARD_W / 2, preferredTop, gap: 40, allowPush: false },
  );

  const id = createShapeId();
  editor.createShape<ObjectiveBriefCardShape>({
    id,
    type: "objective-brief-card",
    x: spot.x,
    y: spot.y,
    props: {
      w: CARD_W,
      h: CARD_H,
      spaceId: d.spaceId,
      color: d.color || BRIEF_COLOR,
    },
  });
  editor.select(id);
  editor.centerOnPoint(
    { x: spot.x + CARD_W / 2, y: spot.y + CARD_H / 2 },
    { animation: { duration: 320 } },
  );
}
