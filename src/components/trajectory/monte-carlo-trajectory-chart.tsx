"use client";

// ── MonteCarloTrajectoryChart ────────────────────────────────────────
//
// SVG line chart for the Phase 4 Monte Carlo `WeeklyTrajectoryEntry[]`
// shape: per-week per-node distribution {p10, p50, p90, mean, stddev}.
// Renders one line per node with its p10/p90 confidence band and a
// p50 trace; the target node is emphasized.
//
// Visual language matches FlightTrajectoryChart (faint gridlines, soft
// confidence ribbons, Apple-system palette) so the two charts feel
// like the same product across surfaces.
//
// Distinct from FlightTrajectoryChart: that one renders edge-level
// onset/peak/persistence ramps (one curve per edge in days). This one
// renders the actual MC outcome trajectory (one line per node in
// weeks). They're complements, not alternatives.

import { useMemo, useState } from "react";

interface NodeWeekly {
  nodeId: string;
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  stddev: number;
}

export interface WeeklyEntry {
  week: number;
  nodes: NodeWeekly[];
}

export interface MonteCarloTrajectoryChartProps {
  trajectory: WeeklyEntry[];
  /** Display id of the primary metric. Rendered with full opacity +
   *  thicker stroke + endpoint label. Other nodes render dimmed. */
  targetNodeId: string;
  /** Optional: id → display name overrides. When absent, nodeId is shown. */
  nodeNames?: Record<string, string>;
  /** Maximum number of nodes to render lines for. Excess hidden via
   *  legend toggle. Default 4 — protects the chart from getting noisy
   *  on large subgraphs. */
  maxNodes?: number;
  /** Optional intervention onset week marker (1-indexed) */
  interventionWeek?: number | null;
  /** Optional label drawn above the intervention marker. */
  interventionLabel?: string | null;
  /**
   * Counterfactual baseline trajectory — same subgraph + same seed but
   * NO perturbation. When supplied, the target node is rendered as a
   * pair: dashed light line for baseline (with a faint band) plus the
   * solid full-opacity variant line. Lets the user see "did the
   * intervention matter?" at a glance instead of having to mentally
   * subtract two numbers.
   *
   * Other nodes are NOT overlaid — only the target gets the A/B
   * treatment to keep the chart legible. If a caller wants per-node
   * baseline overlays they can use `targetNodeId` to switch.
   */
  baselineTrajectory?: WeeklyEntry[] | null;
  width?: number;
  height?: number;
}

const PALETTE = [
  "#0A84FF", // primary — target
  "#FF453A",
  "#30D158",
  "#FF9F0A",
  "#5E5CE6",
  "#AF52DE",
  "#06B6D4",
  "#FF2D55",
];

