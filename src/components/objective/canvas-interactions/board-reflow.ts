// ── Board reflow ──
//
// Keep the sharpening intake stack (objective → sharpening → forked cards)
// from overlapping when an upstream card grows. The objective card auto-
// fits its height to its full title; without a reflow pass, growing the
// title bleeds the card into the sharpening card below.
//
// `pushDown`-only: never pull a card up. The user may have intentionally
// moved a card; we only nudge a downstream card if it has crept INTO an
// upstream card's footprint. No-op when there's nothing to fix.

import type { Editor, TLShapeId } from "tldraw";

const GAP = 40;

/** Shape types this reflow understands — keep small so we don't disturb
 *  unrelated shapes that happen to be near the objective. */
const ANCHORED_TYPES = new Set([
  "prompt-sharpening",
  "ambiguity-heatmap-card",
  "priority-map-card",
  "objective-image-card",
  "journal-card",
]);

/** True if two horizontal extents overlap with a small tolerance. */
function overlapsX(a: { minX: number; maxX: number }, b: { minX: number; maxX: number }) {
  const tol = 8;
  return a.maxX > b.minX + tol && a.minX < b.maxX - tol;
}

/** Ensure every "anchored" card stays clear of the objective card AND the
 *  sharpening card. Called from the objective card's resize layout-effect
 *  and from the board's restore-settled hook so a returning visit fixes
 *  any overlap saved in the snapshot. */
export function reflowIntakeStack(editor: Editor): void {
  const shapes = editor.getCurrentPageShapes();
  const obj = shapes.find((s) => s.type === "objective-card");
  if (!obj) return;
  const ob = editor.getShapePageBounds(obj.id);
  if (!ob) return;

  // Pass 1: anything below the objective gets pushed clear of it.
  const movedY = new Map<TLShapeId, number>();
  for (const s of shapes) {
    if (!ANCHORED_TYPES.has(s.type)) continue;
    const b = editor.getShapePageBounds(s.id);
    if (!b) continue;
    if (!overlapsX(b, ob)) continue;
    const desiredTop = ob.maxY + GAP;
    if (b.minY < desiredTop) {
      const dy = desiredTop - b.minY;
      // Type narrows over the small ANCHORED_TYPES set (all valid custom
       // shapes) — the loop body never touches props/meta, just y.
      editor.updateShape({
        id: s.id,
        type: s.type,
        y: s.y + dy,
      } as Parameters<Editor["updateShape"]>[0]);
      movedY.set(s.id, dy);
    }
  }

  // Pass 2: sharpening card may have just been pushed down — cascade to
  // anything that anchors to IT (heatmap, priority-map, fork insight-cards).
  const sharp = editor
    .getCurrentPageShapes()
    .find((s) => s.type === "prompt-sharpening");
  if (!sharp) return;
  const sb = editor.getShapePageBounds(sharp.id);
  if (!sb) return;

  for (const s of editor.getCurrentPageShapes()) {
    // Skip shapes already moved in pass 1 — they're now positioned vs the
    // objective, not the sharpening card.
    if (movedY.has(s.id)) continue;
    // Cards explicitly sourced FROM the sharpening card.
    const sourceId = (s.props as { sourceId?: string })?.sourceId;
    const forkSourceId = (s.meta as { forkSourceId?: string })?.forkSourceId;
    if (sourceId !== sharp.id && forkSourceId !== sharp.id) continue;
    const b = editor.getShapePageBounds(s.id);
    if (!b) continue;
    // Only push DOWN if they overlap the sharpening footprint vertically.
    if (b.minY < sb.maxY + 8 && b.maxY > sb.minY - 8 && overlapsX(b, sb)) {
      const desiredTop = sb.maxY + GAP;
      if (b.minY < desiredTop) {
        const dy = desiredTop - b.minY;
        editor.updateShape({
          id: s.id,
          type: s.type,
          y: s.y + dy,
        } as Parameters<Editor["updateShape"]>[0]);
      }
    }
  }
}
