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

/** Build a smooth S between two boxes' nearest borders. Shared by the group and
 *  single-shape passes — same look, same dominant-axis control points. */
function curveBetween(ab: Box, bb: Box): Seg {
  const sCenter = { x: ab.x + ab.w / 2, y: ab.y + ab.h / 2 };
  const fCenter = { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 };
  const from = borderToward(ab, fCenter);
  const to = borderToward(bb, sCenter);
  const vertical = Math.abs(to.y - from.y) >= Math.abs(to.x - from.x);
  const k = 0.5;
  const c1 = vertical
    ? { x: from.x, y: from.y + (to.y - from.y) * k }
    : { x: from.x + (to.x - from.x) * k, y: from.y };
  const c2 = vertical
    ? { x: to.x, y: to.y - (to.y - from.y) * k }
    : { x: to.x - (to.x - from.x) * k, y: to.y };
  return {
    id: "",
    d: `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`,
    from,
    to,
  };
}

/** Shape types this overlay must NOT draw a single-source connector for. The
 *  sharpening fork (sharpening → heatmap / priority / insight-card) is owned by
 *  SharpeningConnectorsOverlay; the resolve-pill merge wires are owned by the
 *  real flow-connector reactor. Drawing duplicates here would double-line. */
const SINGLE_SHAPE_EXCLUDE = new Set([
  "ambiguity-heatmap-card",
  "priority-map-card",
  "insight-card",
  "resolve-pill",
  "flow-connector",
  "sys-frame",
  "prompt-sharpening",
  "objective-card",
  "room-card",
  // The chatbox card is the seed of the board, not a fork result.
  "chatbox-card",
]);

function computeSegments(editor: Editor): Seg[] {
  const segs: Seg[] = [];
  const allShapes = editor.getCurrentPageShapes();

  // ── Pass 1 ── source → fork-group FRAME. The set's underlay carries the
  // connector for every card in it — one wire per group, not N.
  // Track which shape ids are "framed" so the single-shape pass below skips them.
  const framedMembers = new Set<string>();
  for (const f of allShapes) {
    if (f.type !== "sys-frame") continue;
    const meta = f.meta as {
      forkGroup?: boolean;
      sourceShapeId?: string;
      memberIds?: unknown;
    };
    if (!meta?.forkGroup) continue;
    if (Array.isArray(meta.memberIds)) {
      for (const id of meta.memberIds as string[]) framedMembers.add(id);
    }
    if (!meta.sourceShapeId) continue;
    const src = editor.getShape(meta.sourceShapeId as TLShapeId);
    if (!src) continue; // source deleted → drop the connector
    const sb = editor.getShapePageBounds(src.id);
    const fb = editor.getShapePageBounds(f.id);
    if (!sb || !fb) continue;
    const c = curveBetween(
      { x: sb.x, y: sb.y, w: sb.w, h: sb.h },
      { x: fb.x, y: fb.y, w: fb.w, h: fb.h },
    );
    segs.push({ ...c, id: `forkgroup-${f.id}` });
  }

  // ── Pass 2 ── source → SINGLE shape. The HARD RULE: anything generated from
  // another card carries its origin in `meta.sourceShapeId` and gets a visible
  // wire to that origin. Group-framed members are skipped (pass 1 covers them);
  // a small exclusion list keeps overlay families that own their own wire from
  // double-drawing.
  for (const s of allShapes) {
    if (SINGLE_SHAPE_EXCLUDE.has(s.type)) continue;
    if (framedMembers.has(String(s.id))) continue;
    const meta = s.meta as { sourceShapeId?: string };
    const srcId = meta?.sourceShapeId;
    if (!srcId || srcId === String(s.id)) continue;
    const src = editor.getShape(srcId as TLShapeId);
    if (!src) continue;
    const sb = editor.getShapePageBounds(src.id);
    const tb = editor.getShapePageBounds(s.id);
    if (!sb || !tb) continue;
    const c = curveBetween(
      { x: sb.x, y: sb.y, w: sb.w, h: sb.h },
      { x: tb.x, y: tb.y, w: tb.w, h: tb.h },
    );
    segs.push({ ...c, id: `forkone-${s.id}` });
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
