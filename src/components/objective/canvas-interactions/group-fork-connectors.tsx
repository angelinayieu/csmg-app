"use client";

// ── GroupForkConnectorsOverlay ─────────────────────────────────────────
//
// The "forked from here" connector for every grouping underlay. For each
// `sys-frame` stamped `meta.forkGroup`, draws ONE smooth cubic-bezier from the
// source card it was forked out of to the frame — the same flow-builder look as
// the sharpening connectors (neutral hairline + white endpoint handles), so a
// decomposed system, a variations set, a plan, … all visibly hang off the card
// they came from. Derived live from page bounds (re-renders when either moves);
// an SVG drawn in raw page coords, mounted in the OnTheCanvas slot so it sits
// BEHIND the cards. No tldraw arrow shapes — nothing for the user to select or
// nudge. Pairs with frameForkedGroup (group-frame.ts), which creates the frames.

import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import { useGroupFrameReflow } from "./group-frame-reflow";

// Matches sharpening-connectors so all board connectors read as one family.
const STROKE = "#C3CAD7";
const HANDLE_RING = "#C3CAD7";

interface Seg {
  id: string;
  d: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The point on `b`'s border facing `t` — a simple center-out edge projection. */
function borderToward(b: Box, t: { x: number; y: number }): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = t.x - cx;
  const dy = t.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: b.y };
  const sx = dx !== 0 ? b.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? b.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

function computeSegments(editor: Editor): Seg[] {
  const segs: Seg[] = [];
  for (const f of editor.getCurrentPageShapes()) {
    if (f.type !== "sys-frame") continue;
    const meta = f.meta as { forkGroup?: boolean; sourceShapeId?: string };
    if (!meta?.forkGroup || !meta.sourceShapeId) continue;
    const src = editor.getShape(meta.sourceShapeId as TLShapeId);
    if (!src) continue; // source deleted → drop the connector
    const sb = editor.getShapePageBounds(src.id);
    const fb = editor.getShapePageBounds(f.id);
    if (!sb || !fb) continue;

    const sCenter = { x: sb.x + sb.w / 2, y: sb.y + sb.h / 2 };
    const fCenter = { x: fb.x + fb.w / 2, y: fb.y + fb.h / 2 };
    const from = borderToward(sb, fCenter);
    const to = borderToward(fb, sCenter);

    // Pull control points along the dominant axis for a clean S-curve.
    const vertical = Math.abs(to.y - from.y) >= Math.abs(to.x - from.x);
    const k = 0.5;
    const c1 = vertical
      ? { x: from.x, y: from.y + (to.y - from.y) * k }
      : { x: from.x + (to.x - from.x) * k, y: from.y };
    const c2 = vertical
      ? { x: to.x, y: to.y - (to.y - from.y) * k }
      : { x: to.x - (to.x - from.x) * k, y: to.y };

    segs.push({
      id: `forkgroup-${f.id}`,
      d: `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`,
      from,
      to,
    });
  }
  return segs;
}

export function GroupForkConnectorsOverlay() {
  const editor = useEditor();
  // Keep each grouping underlay fitted to its cards as they're rearranged. Lives
  // here because this overlay is always mounted in OnTheCanvas — no extra mount.
  useGroupFrameReflow(editor);
  const segs = useValue(
    "group-fork-connectors",
    () => computeSegments(editor),
    [editor],
  );
  const scale = useValue("gfc-scale", () => editor.getCamera().z, [editor]);

  if (segs.length === 0) return null;

  // The parent OnTheCanvas layer already carries the camera transform, so paths
  // are drawn in raw page coords; only weights divide by zoom to stay crisp.
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
            stroke={STROKE}
            strokeWidth={1.75 / scale}
            strokeLinecap="round"
          />
          <circle
            cx={s.from.x}
            cy={s.from.y}
            r={3.5 / scale}
            fill="#ffffff"
            stroke={HANDLE_RING}
            strokeWidth={1.5 / scale}
          />
          <circle
            cx={s.to.x}
            cy={s.to.y}
            r={3.5 / scale}
            fill="#ffffff"
            stroke={HANDLE_RING}
            strokeWidth={1.5 / scale}
          />
        </g>
      ))}
    </svg>
  );
}
