"use client";

// ── CausalMapEdge ─────────────────────────────────────────────────
//
// Phase 12.A. Custom React Flow edge encoding the map's edge grammar:
//   • Polarity tint (green +, red −, gray neutral)
//   • Strength → stroke width (1–4px) + opacity
//   • Optional label (shared-concept phrase / verb)
//   • Optional mediator pill on the midpoint
//   • Loop emphasis when part of the highlighted feedback loop
//
// Cross-space + semantic edges (KG seams) get a dashed treatment —
// branch is in place though the MVP only ever emits source:"local".

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { CausalMapEdgeData } from "../lib/types";
import {
  POLARITY_COLORS,
  LOOP_COLORS,
  edgeStrokeWidth,
  edgeOpacity,
} from "../lib/visual-grammar";

function CausalMapEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const d = (data ?? {}) as unknown as CausalMapEdgeData;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
  });

  const loopActive = d.loopActive === true;
  const focused = d.focused === true;
  const baseColor = POLARITY_COLORS[d.polarity] ?? POLARITY_COLORS.neutral;
  const stroke = loopActive
    ? d.loopKind
      ? LOOP_COLORS[d.loopKind].ring
      : baseColor
    : baseColor;
  const width =
    loopActive || focused
      ? edgeStrokeWidth(d.strength) + 1.4
      : edgeStrokeWidth(d.strength);
  // Resting (room) wires are ghosted to a quiet skeleton so the default web
  // never shouts; a hovered thread or a highlighted loop overrides back to
  // full strength, making the focused path pop hard against the calm rest.
  const restOpacity = edgeOpacity(d.strength) * (d.calmRest ? 0.42 : 1);
  const opacity = d.faded ? 0.1 : loopActive || focused ? 1 : restOpacity;
  const dashed = d.source === "cross_space" || d.source === "semantic";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth: width,
          opacity,
          strokeDasharray: dashed ? "5 4" : undefined,
        }}
      />
      {(d.label || d.mediator) && !d.faded ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
              fontFamily: appleVibe.font.stack,
            }}
            className="flex flex-col items-center gap-0.5"
          >
            {d.mediator ? (
              <span
                className="rounded-full px-1.5 py-0.5 text-[8.5px] font-medium"
                style={{
                  background: appleVibe.surface.card,
                  color: appleVibe.text.secondary,
                  border: `1px solid ${appleVibe.stroke.soft}`,
                  boxShadow: appleVibe.shadow.chip,
                }}
              >
                {d.mediator}
              </span>
            ) : null}
            {d.label ? (
              <span
                className="rounded px-1 text-[8.5px] font-medium"
                style={{
                  background: "rgba(255,255,255,0.86)",
                  color: appleVibe.text.tertiary,
                }}
              >
                {d.label}
              </span>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const CausalMapEdge = memo(CausalMapEdgeInner);
