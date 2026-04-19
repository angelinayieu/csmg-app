"use client";

// ── WhiteboardEdge ──
//
// Renders a curved connection between two nodes on the whiteboard.
// Features:
//   - Stroke thickness scales with combined weight of endpoints
//   - Cross-layer edges (layer gap > 1) get dashed + lower opacity
//   - Gradient stroke: source color → target color
//   - Edges touching hero nodes are more prominent
//   - Topology-aware styling:
//       * disjoint → red dashed
//       * equal    → muted (should be merged out, but render if present)
//       * composes → slightly thicker solid
//       * meets    → standard curve
//   - Dynamics glyph (Tier 3 surfacing — previously invisible):
//       * compounding → amber pulsing dot (feedback growth)
//       * exponential → amber ring + ring (accelerating)
//       * threshold   → emerald square (gate / binary)
//       * delayed     → sky arc (phase-offset)
//       * decay       → cool gray fading stroke
//     Glyph sits at curve midpoint; on hover, shows dynamics label + cycle_time.

import React, { useState } from "react";
import type { Edge } from "@/types";
import type { LayerConfig } from "@/lib/whiteboard/layer-config";

export interface WhiteboardEdgeRenderData {
  edge: Edge;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourceWeight: number;   // 0..100
  targetWeight: number;   // 0..100
  sourceLayer: LayerConfig;
  targetLayer: LayerConfig;
  // Layer "depth" gap (absolute difference in layer order indices)
  layerGap: number;
}

interface Props {
  data: WhiteboardEdgeRenderData;
  // Optional: dim edges when another edge is being hovered
  dimmed?: boolean;
}

/**
 * Compute stroke width from combined endpoint weights.
 * Range: 0.8..3.8 (typical graphs), emphasized on hero links.
 */
export function edgeStrokeWidth(sourceWeight: number, targetWeight: number): number {
  const avg = (sourceWeight + targetWeight) / 200; // 0..1
  return Math.max(0.8, Math.min(3.8, 0.8 + avg * 3));
}

/**
 * Cubic curve endpoints — vertical Bezier that works well for dimensional-band
 * layouts (source above, target below, or vice versa).
 */
function curvePath(sx: number, sy: number, tx: number, ty: number): string {
  const dy = Math.abs(ty - sy);
  const offset = Math.min(dy * 0.4, 80);
  const direction = ty >= sy ? 1 : -1;
  const cy1 = sy + offset * direction;
  const cy2 = ty - offset * direction;
  return `M${sx},${sy} C${sx},${cy1} ${tx},${cy2} ${tx},${ty}`;
}

/** Compute approximate midpoint of the cubic Bezier used for edge curves. */
function curveMidpoint(sx: number, sy: number, tx: number, ty: number): { x: number; y: number } {
  const dy = Math.abs(ty - sy);
  const offset = Math.min(dy * 0.4, 80);
  const direction = ty >= sy ? 1 : -1;
  const cy1 = sy + offset * direction;
  const cy2 = ty - offset * direction;
  // Cubic Bezier at t=0.5 where control x-coords match endpoints:
  const t = 0.5;
  const mt = 1 - t;
  const x = mt * mt * mt * sx + 3 * mt * mt * t * sx + 3 * mt * t * t * tx + t * t * t * tx;
  const y = mt * mt * mt * sy + 3 * mt * mt * t * cy1 + 3 * mt * t * t * cy2 + t * t * t * ty;
  return { x, y };
}

/** Dynamics → visual language. Only populates for non-default values. */
type DynamicsGlyph = {
  color: string;
  label: string;
  kind: "pulse" | "ring" | "gate" | "arc" | "fade";
};

function dynamicsGlyph(dynamics: string | undefined): DynamicsGlyph | null {
  if (!dynamics) return null;
  const d = dynamics.toLowerCase().trim();
  switch (d) {
    case "compounding":
      return { color: "#f59e0b", label: "Compounding", kind: "pulse" };
    case "exponential":
      return { color: "#d97706", label: "Exponential", kind: "ring" };
    case "threshold":
      return { color: "#10b981", label: "Threshold gate", kind: "gate" };
    case "delayed":
      return { color: "#0ea5e9", label: "Delayed", kind: "arc" };
    case "decay":
      return { color: "#6b7280", label: "Decay", kind: "fade" };
    case "step_function":
      return { color: "#6366f1", label: "Step function", kind: "gate" };
    case "logarithmic":
      return { color: "#8b5cf6", label: "Logarithmic", kind: "arc" };
    case "linear":
    case "":
    case "null":
      return null;
    default:
      return null;
  }
}

