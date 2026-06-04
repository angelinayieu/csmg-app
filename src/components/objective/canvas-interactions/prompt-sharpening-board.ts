// ── Prompt Sharpening → board materialization ──
//
// Drop the Prompt Sharpening Card onto the board connected straight below
// the objective card, and fork an ambiguity off it as its own node. Reuses
// the createShape + createBindings arrow recipe from synthesis-map.ts.

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import {
  SHARPEN_COLOR,
  type PromptSharpeningCardShape,
} from "../shapes/prompt-sharpening-card-shape";
import type { InsightCardShape } from "../shapes/insight-card-shape";
import type { RoomCardShape } from "../shapes/room-card-shape";
import type { SharpeningCardDetail, AmbiguityForkDetail } from "../board-bus";

const CARD_W = 348;
const CARD_H = 204;

// Connectors are no longer tldraw arrows — a custom bezier overlay
// (sharpening-connectors.tsx) draws them, derived live from the card
// positions. On older boards we created real arrows (meta.sharpeningArrow)
// for BOTH objective→sharpening and sharpening→fork; those now show as a
// straight line UNDER the new curve. Delete any that linger. Exported so the
// board can sweep them once on restore — a returning visit never re-runs
// deploy, so the sweep can't live only here.
export function clearLegacySharpeningArrows(editor: Editor): void {
  const ids = editor
    .getCurrentPageShapes()
    .filter(
      (s) =>
        s.type === "arrow" &&
        (s.meta as { sharpeningArrow?: boolean })?.sharpeningArrow,
    )
    .map((s) => s.id);
  if (ids.length > 0) editor.deleteShapes(ids);
}

/** Find the objective card on the board (the seeded "__obj" room-card). */
function findObjectiveCard(editor: Editor): TLShapeId | null {
  const shapes = editor.getCurrentPageShapes();
  const obj =
    shapes.find((s) => s.type === "objective-card") ??
    shapes.find(
      (s) =>
        s.type === "room-card" &&
        (s as RoomCardShape).props.roomId === "__obj",
    ) ??
    shapes.find((s) => s.type === "room-card");
  return obj ? obj.id : null;
}

/** Materialize the Prompt Sharpening Card below the objective card, with a
 *  downward connector. Idempotent — one sharpening card per board. */
export function deployPromptSharpeningOnBoard(
  editor: Editor,
  d: SharpeningCardDetail,
): void {
  clearLegacySharpeningArrows(editor);

  // If a card already exists (the optimistic "Sharpening…" placeholder, or a
  // returning visit), fill it IN PLACE — preserve its position + expanded
  // state. This is what makes the sharpening feel instant: the placeholder
  // appears on submit, then its content fills here when the artifact lands.
  const existing = editor
    .getCurrentPageShapes()
    .find((s) => s.type === "prompt-sharpening");
  if (existing) {
    // Filling a (collapsed) placeholder → snap h back to the collapsed base
    // so the card's auto-fit sizes it to the real content instead of leaving
    // the taller loading-view height. Preserve an expanded card's height.
    const wasExpanded =
      (existing as PromptSharpeningCardShape).props.expanded === true;
    editor.updateShape<PromptSharpeningCardShape>({
      id: existing.id,
      type: "prompt-sharpening",
      props: {
        spaceId: d.spaceId,
        title: d.title,
        sharpenedPrompt: d.sharpenedPrompt,
        chips: d.chips,
        heatmapJson: d.heatmapJson,
        rankedJson: d.rankedJson,
        color: d.color || SHARPEN_COLOR,
        ...(wasExpanded ? {} : { h: CARD_H }),
      },
    });
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
      color: d.color || SHARPEN_COLOR,
    },
  });

  // The objective→sharpening connector is drawn by the bezier overlay.
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
  // Fan into a grid (5 rows per column) so a batch "address all" never stacks.
  const x = baseX + Math.floor(forkCount / 5) * (W + 24);
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

  // The sharpening→fork connector is drawn by the bezier overlay.
  editor.select(id);
  editor.centerOnPoint(
    { x: x + W / 2, y: y + H / 2 },
    { animation: { duration: 300 } },
  );
}
