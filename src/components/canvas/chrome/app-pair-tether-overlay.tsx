"use client";

// ── AppPairTetherOverlay (F4 / D14) ──────────────────────────────────
//
// Renders flowchart-style orthogonal tethers between paired Apps on
// the canvas. Each tether connects two `app-card` shapes whose apps
// are linked via `apps.complementary_app_ids[]` (populated by the
// cognitive template seeder + future user-driven pairing UI).
//
// Visual spec:
//   • Solid line (NOT dashed — these are first-class structural
//     relationships, not heuristic associations like ThreadTethers).
//   • Orthogonal routing — only horizontal + vertical segments with
//     gentle rounded corners (8px radius). NO bezier curves. Reads as
//     a flowchart connection, not a freehand line.
//   • Stroke: gradient from left app's application_type accent →
//     right app's accent (e.g. game-amber → measurement-blue).
//   • 2.5px wide at 1× zoom, scales inversely so it stays visually
//     consistent across zoom levels.
//   • Mid-handle pill: small label (e.g. "game ↔ measurement" or
//     "paired") at the geometric midpoint of the path. Hoverable
//     tooltip lists both app names + relationship rationale.
//   • Renders BELOW shape layer (`zIndex: 1`) so app cards remain
//     interactable; pointer-events disabled on the SVG.
//
// Pattern source: thread-tethers-overlay.tsx — same useEditor +
// useValue + camera-aware transform pattern. Difference: solid +
// orthogonal + structural-meaning vs dashed + bezier + thread-trace.
//
// See:
//   - src/components/canvas/hooks/use-space-app-pairs.ts (data)
//   - src/types/research-template.ts ResearchSeedApp (template seed)
//   - supabase/migrations/20260618_apps_application_pairing.sql (schema)

import { useMemo } from "react";
import { useEditor, useValue, type Editor, type TLShape } from "tldraw";
import { useSpaceAppPairs } from "../hooks/use-space-app-pairs";

// ── Geometry types ───────────────────────────────────────────────────

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Anchor {
  x: number;
  y: number;
  side: "top" | "right" | "bottom" | "left";
}

// ── Anchor selection — pick the edge midpoint closest to the partner ──

/**
 * Choose which edge midpoint to exit/enter on each end so the path
 * goes the shortest sensible direction. Right-of-source pairs exit
 * source's right edge + enter target's left edge; below-source pairs
 * use top/bottom; etc.
 */
function pickAnchorPair(
  source: Bounds,
  target: Bounds,
): { from: Anchor; to: Anchor } {
  const sCx = source.x + source.w / 2;
  const sCy = source.y + source.h / 2;
  const tCx = target.x + target.w / 2;
  const tCy = target.y + target.h / 2;
  const dx = tCx - sCx;
  const dy = tCy - sCy;

  // Pick dominant axis. For roughly diagonal layouts we still prefer
  // horizontal exit because app cards are typically wider than they
  // are tall — horizontal exit reads cleaner at typical layouts.
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      // Target is to the right
      return {
        from: { x: source.x + source.w, y: sCy, side: "right" },
        to: { x: target.x, y: tCy, side: "left" },
      };
    }
    return {
      from: { x: source.x, y: sCy, side: "left" },
      to: { x: target.x + target.w, y: tCy, side: "right" },
    };
  }
  if (dy >= 0) {
    // Target is below
    return {
      from: { x: sCx, y: source.y + source.h, side: "bottom" },
      to: { x: tCx, y: target.y, side: "top" },
    };
  }
  return {
    from: { x: sCx, y: source.y, side: "top" },
    to: { x: tCx, y: target.y + target.h, side: "bottom" },
  };
}

// ── Orthogonal routing ───────────────────────────────────────────────

/**
 * Build an SVG path string with right-angle bends only and rounded
 * corners. For aligned cards the path is straight (no bends); for
 * diagonal cards the path is a Z-shape with 2 bends; corners are
 * rendered as quarter-circle arcs of `cornerRadius` so they read
 * smooth at any zoom level.
 *
 * Returns both the path string and the geometric midpoint of the path
 * (used to position the mid-handle pill).
 */
