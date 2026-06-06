// ── Prompt Sharpening → board materialization ──
//
// Drop the Prompt Sharpening Card onto the board connected straight below
// the objective card, and fork an ambiguity off it as its own node. Reuses
// the createShape + createBindings arrow recipe from synthesis-map.ts.

import {
  createShapeId,
  type Editor,
  type TLShapeId,
} from "tldraw";
import { reserveSpace } from "./placement";
import {
  SHARPEN_COLOR,
  type PromptSharpeningCardShape,
} from "../shapes/prompt-sharpening-card-shape";
import type { AmbiguityHeatmapCardShape } from "../shapes/ambiguity-heatmap-card-shape";
import type { PriorityMapCardShape } from "../shapes/priority-map-card-shape";
import type { ResolvePillShape } from "../shapes/resolve-pill-shape";
import type { InsightCardShape } from "../shapes/insight-card-shape";
import type { RoomCardShape } from "../shapes/room-card-shape";
import type {
  SharpeningCardDetail,
  AmbiguityForkDetail,
  DeployHeatmapCardDetail,
  DeployPriorityMapCardDetail,
} from "../board-bus";

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

/** SUPERSEDED by the real flow-connector (green/pink ports + gradient): the
 *  board's flow-connector reactor now draws objective→sharpening too, for ONE
 *  consistent connector style. Kept (callers still invoke it) but it now ONLY
 *  sweeps any legacy native `objSharpArrow` so the wire never doubles. */
export function ensureObjectiveSharpeningArrow(editor: Editor): void {
  const ids = editor
    .getCurrentPageShapes()
    .filter(
      (s) =>
        s.type === "arrow" &&
        (s.meta as { objSharpArrow?: boolean })?.objSharpArrow,
    )
    .map((s) => s.id);
  if (ids.length > 0) editor.deleteShapes(ids);
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
    ensureObjectiveSharpeningArrow(editor);
    return;
  }

  const objId = findObjectiveCard(editor);
  const srcBounds = objId ? editor.getShapePageBounds(objId) : null;
  const vp = editor.getViewportPageBounds();
  const cx = srcBounds ? srcBounds.midX : vp.center.x;
  const preferredTop = srcBounds ? srcBounds.maxY + 56 : vp.center.y + 40;
  // Passive drop → yield only: settle in clear space below the objective
  // without pushing any existing work aside.
  const spot = reserveSpace(
    editor,
    { w: CARD_W, h: CARD_H },
    { anchorMidX: cx, preferredTop, gap: 40, allowPush: false },
  );
  const x = spot.x;
  const y = spot.y;

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

  // The objective→sharpening connector is now a REAL bound arrow (the bezier
  // overlay wasn't rendering it).
  ensureObjectiveSharpeningArrow(editor);
  editor.select(cardId);
  editor.centerOnPoint(
    { x: x + CARD_W / 2, y: y + CARD_H / 2 },
    { animation: { duration: 320 } },
  );
}

/** Fork an ambiguity off the sharpening card (or heatmap / priority-map
 *  card) as its own insight-card node. The source is whatever shape called
 *  forkAmbiguity — the bezier overlay routes the connector from that source
 *  by reading `meta.forkSourceId`. */
export function forkAmbiguityOnBoard(
  editor: Editor,
  d: AmbiguityForkDetail,
): void {
  const sourceId = d.sourceId as TLShapeId;
  // Read spaceId from whichever fork source supplies it (sharpening directly;
  // heatmap / priority map carry it forward from their own props).
  const srcShape = editor.getShape(sourceId);
  let forkSpaceId = "";
  if (srcShape?.type === "prompt-sharpening") {
    forkSpaceId = (srcShape as PromptSharpeningCardShape).props.spaceId;
  } else if (srcShape?.type === "ambiguity-heatmap-card") {
    forkSpaceId = (srcShape as AmbiguityHeatmapCardShape).props.spaceId;
  } else if (srcShape?.type === "priority-map-card") {
    forkSpaceId = (srcShape as PriorityMapCardShape).props.spaceId;
  }
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
    meta: {
      ambiguityFork: true,
      // The overlay routes the connector from this source explicitly. Without
      // forkSourceId it falls back to the sharpening card (legacy behavior).
      forkSourceId: d.sourceId,
      spaceId: forkSpaceId,
    },
  });

  // The sharpening→fork connector is drawn by the bezier overlay.
  editor.select(id);
  editor.centerOnPoint(
    { x: x + W / 2, y: y + H / 2 },
    { animation: { duration: 300 } },
  );
}

