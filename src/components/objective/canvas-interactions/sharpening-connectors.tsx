"use client";

// ── SharpeningConnectorsOverlay ────────────────────────────────────────
//
// Custom flow-builder connectors for the sharpening graph, drawn as a
// single SVG over the board (NOT tldraw arrows). Renders smooth cubic-
// bezier curves with connection-point handles, derived live from the card
// positions — so they always reflect the graph and never go stale:
//
//   objective card  ──(down)──▶  Prompt Sharpening card
//   Prompt Sharpening card  ──(side)──▶  Ambiguity Heatmap card (when forked)
//   Prompt Sharpening card  ──(side)──▶  Priority Map card     (when forked)
//   <fork source card>      ──(side)──▶  each forked insight-card
//
// A forked insight-card's source is read from `meta.forkSourceId` when
// present (heatmap / priority-map card forks). Without it, the connector
// falls back to the sharpening card so historical forks still draw.
//
// useValue reads the shape bounds in page space and the SVG is rendered
// directly in page coordinates. Mounted via the OnTheCanvas slot in
// whiteboard-base's BOARD_COMPONENTS — that slot lives INSIDE the shapes
// layer (which tldraw already camera-transforms) and BEHIND the shapes
// themselves, so the connectors stay on the board surface and never paint
// over a card you open. Because the parent layer is already transformed,
// we draw paths in raw page coords (no manual camera <g>); only the
// hairline weights are divided by the zoom so they stay screen-constant.

import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import type { RoomCardShape } from "../shapes/room-card-shape";
import type { AmbiguityHeatmapCardShape } from "../shapes/ambiguity-heatmap-card-shape";
import type { PriorityMapCardShape } from "../shapes/priority-map-card-shape";

// Neutral light hairline (matches the inspo's connectors, not the card accent).
const STROKE = "#C3CAD7";
const HANDLE_RING = "#C3CAD7";