function orthogonalPath(
  from: Anchor,
  to: Anchor,
  cornerRadius: number,
): { d: string; midpoint: { x: number; y: number } } {
  // Both anchors exit horizontally → Z-shape (h-v-h)
  // Both anchors exit vertically → Z-shape (v-h-v)
  // Mismatched (one horizontal, one vertical) → L-shape (1 bend)
  const fromHorizontal = from.side === "left" || from.side === "right";
  const toHorizontal = to.side === "left" || to.side === "right";

  const r = cornerRadius;

  // Helper: emit an arc command for a 90° turn from one direction to
  // another. The arc is a quarter circle of radius `r`. SVG arc syntax:
  // `A rx ry rotate large-arc-flag sweep-flag x y`. For 90° turns,
  // large-arc-flag=0 and sweep-flag depends on direction.
  const arc = (sweep: 0 | 1, x: number, y: number) =>
    `A ${r} ${r} 0 0 ${sweep} ${x} ${y}`;

  // ── Case 1: aligned (no bends) ──
  // Source and target on same row/column.
  if (fromHorizontal && toHorizontal && Math.abs(from.y - to.y) < 1) {
    return {
      d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
      midpoint: { x: (from.x + to.x) / 2, y: from.y },
    };
  }
  if (!fromHorizontal && !toHorizontal && Math.abs(from.x - to.x) < 1) {
    return {
      d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
      midpoint: { x: from.x, y: (from.y + to.y) / 2 },
    };
  }

  // ── Case 2: both horizontal exits → Z-shape (h-v-h) ──
  if (fromHorizontal && toHorizontal) {
    const midX = (from.x + to.x) / 2;
    // Direction signs for clean arcs
    const xSignFirst = midX >= from.x ? 1 : -1; // first segment direction
    const ySign = to.y >= from.y ? 1 : -1;
    const xSignSecond = to.x >= midX ? 1 : -1;

    // Pre-corner approach distances — keep the path inside the segment
    // bounds so we never overshoot.
    const approachR = Math.min(
      r,
      Math.abs(midX - from.x) / 2,
      Math.abs(to.y - from.y) / 2,
      Math.abs(to.x - midX) / 2,
    );
    if (approachR < 1) {
      // Cards too close — fall back to plain polyline (no arcs)
      return {
        d: `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`,
        midpoint: { x: midX, y: (from.y + to.y) / 2 },
      };
    }

    // First corner: turn from horizontal to vertical
    // Going right(xSignFirst=1) then down(ySign=1): sweep=1 (clockwise)
    // Going right then up: sweep=0
    // Going left then down: sweep=0
    // Going left then up: sweep=1
    const sweep1: 0 | 1 = xSignFirst === ySign ? 1 : 0;
    // Second corner: turn from vertical back to horizontal
    const sweep2: 0 | 1 = ySign === xSignSecond ? 0 : 1;

    return {
      d: [
        `M ${from.x} ${from.y}`,
        `L ${midX - approachR * xSignFirst} ${from.y}`,
        arc(sweep1, midX, from.y + approachR * ySign),
        `L ${midX} ${to.y - approachR * ySign}`,
        arc(sweep2, midX + approachR * xSignSecond, to.y),
        `L ${to.x} ${to.y}`,
      ].join(" "),
      midpoint: { x: midX, y: (from.y + to.y) / 2 },
    };
  }

  // ── Case 3: both vertical exits → Z-shape (v-h-v) ──
  if (!fromHorizontal && !toHorizontal) {
    const midY = (from.y + to.y) / 2;
    const ySignFirst = midY >= from.y ? 1 : -1;
    const xSign = to.x >= from.x ? 1 : -1;
    const ySignSecond = to.y >= midY ? 1 : -1;
    const approachR = Math.min(
      r,
      Math.abs(midY - from.y) / 2,
      Math.abs(to.x - from.x) / 2,
      Math.abs(to.y - midY) / 2,
    );
    if (approachR < 1) {
      return {
        d: `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`,
        midpoint: { x: (from.x + to.x) / 2, y: midY },
      };
    }
    const sweep1: 0 | 1 = ySignFirst === xSign ? 0 : 1;
    const sweep2: 0 | 1 = xSign === ySignSecond ? 1 : 0;
    return {
      d: [
        `M ${from.x} ${from.y}`,
        `L ${from.x} ${midY - approachR * ySignFirst}`,
        arc(sweep1, from.x + approachR * xSign, midY),
        `L ${to.x - approachR * xSign} ${midY}`,
        arc(sweep2, to.x, midY + approachR * ySignSecond),
        `L ${to.x} ${to.y}`,
      ].join(" "),
      midpoint: { x: (from.x + to.x) / 2, y: midY },
    };
  }

  // ── Case 4: mismatched (L-shape, 1 bend) ──
  // Source horizontal + target vertical, or vice versa.
  // Bend at (target.x, source.y) for h+v, (source.x, target.y) for v+h.
  if (fromHorizontal && !toHorizontal) {
    const bend = { x: to.x, y: from.y };
    const xSign = bend.x >= from.x ? 1 : -1;
    const ySign = to.y >= bend.y ? 1 : -1;
    const approachR = Math.min(
      r,
      Math.abs(bend.x - from.x) / 2,
      Math.abs(to.y - bend.y) / 2,
    );
    if (approachR < 1) {
      return {
        d: `M ${from.x} ${from.y} L ${bend.x} ${bend.y} L ${to.x} ${to.y}`,
        midpoint: bend,
      };
    }
    const sweep: 0 | 1 = xSign === ySign ? 1 : 0;
    return {
      d: [
        `M ${from.x} ${from.y}`,
        `L ${bend.x - approachR * xSign} ${from.y}`,
        arc(sweep, bend.x, bend.y + approachR * ySign),
        `L ${to.x} ${to.y}`,
      ].join(" "),
      midpoint: bend,
    };
  }
  // Source vertical + target horizontal
  const bend = { x: from.x, y: to.y };
  const ySign = bend.y >= from.y ? 1 : -1;
  const xSign = to.x >= bend.x ? 1 : -1;
  const approachR = Math.min(
    r,
    Math.abs(bend.y - from.y) / 2,
    Math.abs(to.x - bend.x) / 2,
  );
  if (approachR < 1) {
    return {
      d: `M ${from.x} ${from.y} L ${bend.x} ${bend.y} L ${to.x} ${to.y}`,
      midpoint: bend,
    };
  }
  const sweep: 0 | 1 = ySign === xSign ? 0 : 1;
  return {
    d: [
      `M ${from.x} ${from.y}`,
      `L ${from.x} ${bend.y - approachR * ySign}`,
      arc(sweep, bend.x + approachR * xSign, bend.y),
      `L ${to.x} ${to.y}`,
    ].join(" "),
    midpoint: bend,
  };
}