export function WhiteboardEdge({ data, dimmed }: Props) {
  const { edge, sourceX, sourceY, targetX, targetY, sourceWeight, targetWeight, sourceLayer, targetLayer, layerGap } = data;
  const [glyphHover, setGlyphHover] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topology = (edge as any).topology as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamics = (edge as any).dynamics as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamicsProperties = (edge as any).dynamics_properties as Record<string, unknown> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relationshipType = (edge as any).relationship_type as string | undefined;

  const avgWeight = (sourceWeight + targetWeight) / 2;
  const isCrossLayer = layerGap !== 1;
  const isDisjoint = topology === "disjoint";
  const isComposes = topology === "composes";
  const isEqual = topology === "equal";
  // Predicted edges are what playground-materialize creates before user
  // approves — they render with a distinctive sparse dash + indigo accent.
  const isPredicted = edge.source_tag === "predicted";
  const glyph = dynamicsGlyph(dynamics);
  const isDecay = glyph?.kind === "fade";

  const strokeW = edgeStrokeWidth(sourceWeight, targetWeight) * (isComposes ? 1.2 : 1) * (isPredicted ? 0.85 : 1);

  let dashArray: string | undefined;
  if (isPredicted) dashArray = "4 3";
  else if (isDisjoint) dashArray = "5 3";
  else if (isDecay) dashArray = "2 5"; // dotted fade for decay dynamics
  else if (isCrossLayer && !isComposes) dashArray = "6 4";

  // Opacity logic: hero-touching edges strong, standard moderate, cross-layer low.
  const baseOpacity = avgWeight >= 85 ? 0.72 : avgWeight >= 65 ? 0.5 : 0.32;
  const opacity = (dimmed ? baseOpacity * 0.3 : baseOpacity) * (isCrossLayer ? 0.75 : 1) * (isEqual ? 0.4 : 1);

  // Gradient id: unique per edge so gradients don't collide.
  const gid = `wb-edge-g-${edge.id}`;

  // Coloring rules (in priority order):
  //   predicted → indigo (signals "awaiting approval")
  //   disjoint  → red/rose (set-theoretically disjoint)
  //   default   → gradient from source layer → target layer color
  const sourceColor = isPredicted ? "#6366f1" : isDisjoint ? "#ef4444" : sourceLayer.color;
  const targetColor = isPredicted ? "#818cf8" : isDisjoint ? "#f87171" : targetLayer.color;

  const mid = glyph ? curveMidpoint(sourceX, sourceY, targetX, targetY) : null;
  // Tooltip text assembled from dynamics + conditions + cycle_time, if any.
  const cycleTime = dynamicsProperties && typeof dynamicsProperties.cycle_time === "string"
    ? (dynamicsProperties.cycle_time as string) : undefined;
  const conditionHint = dynamicsProperties && typeof dynamicsProperties.threshold_condition === "string"
    ? (dynamicsProperties.threshold_condition as string) : undefined;

  return (
    <>
      <defs>
        <linearGradient id={gid} x1={sourceX} y1={sourceY} x2={targetX} y2={targetY} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={sourceColor} stopOpacity={opacity} />
          <stop offset="100%" stopColor={targetColor} stopOpacity={opacity * 0.8} />
        </linearGradient>
      </defs>
      <path
        d={curvePath(sourceX, sourceY, targetX, targetY)}
        fill="none"
        stroke={`url(#${gid})`}
        strokeWidth={strokeW}
        strokeDasharray={dashArray}
        strokeLinecap="round"
        style={{
          transition: "opacity 0.3s",
          ...(isPredicted ? { animation: "wb-predicted-pulse 2.4s ease-in-out infinite" } : {}),
        }}
      />
      {/* Dynamics glyph — Apple-Vision-Pro-style: minimal, anchored to edge midpoint,
          only rendered when dynamics ≠ linear/null. Enlarges subtly on hover; emits
          tooltip line of metadata. Glyph shape encodes kind, color encodes category. */}
      {glyph && mid && (
        <g
          transform={`translate(${mid.x}, ${mid.y})`}
          style={{ cursor: "default" }}
          onMouseEnter={() => setGlyphHover(true)}
          onMouseLeave={() => setGlyphHover(false)}
        >
          {/* Hover halo (Vision-Pro-style subtle glow when focused) */}
          {glyphHover && (
            <circle r={12} fill={glyph.color} opacity={0.12} />
          )}
          <DynamicsGlyphShape kind={glyph.kind} color={glyph.color} animate={!dimmed} />
          {/* Invisible hit target — larger than the visible glyph so hover is forgiving */}
          <circle r={12} fill="transparent" pointerEvents="all" />
          {glyphHover && (
            <g transform="translate(12, -8)" pointerEvents="none">
              {/* Tooltip bubble */}
              <rect
                x={0}
                y={-10}
                width={Math.max(140, (glyph.label.length + 10) * 6)}
                height={cycleTime || conditionHint ? 42 : 24}
                rx={6}
                ry={6}
                fill="rgba(17,24,39,0.95)"
              />
              <text x={8} y={4} fontSize={10} fill="white" fontFamily="ui-sans-serif,-apple-system,system-ui">
                <tspan fontWeight="600">{glyph.label}</tspan>
                {relationshipType && relationshipType !== "relates-to" && (
                  <tspan fill="#9ca3af"> · {relationshipType}</tspan>
                )}
              </text>
              {cycleTime && (
                <text x={8} y={18} fontSize={9} fill="#d1d5db" fontFamily="ui-sans-serif,-apple-system,system-ui">
                  cycle · {cycleTime}
                </text>
              )}
              {conditionHint && !cycleTime && (
                <text x={8} y={18} fontSize={9} fill="#d1d5db" fontFamily="ui-sans-serif,-apple-system,system-ui">
                  when: {conditionHint.slice(0, 20)}{conditionHint.length > 20 ? "…" : ""}
                </text>
              )}
            </g>
          )}
        </g>
      )}
    </>
  );
}

