"use client";

// ── CommentStrandsOverlay ──────────────────────────────────────────────
//
// For every comment-card on the page, draws a soft bezier strand from the
// comment's edge to each of its target_shape_ids. Quiet by default
// (low-opacity neutral hairline); brightens when the comment is selected
// or hovered so the relationship reads at a glance without permanently
// adding visual weight.
//
// Mirrors SharpeningConnectorsOverlay: rendered in the OnTheCanvas slot
// (behind shapes, inside tldraw's already camera-transformed shapes
// layer), so strands sit on the board surface and never paint over a card
// you open. Paths are drawn in raw page coords; only the hairline weights
// divide by the zoom. Composed with the sharpening connectors in
// whiteboard-base BOARD_COMPONENTS.

import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import type { CommentCardShape } from "../shapes/comment-card-shape";

const STROKE_QUIET = "rgba(99,102,241,0.32)"; // soft indigo, mostly invisible
const STROKE_HOT = "rgba(99,102,241,0.95)"; // lit when comment selected/hovered

interface Seg {
  id: string;
  d: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  hot: boolean;
}

function nearestEdgePoint(
  src: { x: number; y: number; w: number; h: number },
  toCx: number,
  toCy: number,
): { x: number; y: number } {
  // Pick the side of `src` that faces (toCx, toCy). Beats centre-to-centre
  // for connector aesthetics — strands sit on the closest edge instead of
  // diving through the card.
  const cx = src.x + src.w / 2;
  const cy = src.y + src.h / 2;
  const dx = toCx - cx;
  const dy = toCy - cy;
  if (Math.abs(dx) * src.h > Math.abs(dy) * src.w) {
    // East/West edge
    return { x: dx > 0 ? src.x + src.w : src.x, y: cy };
  }
  return { x: cx, y: dy > 0 ? src.y + src.h : src.y };
}

function computeSegments(editor: Editor): Seg[] {
  const shapes = editor.getCurrentPageShapes();
  const comments = shapes.filter((s) => s.type === "comment-card");
  if (comments.length === 0) return [];
  const selected = new Set(editor.getSelectedShapeIds());
  const hovered = editor.getHoveredShapeId();

  // Build a quick id → bounds map (avoids a getShapePageBounds call per
  // (comment, target) pair when many comments reference the same shape).
  const boundsById = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const s of shapes) {
    const b = editor.getShapePageBounds(s.id);
    if (b) boundsById.set(s.id, { x: b.x, y: b.y, w: b.w, h: b.h });
  }

  const segs: Seg[] = [];
  for (const c of comments) {
    const cb = boundsById.get(c.id);
    if (!cb) continue;
    const targets = (c as CommentCardShape).props.targetShapeIds;
    if (!targets || targets.length === 0) continue;
    const isHot = selected.has(c.id) || hovered === c.id;
    for (const tId of targets) {
      const tb = boundsById.get(tId as TLShapeId);
      if (!tb) continue;
      // Strand from the comment's edge facing the target, to the target's
      // edge facing the comment — symmetric, so it always looks connected.
      const tCx = tb.x + tb.w / 2;
      const tCy = tb.y + tb.h / 2;
      const from = nearestEdgePoint(cb, tCx, tCy);
      const cCx = cb.x + cb.w / 2;
      const cCy = cb.y + cb.h / 2;
      const to = nearestEdgePoint(tb, cCx, cCy);
      // Curve handle proportional to the gap so close targets get gentle
      // curves and distant ones get a bigger sweep.
      const dx = (to.x - from.x) * 0.5;
      const dy = (to.y - from.y) * 0.5;
      segs.push({
        id: `c-${c.id}-${tId}`,
        d: `M ${from.x} ${from.y} C ${from.x + dx} ${from.y + dy * 0.2}, ${to.x - dx} ${to.y - dy * 0.2}, ${to.x} ${to.y}`,
        from,
        to,
        hot: isHot || selected.has(tId as TLShapeId) || hovered === tId,
      });
    }
  }
  return segs;
}

export function CommentStrandsOverlay() {
  const editor = useEditor();
  const segs = useValue("comment-strands", () => computeSegments(editor), [editor]);
  const scale = useValue("cs-scale", () => editor.getCamera().z, [editor]);

  if (segs.length === 0) return null;

  // OnTheCanvas parent already carries the camera transform, so anchor the
  // SVG at page origin with overflow visible and draw in raw page coords.
  return (
    <svg
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      {segs.map((s) => (
        <g key={s.id}>
          <path
            d={s.d}
            fill="none"
            stroke={s.hot ? STROKE_HOT : STROKE_QUIET}
            strokeWidth={(s.hot ? 2.2 : 1.5) / scale}
            strokeLinecap="round"
            strokeDasharray={s.hot ? undefined : `${4 / scale} ${4 / scale}`}
          />
          {s.hot && (
            <>
              <circle
                cx={s.from.x}
                cy={s.from.y}
                r={3.5 / scale}
                fill="#ffffff"
                stroke={STROKE_HOT}
                strokeWidth={1.5 / scale}
              />
              <circle
                cx={s.to.x}
                cy={s.to.y}
                r={3.5 / scale}
                fill="#ffffff"
                stroke={STROKE_HOT}
                strokeWidth={1.5 / scale}
              />
            </>
          )}
        </g>
      ))}
    </svg>
  );
}
