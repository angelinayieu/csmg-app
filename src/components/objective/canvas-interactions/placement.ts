// ── Shared placement rule: spawn AI generations in clear space ──
//
// Every AI placer (board decompose · per-card ops) drops a cluster of result
// shapes onto the board. Without a guard they anchor at a FIXED offset (below
// the objective card, below the source card) and so a second run lands directly
// on top of the first — the "decompose cards overlap each other" report. This
// is the single collision rule they share: given the horizontal span a new
// cluster will occupy, find the lowest Y already taken in that span and drop the
// cluster below it with a margin. Span-scoped, so content off to the side never
// shoves a cluster needlessly far down — pan away and a re-run lands fresh.
//
// tldraw-coupled but a pure read of the editor (creates nothing).

import type { Editor, TLShapeId, TLShapePartial } from "tldraw";

export interface ClusterSpan {
  /** Left page-x edge the new cluster will occupy. */
  left: number;
  /** Right page-x edge the new cluster will occupy. */
  right: number;
}

/** A page-space rectangle (top-left origin). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Lowest clear top-Y for a cluster spanning [span.left, span.right].
 *  Returns `preferredTop` when nothing in the span sits at/below it; otherwise
 *  the bottom of the lowest overlapping shape + `gap`. Shapes in `ignore`
 *  (e.g. the cluster's own shapes on a re-layout) are skipped. */
export function lowestClearTop(
  editor: Editor,
  span: ClusterSpan,
  preferredTop: number,
  gap: number,
  ignore?: ReadonlySet<TLShapeId>,
): number {
  let maxBottom = -Infinity;
  for (const s of editor.getCurrentPageShapes()) {
    if (ignore?.has(s.id)) continue;
    const b = editor.getShapePageBounds(s.id);
    if (!b) continue;
    // Only shapes whose x-range intersects the cluster span can collide.
    if (b.maxX <= span.left || b.minX >= span.right) continue;
    if (b.maxY > maxBottom) maxBottom = b.maxY;
  }
  return maxBottom === -Infinity
    ? preferredTop
    : Math.max(preferredTop, maxBottom + gap);
}

// ── Hybrid "make room" placement (push-then-yield) ──────────────────────
//
// `lowestClearTop` only drops a cluster straight DOWN — one unrelated card in
// the column flings a whole generation far down-page. `reserveSpace` upgrades
// this to the spatial policy the canvas wants: claim the natural spot below the
// source and PUSH neighbours aside to make room; if the push would cascade too
// far (or hit a pinned head card), YIELD instead and grow the cluster into the
// nearest clear region. So a decompose / spec-forge / op run always lands in
// real space, extending the board outward rather than stacking on top.

/** Shapes that anchor the board and must never be shoved to make room — the
 *  objective head, collapsed rooms, the intake chatbox, the sharpening artifact.
 *  A cluster that can't avoid one of these yields (relocates) instead. */
const PINNED_TYPES: ReadonlySet<string> = new Set([
  "objective-card",
  "room-card",
  "chatbox-card",
  "prompt-sharpening",
]);

/** Shapes that neither block a placement nor get pushed directly: connectors /
 *  freehand follow their endpoints, and passive backdrops (the group underlay,
 *  layer bands) are sized to their OWN content — pushing a frame without its
 *  cards would tear the underlay off the set it wraps. */
const NON_BLOCKING: ReadonlySet<string> = new Set([
  "arrow",
  "draw",
  "highlight",
  "sys-frame",
  "layer-band",
]);
function isBlocker(type: string): boolean {
  return !NON_BLOCKING.has(type);
}

function pageBox(editor: Editor, id: TLShapeId): Rect | null {
  const b = editor.getShapePageBounds(id);
  return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
}

/** Do `a` and `b` come within `gap` of each other (b inflated by gap)? */
function tooClose(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w > b.x - gap &&
    a.y < b.y + b.h + gap &&
    a.y + a.h > b.y - gap
  );
}

