"use client";

// ── SpecForgeConnectorsOverlay ────────────────────────────────────────
//
// Flow-builder connectors for the SpecForge unfurl, drawn as a single SVG
// over the board (NOT tldraw arrow shapes). Same grammar as
// SharpeningConnectorsOverlay: smooth cubic-bezier curves with connection-
// point handles, derived live from card positions.
//
// The runner persists each card's parent IDs in `meta.specforgeParents`.
// This overlay scans every SpecForge card on the page, reads that meta,
// and renders bottom-of-parent → top-of-child beziers. Because the curve
// pulls straight DOWN from the parent before traversing horizontally and
// then arrives straight DOWN into the child, off-center targets (the MVP
// row's left/right cards) route through the vertical gap between rows
// instead of cutting diagonally through neighbor cards (which is what
// the old tldraw straight-line arrows did).
//
// Mounted via the OnTheCanvas slot in whiteboard-base — that slot lives
// inside the shapes layer (already camera-transformed) and BEHIND the
// shapes themselves, so connectors stay on the board surface and never
// paint over a card. We draw paths in raw page coords (no manual camera
// <g>); only the hairline weights are divided by the zoom so they stay
// screen-constant.

import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";

// Match the previous arrow color (black) but soften slightly for the
// hairline weight so it doesn't shout over the card content.
const STROKE = "#1A1F2E";
const HANDLE_RING = "#1A1F2E";

interface Seg {
  id: string;
  d: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

function computeSegments(editor: Editor): Seg[] {
  const shapes = editor.getCurrentPageShapes();
  const segs: Seg[] = [];

  for (const s of shapes) {
    if (s.type !== "specforge-card") continue;
    const parents = (s.meta as { specforgeParents?: string[] })
      ?.specforgeParents;
    if (!Array.isArray(parents) || parents.length === 0) continue;

    const cb = editor.getShapePageBounds(s.id);
    if (!cb) continue;

    for (const pid of parents) {
      const pb = editor.getShapePageBounds(pid as TLShapeId);
      if (!pb) continue;

      // Bottom-center of parent → top-center of child. Pulling the control
      // points straight DOWN from the source and straight UP into the target
      // means the bezier's horizontal traverse happens in the gap BETWEEN
      // the two cards' Y-ranges — never crossing through a neighbor card.
      const from = { x: pb.midX, y: pb.maxY };
      const to = { x: cb.midX, y: cb.minY };
      const dy = Math.max(26, (to.y - from.y) * 0.5);

      segs.push({
        id: `${pid}-${s.id}`,
        d: `M ${from.x} ${from.y} C ${from.x} ${from.y + dy}, ${to.x} ${to.y - dy}, ${to.x} ${to.y}`,
        from,
        to,
      });
    }
  }

  return segs;
}

export function SpecForgeConnectorsOverlay() {
  const editor = useEditor();
  const segs = useValue(
    "specforge-connectors",
    () => computeSegments(editor),
    [editor],
  );
  const scale = useValue("sf-scale", () => editor.getCamera().z, [editor]);

  if (segs.length === 0) return null;

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
