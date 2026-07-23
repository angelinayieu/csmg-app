"use client";

// ── UncertaintyMap ───────────────────────────────────────────────────
//
// The auto-detected replacement for the ten-zone ambiguity heatmap (#17).
// Draws the space's own graph, coloured by heat = centrality × residual
// uncertainty. Nothing is a named category: a region is hot because it is
// load-bearing AND unresolved, and the hottest nodes are what become open
// questions.
//
// Layout is a deterministic radial placement, not a physics sim — the same
// graph always draws the same way, so a user's spatial memory survives a
// refresh and the component stays cheap (no animation loop).
//
// Heat colour mixes the existing --av-stage-pain against --av-text-faint, so
// the ramp is the design system's own two tokens rather than a new palette.

import { useMemo } from "react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { HotSpot, UncertaintyGraph } from "@/lib/uncertainty/hot-spots";

const VIEW_W = 560;
const VIEW_H = 360;

/** Nodes are laid out in concentric rings, hottest at the centre — the map
 *  reads inside-out, which matches how a user should read it. */
function layout(nodes: HotSpot[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return pos;

  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  pos.set(nodes[0].entityId, { x: cx, y: cy });

  const rest = nodes.slice(1);
  // Ring sizes grow outward: 6, 12, 18… Keeps density even.
  let i = 0;
  let ring = 1;
  while (i < rest.length) {
    const capacity = ring * 6;
    const count = Math.min(capacity, rest.length - i);
    const radius = ring * Math.min(VIEW_W, VIEW_H) * 0.17;
    for (let k = 0; k < count; k++) {
      // Offset every other ring so nodes don't line up spoke-on-spoke.
      const angle = (k / count) * Math.PI * 2 + (ring % 2 ? 0 : Math.PI / count);
      pos.set(rest[i + k].entityId, {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    }
    i += count;
    ring += 1;
  }
  return pos;
}

/** Heat 0..1 → a colour on the system's own cool→hot ramp. */
function heatColor(heat: number, max: number): string {
  const norm = max > 0 ? Math.max(0, Math.min(1, heat / max)) : 0;
  const pct = Math.round(norm * 100);
  return `color-mix(in srgb, var(--av-stage-pain) ${pct}%, var(--av-text-faint))`;
}

export function UncertaintyMap({
  graph,
  hotSpotIds,
  allEstimated,
  onSelect,
  selectedId,
}: {
  graph: UncertaintyGraph;
  /** Entity ids that became questions — these get a halo. */
  hotSpotIds: string[];
  allEstimated: boolean;
  onSelect?: (entityId: string) => void;
  selectedId?: string | null;
}) {
  const pos = useMemo(() => layout(graph.nodes), [graph.nodes]);
  const maxHeat = useMemo(
    () => graph.nodes.reduce((m, n) => Math.max(m, n.heat), 0),
    [graph.nodes],
  );
  const hot = useMemo(() => new Set(hotSpotIds), [hotSpotIds]);

  if (graph.nodes.length === 0) {
    return (
      <div style={empty}>
        Nothing mapped yet. The uncertainty map appears once this space has a
        graph to read.
      </div>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <div style={legendRow}>
        <span style={legendLabel}>
          Hot spots are what the graph found — important and unresolved
        </span>
        <span style={legendScale}>
          cool
          <span style={legendBar} />
          hot
        </span>
      </div>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label={`Uncertainty map: ${graph.nodes.length} concepts, ${hot.size} hot spots`}
      >
        {graph.links.map((l, i) => {
          const a = pos.get(l.source);
          const b = pos.get(l.target);
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={appleVibe.stroke.medium}
              strokeWidth={1}
            />
          );
        })}

        {graph.nodes.map((n) => {
          const p = pos.get(n.entityId);
          if (!p) return null;
          const r = 7 + n.centrality * 9;
          const isHot = hot.has(n.entityId);
          const isSel = selectedId === n.entityId;
          const fill = heatColor(n.heat, maxHeat);
          return (
            <g
              key={n.entityId}
              onClick={() => onSelect?.(n.entityId)}
              style={{ cursor: onSelect ? "pointer" : "default" }}
            >
              <title>
                {`${n.label} — ${Math.round(n.heat * 100)}% hot` +
                  (n.estimated ? " (uncertainty estimated)" : "")}
              </title>
              {isHot && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + 9}
                  fill={fill}
                  opacity={0.3}
                  className="uncertainty-halo"
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={fill}
                stroke={isSel ? appleVibe.accent.primary : "var(--av-surface-base)"}
                strokeWidth={isSel ? 2.5 : 2}
                // Dashed rim = uncertainty is a default, not a measurement.
                strokeDasharray={n.estimated ? "3 2" : undefined}
              />
              {isHot && (
                <text
                  x={p.x}
                  y={p.y - r - 6}
                  textAnchor="middle"
                  style={nodeLabel}
                >
                  {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {allEstimated && (
        <div style={estimateNote}>
          No signatures materialized for this space yet, so every uncertainty
          here is an assumption rather than a reading. Hot spots will re-rank
          once signatures land.
        </div>
      )}

      <style>{`
        @keyframes uncertainty-pulse{0%,100%{opacity:.28}50%{opacity:.52}}
        .uncertainty-halo{animation:uncertainty-pulse 2.4s ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){.uncertainty-halo{animation:none}}
      `}</style>
    </div>
  );
}

// ── styles ──
const legendRow: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  marginBottom: 6,
};
const legendLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: appleVibe.text.tertiary,
  letterSpacing: "-0.005em",
};
const legendScale: React.CSSProperties = {
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
  gap: 5,
  fontSize: 10.5,
  color: appleVibe.text.faint,
};
const legendBar: React.CSSProperties = {
  width: 48,
  height: 6,
  borderRadius: appleVibe.radius.pill,
  background:
    "linear-gradient(90deg, var(--av-text-faint), color-mix(in srgb, var(--av-stage-pain) 55%, var(--av-text-faint)), var(--av-stage-pain))",
};
const nodeLabel: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  fill: appleVibe.text.secondary,
  pointerEvents: "none",
  letterSpacing: "-0.01em",
};
const empty: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: appleVibe.text.tertiary,
  padding: "18px 4px",
};
const estimateNote: React.CSSProperties = {
  marginTop: 10,
  padding: "9px 12px",
  borderRadius: 9,
  borderLeft: `2.5px solid ${appleVibe.stroke.medium}`,
  background: appleVibe.surface.chip,
  fontSize: 11.5,
  lineHeight: 1.55,
  color: appleVibe.text.secondary,
};