/** True when no blocking shape sits within `gap` of `rect`. */
export function isAreaClear(
  editor: Editor,
  rect: Rect,
  gap: number,
  ignore?: ReadonlySet<TLShapeId>,
): boolean {
  for (const s of editor.getCurrentPageShapes()) {
    if (ignore?.has(s.id)) continue;
    if (!isBlocker(s.type)) continue;
    const b = pageBox(editor, s.id);
    if (!b) continue;
    if (tooClose(rect, b, gap)) return false;
  }
  return true;
}

/** Compute the downward shift (page-y delta, per shape id) needed to clear
 *  `rect` by pushing blocking shapes below it — cascading so a pushed shape
 *  that lands on another pushes that one too. Returns `null` when the push
 *  exceeds budget or would move a pinned head card (caller should yield). An
 *  empty map means nothing needed moving (the spot is effectively clear). */
function makeRoom(
  editor: Editor,
  rect: Rect,
  gap: number,
  opts: {
    ignore?: ReadonlySet<TLShapeId>;
    budgetShapes?: number;
    budgetDist?: number;
  },
): Map<TLShapeId, number> | null {
  const boxes: { id: TLShapeId; box: Rect; pinned: boolean }[] = [];
  for (const s of editor.getCurrentPageShapes()) {
    if (opts.ignore?.has(s.id)) continue;
    if (!isBlocker(s.type)) continue;
    const b = pageBox(editor, s.id);
    if (!b) continue;
    boxes.push({ id: s.id, box: b, pinned: PINNED_TYPES.has(s.type) });
  }

  const dy = new Map<TLShapeId, number>();
  const cur = (e: { id: TLShapeId; box: Rect }): Rect => ({
    ...e.box,
    y: e.box.y + (dy.get(e.id) ?? 0),
  });
  const horiz = (a: Rect, b: Rect) =>
    a.x < b.x + b.w + gap && a.x + a.w > b.x - gap;

  const queue: typeof boxes = [];
  // Seed: every blocker that overlaps the reserved rect must drop below it.
  for (const e of boxes) {
    const c = cur(e);
    if (!horiz(rect, c)) continue;
    if (c.y >= rect.y + rect.h + gap) continue; // already clear below
    if (c.y + c.h <= rect.y) continue; // entirely above — leave it
    if (e.pinned) return null; // can't move a head card → yield
    const need = rect.y + rect.h + gap - c.y;
    if (need > 0) {
      dy.set(e.id, (dy.get(e.id) ?? 0) + need);
      queue.push(e);
    }
  }

  // Cascade: a shape pushed down may now sit on another → push that one too.
  let guard = 0;
  while (queue.length) {
    if (++guard > 2000) break;
    const e = queue.shift()!;
    const moved = cur(e);
    for (const o of boxes) {
      if (o.id === e.id) continue;
      const c = cur(o);
      if (!horiz(moved, c)) continue;
      if (c.y >= moved.y + moved.h + gap) continue; // below, clear
      if (c.y + c.h <= moved.y) continue; // above
      if (o.pinned) return null;
      const need = moved.y + moved.h + gap - c.y;
      if (need > 0.5) {
        dy.set(o.id, (dy.get(o.id) ?? 0) + need);
        queue.push(o);
      }
    }
  }

  if (dy.size > (opts.budgetShapes ?? 8)) return null;
  let maxD = 0;
  for (const d of dy.values()) maxD = Math.max(maxD, d);
  if (maxD > (opts.budgetDist ?? 1400)) return null;
  return dy;
}

export interface ReserveOptions {
  /** Page-x the cluster wants to be centered on (usually the source midX). */
  anchorMidX: number;
  /** Page-y the cluster's top wants to sit at (usually below the source). */
  preferredTop: number;
  /** Clear margin to keep between the cluster and its neighbours. */
  gap: number;
  /** Shapes never treated as obstacles (e.g. the source card itself). */
  ignore?: ReadonlySet<TLShapeId>;
  /** Disable the push step — pure yield (find clear space, move nothing). */
  allowPush?: boolean;
  /** Max neighbours a push may displace before yielding (default 8). */
  budgetShapes?: number;
  /** Max px a push may move any neighbour before yielding (default 1400). */
  budgetDist?: number;
}

