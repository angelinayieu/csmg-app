// ── Prompt Sharpening → board materialization ──
//
// Drop the Prompt Sharpening Card onto the board connected straight below
// the objective card, and fork an ambiguity off it as its own node. Reuses
// the createShape + createBindings arrow recipe from synthesis-map.ts.

import {
  createShapeId,
  type Editor,
  type TLArrowShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import type { PromptSharpeningCardShape } from "../shapes/prompt-sharpening-card-shape";
import type { InsightCardShape } from "../shapes/insight-card-shape";
import type { RoomCardShape } from "../shapes/room-card-shape";
import type { SharpeningCardDetail, AmbiguityForkDetail } from "../board-bus";

const CARD_W = 348;
const CARD_H = 204;

/** A solid, headed connector between two shapes (center → center). */
function connect(editor: Editor, fromId: TLShapeId, toId: TLShapeId): void {
  const arrowId = createShapeId();
  const arrow: TLShapePartial<TLArrowShape> = {
    id: arrowId,
    type: "arrow",
    props: { color: "grey", size: "s", dash: "solid", arrowheadEnd: "arrow" },
    meta: { sharpeningArrow: true },
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

/** Find the objective card on the board (the seeded "__obj" room-card). */
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

/** Materialize the Prompt Sharpening Card below the objective card, with a
 *  downward connector. Idempotent — one sharpening card per board. */
export function deployPromptSharpeningOnBoard(
  editor: Editor,
  d: SharpeningCardDetail,
): void {
  // Idempotent — one sharpening card per board. Quietly no-op on revisits
  // (don't re-select/re-center; the user may be elsewhere on the board).
  if (
    editor.getCurrentPageShapes().some((s) => s.type === "prompt-sharpening")
  ) {
    return;
  }

  const objId = findObjectiveCard(editor);
  const srcBounds = objId ? editor.getShapePageBounds(objId) : null;
  const vp = editor.getViewportPageBounds();
  const cx = srcBounds ? srcBounds.midX : vp.center.x;
  const y = srcBounds ? srcBounds.maxY + 56 : vp.center.y + 40;
  const x = cx - CARD_W / 2;

  const cardId = createShapeId();
  editor.createShape<PromptSharpeningCardShape>({
    id: cardId,
    type: "prompt-sharpening",
    x,
    y,
    props: {
      w: CARD_W,
      h: CARD_H,
      expanded: false,
      spaceId: d.spaceId,
      title: d.title,
      sharpenedPrompt: d.sharpenedPrompt,
      chips: d.chips,
      heatmapJson: d.heatmapJson,
      rankedJson: d.rankedJson,
      color: d.color || "#7C3AED",
    },
  });

  if (objId) connect(editor, objId, cardId);

  editor.select(cardId);
  editor.centerOnPoint(
    { x: x + CARD_W / 2, y: y + CARD_H / 2 },
    { animation: { duration: 320 } },
  );
}

/** Fork an ambiguity off the sharpening card as its own insight-card node. */
export function forkAmbiguityOnBoard(
  editor: Editor,
  d: AmbiguityForkDetail,
): void {
  const sourceId = d.sourceId as TLShapeId;
  const srcBounds = editor.getShapePageBounds(sourceId);
  const vp = editor.getViewportPageBounds();
  const W = 232;
  const H = 150;

  // Cascade existing forks to the right so they fan out instead of stacking.
  const forkCount = editor
    .getCurrentPageShapes()
    .filter(
      (s) =>
        s.type === "insight-card" &&
        (s.meta as { ambiguityFork?: boolean })?.ambiguityFork,
    ).length;
  const baseX = srcBounds ? srcBounds.maxX + 64 : vp.center.x;
  const baseY = srcBounds ? srcBounds.minY : vp.center.y;
  const x = baseX;
  const y = baseY + (forkCount % 5) * (H + 18);

  const id = createShapeId();
  editor.createShape<InsightCardShape>({
    id,
    type: "insight-card",
    x,
    y,
    props: {
      w: W,
      h: H,
      status: "accepted",
      kind: "connect",
      role: "single",
      headline: d.headline,
      body: d.body,
      color: d.color,
      sourceIds: [d.sourceId],
      citations: [],
    },
    meta: { ambiguityFork: true },
  });

  connect(editor, sourceId, id);
  editor.select(id);
  editor.centerOnPoint(
    { x: x + W / 2, y: y + H / 2 },
    { animation: { duration: 300 } },
  );
}
