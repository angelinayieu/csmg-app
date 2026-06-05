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
  OperationTransportError,
  type OperationTarget,
  type OperationResultItem,
  type OperationRunOptions,
  type OperationErrorReason,
} from "@/lib/objective-canvas/canvas-operations";
import { saveCardsToLibrary, type SaveableCard } from "./save-to-library";
import { reserveSpace } from "./placement";
import { frameForkedGroup } from "./group-frame";

const RESULT_W = 216;
const RESULT_H = 132;
/** Vertical pitch per row — fits the taller oc-card (feature/variable). */
const ROW_H = 176;
const GAP_X = 16;
const PER_ROW = 3;
/** Gap below the source card (and below anything already sitting under it). */
const RESULT_GAP = 40;
/** Slate — neutral accent for AI-result cards (matches the de-purpled theme). */
const RESULT_COLOR = "#64748B";

/** Feature/Variable nodes render as the clickable oc-card; everything else
 *  (factor / decision / question) as a generic "lab" node. */
const FV = new Set(["feature", "variable"]);
function objectTypeFor(t?: string): SaveableCard["objectType"] {
  return t === "feature" ? "feature" : t === "variable" ? "variable" : "insight";
}

/** Ops whose result rows are RUNTIME-FLOW STEPS (consumes/produces tokens) —
 *  paint them as the "mechanism" artifact-card kind so the group reads as a
 *  mechanism chain ("Mechanism Step" eyebrow), not generic "Lab" nodes. */
const MECHANISM_OPS = new Set(["make_technical", "data_flow"]);

/** Result of a run: how many cards landed on the board, plus WHY zero landed.
 *  Callers (the ‹ › popup) use `count === 0` to surface feedback instead of a
 *  silent no-op — the #1 cause of "diverge doesn't work" reports. `error`
 *  distinguishes a failed request (network / server / credits / auth → "couldn't
 *  run, retry") from a genuine empty result (error undefined → "nothing came
 *  back"); the two looked identical before, which is why a broken call read as
 *  "Empty". */
