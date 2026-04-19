"use client";

import React from "react";
import { getEdgeDimensionStyle, graphOverlays, edgeDynamicsStyles } from "@/lib/design-tokens";
import type { Edge } from "@/types";
import type { LayoutType } from "@/lib/graph/layout-engine";

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
  onClick?: (e: React.MouseEvent) => void;
  /** Layout type — affects edge rendering style */
  layoutType?: LayoutType;
  /** When true, external edges render at full strength (not faded) */
  externalAsPrimary?: boolean;
  /** When true, this edge is part of a detected feedback cycle */
  isCycleEdge?: boolean;
  /** When true, this edge is part of a strategic corridor */
  isCorridorEdge?: boolean;
  /** Corridor polarity — affects corridor highlight color */
  corridorPolarity?: "enabling" | "constraining" | "complex";
  /** When true, source and target are in different entity categories — renders curved arc */
  isCrossCategoryEdge?: boolean;
  /** When true, show a persistent labeled callout on cross-category arcs (map view bridge prominence) */
  showCrossBridgeLabel?: boolean;
}

function GraphEdgeInner({
  edge,
  x1,
  y1,
  x2,
  y2,
  isDimmed,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onClick,
  layoutType = "force",
  externalAsPrimary = false,
  isCycleEdge = false,
  isCorridorEdge = false,
  corridorPolarity,
  isCrossCategoryEdge = false,
  showCrossBridgeLabel = false,
}: GraphEdgeProps) {
  const style = getEdgeDimensionStyle(edge.dimension);
  const isTradeoff = edge.is_tradeoff;
  const isBridge = edge.knowledge_layer === "bridge";
  const isExternal = edge.knowledge_layer === "external";
  const isPendingApproval = edge.requires_user_approval && !edge.approved_at;
  const utility = edge.utility as Record<string, unknown> | null;
  const isHighUtility = utility?.information_value === "decision_critical" || utility?.information_value === "high";
  const isCatastrophic = utility?.failure_consequence === "catastrophic";
  // When external entities are the primary content, don't fade them
  const fadeExternal = isExternal && !externalAsPrimary;
  const dimOpacity = isDimmed ? 0.08 : fadeExternal ? 0.35 : (0.5 + edge.confidence * 0.5);

  // Dynamics visual encoding
  const dynamics = edge.dynamics as string | null;
  const dynamicsStyle = dynamics ? edgeDynamicsStyles[dynamics] ?? null : null;
  const hasDynamics = !!dynamicsStyle && !isDimmed;

  // Calculate midpoint for labels
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  // Perpendicular offset for dynamics glow (renders parallel line offset from edge)
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  // Unit normal (perpendicular to edge direction)
  const nx = -dy / len;
  const ny = dx / len;
  const glowOffset = 3; // px offset for parallel glow line

  // Curved path for cross-category edges (arc instead of straight line)
  const arcOffset = isCrossCategoryEdge ? Math.min(len * 0.15, 50) : 0;
  const cpx = mx + nx * arcOffset;  // control point x
  const cpy = my + ny * arcOffset;  // control point y
  const curvedPath = isCrossCategoryEdge
    ? `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`
    : null;

  // Arrow marker ID
  const markerId = `arrow-${edge.id}`;
  const glowFilterId = `dynamics-glow-${edge.id}`;
  const edgeColor = isHovered
    ? "#007AFF"
    : isBridge
      ? "#EF9F27" // Gold for bridges
      : isTradeoff
        ? graphOverlays.tradeoff.color
        : fadeExternal
          ? "#86868B" // Gray for faded external-only edges
          : style.color; // Use dimension color for primary display
  const baseWidth = isCatastrophic ? style.width * 1.8 : isHighUtility ? style.width * 1.3 : Math.max(style.width, 0.8);
  const edgeWidth = isHovered ? 2.5 : isBridge ? 1.5 : isTradeoff ? graphOverlays.tradeoff.width : fadeExternal ? 0.5 : baseWidth;
  const edgeDash = isBridge
    ? (isPendingApproval ? "6 3 2 3" : "6 3") // Animated dash for pending, regular dash for approved
    : isTradeoff
      ? graphOverlays.tradeoff.dash
      : fadeExternal
        ? "2 3"
        : style.dash;

  // Dynamics tooltip detail
  const dynamicsProps = edge.dynamics_properties as Record<string, unknown> | null;
  const dynamicsDetail = dynamics && dynamicsProps
    ? (dynamicsProps.threshold_condition as string | undefined) ??
      (dynamicsProps.compounding_mechanism as string | undefined) ??
      (dynamicsProps.delay as string | undefined) ??
      null
    : null;

  return (
    <g
      style={{
        opacity: dimOpacity,
        transition: "opacity 250ms ease",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {/* Definitions: arrow marker + dynamics glow filter */}
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 6"
          refX="10"
          refY="3"
          markerWidth="10"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,3 L0,6 Z" fill={edgeColor} />
        </marker>
        {hasDynamics && (
          <filter id={glowFilterId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>

      {/* Cycle membership underline — subtle thicker stroke behind edge */}
      {isCycleEdge && !isDimmed && (
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#7C3AED"
          strokeWidth={edgeWidth + 4}
          strokeLinecap="round"
          opacity={isHovered ? 0.2 : 0.1}
          style={{ pointerEvents: "none", transition: "opacity 250ms ease" }}
        />
      )}

      {/* Strategic corridor underline — emerald highlight for edges on high-influence paths */}
      {isCorridorEdge && !isDimmed && (
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={corridorPolarity === "constraining" ? "#DC2626" : corridorPolarity === "complex" ? "#D97706" : graphOverlays.corridor.color}
          strokeWidth={graphOverlays.corridor.width + 3}
          strokeLinecap="round"
          opacity={isHovered ? graphOverlays.corridor.opacity : graphOverlays.corridor.opacity * 0.5}
          style={{ pointerEvents: "none", transition: "opacity 250ms ease" }}
        />
      )}

      {/* Dynamics glow line — rendered behind the main edge as a soft parallel glow */}
      {hasDynamics && dynamicsStyle && (
        <line
          x1={x1 + nx * glowOffset}
          y1={y1 + ny * glowOffset}
          x2={x2 + nx * glowOffset}
          y2={y2 + ny * glowOffset}
          stroke={dynamicsStyle.color}
          strokeWidth={edgeWidth + 2}
          strokeDasharray={dynamics === "threshold" ? "2 4" : dynamics === "step_function" ? "6 2" : dynamics === "delayed" ? "1 3" : ""}
          opacity={isHovered ? dynamicsStyle.glowOpacity + 0.15 : dynamicsStyle.glowOpacity}
          filter={`url(#${glowFilterId})`}
          style={{ pointerEvents: "none", transition: "opacity 250ms ease" }}
        />
      )}

      {/* Edge line (curved arc for cross-category, straight for within-category) */}
      {curvedPath ? (
        <path
          d={curvedPath}
          fill="none"
          stroke={edgeColor}
          strokeWidth={edgeWidth}
          strokeDasharray={edgeDash}
          markerEnd={`url(#${markerId})`}
          markerStart={isTradeoff ? `url(#${markerId})` : undefined}
          style={{ cursor: "pointer", transition: "stroke 250ms ease" }}
        />
      ) : (
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
      )}

      {/* Dynamics symbol indicator at midpoint */}
      {hasDynamics && dynamicsStyle && !isTradeoff && !isBridge && (
        <g transform={`translate(${mx + nx * 8},${my + ny * 8})`}>
          <circle
            r={6}
            fill={dynamicsStyle.color}
            opacity={0.85}
            stroke="white"
            strokeWidth={0.5}
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={7}
            fontWeight={700}
            fill="white"
            style={{ pointerEvents: "none" }}
          >
            {dynamicsStyle.symbol}
          </text>
        </g>
      )}

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

      {/* Bridge label */}
      {isBridge && (
        <text
          x={mx}
          y={my - 6}
          textAnchor="middle"
          fontSize={7}
          fontWeight={500}
          fill="#EF9F27"
          style={{ pointerEvents: "none" }}
        >
          {edge.relationship_type}
          {isPendingApproval ? " ⟡" : " ✓"}
        </text>
      )}

      {/* Map view cross-pillar bridge callout — persistent label on critical cross-category arcs */}
      {showCrossBridgeLabel && isCrossCategoryEdge && !isBridge && !isTradeoff && !isDimmed && (
        (() => {
          const labelX = arcOffset ? cpx : mx;
          const labelY = arcOffset ? cpy : my;
          const relType = edge.relationship_type.length > 18
            ? edge.relationship_type.slice(0, 16) + "…"
            : edge.relationship_type;
          const labelW = Math.max(relType.length * 5 + 12, 40);
          return (
            <g transform={`translate(${labelX},${labelY})`} style={{ pointerEvents: "none" }}>
              <rect
                x={-labelW / 2}
                y={-7}
                width={labelW}
                height={14}
                rx={4}
                fill="white"
                stroke={edgeColor}
                strokeWidth={0.6}
                opacity={0.92}
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={7}
                fontWeight={600}
                fill={edgeColor}
                letterSpacing="0.02em"
              >
                {relType}
              </text>
            </g>
          );
        })()
      )}

      {/* Hover tooltip — extended with dynamics info */}
      {isHovered && (
        <g transform={`translate(${mx},${my - 14})`}>
          <rect
            x={dynamics ? -80 : -60}
            y={dynamicsDetail ? -24 : -10}
            width={dynamics ? 160 : 120}
            height={dynamicsDetail ? 34 : 20}
            rx={4}
            fill="#1D1D1F"
            opacity={0.92}
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={9}
            fill="white"
            y={dynamicsDetail ? -10 : 0}
            style={{ pointerEvents: "none" }}
          >
            {edge.relationship_type} · {edge.dimension} ·{" "}
            {Math.round(edge.confidence * 100)}%
            {dynamics ? ` · ${dynamicsStyle?.label ?? dynamics}` : ""}
          </text>
          {dynamicsDetail && (
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={8}
              fill={dynamicsStyle?.color ?? "#999"}
              y={4}
              style={{ pointerEvents: "none" }}
            >
              {dynamicsDetail.length > 30 ? dynamicsDetail.slice(0, 30) + "…" : dynamicsDetail}
            </text>
          )}
        </g>
      )}
    </g>
  );
}

export const GraphEdge = React.memo(GraphEdgeInner);
