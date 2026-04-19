"use client";

import { useMemo } from "react";
import type { LabCard } from "@/types/operating-twin";

export interface LabLayout {
  id: string;
  x: number;           // center-relative px
  y: number;           // center-relative px
  angle: number;       // radians, from canvas center
}

export interface LabLayoutResult {
  layouts: Map<string, LabLayout>;
  centerX: number;
  centerY: number;
}

/**
 * Compute deterministic radial positions for lab cards around the center ring.
 * Layout distributes labs around 3 rings (inner, middle, outer) based on size,
 * then spreads them by angle to avoid overlap.
 *
 * - xl/l cards: outer ring (farther from center, more prominent)
 * - m cards: middle ring
 * - s cards: inner ring (closer)
 */
export function useLabLayout(
  labs: LabCard[],
  canvasWidth: number,
  canvasHeight: number,
): LabLayoutResult {
  return useMemo(() => {
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const layouts = new Map<string, LabLayout>();

    if (labs.length === 0 || canvasWidth === 0 || canvasHeight === 0) {
      return { layouts, centerX, centerY };
    }

    // Ring radii — scaled to available space; center ring is ~180px (radius).
    const maxRadius = Math.min(canvasWidth, canvasHeight) * 0.42;
    const outerR = Math.max(maxRadius, 330);
    const middleR = Math.max(maxRadius * 0.78, 260);
    const innerR = Math.max(maxRadius * 0.58, 210);

    // Group labs by size
    const outerLabs = labs.filter((l) => l.size === "xl" || l.size === "l");
    const middleLabs = labs.filter((l) => l.size === "m");
    const innerLabs = labs.filter((l) => l.size === "s");

    // Distribute each group evenly around the ring
    const placeGroup = (group: LabCard[], radius: number, startAngle = -Math.PI / 2) => {
      const n = group.length;
      if (n === 0) return;
      const step = (Math.PI * 2) / n;
      // Offset alternating rings so cards don't overlap radially
      group.forEach((lab, i) => {
        const angle = startAngle + step * i;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        layouts.set(lab.id, { id: lab.id, x, y, angle });
      });
    };

    // Start outer at top, middle offset by half-step, inner offset again
    placeGroup(outerLabs, outerR, -Math.PI / 2);
    placeGroup(middleLabs, middleR, -Math.PI / 2 + Math.PI / (middleLabs.length || 1));
    placeGroup(innerLabs, innerR, -Math.PI / 2 + Math.PI / 2 / (innerLabs.length || 1));

    return { layouts, centerX, centerY };
  }, [labs, canvasWidth, canvasHeight]);
}
