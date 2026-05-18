"use client";

// ── SynergyClusterOverlay (Wave 3.2) ──────────────────────────────
//
// The visual layer for the brainstorm-speedrun converge result. When
// the converge round (Wave 2) lands a `ranking`-kind node carrying a
// JSON cluster payload, this overlay reads it via useConvergeResult
// and draws soft rounded-rect boundaries around each cluster's
// member nodes — making the grouping legible at a glance.
//
// Per-cluster visual treatment:
//   • Recommended cluster: emerald tint + soft green glow + bold
//     border, "Recommended" pill at top
//   • Deferred (non-recommended) clusters: muted gray tint,
//     thin border, plain name label
//
// Renders INSIDE the whiteboard's transformed canvas container so
// boundaries scale + pan with nodes. Uses SVG so the rounded-rect
// + drop-shadow render cleanly at any zoom level. Sits BEHIND nodes
// (lower z-index) so node text stays unobscured.
//
// Padding: each cluster bbox is expanded by CLUSTER_PADDING px on all
// sides so the boundary doesn't crowd the nodes. Cluster name label
// floats just above the top edge.
//
// Pure render — no state, no events. Parent passes the result.

import type { ConvergeResult } from "@/hooks/synergy/use-converge-result";

const CLUSTER_PADDING = 36; // px on each side of the member bbox
const CLUSTER_CORNER_RADIUS = 28;
const LABEL_OFFSET = 24; // px above the cluster top edge

export function SynergyClusterOverlay({
  result,
}: {
  result: ConvergeResult;
}) {
  // The transformed canvas container is sized 0×0 with
  // `overflow: visible`; the SVG inherits and we draw at canvas
  // coordinates that may be negative or far positive. width/height
  // of 1 with `overflow: visible` is the same trick the folder
  // regions SVG uses (synergy-whiteboard.tsx ~line 1909).
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute"
      style={{ overflow: "visible", left: 0, top: 0 }}
      width={1}
      height={1}
    >
      {result.clusterBboxes.map(({ cluster, bbox }, idx) => {
        if (!bbox) return null;
        const isRec = cluster.recommended;
        const x = bbox.minX - CLUSTER_PADDING;
        const y = bbox.minY - CLUSTER_PADDING;
        const w = bbox.maxX - bbox.minX + CLUSTER_PADDING * 2;
        const h = bbox.maxY - bbox.minY + CLUSTER_PADDING * 2;

        // Colors per state. Emerald for the recommended cluster, soft
        // neutral for deferred clusters. Stroke alpha is higher than
        // fill so the boundary reads even when the fill is faint.
        const fill = isRec
          ? "rgba(16, 185, 129, 0.06)" // emerald-500 @ 6%
          : "rgba(15, 23, 42, 0.025)"; // slate-900 @ 2.5%
        const stroke = isRec
          ? "rgba(16, 185, 129, 0.45)"
          : "rgba(15, 23, 42, 0.10)";
        const strokeWidth = isRec ? 2 : 1;
        const strokeDasharray = isRec ? undefined : "6 4"; // recommended = solid, deferred = dashed

        return (
          <g key={`cluster-${idx}-${cluster.name}`}>
            {/* Boundary rect */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={CLUSTER_CORNER_RADIUS}
              ry={CLUSTER_CORNER_RADIUS}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={strokeDasharray}
              style={
                isRec
                  ? {
                      // Soft emerald glow for recommended; pure stroke
                      // for deferred. filter applies in canvas-coord
                      // space which means it scales with zoom — fine
                      // here, the glow stays proportional.
                      filter:
                        "drop-shadow(0 0 16px rgba(16, 185, 129, 0.25))",
                    }
                  : undefined
              }
            />

            {/* Cluster name label — small mono-caps pill floating just
                above the top edge. Recommended gets an emerald accent
                + "Recommended" badge; deferred gets a plain gray pill. */}
            <foreignObject
              x={x}
              y={y - LABEL_OFFSET}
              width={w}
              height={LABEL_OFFSET + 4}
              style={{ overflow: "visible" }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "rgba(255, 255, 255, 0.92)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                  boxShadow:
                    "0 1px 2px rgba(15, 23, 42, 0.06), 0 0 0 1px rgba(15, 23, 42, 0.04)",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 10,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: isRec ? "#047857" : "#475569", // emerald-700 | slate-600
                  whiteSpace: "nowrap",
                }}
              >
                {isRec && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: "rgba(16, 185, 129, 0.12)",
                      color: "#047857",
                      fontSize: 9,
                      letterSpacing: "0.18em",
                    }}
                  >
                    ★ Recommended
                  </span>
                )}
                <span style={{ color: isRec ? "#0f172a" : "#475569" }}>
                  {cluster.name}
                </span>
                {/* Effort + scores as discreet pills on the right */}
                <span
                  style={{
                    color: "#94a3b8",
                    fontSize: 9,
                    letterSpacing: "0.12em",
                  }}
                >
                  · {cluster.effort.toUpperCase()} · I {cluster.impact}/10
                  · N {cluster.novelty}/10
                </span>
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
}
