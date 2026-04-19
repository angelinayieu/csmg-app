"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { CascadeRowHandle } from "./cascade-row";
import { palette, type PerspectiveKey } from "../strategy-palette";

interface RoutingPath {
  d: string;
  stroke: string;
}

interface CascadeRouterSvgProps {
  rowRefs: React.MutableRefObject<Array<React.RefObject<CascadeRowHandle | null>>>;
  paletteKeys: PerspectiveKey[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  layoutVersion: number;
}

/**
 * Draws per-row routing lines from the perspective card through each objective card
 * to the proxy indicator list, as a dashed curved bus.
 * Recomputes on `layoutVersion` change (driven by ResizeObserver + objective expand).
 */
export function CascadeRouterSvg({
  rowRefs,
  paletteKeys,
  containerRef,
  layoutVersion,
}: CascadeRouterSvgProps) {
  const [paths, setPaths] = useState<RoutingPath[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const compute = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      const next: RoutingPath[] = [];

      rowRefs.current.forEach((rowRef, i) => {
        const row = rowRef.current?.getAnchors();
        if (!row || !row.container || !row.perspectiveRight || !row.proxyLeft) return;

        const rowContainerRect = row.container.getBoundingClientRect();
        const rowOffsetY = rowContainerRect.top - rect.top;
        const rowOffsetX = rowContainerRect.left - rect.left;

        const p = palette(paletteKeys[i] ?? "internal");
        // Use a CSS var?  palette(internal).accent is a CSS var string; for strokes we need a color.
        // If it's a CSS var, fall back to a cached color at render time using a computed style.
        // Simpler: resolve var on client:
        const stroke = resolveCssColor(p.accent);

        const pOut = {
          x: row.perspectiveRight.x + rowOffsetX,
          y: row.perspectiveRight.y + rowOffsetY,
        };
        const qIn = {
          x: row.proxyLeft.x + rowOffsetX,
          y: row.proxyLeft.y + rowOffsetY,
        };

        row.objectiveAnchors.forEach((obj) => {
          const oLeft = { x: obj.leftX + rowOffsetX, y: obj.y + rowOffsetY };
          const oRight = { x: obj.rightX + rowOffsetX, y: obj.y + rowOffsetY };

          const midXLeft = (pOut.x + oLeft.x) / 2;
          const midXRight = (oRight.x + qIn.x) / 2;

          next.push({
            d: orthoPath(pOut, oLeft, midXLeft),
            stroke,
          });
          next.push({
            d: orthoPath(oRight, qIn, midXRight),
            stroke,
          });
        });
      });

      setPaths(next);
      setSize({ w: width, h: height });
    };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(compute);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [rowRefs, paletteKeys, containerRef, layoutVersion]);

  if (paths.length === 0 || size.w === 0) return null;

  return (
    <svg
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 0, overflow: "visible" }}
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
    >
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          stroke={p.stroke}
          strokeWidth={1.2}
          strokeOpacity={0.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="4 3"
        />
      ))}
    </svg>
  );
}

// ── Helpers ──

function orthoPath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  midX: number,
  r = 8,
): string {
  if (Math.abs(b.y - a.y) < 2) {
    return `M ${a.x},${a.y} L ${b.x},${b.y}`;
  }
  const down = b.y > a.y;
  const y1 = down ? r : -r;
  const y2 = down ? -r : r;
  return [
    `M ${a.x},${a.y}`,
    `L ${midX - r},${a.y}`,
    `Q ${midX},${a.y} ${midX},${a.y + y1}`,
    `L ${midX},${b.y + y2}`,
    `Q ${midX},${b.y} ${midX + r},${b.y}`,
    `L ${b.x},${b.y}`,
  ].join(" ");
}

// Resolve a possibly-CSS-var color to something SVG can actually render.
// CSS vars like "var(--accent-600)" are valid in `stroke=` only if the computed style is read,
// but SVG attribute strings support `currentColor` and CSS color values. To keep this simple,
// detect the var and resolve it against document root.
function resolveCssColor(input: string): string {
  if (!input.includes("var(")) return input;
  if (typeof window === "undefined") return "#4F46E5";
  const match = input.match(/var\((--[a-zA-Z0-9-]+)\)/);
  if (!match) return input;
  const rootStyle = getComputedStyle(document.documentElement);
  const resolved = rootStyle.getPropertyValue(match[1]).trim();
  return resolved || "#4F46E5";
}
