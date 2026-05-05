"use client";

// ── TwinTrajectorySparkline ──────────────────────────────────────────
//
// Compact inline sparkline of the most recent trajectory_run's
// target node — designed to drop into TwinAnalyticsStrip / a dashboard
// card / any place that already shows scalar twin state. Tells the
// user "your most recent forward projection looks like this" without
// requiring them to scroll to the trajectory panel.
//
// Distinct from TwinHealthSparkline: that one shows historical
// health_score across snapshots (backward-looking). This one shows
// the projected target metric across weeks (forward-looking, with
// its p10/p90 confidence band).
//
// Data source: GET /api/predictions?space_id=X&kind=trajectory&limit=1
// — the existing predictions route ordered by predicted_at desc, so
// we naturally get the latest run. Self-hides when no trajectory_run
// exists yet.

import { useEffect, useMemo, useState } from "react";

interface NodeWeekly {
  nodeId: string;
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  stddev: number;
}

interface WeeklyEntry {
  week: number;
  nodes: NodeWeekly[];
}

interface PredictionRow {
  id: string;
  prediction_kind: string;
  status: string;
  metric_label: string;
  metric_unit: string | null;
  predicted_at: string;
  horizon_at: string;
  target_entity_id: string | null;
  predicted_value: number | null;
  predicted_trajectory: WeeklyEntry[] | null;
  confidence: number | null;
}

interface Props {
  spaceId: string;
  /** Width / height in px. Default tuned for an inline strip placement. */
  width?: number;
  height?: number;
  /** When true, render the metric label + p50 readout next to the chart. */
  showLabel?: boolean;
  /** Optional click handler — usually routes to the trajectory panel. */
  onOpen?: () => void;
}

export function TwinTrajectorySparkline({
  spaceId,
  width = 160,
  height = 44,
  showLabel = true,
  onOpen,
}: Props) {
  const [row, setRow] = useState<PredictionRow | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    (async () => {
      try {
        // Pull the most recent open trajectory prediction.
        const res = await fetch(
          `/api/predictions?space_id=${encodeURIComponent(spaceId)}&kind=trajectory&status=open&limit=1`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const json = (await res.json()) as { rows?: PredictionRow[] };
        if (cancelled) return;
        setRow(json.rows && json.rows.length > 0 ? json.rows[0] : null);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // Pull the target node's per-week series. The route persisted the
  // entire WeeklyTrajectoryEntry[] (all nodes, all weeks); we just
  // need one node. target_entity_id is a display id ("C5") but the
  // stored trajectory's nodeId is the entity UUID — they were resolved
  // server-side at write time so the resolver here matches against
  // whichever node id appears in the trajectory.
  const targetSeries = useMemo(() => {
    if (!row?.predicted_trajectory || row.predicted_trajectory.length === 0) {
      return null;
    }
    const traj = row.predicted_trajectory;
    // Identify which nodeId carries the target. Prefer target_entity_id
    // when it matches a nodeId in the first week; otherwise fall back to
    // the node with the highest mean magnitude (usually the metric at
    // the bottom of the cascade).
    const firstWeek = traj[0];
    let targetNodeId: string | null = null;
    if (row.target_entity_id) {
      const match = firstWeek.nodes.find((n) => n.nodeId === row.target_entity_id);
      if (match) targetNodeId = match.nodeId;
    }
    if (!targetNodeId) {
      // Fallback: pick the node with the highest |mean| at the final week.
      const last = traj[traj.length - 1];
      let best = last.nodes[0]?.nodeId ?? null;
      let bestAbs = Math.abs(last.nodes[0]?.mean ?? 0);
      for (const n of last.nodes.slice(1)) {
        if (Math.abs(n.mean) > bestAbs) {
          bestAbs = Math.abs(n.mean);
          best = n.nodeId;
        }
      }
      targetNodeId = best;
    }
    if (!targetNodeId) return null;

    return traj.map((entry) => {
      const n = entry.nodes.find((nn) => nn.nodeId === targetNodeId);
      return n
        ? { week: entry.week, p10: n.p10, p50: n.p50, p90: n.p90 }
        : { week: entry.week, p10: 0, p50: 0, p90: 0 };
    });
  }, [row]);

  // Only render once we know whether data exists.
  if (!loaded) return null;
  if (!row || !targetSeries || targetSeries.length < 2) return null;

  // ── Compute scale ─────────────────────────────────────────────
  const lo = Math.min(...targetSeries.map((p) => p.p10));
  const hi = Math.max(...targetSeries.map((p) => p.p90));
  const range = Math.max(0.05, hi - lo);
  const padX = 2;
  const padY = 4;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const xAt = (i: number) =>
    padX + (i / Math.max(1, targetSeries.length - 1)) * innerW;
  const yAt = (v: number) =>
    padY + ((hi - v) / range) * innerH;

  const lineColor = "#0A84FF";

  // p50 line
  const linePath = targetSeries
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(p.p50)}`)
    .join(" ");

  // p10/p90 band polygon
  const bandUpper = targetSeries.map((p, i) => `${xAt(i)},${yAt(p.p90)}`);
  const bandLower = targetSeries
    .slice()
    .reverse()
    .map((p, i) => {
      const idx = targetSeries.length - 1 - i;
      return `${xAt(idx)},${yAt(p.p10)}`;
    });
  const bandPath = [...bandUpper, ...bandLower].join(" ");

  const finalP50 = targetSeries[targetSeries.length - 1].p50;
  const horizonWeeks = targetSeries[targetSeries.length - 1].week;

  const Tag = onOpen ? "button" : "div";

  return (
    <Tag
      type={onOpen ? "button" : undefined}
      onClick={onOpen}
      className={`inline-flex items-center gap-2 ${
        onOpen ? "cursor-pointer rounded-md transition-opacity hover:opacity-80" : ""
      }`}
      title={[
        `Latest trajectory · ${row.metric_label}`,
        `Horizon: ${horizonWeeks} week${horizonWeeks === 1 ? "" : "s"}`,
        `p50 at horizon: ${finalP50.toFixed(2)}${row.metric_unit ? ` ${row.metric_unit}` : ""}`,
        `Confidence: ${row.confidence != null ? `${Math.round(row.confidence * 100)}%` : "—"}`,
        `Predicted ${new Date(row.predicted_at).toLocaleString()}`,
      ].join("\n")}
      aria-label={`Trajectory sparkline for ${row.metric_label}`}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
      >
        {/* Mid-line reference (the value at week 1) */}
        <line
          x1={padX}
          x2={width - padX}
          y1={yAt(targetSeries[0].p50)}
          y2={yAt(targetSeries[0].p50)}
          stroke="rgba(0,0,0,0.06)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />

        {/* Confidence band */}
        <polygon points={bandPath} fill={lineColor} fillOpacity={0.14} stroke="none" />

        {/* p50 trace */}
        <path
          d={linePath}
          fill="none"
          stroke={lineColor}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Endpoint dot */}
        <circle
          cx={xAt(targetSeries.length - 1)}
          cy={yAt(finalP50)}
          r={2.5}
          fill={lineColor}
          stroke="white"
          strokeWidth={1}
        />
      </svg>
      {showLabel ? (
        <div className="flex flex-col items-start leading-tight">
          <span
            className="font-mono text-[11px] font-semibold tabular-nums"
            style={{ color: lineColor }}
          >
            {formatVal(finalP50)}
          </span>
          <span className="truncate text-[9.5px] text-[color:var(--muted-fg,#86868b)]">
            {row.metric_label}
          </span>
        </div>
      ) : null}
    </Tag>
  );
}

function formatVal(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
