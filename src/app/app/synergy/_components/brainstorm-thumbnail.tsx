// ── BrainstormThumbnail ──
//
// Schematic SVG render of a brainstorm session: nodes coloured by
// kind, edges as parent-child lines. Pure SVG, no client deps, so the
// gallery server-renders fully.
//
// The renderer fits all nodes into the supplied viewBox via bounding-
// box detection so two sessions with very different spatial spreads
// both read at a glance. Edges sit underneath nodes.
//
// Intentionally schematic — not pixel-accurate to the whiteboard. The
// thumbnail's job is recognition ("ah, this is the one with the dense
// cluster on the left"), not faithful preview.

import type { CSSProperties } from "react";

export interface ThumbnailNode {
  id: string;
  parent_id: string | null;
  kind: string;
  x: number;
  y: number;
}

interface BrainstormThumbnailProps {
  nodes: ThumbnailNode[];
  /** Tailwind / CSS-grade height. Width is always 100%. */
  className?: string;
  style?: CSSProperties;
}

const KIND_FILL: Record<string, string> = {
  core: "#3b82f6",       // blue-500 — anchor
  branch: "#94a3b8",     // slate-400
  insight: "#a855f7",    // purple-500
  question: "#f59e0b",   // amber-500
  action: "#10b981",     // emerald-500
  user: "#6b7280",       // gray-500 — voice anchor (rendered smaller)
  variation: "#d946ef",  // fuchsia-500
  ranking: "#f97316",    // orange-500
  plan: "#0ea5e9",       // sky-500
  synergy: "#f59e0b",    // amber-500 (synthesis)
};

const KIND_RADIUS: Record<string, number> = {
  core: 4.5,
  user: 2.6,
};

export function BrainstormThumbnail({
  nodes,
  className,
  style,
}: BrainstormThumbnailProps) {
  if (nodes.length === 0) {
    return <EmptyThumbnail className={className} style={style} />;
  }

  // Bounding box of all nodes, with a small padding so dots near the
  // edge don't clip against the viewBox border.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  // Handle the single-node (zero extent) case so the dot isn't slammed
  // against the corner.
  if (minX === maxX) { minX -= 50; maxX += 50; }
  if (minY === maxY) { minY -= 50; maxY += 50; }

  const w = maxX - minX;
  const h = maxY - minY;
  const padX = w * 0.12;
  const padY = h * 0.12;
  const vb = `${minX - padX} ${minY - padY} ${w + padX * 2} ${h + padY * 2}`;

  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <svg
      className={className}
      style={style}
      viewBox={vb}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {/* Edges first so nodes draw above */}
      <g stroke="rgba(15,23,42,0.18)" strokeWidth={Math.max(w, h) * 0.0025} fill="none">
        {nodes.map((n) => {
          if (!n.parent_id) return null;
          const p = byId.get(n.parent_id);
          if (!p) return null;
          return (
            <line
              key={`${n.id}-edge`}
              x1={p.x}
              y1={p.y}
              x2={n.x}
              y2={n.y}
            />
          );
        })}
      </g>

      {/* Nodes */}
      <g>
        {nodes.map((n) => {
          const fill = KIND_FILL[n.kind] ?? "#94a3b8";
          const baseR = KIND_RADIUS[n.kind] ?? 3.6;
          // Scale radius proportionally to the bounding box so dense
          // sessions don't render as overlapping blobs.
          const r = (Math.max(w, h) * baseR) / 360;
          return (
            <circle
              key={n.id}
              cx={n.x}
              cy={n.y}
              r={r}
              fill={fill}
              fillOpacity={n.kind === "user" ? 0.55 : 0.9}
              stroke="rgba(255,255,255,0.85)"
              strokeWidth={r * 0.22}
            />
          );
        })}
      </g>
    </svg>
  );
}

function EmptyThumbnail({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        ...style,
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.10) 1px, transparent 0)",
        backgroundSize: "14px 14px",
      }}
      aria-hidden
    />
  );
}
