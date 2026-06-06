"use client";

// ── ObjectClusterGraph ──
//
// A small radial node-link diagram of ONE library object's neighborhood: the
// object in the center + its directly-linked objects (object_links: feeds /
// depends_on / derived_from / …) around it. This is the per-variable "cluster"
// view — the graph the object-detail rail renders instead of only a flat list.
// Click a neighbor → navigate the rail to it (re-centers the cluster there).
// Pure SVG, no deps.

import { useMemo } from "react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export interface ClusterNeighbor {
  id: string;
  title: string;
  type: string; // object_type
  relation?: string;
  direction?: "out" | "in";
}

const TYPE_COLOR: Record<string, string> = {
  variable: "#069494",
  feature: "#2563EB",
  mechanism: "#7C3AED",
  experiment: "#D97706",
  deliverable: "#059669",
  insight: "#DB2777",
};
const typeColor = (t: string) => TYPE_COLOR[t] ?? "#64748B";
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function ObjectClusterGraph({
  centerTitle,
  centerType,
  neighbors,
  onNavigate,
}: {
  centerTitle: string;
  centerType: string;
  neighbors: ClusterNeighbor[];
  onNavigate: (id: string) => void;
}) {
  const W = 320;
  const H = 230;
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) / 2 - 42;
  const n = neighbors.length;

  const pts = useMemo(
    () =>
      neighbors.map((nb, i) => {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n);
        return { ...nb, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
      }),
    [neighbors, n, cx, cy, R],
  );

  if (n === 0) return null;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: "block", fontFamily: appleVibe.font.stack, overflow: "visible" }}
    >
      {/* edges */}
      {pts.map((p) => (
        <line
          key={`e-${p.id}`}
          x1={cx}
          y1={cy}
          x2={p.x}
          y2={p.y}
          style={{ stroke: appleVibe.stroke.medium }}
          strokeWidth={1.2}
        />
      ))}
      {/* relation labels at edge midpoints */}
      {pts.map((p) => (
        <text
          key={`rl-${p.id}`}
          x={(cx + p.x) / 2}
          y={(cy + p.y) / 2 - 2}
          fontSize={7}
          style={{ fill: appleVibe.text.faint }}
          textAnchor="middle"
        >
          {(p.relation || "").replace(/_/g, " ")}
        </text>
      ))}
      {/* neighbor nodes (clickable) */}
      {pts.map((p) => (
        <g
          key={p.id}
          style={{ cursor: "pointer" }}
          onClick={() => onNavigate(p.id)}
        >
          <circle cx={p.x} cy={p.y} r={6.5} fill={typeColor(p.type)} />
          <text
            x={p.x}
            y={p.y < cy ? p.y - 10 : p.y + 16}
            fontSize={8.5}
            fontWeight={600}
            style={{ fill: appleVibe.text.secondary }}
            textAnchor="middle"
          >
            {trunc(p.title, 16)}
          </text>
        </g>
      ))}
      {/* center node */}
      <circle cx={cx} cy={cy} r={10} fill={typeColor(centerType)} stroke="white" strokeWidth={2} />
      <text
        x={cx}
        y={cy + 22}
        fontSize={9.5}
        fontWeight={700}
        style={{ fill: appleVibe.text.primary }}
        textAnchor="middle"
      >
        {trunc(centerTitle, 18)}
      </text>
    </svg>
  );
}
