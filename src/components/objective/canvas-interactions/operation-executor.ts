// ── Operation Executor (canvas-AI-scanner Phase 1) ──
//
// The single place a canvas AI operation is RUN and its results dropped back
// onto the board. Replaces the old "AI actions fire into the void" gap: a card
// (or, in Phase 2, a sticky note) dispatches a CardAction → WhiteboardBase calls
// executeCardOperation → we look the operation up in the registry, run it, and
// materialize the results as `lab` artifact cards clustered just below the
// source shape (so they're saveable to Library + tethered to where they came
// from). tldraw-coupled; imported only by whiteboard-base.

import {
  createShapeId,
  type Editor,
  type TLShapeId,
} from "tldraw";
import type { ArtifactCardShape } from "../shapes/artifact-card-shape";
import {
  operationById,
  runOperation,
  type OperationTarget,
  type OperationRunOptions,
} from "@/lib/objective-canvas/canvas-operations";

const RESULT_W = 216;
const RESULT_H = 132;
const GAP_X = 16;
const GAP_Y = 16;
const PER_ROW = 3;
/** Slate — neutral accent for AI-result cards (matches the de-purpled theme). */
const RESULT_COLOR = "#64748B";

/** Run a wired text operation for a card/sticky and render the results.
 *  Soft-fails silently (no results → nothing happens). */
export async function executeCardOperation(
  editor: Editor,
  target: OperationTarget,
  opId: string,
  opts: OperationRunOptions = {},
): Promise<void> {
  const op = operationById(opId);
  if (!op || !op.wired) return;

  // Anchor the result cluster just below the source shape (fallback: viewport).
  let anchorMidX: number;
  let startY: number;
  const bounds = target.shapeId
    ? editor.getShapePageBounds(target.shapeId as TLShapeId)
    : undefined;
  if (bounds) {
    anchorMidX = bounds.midX;
    startY = bounds.maxY + 40;
  } else {
    const vp = editor.getViewportPageBounds();
    anchorMidX = vp.center.x;
    startY = vp.center.y;
  }

  // No pending placeholder shape — the trigger surfaces show their own
  // affordance (scanner rows + the ‹ › buttons), and a grey sticky on the
  // board just reads as clutter. runOperation soft-fails to [] (never throws).
  const items = await runOperation(op, target, opts);
  if (!items.length) return;

  const perRow =
    op.resultLayout === "column" ? 1 : Math.min(items.length, PER_ROW);
  const rowWidth = perRow * RESULT_W + (perRow - 1) * GAP_X;
  const stamp = Date.now();

  items.forEach((item, i) => {
    const col = i % PER_ROW;
    const row = Math.floor(i / PER_ROW);
    const x = anchorMidX - rowWidth / 2 + col * (RESULT_W + GAP_X);
    const y = startY + row * (RESULT_H + GAP_Y);
    editor.createShape<ArtifactCardShape>({
      id: createShapeId(),
      type: "artifact-card",
      x,
      y,
      props: {
        w: RESULT_W,
        h: RESULT_H,
        kind: "lab",
        title: item.title || "Idea",
        subtitle: item.subtitle ?? "",
        color: RESULT_COLOR,
        entityId: `op-${opId}-${stamp}-${i}`,
        roomId: target.roomId ?? "",
      },
      meta: {
        opResult: true,
        op: opId,
        sourceShapeId: target.shapeId ?? "",
      },
    });
  });

  // Reveal where the results landed without yanking the zoom level.
  const nRows = Math.ceil(items.length / PER_ROW);
  const clusterHeight = nRows * RESULT_H + (nRows - 1) * GAP_Y;
  editor.centerOnPoint(
    { x: anchorMidX, y: startY + clusterHeight / 2 },
    { animation: { duration: 300 } },
  );
}