// ── App-card position resolver ───────────────────────────────────────

/**
 * Walk all on-canvas shapes once and build a map of `appId → bounds`.
 * Used inside the editor's `useValue` so it re-runs only when the
 * canvas shape state actually changes.
 */
function buildAppShapeBoundsMap(editor: Editor): Map<string, Bounds> {
  const map = new Map<string, Bounds>();
  try {
    const allShapes = editor.getCurrentPageShapes();
    for (const s of allShapes) {
      if (s.type !== "app-card") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const appId = (s.props as any)?.appId;
      if (typeof appId !== "string" || !appId) continue;
      const bounds = editor.getShapePageBounds((s as TLShape).id);
      if (!bounds) continue;
      map.set(appId, { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h });
    }
  } catch {
    // Soft-fail: a shape was removed mid-traversal, etc. Empty map → no tethers.
  }
  return map;
}

/** Hash the bounds map into a stable string so useValue's identity check
 *  doesn't see a brand-new Map every camera tick. We pair this with a
 *  memoized rebuild keyed on the hash. */
function hashAppShapeBounds(editor: Editor): string {
  try {
    const parts: string[] = [];
    const allShapes = editor.getCurrentPageShapes();
    for (const s of allShapes) {
      if (s.type !== "app-card") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const appId = (s.props as any)?.appId;
      if (typeof appId !== "string" || !appId) continue;
      const b = editor.getShapePageBounds((s as TLShape).id);
      if (!b) continue;
      parts.push(`${appId}:${b.x.toFixed(1)},${b.y.toFixed(1)},${b.w.toFixed(1)},${b.h.toFixed(1)}`);
    }
    parts.sort();
    return parts.join("|");
  } catch {
    return "";
  }
}