export type OperationRunResult = { count: number; error?: OperationErrorReason };

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
    startY = bounds.maxY + RESULT_GAP;
  } else {
    const vp = editor.getViewportPageBounds();
    anchorMidX = vp.center.x;
    startY = vp.center.y;
  }

  // Source object for fork-link persistence: when the op runs on an oc-card (a
  // real library object), every result is `derived_from` it — so the group
  // forked here becomes a real edge in the object cluster graph, not just a
  // visual frame. Resolved now (the source shape is still present) and consumed
  // in the library-backfill below. Empty for stickies / non-object sources, in
  // which case we persist no fork link (matches Connect's "both oc-cards" rule).
  const srcShape = target.shapeId
    ? editor.getShape(target.shapeId as TLShapeId)
    : undefined;
  const sourceObjectId =
    srcShape?.type === "oc-card"
      ? ((srcShape.props as { objectId?: string }).objectId ?? "")
      : "";

  // No pending placeholder shape — the trigger surfaces show their own
  // affordance (scanner rows + the ‹ › buttons), and a grey sticky on the
  // board just reads as clutter. runOperation returns [] for a genuine empty
  // result but THROWS OperationTransportError when the request itself failed —
  // catch it so the verb shows "couldn't run, retry" instead of a silent
  // "Empty" (the bug being fixed) and so a `void`-called run never rejects.
  let items: OperationResultItem[];
  try {
    items = await runOperation(op, target, opts);
  } catch (err) {
    const error: OperationErrorReason =
      err instanceof OperationTransportError ? err.reason : "server";
    console.warn(`[operation-executor] op "${opId}" failed (${error}):`, err);
    return { count: 0, error };
  }
  if (!items.length) return { count: 0 };

  const perRow =
    op.resultLayout === "column" ? 1 : Math.min(items.length, PER_ROW);
  const rowWidth = perRow * RESULT_W + (perRow - 1) * GAP_X;
  const nRows = Math.ceil(items.length / perRow);
  const clusterH = nRows * ROW_H;

  // Hybrid push-then-yield: claim the spot below the source and push neighbours
  // aside to make room; if that would cascade too far (or hit a head card),
  // relocate the cluster to the nearest clear region instead. Replaces the old
  // drop-straight-down rule so a run never stacks on a prior generation AND
  // never gets flung far down-page by one unrelated card in the column. The
  // source card is ignored so it's never pushed by its own results.
  const ignore = new Set<TLShapeId>();
  if (target.shapeId) ignore.add(target.shapeId as TLShapeId);
  const spot = reserveSpace(
    editor,
    { w: rowWidth, h: clusterH },
    { anchorMidX, preferredTop: startY, gap: RESULT_GAP, ignore },
  );
  const clusterX = spot.x;
  startY = spot.y;
  const stamp = Date.now();

  // Create the result cards: feature/variable → oc-card (clickable to its
  // object detail), everything else → a generic "lab" node. Remember each shape
  // id so the library objectId can be backfilled (→ single-click opens the
  // detail drawer; no dead ends).
  const created: { shapeId: TLShapeId; item: OperationResultItem; isOc: boolean }[] = [];
  items.forEach((item, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = clusterX + col * (RESULT_W + GAP_X);
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
      // make_technical + data_flow emit a runtime FLOW (1. step → 2. step …,
      // with consumes/produces tokens); paint those as "mechanism" cards so the
      // group reads as a mechanism chain instead of a pile of generic "Lab"
      // nodes. Every other non-oc result stays "lab".
      const kind: ArtifactCardShape["props"]["kind"] = MECHANISM_OPS.has(opId)
        ? "mechanism"
        : "lab";
      // Stash structured tokens on shape meta (mechanism steps only) so the
      // in-memory card carries them even before the async library save lands;
      // the library save below mirrors them into content_snapshot. Non-empty
      // arrays only — keeps non-mechanism shapes clean.
      const tokenMeta: Record<string, string[]> = {};
      if (item.consumes?.length) tokenMeta.consumes = item.consumes;
      if (item.produces?.length) tokenMeta.produces = item.produces;
      editor.createShape<ArtifactCardShape>({
        id,
        type: "artifact-card",
        x,
        y,
        props: {
          w: RESULT_W,
          h: RESULT_H,
          kind,
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
          ...tokenMeta,
        },
      });
    }
    created.push({ shapeId: id, item, isOc });
  });

  // ── Grouping underlay + fork connector ── a multi-card result is a set forked
  //    out of the source card; wrap it in a frosted backdrop labelled with the
  //    op and tether it back to where it came from. Same primitive decompose
  //    uses, so EVERY set-deploying op gets the boundary + connector. (A lone
  //    result card isn't a "system" — the helper no-ops below 2.)
  frameForkedGroup(editor, {
    childIds: created.map((c) => c.shapeId),
    sourceShapeId: target.shapeId ?? null,
    label: op.label,
    accent: RESULT_COLOR,
  });

  // Reveal where the results landed (the cluster may have been relocated to
  // clear space) without yanking the zoom level.
  editor.centerOnPoint(
    { x: clusterX + rowWidth / 2, y: startY + clusterH / 2 },
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
        created.map(({ item }) => {
          // Mechanism-step rows carry data tokens — persist them in
          // content_snapshot so the tech-spec read path can wire interface
          // contracts off them (no parsing of subtitle strings). Empty arrays
          // are omitted to keep the JSONB tight.
          const contentSnapshot =
            MECHANISM_OPS.has(opId) &&
            (item.consumes?.length || item.produces?.length)
              ? {
                  kind: "mechanism_step",
                  consumes: item.consumes ?? [],
                  produces: item.produces ?? [],
                }
              : null;
          return {
            objectType: objectTypeFor(item.type),
            title: item.title,
            summary: item.subtitle ?? null,
            // Unique per (op, title) so distinct result cards don't collide on
            // the null natural key; a same-title re-run dedupes (updates).
            sourceRef: `op:${opId}:${item.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .slice(0, 60)}`,
            contentSnapshot,
          };
        }),
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

      // Close the connection loop: persist each result as `derived_from` its
      // source object via the SAME link-objects route the Connect op uses, so
      // the forked group is a live edge in the cluster graph (feeds the metadata
      // recommender / auto-cluster), not a visual-only frame. Fire-and-forget,
      // soft-fail — a link miss never blocks the cards that already rendered.
      if (sourceObjectId) {
        await Promise.all(
          objectIds.map((oid) =>
            oid
              ? fetch(`/api/objective/${spaceId}/link-objects`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    fromObjectId: oid,
                    toObjectId: sourceObjectId,
                    relation: "derived_from",
                  }),
                }).catch(() => undefined)
              : Promise.resolve(undefined),
          ),
        );
      }
    })();
  }

  return { count: created.length };
}
