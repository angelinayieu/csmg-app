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

import type { Editor, TLShapeId } from "tldraw";

export interface ClusterSpan {
  /** Left page-x edge the new cluster will occupy. */
  left: number;
  /** Right page-x edge the new cluster will occupy. */
  right: number;
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