const HEATMAP_SIZE = 340;
// Both forked cards are the SAME 340 square now — the priority map is a
// 2-column grid (mirrors the heatmap), so the pair reads as a balanced,
// equally-scaled set below the objective ("relatively same size").
const PRIORITY_W = 340;
const PRIORITY_H = 340;

/** Spawn an Ambiguity Heatmap card to the RIGHT of the sharpening card.
 *  Idempotent per source — re-clicking the fork button focuses the existing
 *  card instead of duplicating it. */
export function deployHeatmapCardOnBoard(
  editor: Editor,
  d: DeployHeatmapCardDetail,
): void {
  const sourceId = d.sourceId as TLShapeId;
  const existing = editor
    .getCurrentPageShapes()
    .find(
      (s) =>
        s.type === "ambiguity-heatmap-card" &&
        (s as AmbiguityHeatmapCardShape).props.sourceId === d.sourceId,
    );
  if (existing) {
    editor.updateShape<AmbiguityHeatmapCardShape>({
      id: existing.id,
      type: "ambiguity-heatmap-card",
      props: { heatmapJson: d.heatmapJson, color: d.color },
    });
    editor.select(existing.id);
    return;
  }

  const sb = editor.getShapePageBounds(sourceId);
  const vp = editor.getViewportPageBounds();
  // Two-way downward fork (the objective forks DOWN into two cards): the
  // ambiguity heatmap takes the LEFT branch, below the source.
  const preferredLeft = sb ? sb.midX - 56 - HEATMAP_SIZE : vp.center.x - HEATMAP_SIZE - 56;
  const top = sb ? sb.maxY + 96 : vp.center.y;
  const spot = reserveSpace(
    editor,
    { w: HEATMAP_SIZE, h: HEATMAP_SIZE },
    { anchorMidX: preferredLeft + HEATMAP_SIZE / 2, preferredTop: top, gap: 36, allowPush: false },
  );

  const id = createShapeId();
  editor.createShape<AmbiguityHeatmapCardShape>({
    id,
    type: "ambiguity-heatmap-card",
    x: spot.x,
    y: spot.y,
    props: {
      w: HEATMAP_SIZE,
      h: HEATMAP_SIZE,
      sourceId: d.sourceId,
      spaceId: d.spaceId,
      heatmapJson: d.heatmapJson,
      color: d.color,
    },
  });
  editor.select(id);
  // Descend the camera STRAIGHT DOWN on the SOURCE's vertical axis — not to the
  // off-center forked card. Centering on the card's own (down-left) midpoint
  // makes the camera pan sideways ("descends from side, twists to middle"); the
  // two-way fork should read as a clean downward descent.
  editor.centerOnPoint(
    { x: sb ? sb.midX : spot.x + HEATMAP_SIZE / 2, y: spot.y + HEATMAP_SIZE / 2 },
    { animation: { duration: 320 } },
  );
  // If the priority branch is already out, both branches now exist → merge pill.
  ensureResolvePill(editor);
}

/** Spawn a Priority Map card BELOW the heatmap card (or right of sharpening
 *  if the heatmap isn't out yet). Idempotent per source. */