// ── Dynamics glyph shapes ──
// Each shape is a small, minimalist icon encoding the dynamics kind. Designed for
// 8px-ish scale with 1.5px strokes. Animation is restrained — only compounding
// gets a soft pulse to suggest feedback motion; others are static.

function DynamicsGlyphShape({ kind, color, animate }: { kind: DynamicsGlyph["kind"]; color: string; animate: boolean }) {
  switch (kind) {
    case "pulse":
      // Compounding: filled dot + soft outer ring that pulses
      return (
        <g>
          <circle r={3.5} fill={color} />
          <circle r={6} fill="none" stroke={color} strokeWidth={1.2} opacity={0.5}>
            {animate && (
              <animate attributeName="r" values="6;8;6" dur="2.2s" repeatCount="indefinite" />
            )}
            {animate && (
              <animate attributeName="opacity" values="0.5;0.15;0.5" dur="2.2s" repeatCount="indefinite" />
            )}
          </circle>
        </g>
      );
    case "ring":
      // Exponential: concentric rings, accelerating visual feel
      return (
        <g>
          <circle r={2.5} fill={color} />
          <circle r={5} fill="none" stroke={color} strokeWidth={1.2} opacity={0.7} />
          <circle r={8} fill="none" stroke={color} strokeWidth={1} opacity={0.35} />
        </g>
      );
    case "gate":
      // Threshold / step function: a small rotated square (gate)
      return (
        <rect x={-4} y={-4} width={8} height={8} rx={1.5} fill={color} transform="rotate(45)" />
      );
    case "arc":
      // Delayed / logarithmic: partial arc showing phase offset
      return (
        <g>
          <path d="M -6 0 A 6 6 0 0 1 6 0" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
          <circle r={2} fill={color} cx={6} cy={0} />
        </g>
      );
    case "fade":
      // Decay: diamond outline, muted fill
      return (
        <g>
          <circle r={4} fill={color} opacity={0.35} />
          <circle r={4} fill="none" stroke={color} strokeWidth={1} strokeDasharray="1.5 2" opacity={0.7} />
        </g>
      );
    default:
      return null;
  }
}
