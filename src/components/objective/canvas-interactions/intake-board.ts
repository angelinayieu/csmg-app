// ── Whiteboard-native intake → board materialization ──
//
// Seeds the chatbox card (draft) or objective card (promoted) onto the
// board, and transforms the chatbox card into the objective card in place
// on submit. The board always has a real (draft) spaceId, so there's no
// navigation or persistence swap.

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import type { ChatboxCardShape } from "../shapes/chatbox-card-shape";
import type { ObjectiveCardShape } from "../shapes/objective-card-shape";
import { appleVibe } from "@/lib/apple-vibe-tokens";

const CHATBOX_W = 420;
const CHATBOX_H = 176;
const OBJ_W = 340;
const OBJ_H = 168;

function centerOf(editor: Editor): { x: number; y: number } {
  const vp = editor.getViewportPageBounds();
  return { x: vp.center.x, y: vp.center.y };
}

/** Seed the chatbox card centered on the board (draft spaces). Idempotent. */
export function deployChatboxOnBoard(
  editor: Editor,
  detail: { spaceId: string; seedText: string },
): void {
  if (editor.getCurrentPageShapes().some((s) => s.type === "chatbox-card")) {
    return;
  }
  const c = centerOf(editor);
  const x = c.x - CHATBOX_W / 2;
  const y = c.y - CHATBOX_H / 2;
  const id = createShapeId();
  editor.createShape<ChatboxCardShape>({
    id,
    type: "chatbox-card",
    x,
    y,
    props: {
      w: CHATBOX_W,
      h: CHATBOX_H,
      spaceId: detail.spaceId,
      seedText: detail.seedText ?? "",
      color: appleVibe.accent.primary,
    },
  });
  editor.centerOnPoint(
    { x: x + CHATBOX_W / 2, y: y + CHATBOX_H / 2 },
    { animation: { duration: 200 } },
  );
}

/** Seed the objective card centered (promoted spaces opened fresh). Idempotent. */
export function deployObjectiveOnBoard(
  editor: Editor,
  detail: { spaceId: string; title: string; objective: string },
): void {
  if (editor.getCurrentPageShapes().some((s) => s.type === "objective-card")) {
    return;
  }
  const c = centerOf(editor);
  const x = c.x - OBJ_W / 2;
  const y = c.y - OBJ_H / 2;
  const id = createShapeId();
  editor.createShape<ObjectiveCardShape>({
    id,
    type: "objective-card",
    x,
    y,
    props: {
      w: OBJ_W,
      h: OBJ_H,
      spaceId: detail.spaceId,
      title: detail.title,
      objective: detail.objective,
      color: appleVibe.stage.objective,
    },
  });
  editor.centerOnPoint(
    { x: x + OBJ_W / 2, y: y + OBJ_H / 2 },
    { animation: { duration: 200 } },
  );
}

/** In-place transform: delete the chatbox card, create the objective card at
 *  the SAME position. Returns the new objective card's id (for the sharpening
 *  fork to anchor below it). */
export function promoteChatboxToObjective(
  editor: Editor,
  detail: { chatboxId: string; spaceId: string; title: string; objective: string },
): TLShapeId | null {
  const chatbox = editor.getShape(detail.chatboxId as TLShapeId) as
    | ChatboxCardShape
    | undefined;
  // Anchor at the chatbox's position (fall back to viewport center).
  let x: number;
  let y: number;
  if (chatbox) {
    x = chatbox.x;
    y = chatbox.y;
    editor.deleteShape(chatbox.id);
  } else {
    const c = centerOf(editor);
    x = c.x - OBJ_W / 2;
    y = c.y - OBJ_H / 2;
  }
  const id = createShapeId();
  editor.createShape<ObjectiveCardShape>({
    id,
    type: "objective-card",
    x,
    y,
    props: {
      w: OBJ_W,
      h: OBJ_H,
      spaceId: detail.spaceId,
      title: detail.title,
      objective: detail.objective,
      color: appleVibe.stage.objective,
    },
  });
  editor.select(id);
  editor.centerOnPoint(
    { x: x + OBJ_W / 2, y: y + OBJ_H / 2 },
    { animation: { duration: 250 } },
  );
  return id;
}
