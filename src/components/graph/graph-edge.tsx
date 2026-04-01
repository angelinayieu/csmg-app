"use client";

import { getEdgeDimensionStyle, graphOverlays } from "@/lib/design-tokens";
import type { Edge } from "@/types";

interface GraphEdgeProps {
  edge: Edge;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isDimmed: boolean;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function GraphEdge({
  edge,
  x1,
  y1,
  x2,
  y2,
  isDimmed,
  isHovered,
  onMouseEnter,
  onMouseLeave,
}: GraphEdgeProps) {
  const style = getEdgeDimensionStyle(edge.dimension);
  const isTradeoff = edge.is_tradeoff;
  const dimOpacity = isDimmed ? 0.12 : 1;

  // Calculate midpoint for labels
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  // Arrow marker ID
  const markerId = `arrow-${edge.id}`;
  const edgeColor = isHovered
    ? "#007AFF"
    : isTradeoff
      ? graphOverlays.tradeoff.color
      : style.color;
  const edgeWidth = isHovered ? 1.8 : isTradeoff ? graphOverlays.tradeoff.width : style.width;
  const edgeDash = isTradeoff ? graphOverlays.tradeoff.dash : style.dash;

  return (
    <g
      style={{
        opacity: dimOpacity,
        transition: "opacity 250ms ease",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Arrow marker definition */}
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 6"
          refX="10"
          refY="3"
          markerWidth="8"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,3 L0,6 Z" fill={edgeColor} />
        </marker>
      </defs>

      {/* Edge line */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={edgeColor}
        strokeWidth={edgeWidth}
        strokeDasharray={edgeDash}
        markerEnd={`url(#${markerId})`}
        markerStart={isTradeoff ? `url(#${markerId})` : undefined}
        style={{ cursor: "pointer", transition: "stroke 250ms ease" }}
      />

      {/* Tradeoff label */}
      {isTradeoff && (
        <text
          x={mx}
          y={my - 6}
          textAnchor="middle"
          fontSize={8}
          fontWeight={500}
          fill={graphOverlays.tradeoff.color}
          style={{ pointerEvents: "none" }}
        >
          tradeoff
        </text>
      )}

      {/* Hover tooltip (shows on hover) */}
      {isHovered && (
        <g transform={`translate(${mx},${my - 14})`}>
          <rect
            x={-60}
            y={-10}
            width={120}
            height={20}
            rx={4}
            fill="#1D1D1F"
            opacity={0.9}
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={9}
            fill="white"
            style={{ pointerEvents: "none" }}
          >
            {edge.relationship_type} · {edge.dimension} ·{" "}
            {Math.round(edge.confidence * 100)}%
          </text>
        </g>
      )}
    </g>
  );
}
