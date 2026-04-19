"use client";

import type { LabCard } from "@/types/operating-twin";
import type { LabLayout } from "../hooks/use-lab-layout";

interface LabEdgesProps {
  labs: LabCard[];
  layouts: Map<string, LabLayout>;
  centerX: number;
  centerY: number;
  coreRadius: number;            // terminate edge just outside ring
  hoveredLabId: string | null;
  svgWidth: number;
  svgHeight: number;
}

const CATEGORY_COLOR: Record<string, string> = {
  leverage: "#007AFF",
  perspective: "#3B82F6",
  objective: "#34C759",
  risk: "#FF3B30",
  bottleneck: "#FF9500",
  process: "#10B981",
};

export function LabEdges({
  labs,
  layouts,
  centerX,
  centerY,
  coreRadius,
  hoveredLabId,
  svgWidth,
  svgHeight,
}: LabEdgesProps) {
  if (labs.length === 0) return null;

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {labs.map((lab) => {
        const layout = layouts.get(lab.id);
        if (!layout) return null;

        const color = CATEGORY_COLOR[lab.category] ?? "#a4a6ad";
        const isDraft = lab.mode === "draft";
        const isHovered = hoveredLabId === lab.id;
        const isDimmed = hoveredLabId !== null && !isHovered;

        // Compute card edge → core edge path
        // Simplified: line from layout center toward canvas center, ending coreRadius from center
        const dx = centerX - layout.x;
        const dy = centerY - layout.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return null;
        const unitX = dx / dist;
        const unitY = dy / dist;

        // Start near card edge (offset from card center by ~90px toward core)
        const cardEdgeOffset = 80;
        const sx = layout.x + unitX * cardEdgeOffset;
        const sy = layout.y + unitY * cardEdgeOffset;
        // End at core radius
        const ex = centerX - unitX * coreRadius;
        const ey = centerY - unitY * coreRadius;

        // Bezier curve for smooth path
        const cp1x = sx + (ex - sx) * 0.5;
        const cp1y = sy + (ey - sy) * 0.2;
        const cp2x = sx + (ex - sx) * 0.5;
        const cp2y = sy + (ey - sy) * 0.8;
        const d = `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${ex} ${ey}`;

        // Stroke width + opacity scale with contribution
        const baseWidth = isDraft ? 0.6 : Math.max(0.8, 0.8 + lab.contribution_abs / 30);
        const strokeWidth = isHovered ? 2.2 : baseWidth;
        const baseOpacity = isDraft ? 0.15 : Math.min(0.4, 0.18 + lab.contribution_abs / 160);
        const strokeOpacity = isHovered ? 0.85 : isDimmed ? 0.08 : baseOpacity;

        return (
          <g key={lab.id}>
            <path
              d={d}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeOpacity={strokeOpacity}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={isDraft ? "3 4" : undefined}
              style={{ transition: "stroke-opacity 0.2s, stroke-width 0.2s" }}
            />
            {/* Particle animation (only for active labs with contribution) */}
            {!isDraft && lab.contribution_abs > 3 && (
              <circle r="1.8" fill={color} opacity={isDimmed ? 0.1 : 0.85}>
                <animateMotion
                  dur={`${3.5 + (lab.contribution_abs / 40)}s`}
                  repeatCount="indefinite"
                  path={d}
                  begin={`${lab.contribution_abs * 0.05}s`}
                />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}