// ── The overlay ──────────────────────────────────────────────────────

interface OverlayProps {
  spaceId: string;
}

export function AppPairTetherOverlay({ spaceId }: OverlayProps) {
  const editor = useEditor();
  const pairIndex = useSpaceAppPairs(spaceId);

  // Reactive shape-bounds — hashed to a string so useValue's identity
  // check stays stable across camera ticks. The actual Map is rebuilt
  // (memoized) only when the hash changes.
  const appBoundsHash = useValue(
    "app-card-bounds-hash",
    () => hashAppShapeBounds(editor),
    [editor],
  );
  const appBounds = useMemo(
    () => buildAppShapeBoundsMap(editor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, appBoundsHash],
  );

  const camera = useValue("camera", () => editor.getCamera(), [editor]);
  const viewport = useValue(
    "viewport-screen-bounds",
    () => editor.getViewportScreenBounds(),
    [editor],
  );

  // Compute renderable tethers — only pairs where BOTH ends have an
  // on-canvas app-card shape with resolved bounds. Pairs missing an
  // end card render nothing (rather than dangling lines).
  const renderable = useMemo(() => {
    return pairIndex.pairs
      .map((pair) => {
        const lb = appBounds.get(pair.left.app_id);
        const rb = appBounds.get(pair.right.app_id);
        if (!lb || !rb) return null;
        return { pair, leftBounds: lb, rightBounds: rb };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [pairIndex.pairs, appBounds]);

  if (renderable.length === 0) return null;

  const scale = camera.z;
  const tx = camera.x;
  const ty = camera.y;
  // Corner radius in PAGE coords. 12 = comfortable flowchart corners
  // at 1× zoom. Scaling later keeps it visually consistent.
  const cornerRadius = 12;

  return (
    <svg
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        width: viewport.w,
        height: viewport.h,
        zIndex: 1,
      }}
    >
      <defs>
        {renderable.map(({ pair }) => (
          <linearGradient
            key={`grad-${pair.pair_key}`}
            id={`pair-grad-${pair.pair_key}`}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            <stop offset="0%" stopColor={pair.left_accent || "#64748b"} />
            <stop offset="100%" stopColor={pair.right_accent || "#64748b"} />
          </linearGradient>
        ))}
      </defs>
      <g transform={`scale(${scale}) translate(${tx} ${ty})`}>
        {renderable.map(({ pair, leftBounds, rightBounds }) => {
          const { from, to } = pickAnchorPair(leftBounds, rightBounds);
          const { d, midpoint } = orthogonalPath(from, to, cornerRadius);
          const labelText = typeof pair.label === "string" && pair.label.length > 0 ? pair.label : "paired";
          const leftAccent = pair.left_accent || "#64748b";
          const rightAccent = pair.right_accent || "#64748b";

          return (
            <g key={pair.pair_key}>
              {/* Outer halo for visibility against busy KG backgrounds */}
              <path
                d={d}
                fill="none"
                stroke="white"
                strokeWidth={5 / scale}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.85}
              />
              {/* Main gradient stroke */}
              <path
                d={d}
                fill="none"
                stroke={`url(#pair-grad-${pair.pair_key})`}
                strokeWidth={2.5 / scale}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.95}
              />
              {/* Mid-handle pill — small label rendered at the
                  geometric midpoint of the path. Background pill
                  + text. Pointer-events stay disabled (overlay),
                  so this is decorative-only at this stage; future
                  hover/click handlers would wrap a foreignObject
                  for HTML interactivity. */}
              <g
                transform={`translate(${midpoint.x} ${midpoint.y})`}
                style={{ pointerEvents: "none" }}
              >
                <rect
                  x={-(labelText.length * 3.4 + 12) / 2}
                  y={-9}
                  width={labelText.length * 3.4 + 12}
                  height={18}
                  rx={9}
                  ry={9}
                  fill="white"
                  stroke={leftAccent}
                  strokeWidth={1 / scale}
                  opacity={0.96}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={10 / scale}
                  fontWeight={600}
                  fill="#0a1020"
                  letterSpacing="0.04em"
                >
                  {labelText}
                </text>
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
