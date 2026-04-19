"use client";

import { memo } from "react";
import type {
  WhiteboardEdge as WBEdge,
  WhiteboardNode,
} from "@/types/whiteboard";

interface EdgeProps {
  edge: WBEdge;
  source: WhiteboardNode;
  target: WhiteboardNode;
}

const EDGE_COLORS = {
  causalUser: "#6366F1",
  causalSystem: "rgba(var(--accent-rgb), 0.75)",
  temporal: "#22D3EE",
  feedback: "#A855F7",
  support: "rgba(100, 116, 139, 0.55)",
};

function EdgeInner({ edge, source, target }: EdgeProps) {
  const sx = source.x ?? 0;
  const sy = source.y ?? 0;
  const tx = target.x ?? 0;
  const ty = target.y ?? 0;

  // Perpendicular offset creates a gentle arc.
  // Feedback edges use a much larger offset to create the visible loop back.
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const curveOffset = edge.dimension === "feedback" ? 140 : 22;
  const offsetX = (-dy / len) * curveOffset;
  const offsetY = (dx / len) * curveOffset;
  const mx = (sx + tx) / 2 + offsetX;
  const my = (sy + ty) / 2 + offsetY;

  // Shorten the endpoint a bit so arrowheads don't overlap node borders.
  const endPad = 28;
  const k = Math.max(0, (len - endPad) / len);
  const ex = sx + (tx - sx) * k;
  const ey = sy + (ty - sy) * k;

  let stroke = EDGE_COLORS.causalSystem;
  if (edge.kind === "user") stroke = EDGE_COLORS.causalUser;
  else if (edge.dimension === "feedback") stroke = EDGE_COLORS.feedback;
  else if (edge.dimension === "temporal") stroke = EDGE_COLORS.temporal;
  else if (edge.dimension === "support") stroke = EDGE_COLORS.support;

  const dash =
    edge.kind === "user"
      ? "5 3"
      : edge.dimension === "feedback"
        ? "4 5"
        : edge.dimension === "support"
          ? "2 3"
          : undefined;

  const strokeWidth =
    edge.dimension === "feedback"
      ? 1.6
      : edge.dimension === "causal"
        ? 1.4
        : 1.1;

  const markerId = `arrow-${
    edge.kind === "user"
      ? "user"
      : edge.dimension ?? "support"
  }`;

  return (
    <g opacity={0.9}>
      <path
        d={`M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        strokeLinecap="round"
        markerEnd={`url(#${markerId})`}
      />
      {edge.label && (
        <text
          x={mx}
          y={my - 5}
          fontSize="9.5"
          fill="#64748B"
          textAnchor="middle"
          fontWeight={500}
          style={{ pointerEvents: "none", textShadow: "0 0 3px white, 0 0 3px white" }}
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}

export const WhiteboardEdge = memo(EdgeInner);

/** Arrowhead marker defs — include once in the parent <svg> */
export function WhiteboardEdgeMarkers() {
  return (
    <defs>
      {[
        { id: "arrow-causal", color: EDGE_COLORS.causalSystem },
        { id: "arrow-user", color: EDGE_COLORS.causalUser },
        { id: "arrow-temporal", color: EDGE_COLORS.temporal },
        { id: "arrow-feedback", color: EDGE_COLORS.feedback },
        { id: "arrow-support", color: EDGE_COLORS.support },
      ].map(({ id, color }) => (
        <marker
          key={id}
          id={id}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      ))}
    </defs>
  );
}
