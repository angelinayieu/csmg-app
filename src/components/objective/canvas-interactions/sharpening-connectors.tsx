"use client";

// ── SharpeningConnectorsOverlay ────────────────────────────────────────
//
// Custom flow-builder connectors for the sharpening graph, drawn as a
// single SVG over the board (NOT tldraw arrows). Renders smooth cubic-
// bezier curves with connection-point handles, derived live from the card
// positions — so they always reflect the graph and never go stale:
//
//   objective card  ──(down)──▶  Prompt Sharpening card
//   Prompt Sharpening card  ──(side)──▶  each forked ambiguity card
//
// Mirrors thread-tethers-overlay.tsx: useValue reads the shape bounds in
// page space, and a <g> applies tldraw's camera transform so the SVG
// aligns with the shapes at any zoom/pan. Mounted via InFrontOfTheCanvas
// in whiteboard-base's BOARD_COMPONENTS.

import { useEditor, useValue, type Editor } from "tldraw";
import type { RoomCardShape } from "../shapes/room-card-shape";

// Neutral light hairline (matches the inspo's connectors, not the card accent).
const STROKE = "#C3CAD7";
const HANDLE_RING = "#C3CAD7";

interface Seg {
  id: string;
  d: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

function computeSegments(editor: Editor): Seg[] {
  const shapes = editor.getCurrentPageShapes();
  const sharp = shapes.find((s) => s.type === "prompt-sharpening");
  if (!sharp) return [];
  const sb = editor.getShapePageBounds(sharp.id);
  if (!sb) return [];

  const segs: Seg[] = [];

  // objective → sharpening (vertical, smooth curve)
  const obj =
    shapes.find((s) => s.type === "objective-card") ??
    shapes.find(
      (s) =>
        s.type === "room-card" &&
        (s as RoomCardShape).props.roomId === "__obj",
    ) ??
    shapes.find((s) => s.type === "room-card");
  if (obj) {
    const ob = editor.getShapePageBounds(obj.id);
    if (ob) {
      const from = { x: ob.x + ob.w / 2, y: ob.y + ob.h }; // bottom-center
      const to = { x: sb.x + sb.w / 2, y: sb.y }; // top-center
      const dy = Math.max(26, (to.y - from.y) * 0.5);
      segs.push({
        id: `obj-${sharp.id}`,
        d: `M ${from.x} ${from.y} C ${from.x} ${from.y + dy}, ${to.x} ${to.y - dy}, ${to.x} ${to.y}`,
        from,
        to,
      });
    }
  }

  // sharpening → each forked ambiguity card (horizontal S-curve)
  for (const f of shapes) {
    if (f.type !== "insight-card") continue;
    if (!(f.meta as { ambiguityFork?: boolean })?.ambiguityFork) continue;
    const fb = editor.getShapePageBounds(f.id);
    if (!fb) continue;
    // Pick the side of the sharpening card the fork sits on.
    const forkLeftOfCard = fb.x + fb.w / 2 < sb.x + sb.w / 2;
    const from = forkLeftOfCard
      ? { x: sb.x, y: sb.y + sb.h / 2 } // left-center
      : { x: sb.x + sb.w, y: sb.y + sb.h / 2 }; // right-center
    const to = forkLeftOfCard
      ? { x: fb.x + fb.w, y: fb.y + fb.h / 2 } // fork right-center
      : { x: fb.x, y: fb.y + fb.h / 2 }; // fork left-center
    const dx = Math.max(44, Math.abs(to.x - from.x) * 0.5) * (forkLeftOfCard ? -1 : 1);
    segs.push({
      id: `fork-${f.id}`,
      d: `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`,
      from,
      to,
    });
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
  const camera = useValue("sc-camera", () => editor.getCamera(), [editor]);
  const viewport = useValue(
    "sc-viewport",
    () => editor.getViewportScreenBounds(),
    [editor],
  );

  if (segs.length === 0) return null;
  const scale = camera.z;

  return (
    <svg
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        width: viewport.w,
        height: viewport.h,
        zIndex: 1, // same layering as the shipped thread-tethers overlay
      }}
    >
      <g transform={`scale(${scale}) translate(${camera.x} ${camera.y})`}>
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
      </g>
    </svg>
  );
}
