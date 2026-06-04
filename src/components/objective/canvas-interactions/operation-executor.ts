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
import type { OcCardShape, OcCardKind } from "../shapes/oc-card-shape";
import {
  operationById,
  runOperation,
  type OperationTarget,
  type OperationResultItem,
  type OperationRunOptions,
} from "@/lib/objective-canvas/canvas-operations";
import { saveCardsToLibrary, type SaveableCard } from "./save-to-library";

const RESULT_W = 216;
const RESULT_H = 132;
/** Vertical pitch per row — fits the taller oc-card (feature/variable). */
const ROW_H = 176;
const GAP_X = 16;
const PER_ROW = 3;
/** Slate — neutral accent for AI-result cards (matches the de-purpled theme). */
const RESULT_COLOR = "#64748B";

/** Feature/Variable nodes render as the clickable oc-card; everything else
 *  (factor / decision / question) as a generic "lab" node. */
const FV = new Set(["feature", "variable"]);
function objectTypeFor(t?: string): SaveableCard["objectType"] {
  return t === "feature" ? "feature" : t === "variable" ? "variable" : "insight";
}

/** Result of a run: how many cards landed on the board. Callers (the ‹ ›
 *  popup) use `count === 0` to surface "nothing came back" feedback instead of
 *  a silent no-op — the #1 cause of "converge doesn't work" reports. */
export type OperationRunResult = { count: number };

/** Run a wired text operation for a card/sticky and render the results.
 *  Returns the number of cards created (0 → caller should signal "nothing
 *  came back" rather than fail silently). */
export async function executeCardOperation(
  editor: Editor,
  target: OperationTarget,
  opId: string,
  opts: OperationRunOptions = {},
): Promise<OperationRunResult> {
  const op = operationById(opId);
  if (!op || !op.wired) return { count: 0 };

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
  if (!items.length) return { count: 0 };

  const perRow =
    op.resultLayout === "column" ? 1 : Math.min(items.length, PER_ROW);
  const rowWidth = perRow * RESULT_W + (perRow - 1) * GAP_X;
  const stamp = Date.now();

  // Create the result cards: feature/variable → oc-card (clickable to its
  // object detail), everything else → a generic "lab" node. Remember each shape
  // id so the library objectId can be backfilled (→ single-click opens the
  // detail drawer; no dead ends).
  const created: { shapeId: TLShapeId; item: OperationResultItem; isOc: boolean }[] = [];
  items.forEach((item, i) => {
    const col = i % PER_ROW;
    const row = Math.floor(i / PER_ROW);
    const x = anchorMidX - rowWidth / 2 + col * (RESULT_W + GAP_X);
    const y = startY + row * ROW_H;
    const id = createShapeId();
    const isOc = !!item.type && FV.has(item.type);
    if (isOc) {
      editor.createShape<OcCardShape>({
        id,
        type: "oc-card",
        x,
        y,
        props: {
          w: RESULT_W,
          h: 160,
          kind: item.type as OcCardKind,
          name: item.title || "Idea",
          body: item.subtitle ?? "",
          objectId: "",
          metaCount: 0,
        },
        meta: { opResult: true, op: opId, sourceShapeId: target.shapeId ?? "" },
      });
    } else {
      editor.createShape<ArtifactCardShape>({
        id,
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
        meta: { opResult: true, op: opId, sourceShapeId: target.shapeId ?? "" },
      });
    }
    created.push({ shapeId: id, item, isOc });
  });

  // Reveal where the results landed without yanking the zoom level.
  const nRows = Math.ceil(items.length / PER_ROW);
  const clusterHeight = nRows * ROW_H;
  editor.centerOnPoint(
    { x: anchorMidX, y: startY + clusterHeight / 2 },
    { animation: { duration: 300 } },
  );

  // Persist each result to library_objects, then backfill the objectId onto its
  // shape so a single click opens the object detail drawer (no dead ends). The
  // cards already render above; this just makes them first-class. Soft-fails.
  if (opts.spaceId) {
    const spaceId = opts.spaceId;
    void (async () => {
      const { objectIds } = await saveCardsToLibrary(
        spaceId,
        created.map(({ item }) => ({
          objectType: objectTypeFor(item.type),
          title: item.title,
          summary: item.subtitle ?? null,
          // Unique per (op, title) so distinct result cards don't collide on the
          // null natural key; a same-title re-run dedupes (updates) instead.
          sourceRef: `op:${opId}:${item.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 60)}`,
        })),
      );
      created.forEach(({ shapeId, isOc }, i) => {
        const objectId = objectIds[i];
        if (!objectId) return;
        try {
          if (isOc) {
            editor.updateShape<OcCardShape>({
              id: shapeId,
              type: "oc-card",
              props: { objectId },
            });
          } else {
            const s = editor.getShape(shapeId);
            editor.updateShape({
              id: shapeId,
              type: "artifact-card",
              meta: { ...(s?.meta ?? {}), objectId },
            });
          }
        } catch {
          /* shape removed before backfill */
        }
      });
    })();
  }

  return { count: created.length };
}
