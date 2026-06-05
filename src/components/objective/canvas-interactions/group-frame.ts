// ── Group underlay for a forked-out set of cards (shared primitive) ──
//
// Every AI op that deploys a SET of cards — Decompose objective, Variations,
// Questions, Make plan, the layer/data-flow ops, … — forks that set out of a
// source card. Before this, the cards just landed loose: no boundary saying
// "these N cards are ONE system that came from THAT card". This is the single
// primitive they all call to fix that: it drops a frosted `sys-frame` backdrop
// sized to wrap the set (sent to the back so it never steals a click from a
// card on top) and tags it with the source shape + its member ids, so
// GroupForkConnectorsOverlay can draw the live "forked from here" connector and
// useGroupFrameReflow can keep the frame fitted as the cards move. Pure tldraw.

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import type { SysFrameShape } from "../shapes/sys-frame-shape";

/** Meta stamped on a grouping frame so the connector overlay + reflow listener
 *  can find it, tether it to its source, and refit it to its members. */
export interface ForkGroupMeta {
  forkGroup: true;
  /** Stringified id of the source card (empty when forked without one). */
  sourceShapeId: string;
  /** Stringified ids of the shapes the frame wraps (cards + lane labels). */
  memberIds: string[];
}

/** Breathing room between the outermost cards and the frame edge. */
export const GROUP_FRAME_PAD = 28;
/** Extra top room so the frame's folder-tab label clears the cards/labels. */
export const GROUP_FRAME_LABEL_HEAD = 22;

/** A page rectangle (top-left origin). */
export interface GroupFrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The padded frame rect that wraps a set of page-bounds boxes — the single
 *  geometry both creation and reflow use, so the frame never drifts from the
 *  size it was first drawn at. Returns null for an empty set. */
export function groupFrameRect(
  boxes: ReadonlyArray<{ minX: number; minY: number; maxX: number; maxY: number }>,
): GroupFrameRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!Number.isFinite(minX)) return null;
  return {
    x: minX - GROUP_FRAME_PAD,
    y: minY - GROUP_FRAME_PAD - GROUP_FRAME_LABEL_HEAD,
    w: maxX - minX + GROUP_FRAME_PAD * 2,
    h: maxY - minY + GROUP_FRAME_PAD * 2 + GROUP_FRAME_LABEL_HEAD,
  };
}

/** Wrap a freshly-deployed set of cards in a grouping underlay tethered to its
 *  source. Returns the frame id, or `null` when there's nothing worth framing
 *  (a lone card isn't a "system"). Call AFTER the cards exist so the frame can
 *  be measured from their real page bounds. */
export function frameForkedGroup(
  editor: Editor,
  opts: {
    /** The shapes that make up the set (cards, and any lane labels to enclose). */
    childIds: TLShapeId[];
    /** The card the set was forked out of (drives the connector). */
    sourceShapeId?: TLShapeId | string | null;
    /** Quiet folder-tab label on the frame. */
    label: string;
    /** Accent hex for the tab + glow. */
    accent?: string;
  },
): TLShapeId | null {
  const ids = opts.childIds.filter(Boolean);
  if (ids.length < 2) return null; // a single card isn't a group

  const boxes = ids
    .map((id) => editor.getShapePageBounds(id))
    .filter((b): b is NonNullable<typeof b> => !!b);
  const rect = groupFrameRect(boxes);
  if (!rect) return null;

  const frameId = createShapeId();
  editor.createShape<SysFrameShape>({
    id: frameId,
    type: "sys-frame",
    x: rect.x,
    y: rect.y,
    props: {
      w: rect.w,
      h: rect.h,
      label: opts.label,
      accent: opts.accent ?? "#7C3AED",
    },
    // Inline literal (matches the board's other meta tags) so it's assignable to
    // tldraw's JsonObject meta. Shape mirrors ForkGroupMeta above.
    meta: {
      forkGroup: true,
      sourceShapeId: opts.sourceShapeId ? String(opts.sourceShapeId) : "",
      memberIds: ids.map(String),
    },
  });
  // Behind its cards (and everything) so it reads as an underlay and a click in
  // a gap between cards falls through instead of grabbing the whole frame.
  editor.sendToBack([frameId]);
  return frameId;
}
