"use client";

// TrailEdge — SVG path connecting two trail nodes.
//
// Uses a smooth cubic bezier for organic flow rather than orthogonal
// elbows (Wardley/swimlane chart aesthetic; not flowchart aesthetic).
// While the edge is "working", the dasharray stays animated; on
// "complete" the offset draws to 0 over 600ms for the satisfying
// stroke-on reveal.
//
// Path math is in screen-space px; the parent renders this into an
// absolutely positioned SVG that spans the trail bounding box.

import { useMemo } from "react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

export type TrailEdgePhase = "working" | "complete";

export interface TrailEdgeProps {
  /** Source node center (relative to the trail SVG origin). */
  from: { x: number; y: number };
  /** Target node center. */
  to: { x: number; y: number };
  phase: TrailEdgePhase;
  /** Stroke color. Defaults to var(--trail-edge). */
  color?: string;
}

export function TrailEdge({ from, to, phase, color }: TrailEdgeProps) {
  const reduced = useReducedMotion();

  // Cubic bezier with control points biased toward source horizontally
  // — produces a soft S-curve that reads as "flow" rather than "wire."
  const { d, length } = useMemo(() => {
    const dx = to.x - from.x;
    const c1x = from.x + dx * 0.45;
    const c1y = from.y;
    const c2x = to.x - dx * 0.45;
    const c2y = to.y;
    const dPath = `M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`;
    // Approximate path length for stroke-dashoffset animation.
    // Real measurement needs a DOM ref; this estimate is close enough
    // for visual draw-on (the spec just needs a "long enough" dasharray).
    const approxLength = Math.hypot(dx, to.y - from.y) * 1.15 + 32;
    return { d: dPath, length: approxLength };
  }, [from.x, from.y, to.x, to.y]);

  const stroke = color ?? "var(--trail-edge)";

  if (phase === "working") {
    return (
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray="4 4"
        style={{
          opacity: 0.7,
        }}
      />
    );
  }

  // complete: animated stroke-on over 600ms, then settles to solid.
  return (
    <path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeDasharray={length}
      strokeDashoffset={reduced ? 0 : length}
      className={reduced ? undefined : "trail-edge-draw"}
      style={
        reduced
          ? undefined
          : ({
              ["--trail-len" as string]: String(length),
            } as React.CSSProperties)
      }
    />
  );
}