export function deployPriorityMapCardOnBoard(
  editor: Editor,
  d: DeployPriorityMapCardDetail,
): void {
  const sourceId = d.sourceId as TLShapeId;
  const existing = editor
    .getCurrentPageShapes()
    .find(
      (s) =>
        s.type === "priority-map-card" &&
        (s as PriorityMapCardShape).props.sourceId === d.sourceId,
    );
  if (existing) {
    editor.updateShape<PriorityMapCardShape>({
      id: existing.id,
      type: "priority-map-card",
      props: { salienceJson: d.salienceJson, color: d.color },
    });
    editor.select(existing.id);
    return;
  }

  const sb = editor.getShapePageBounds(sourceId);
  const vp = editor.getViewportPageBounds();
  // Two-way downward fork: the priority map takes the RIGHT branch, below the
  // source — mirroring the heatmap on the left.
  const preferredLeft = sb ? sb.midX + 56 : vp.center.x + 56;
  const top = sb ? sb.maxY + 96 : vp.center.y;
  const spot = reserveSpace(
    editor,
    { w: PRIORITY_W, h: PRIORITY_H },
    { anchorMidX: preferredLeft + PRIORITY_W / 2, preferredTop: top, gap: 36, allowPush: false },
  );

  const id = createShapeId();
  editor.createShape<PriorityMapCardShape>({
    id,
    type: "priority-map-card",
    x: spot.x,
    y: spot.y,
    props: {
      w: PRIORITY_W,
      h: PRIORITY_H,
      sourceId: d.sourceId,
      spaceId: d.spaceId,
      salienceJson: d.salienceJson,
      color: d.color,
    },
  });
  editor.select(id);
  // Straight-down descent on the source's vertical axis (same as the heatmap) —
  // no sideways pan to the off-center card.
  editor.centerOnPoint(
    { x: sb ? sb.midX : spot.x + PRIORITY_W / 2, y: spot.y + PRIORITY_H / 2 },
    { animation: { duration: 320 } },
  );
  // The two-way fork now has both branches — drop the merged resolve pill that
  // converges them.
  ensureResolvePill(editor);
}

const RESOLVE_PILL_W = 220;
const RESOLVE_PILL_H = 64;

/** Drop the MERGED "AI resolve" pill below the heatmap + priority fork — the
 *  convergence point of the two-way fork. Idempotent: only when BOTH forked
 *  cards exist and no pill is out yet. The flow-connector reactor then wires a
 *  real wire from each card down into the pill (see ensureSharpeningFlowConnectors).
 *  Exported so the board can re-ensure it on restore (deploy doesn't re-run on a
 *  returning visit). */
export function ensureResolvePill(editor: Editor): void {
  const shapes = editor.getCurrentPageShapes();
  const heatmap = shapes.find((s) => s.type === "ambiguity-heatmap-card") as
    | AmbiguityHeatmapCardShape
    | undefined;
  const priority = shapes.find((s) => s.type === "priority-map-card") as
    | PriorityMapCardShape
    | undefined;
  // Need BOTH branches of the fork before the merge point makes sense.
  if (!heatmap || !priority) return;
  if (shapes.some((s) => s.type === "resolve-pill")) return;

  const hb = editor.getShapePageBounds(heatmap.id);
  const pb = editor.getShapePageBounds(priority.id);
  if (!hb || !pb) return;

  const spaceId = priority.props.spaceId || heatmap.props.spaceId;
  const color = priority.props.color || heatmap.props.color || SHARPEN_COLOR;
  const midX = (hb.midX + pb.midX) / 2;
  const top = Math.max(hb.maxY, pb.maxY) + 72;
  const spot = reserveSpace(
    editor,
    { w: RESOLVE_PILL_W, h: RESOLVE_PILL_H },
    { anchorMidX: midX, preferredTop: top, gap: 24, allowPush: false },
  );

  const id = createShapeId();
  editor.createShape<ResolvePillShape>({
    id,
    type: "resolve-pill",
    x: spot.x,
    y: spot.y,
    props: {
      w: RESOLVE_PILL_W,
      h: RESOLVE_PILL_H,
      spaceId,
      sourceIds: `${heatmap.id},${priority.id}`,
      color,
    },
  });
}