interface Seg {
  id: string;
  d: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/** Smooth horizontal-S between two rectangles' nearest sides. */
function sideToSideCurve(
  ab: { x: number; y: number; w: number; h: number },
  bb: { x: number; y: number; w: number; h: number },
): { from: { x: number; y: number }; to: { x: number; y: number }; d: string } {
  const bLeftOfA = bb.x + bb.w / 2 < ab.x + ab.w / 2;
  const from = bLeftOfA
    ? { x: ab.x, y: ab.y + ab.h / 2 }
    : { x: ab.x + ab.w, y: ab.y + ab.h / 2 };
  const to = bLeftOfA
    ? { x: bb.x + bb.w, y: bb.y + bb.h / 2 }
    : { x: bb.x, y: bb.y + bb.h / 2 };
  const dx = Math.max(44, Math.abs(to.x - from.x) * 0.5) * (bLeftOfA ? -1 : 1);
  return {
    from,
    to,
    d: `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`,
  };
}

/** Smooth vertical-S from bottom-center of source to top-center of child.
 *  Used when the child card sits BELOW the source — the heatmap + priority
 *  fork off the sharpening card downward, so the connector should exit the
 *  source's bottom edge straight down (NOT side-out then twist). */
function topDownForkCurve(
  ab: { x: number; y: number; w: number; h: number },
  bb: { x: number; y: number; w: number; h: number },
): { from: { x: number; y: number }; to: { x: number; y: number }; d: string } {
  const from = { x: ab.x + ab.w / 2, y: ab.y + ab.h };
  const to = { x: bb.x + bb.w / 2, y: bb.y };
  // Strong vertical commitment in the control points so the curve leaves the
  // source pointing DOWN, then arcs toward the child — no sideways lobe.
  const dy = Math.max(48, (to.y - from.y) * 0.6);
  return {
    from,
    to,
    d: `M ${from.x} ${from.y} C ${from.x} ${from.y + dy}, ${to.x} ${to.y - dy}, ${to.x} ${to.y}`,
  };
}

/** Pick the right curve. If the child sits clearly below the source (vertical
 *  gap dominates horizontal offset), fork downward; otherwise side-to-side. */
function pickCurve(
  ab: { x: number; y: number; w: number; h: number },
  bb: { x: number; y: number; w: number; h: number },
) {
  const verticalGap = bb.y - (ab.y + ab.h);
  const horizontalOverlap =
    Math.min(ab.x + ab.w, bb.x + bb.w) - Math.max(ab.x, bb.x);
  // Below + at least partial horizontal overlap (or close to it) → down-fork.
  if (verticalGap > -ab.h * 0.2 && horizontalOverlap > -Math.max(ab.w, bb.w) * 0.6) {
    return topDownForkCurve(ab, bb);
  }
  return sideToSideCurve(ab, bb);
}

function computeSegments(editor: Editor): Seg[] {
  const shapes = editor.getCurrentPageShapes();
  const sharp = shapes.find((s) => s.type === "prompt-sharpening");
  if (!sharp) return [];
  const sb = editor.getShapePageBounds(sharp.id);
  if (!sb) return [];

  const segs: Seg[] = [];

  // objective → sharpening is now a REAL bound tldraw arrow (created in
  // prompt-sharpening-board.ts → ensureObjectiveSharpeningArrow) so it always
  // renders + moves with the cards. The overlay only draws the forks below.

  // sharpening → ambiguity heatmap card (only the ones sourced FROM this card)
  // and sharpening → priority map card. Each is a horizontal S-curve.
  const boundsCache = new Map<string, { x: number; y: number; w: number; h: number }>();
  function bounds(id: string) {
    const cached = boundsCache.get(id);
    if (cached) return cached;
    const b = editor.getShapePageBounds(id as TLShapeId);
    if (!b) return null;
    const v = { x: b.x, y: b.y, w: b.w, h: b.h };
    boundsCache.set(id, v);
    return v;
  }
  const sbBox = { x: sb.x, y: sb.y, w: sb.w, h: sb.h };

  for (const s of shapes) {
    if (s.type === "ambiguity-heatmap-card") {
      if ((s as AmbiguityHeatmapCardShape).props.sourceId !== sharp.id) continue;
      const hb = bounds(s.id);
      if (!hb) continue;
      const c = pickCurve(sbBox, hb);
      segs.push({ id: `sharp-heatmap-${s.id}`, ...c });
    } else if (s.type === "priority-map-card") {
      if ((s as PriorityMapCardShape).props.sourceId !== sharp.id) continue;
      const pb = bounds(s.id);
      if (!pb) continue;
      const c = pickCurve(sbBox, pb);
      segs.push({ id: `sharp-priority-${s.id}`, ...c });
    }
  }

  // <fork source> → each forked insight-card. Source is meta.forkSourceId
  // when present (heatmap / priority-map forks); otherwise falls back to the
  // sharpening card so legacy forks still draw.
  for (const f of shapes) {
    if (f.type !== "insight-card") continue;
    if (!(f.meta as { ambiguityFork?: boolean })?.ambiguityFork) continue;
    const fb = bounds(f.id);
    if (!fb) continue;
    const forkSourceId =
      (f.meta as { forkSourceId?: string })?.forkSourceId || sharp.id;
    // Only route to a source that's actually on the page; otherwise fall back
    // to the sharpening card (e.g. user deleted the heatmap card).
    let srcBox = bounds(forkSourceId);
    if (!srcBox) srcBox = sbBox;
    const c = pickCurve(srcBox, fb);
    segs.push({ id: `fork-${f.id}`, ...c });
  }

  return segs;
}

export function SharpeningConnectorsOverlay() {
  const editor = useEditor();
  const segs = useValue(
    "sharpening-connectors",
    () => computeSegments(editor),
    [editor],
  );
  const scale = useValue("sc-scale", () => editor.getCamera().z, [editor]);

  if (segs.length === 0) return null;

  // The parent OnTheCanvas layer already carries tldraw's camera transform,
  // so the SVG anchors at page origin (0,0) with overflow visible and paths
  // are drawn in raw page coords. Weights divide by the zoom to stay crisp.
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
      <defs>
        <style>{`
          @keyframes sharp-fork-draw {
            from { stroke-dashoffset: 1; }
            to   { stroke-dashoffset: 0; }
          }
          @keyframes sharp-fork-pop {
            from { opacity: 0; transform: scale(0.4); }
            to   { opacity: 1; transform: scale(1); }
          }
          .sharp-fork-path {
            stroke-dasharray: 1;
            stroke-dashoffset: 0;
            animation: sharp-fork-draw 520ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
          }
          .sharp-fork-handle-from {
            transform-box: fill-box;
            transform-origin: center;
            animation: sharp-fork-pop 220ms ease-out both;
          }
          .sharp-fork-handle-to {
            transform-box: fill-box;
            transform-origin: center;
            animation: sharp-fork-pop 260ms ease-out 380ms both;
          }
        `}</style>
      </defs>
      {segs.map((s) => (
        <g key={s.id}>
          <path
            className="sharp-fork-path"
            d={s.d}
            pathLength={1}
            fill="none"
            stroke={STROKE}
            strokeWidth={1.75 / scale}
            strokeLinecap="round"
          />
          <circle
            className="sharp-fork-handle-from"
            cx={s.from.x}
            cy={s.from.y}
            r={3.5 / scale}
            fill="#ffffff"
            stroke={HANDLE_RING}
            strokeWidth={1.5 / scale}
          />
          <circle
            className="sharp-fork-handle-to"
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