export function MonteCarloTrajectoryChart({
  trajectory,
  targetNodeId,
  nodeNames,
  maxNodes = 4,
  interventionWeek,
  interventionLabel,
  baselineTrajectory,
  width = 720,
  height = 320,
}: MonteCarloTrajectoryChartProps) {
  // ── Empty state ─────────────────────────────────────────────────
  if (!trajectory || trajectory.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-black/10 bg-white/40 p-8 text-[12px] text-[color:var(--muted-fg,#86868b)]"
        style={{ minHeight: height }}
      >
        No trajectory data — run a projection to populate this chart.
      </div>
    );
  }

  // ── Pick which node ids to render ──────────────────────────────
  const allNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const entry of trajectory) {
      for (const n of entry.nodes) set.add(n.nodeId);
    }
    return Array.from(set);
  }, [trajectory]);

  // Always include the target. Then take the next N nodes with the
  // highest variance (p90 - p10) at the final week — those are the
  // most informative to plot.
  const displayedNodeIds = useMemo(() => {
    if (allNodeIds.length === 0) return [];
    const finalWeek = trajectory[trajectory.length - 1];
    const variance = new Map<string, number>();
    for (const n of finalWeek.nodes) {
      variance.set(n.nodeId, n.p90 - n.p10);
    }
    const others = allNodeIds
      .filter((id) => id !== targetNodeId)
      .sort((a, b) => (variance.get(b) ?? 0) - (variance.get(a) ?? 0));
    const ordered = [
      ...(allNodeIds.includes(targetNodeId) ? [targetNodeId] : []),
      ...others,
    ];
    return ordered.slice(0, Math.max(1, maxNodes));
  }, [allNodeIds, trajectory, targetNodeId, maxNodes]);

  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set());

  // Pre-extract the target node's baseline series so the y-scale
  // computation accounts for it (otherwise the dashed baseline line
  // can fall outside the plot when the variant pulls the band away).
  const baselineTargetPoints = useMemo(() => {
    if (!baselineTrajectory || baselineTrajectory.length === 0) return null;
    return baselineTrajectory.map((entry) => {
      const n = entry.nodes.find((nn) => nn.nodeId === targetNodeId);
      return n
        ? { week: entry.week, p10: n.p10, p50: n.p50, p90: n.p90 }
        : { week: entry.week, p10: 0, p50: 0, p90: 0 };
    });
  }, [baselineTrajectory, targetNodeId]);

  // ── Compute scale ───────────────────────────────────────────────
  const { yMin, yMax } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const entry of trajectory) {
      for (const n of entry.nodes) {
        if (!displayedNodeIds.includes(n.nodeId)) continue;
        if (hiddenNodes.has(n.nodeId)) continue;
        if (n.p10 < lo) lo = n.p10;
        if (n.p90 > hi) hi = n.p90;
      }
    }
    // Include baseline target band in the scale so the dashed line
    // doesn't get clipped at the top/bottom of the plot.
    if (baselineTargetPoints) {
      for (const p of baselineTargetPoints) {
        if (p.p10 < lo) lo = p.p10;
        if (p.p90 > hi) hi = p.p90;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { yMin: 0, yMax: 1 };
    if (hi - lo < 0.05) {
      const mid = (hi + lo) / 2;
      lo = mid - 0.5;
      hi = mid + 0.5;
    }
    const padding = (hi - lo) * 0.08;
    return { yMin: lo - padding, yMax: hi + padding };
  }, [trajectory, displayedNodeIds, hiddenNodes, baselineTargetPoints]);

  const horizonWeeks = trajectory[trajectory.length - 1].week;

  const padX = 56;
  const padY = 28;
  const innerW = width - padX - 16;
  const innerH = height - padY * 2;
  const xAt = (week: number) =>
    padX + ((week - 1) / Math.max(1, horizonWeeks - 1)) * innerW;
  const yAt = (v: number) =>
    padY + ((yMax - v) / Math.max(1e-9, yMax - yMin)) * innerH;

  // ── Build per-node series for cheap iteration ───────────────────
  type Series = {
    nodeId: string;
    color: string;
    isTarget: boolean;
    points: Array<{ week: number; p10: number; p50: number; p90: number }>;
  };

  const series: Series[] = useMemo(() => {
    return displayedNodeIds.map((nodeId, i) => {
      const points = trajectory.map((entry) => {
        const n = entry.nodes.find((nn) => nn.nodeId === nodeId);
        return n
          ? { week: entry.week, p10: n.p10, p50: n.p50, p90: n.p90 }
          : { week: entry.week, p10: 0, p50: 0, p90: 0 };
      });
      return {
        nodeId,
        color: nodeId === targetNodeId ? PALETTE[0] : PALETTE[(i + 1) % PALETTE.length],
        isTarget: nodeId === targetNodeId,
        points,
      };
    });
  }, [displayedNodeIds, trajectory, targetNodeId]);

  const yTicks = useMemo(() => {
    const ticks = 4;
    const step = (yMax - yMin) / ticks;
    return Array.from({ length: ticks + 1 }, (_, i) => yMin + i * step);
  }, [yMin, yMax]);

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Monte Carlo trajectory chart"
      >
        {/* Y axis tick lines + labels */}
        {yTicks.map((tick, i) => (
          <g key={`tick-${i}`}>
            <line
              x1={padX}
              x2={width - 16}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke="rgba(0,0,0,0.06)"
              strokeWidth={1}
              strokeDasharray={i === 0 || i === yTicks.length - 1 ? undefined : "2 4"}
            />
            <text
              x={padX - 8}
              y={yAt(tick) + 3}
              fontSize="9"
              fontFamily="ui-monospace, monospace"
              fill="rgba(0,0,0,0.45)"
              textAnchor="end"
            >
              {formatTick(tick)}
            </text>
          </g>
        ))}

        {/* X axis tick labels (weeks) */}
        {Array.from(
          { length: Math.min(6, horizonWeeks) },
          (_, i) => Math.round(((i + 1) / 6) * horizonWeeks),
        )
          .filter((w, idx, arr) => arr.indexOf(w) === idx)
          .map((week) => (
            <text
              key={`x-${week}`}
              x={xAt(week)}
              y={height - 8}
              fontSize="9"
              fontFamily="ui-monospace, monospace"
              fill="rgba(0,0,0,0.45)"
              textAnchor="middle"
            >
              w{week}
            </text>
          ))}

        {/* X axis title */}
        <text
          x={padX}
          y={height - 8}
          fontSize="9"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fill="rgba(0,0,0,0.55)"
          fontWeight={600}
          letterSpacing="0.06em"
          style={{ textTransform: "uppercase" }}
        >
          Week
        </text>

        {/* Intervention marker */}
        {interventionWeek != null &&
        interventionWeek >= 1 &&
        interventionWeek <= horizonWeeks ? (
          <g>
            <line
              x1={xAt(interventionWeek)}
              x2={xAt(interventionWeek)}
              y1={padY}
              y2={padY + innerH}
              stroke="rgba(0,0,0,0.30)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <rect
              x={xAt(interventionWeek) - 30}
              y={padY - 4}
              width="60"
              height="14"
              rx="3"
              fill="rgba(255,159,10,0.95)"
            />
            <text
              x={xAt(interventionWeek)}
              y={padY + 6}
              fontSize="9"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fill="white"
              fontWeight={600}
              textAnchor="middle"
            >
              {interventionLabel ?? `intervention w${interventionWeek}`}
            </text>
          </g>
        ) : null}

        {/* Baseline target band (faint) — renders FIRST so variant
            stacks on top. Hidden when no baseline supplied. */}
        {baselineTargetPoints && !hiddenNodes.has(targetNodeId)
          ? (() => {
              const upper = baselineTargetPoints.map(
                (p) => `${xAt(p.week)},${yAt(p.p90)}`,
              );
              const lower = baselineTargetPoints
                .slice()
                .reverse()
                .map((p) => `${xAt(p.week)},${yAt(p.p10)}`);
              const bandPath = [...upper, ...lower].join(" ");
              return (
                <polygon
                  points={bandPath}
                  fill="#86868B"
                  fillOpacity={0.10}
                  stroke="none"
                />
              );
            })()
          : null}

        {/* Bands (rendered first so lines stack on top) */}
        {series
          .filter((s) => !hiddenNodes.has(s.nodeId))
          .map((s) => {
            const upper = s.points.map((p) => `${xAt(p.week)},${yAt(p.p90)}`);
            const lower = s.points
              .slice()
              .reverse()
              .map((p) => `${xAt(p.week)},${yAt(p.p10)}`);
            const bandPath = [...upper, ...lower].join(" ");
            return (
              <polygon
                key={`band-${s.nodeId}`}
                points={bandPath}
                fill={s.color}
                fillOpacity={s.isTarget ? 0.18 : 0.08}
                stroke="none"
              />
            );
          })}

        {/* Baseline target median (dashed gray) — drawn UNDER the
            variant median so the variant pops. */}
        {baselineTargetPoints && !hiddenNodes.has(targetNodeId)
          ? (() => {
              const d = baselineTargetPoints
                .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(p.week)} ${yAt(p.p50)}`)
                .join(" ");
              return (
                <path
                  d={d}
                  fill="none"
                  stroke="#86868B"
                  strokeWidth={1.4}
                  strokeOpacity={0.7}
                  strokeDasharray="4 3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <title>Baseline (no intervention)</title>
                </path>
              );
            })()
          : null}

        {/* Median lines */}
        {series
          .filter((s) => !hiddenNodes.has(s.nodeId))
          .map((s) => {
            const d = s.points
              .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(p.week)} ${yAt(p.p50)}`)
              .join(" ");
            return (
              <path
                key={`line-${s.nodeId}`}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={s.isTarget ? 2.2 : 1.4}
                strokeOpacity={s.isTarget ? 1 : 0.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

        {/* Endpoint label for the target */}
        {(() => {
          const t = series.find((s) => s.isTarget);
          if (!t || hiddenNodes.has(t.nodeId)) return null;
          const last = t.points[t.points.length - 1];
          return (
            <g>
              <circle
                cx={xAt(last.week)}
                cy={yAt(last.p50)}
                r={3}
                fill={t.color}
                stroke="white"
                strokeWidth={1}
              />
              <rect
                x={xAt(last.week) + 6}
                y={yAt(last.p50) - 9}
                width="58"
                height="18"
                rx="4"
                fill="white"
                stroke={t.color}
                strokeWidth={1}
                fillOpacity={0.95}
              />
              <text
                x={xAt(last.week) + 35}
                y={yAt(last.p50) + 3.5}
                fontSize="10"
                fontFamily="ui-monospace, monospace"
                fill={t.color}
                textAnchor="middle"
                fontWeight={600}
              >
                {formatTick(last.p50)}
              </text>
            </g>
          );
        })()}
      </svg>

      {/* Legend */}
      {series.length > 1 || baselineTargetPoints ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-[11px]">
          {series.map((s) => {
            const hidden = hiddenNodes.has(s.nodeId);
            return (
              <button
                key={s.nodeId}
                type="button"
                onClick={() => {
                  setHiddenNodes((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.nodeId)) next.delete(s.nodeId);
                    else next.add(s.nodeId);
                    return next;
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 transition-opacity hover:bg-black/[0.04]"
                style={{ opacity: hidden ? 0.4 : 1 }}
                title={hidden ? "Click to show" : "Click to hide"}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: s.color,
                    boxShadow: s.isTarget ? `0 0 4px ${s.color}80` : undefined,
                  }}
                />
                <span
                  className={s.isTarget ? "font-semibold" : ""}
                  style={{ color: "var(--fg, #1d1d1f)" }}
                >
                  {nodeNames?.[s.nodeId] ?? s.nodeId}
                </span>
              </button>
            );
          })}
          {baselineTargetPoints ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5"
              style={{ color: "var(--muted-fg, #6b7280)" }}
              title="Counterfactual: same subgraph + same seed, no perturbation applied"
            >
              <svg width="14" height="6" viewBox="0 0 14 6" aria-hidden>
                <line
                  x1="0"
                  x2="14"
                  y1="3"
                  y2="3"
                  stroke="#86868B"
                  strokeWidth="1.4"
                  strokeDasharray="4 3"
                  strokeLinecap="round"
                />
              </svg>
              <span>Baseline (no intervention)</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function formatTick(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
