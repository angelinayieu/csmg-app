// ── Exploration card → board materialization ──
//
// Drop an Exploration (variation/brainstorm) card near the source heatmap /
// priority card. Idempotent per (sourceId + headline): re-clicking "Explore"
// on the same ambiguity focuses the existing card instead of duplicating it.
// The card self-fetches /explore-ambiguity to run diverge → converge.

import { createShapeId, type Editor } from "tldraw";
import { reserveSpace } from "./placement";
import {
  EXPLORE_COLOR,
  type ExplorationCardShape,
} from "../shapes/exploration-card-shape";
import type { ExplorationCardDetail } from "../board-bus";

const CARD_W = 380;
const CARD_H = 440;

export function deployExplorationOnBoard(
  editor: Editor,
  d: ExplorationCardDetail,
): void {
  // Idempotent per source ambiguity.
  const existing = editor.getCurrentPageShapes().find(
    (s) =>
      s.type === "exploration-card" &&
      (s as ExplorationCardShape).props.headline === d.headline &&
      (s.meta as { exploreSourceId?: string })?.exploreSourceId === d.sourceId,
  );
  if (existing) {
    editor.select(existing.id);
    editor.centerOnPoint(
      {
        x: (existing as ExplorationCardShape).x + CARD_W / 2,
        y: (existing as ExplorationCardShape).y + CARD_H / 2,
      },
      { animation: { duration: 280 } },
    );
    return;
  }

  const srcBounds = d.sourceId
    ? editor.getShapePageBounds(d.sourceId as ExplorationCardShape["id"])
    : null;
  const vp = editor.getViewportPageBounds();
  // To the right of the source card so the fork reads left→right.
  const preferredLeft = srcBounds ? srcBounds.maxX + 56 : vp.center.x + 56;
  const preferredTop = srcBounds ? srcBounds.minY : vp.center.y - CARD_H / 2;
  const spot = reserveSpace(
    editor,
    { w: CARD_W, h: CARD_H },
    { anchorMidX: preferredLeft + CARD_W / 2, preferredTop, gap: 36, allowPush: false },
  );

  const id = createShapeId();
  editor.createShape<ExplorationCardShape>({
    id,
    type: "exploration-card",
    x: spot.x,
    y: spot.y,
    props: {
      w: CARD_W,
      h: CARD_H,
      spaceId: d.spaceId,
      headline: d.headline,
      question: d.question ?? "",
      source: d.source ?? "",
      objectId: "",
      color: d.color || EXPLORE_COLOR,
    },
    meta: { exploreSourceId: d.sourceId },
  });
  editor.select(id);
  editor.centerOnPoint(
    { x: spot.x + CARD_W / 2, y: spot.y + CARD_H / 2 },
    { animation: { duration: 320 } },
  );
}
