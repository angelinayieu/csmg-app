"use client";

import { getNodeColor, graphOverlays } from "@/lib/design-tokens";
import type { Entity } from "@/types";

interface GraphNodeProps {
  entity: Entity;
  x: number;
  y: number;
  radius?: number;
  isHovered: boolean;
  isNeighbor: boolean;
  isDimmed: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}

export function GraphNode({
  entity,
  x,
  y,
  radius = 20,
  isHovered,
  isNeighbor,
  isDimmed,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: GraphNodeProps) {
  const colors = getNodeColor(entity.entity_category);
  const confidenceOpacity =
    entity.confidence >= 0.8 ? 1 : entity.confidence >= 0.5 ? 0.6 : 0.4;
  const displayRadius = isHovered ? radius + 3 : radius;
  const strokeWidth = isHovered ? 2 : 1.2;
  const dimOpacity = isDimmed ? 0.2 : 1;

  return (
    <g
      transform={`translate(${x},${y})`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      style={{
        cursor: "pointer",
        opacity: dimOpacity,
        transition: "opacity 250ms ease",
      }}
    >
      {/* Master bottleneck ring */}
      {entity.is_master_bottleneck && (
        <circle
          r={displayRadius + 6}
          fill="none"
          stroke={graphOverlays.bottleneck.ring}
          strokeWidth={graphOverlays.bottleneck.width}
          opacity={0.8}
        />
      )}

      {/* Leverage point ring */}
      {entity.is_leverage_point && !entity.is_master_bottleneck && (
        <circle
          r={displayRadius + 5}
          fill="none"
          stroke={graphOverlays.leverage.ring}
          strokeWidth={graphOverlays.leverage.width}
          strokeDasharray={graphOverlays.leverage.dash}
          opacity={0.7}
        />
      )}

      {/* Risk point ring */}
      {entity.is_risk_point && !entity.is_master_bottleneck && (
        <circle
          r={displayRadius + 5}
          fill="none"
          stroke={graphOverlays.risk.ring}
          strokeWidth={graphOverlays.risk.width}
          strokeDasharray={graphOverlays.risk.dash}
          opacity={0.7}
        />
      )}

      {/* Main node */}
      {entity.entity_category === "relational" ? (
        // Diamond shape for relational entities
        <rect
          x={-displayRadius * 0.7}
          y={-displayRadius * 0.7}
          width={displayRadius * 1.4}
          height={displayRadius * 1.4}
          rx={3}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={strokeWidth}
          strokeOpacity={confidenceOpacity}
          strokeDasharray={entity.confidence < 0.5 ? "3 2" : ""}
          transform="rotate(45)"
        />
      ) : (
        <circle
          r={displayRadius}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={strokeWidth}
          strokeOpacity={confidenceOpacity}
          strokeDasharray={
            entity.entity_category === "epistemic"
              ? "4 2"
              : entity.confidence < 0.5
                ? "3 2"
                : ""
          }
        />
      )}

      {/* Entity ID label inside node */}
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={600}
        letterSpacing="0.03em"
        fill={colors.stroke}
        style={{ pointerEvents: "none" }}
      >
        {entity.entity_id}
      </text>

      {/* Name label below node */}
      <text
        y={displayRadius + 14}
        textAnchor="middle"
        fontSize={9}
        fill="#86868B"
        style={{ pointerEvents: "none" }}
      >
        {entity.name.length > 18
          ? entity.name.slice(0, 16) + "..."
          : entity.name}
      </text>

      {/* Decomposable indicator */}
      {entity.is_decomposable && (
        <g transform={`translate(${displayRadius - 4},${displayRadius - 4})`}>
          <circle r={6} fill="white" stroke="#86868B" strokeWidth={0.5} />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={9}
            fill="#86868B"
          >
            {entity.has_sub_space ? "●" : "⊕"}
          </text>
        </g>
      )}
    </g>
  );
}