/** Find — and clear — space for a `footprint`-sized cluster near its anchor.
 *
 *  Hybrid push-then-yield: (1) if the natural spot (centered on `anchorMidX`,
 *  top at `preferredTop`) is already free, use it; (2) else try to push
 *  neighbours aside within budget and use it anyway; (3) else yield — relocate
 *  the cluster to the nearest clear region. Mutates the board ONLY in case (2)
 *  (the neighbour nudges). Returns the cluster's final top-left page point. */
export function reserveSpace(
  editor: Editor,
  footprint: { w: number; h: number },
  opts: ReserveOptions,
): { x: number; y: number } {
  const rect: Rect = {
    x: opts.anchorMidX - footprint.w / 2,
    y: opts.preferredTop,
    w: footprint.w,
    h: footprint.h,
  };

  // 1. Natural spot already clear.
  if (isAreaClear(editor, rect, opts.gap, opts.ignore)) {
    return { x: rect.x, y: rect.y };
  }

  // 2. Hybrid step A — push neighbours aside within budget.
  if (opts.allowPush !== false) {
    const dy = makeRoom(editor, rect, opts.gap, {
      ignore: opts.ignore,
      budgetShapes: opts.budgetShapes,
      budgetDist: opts.budgetDist,
    });
    if (dy) {
      if (dy.size > 0) {
        const updates: TLShapePartial[] = [];
        for (const [id, d] of dy) {
          const s = editor.getShape(id);
          // y-only nudge; cast because TLShapePartial<T> can't be inferred from
          // the runtime union of shape types.
          if (s) updates.push({ id, type: s.type, y: s.y + d } as TLShapePartial);
        }
        if (updates.length) editor.updateShapes(updates);
      }
      return { x: rect.x, y: rect.y };
    }
    // dy === null → over budget / hit a pinned card → fall through to yield.
  }

  // 3. Hybrid step B — yield: grow the cluster into the nearest clear region.
  return findClearRect(editor, footprint, opts);
}

/** Find the nearest clear top-left for a `footprint`-sized cluster: prefer a
 *  spot beside the occupied span at the preferred height (whichever side is
 *  nearer center), else drop straight down past everything in the column. */
export function findClearRect(
  editor: Editor,
  footprint: { w: number; h: number },
  opts: ReserveOptions,
): { x: number; y: number } {
  const { w, h } = footprint;
  const gap = opts.gap;
  const baseX = opts.anchorMidX - w / 2;

  // Beside: scan the horizontal extent of shapes sharing the preferred band.
  let spanMinX = Infinity;
  let spanMaxX = -Infinity;
  for (const s of editor.getCurrentPageShapes()) {
    if (opts.ignore?.has(s.id)) continue;
    if (!isBlocker(s.type)) continue;
    const b = pageBox(editor, s.id);
    if (!b) continue;
    if (b.y >= opts.preferredTop + h + gap) continue;
    if (b.y + b.h <= opts.preferredTop - gap) continue;
    if (b.x < spanMinX) spanMinX = b.x;
    if (b.x + b.w > spanMaxX) spanMaxX = b.x + b.w;
  }

  const candidates: { x: number; y: number }[] = [];
  if (spanMaxX > -Infinity) {
    candidates.push({ x: spanMaxX + gap, y: opts.preferredTop }); // right
    candidates.push({ x: spanMinX - gap - w, y: opts.preferredTop }); // left
    // Nearest-to-center side first.
    candidates.sort((a, b) => Math.abs(a.x - baseX) - Math.abs(b.x - baseX));
  }
  for (const c of candidates) {
    if (isAreaClear(editor, { x: c.x, y: c.y, w, h }, gap, opts.ignore)) return c;
  }

  // Fallback: straight down past everything in the column (always clear).
  const top = lowestClearTop(
    editor,
    { left: baseX, right: baseX + w },
    opts.preferredTop,
    gap,
    opts.ignore,
  );
  return { x: baseX, y: top };
}
