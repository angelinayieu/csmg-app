"use client";

// ── TwinHealthSparkline ──────────────────────────────────────────────
//
// Tiny inline time-series of the twin's health_score over the project's
// lifetime. Reads from /api/spaces/[id]/snapshots/history which projects
// just (captured_at, health_score) so the response stays small.
//
// Compositional intent: drop into TwinChip / MainObjectiveBanner / any
// strip where you'd otherwise see a single number. Renders nothing
// when there's only ≤1 snapshot — avoids a misleading flat line.

import { useEffect, useMemo, useState } from "react";

interface HistoryPoint {
  captured_at: string;
  health_score: number;
  health_label: string | null;
  reason: string;
}

interface Props {
  spaceId: string;
  /** Width × height in px. Default sized for a banner inline. */
  width?: number;
  height?: number;
  /** When true, renders the latest score number on the right. */
  showLatest?: boolean;
  /** Callback when the user hovers a point — useful for syncing with
   *  another visualization in the same panel. */
  onHoverPoint?: (point: HistoryPoint | null) => void;
}

const HEALTH_COLOR = (score: number): string => {
  if (score >= 85) return "#30D158";
  if (score >= 70) return "#0A84FF";
  if (score >= 50) return "#FF9F0A";
  return "#FF453A";
};

export function TwinHealthSparkline({
  spaceId,
  width = 140,
  height = 40,
  showLatest = true,
  onHoverPoint,
}: Props) {
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/snapshots/history?limit=200`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { points?: HistoryPoint[] };
        if (!cancelled) setPoints(json.points ?? []);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const { path, dots, latest, min, max, color } = useMemo(() => {
    if (!points || points.length === 0)
      return { path: "", dots: [], latest: null, min: 0, max: 100, color: "#86868B" };
    const scores = points.map((p) => p.health_score);
    const mn = Math.max(0, Math.floor(Math.min(...scores) - 5));
    const mx = Math.min(100, Math.ceil(Math.max(...scores) + 5));
    const range = Math.max(1, mx - mn);
    const padX = 2;
    const padY = 4;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    const xAt = (i: number) =>
      padX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const yAt = (s: number) => padY + ((mx - s) / range) * innerH;
    const segs = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(p.health_score)}`);
    const dotsArr = points.map((p, i) => ({
      cx: xAt(i),
      cy: yAt(p.health_score),
      score: p.health_score,
      capturedAt: p.captured_at,
      reason: p.reason,
    }));
    const latestPoint = points[points.length - 1];
    return {
      path: segs.join(" "),
      dots: dotsArr,
      latest: latestPoint,
      min: mn,
      max: mx,
      color: HEALTH_COLOR(latestPoint.health_score),
    };
  }, [points, width, height]);

  // ≤1 point: don't render — a flat line/single dot is more confusing
  // than nothing at all.
  if (!points || points.length < 2) return null;

  return (
    <div className="inline-flex items-center gap-2" aria-label="Twin health history">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
      >
        {/* Mid-line reference (50 / range) */}
        {min < 50 && max > 50 ? (
          <line
            x1={2}
            x2={width - 2}
            y1={4 + ((max - 50) / (max - min)) * (height - 8)}
            y2={4 + ((max - 50) / (max - min)) * (height - 8)}
            stroke="rgba(0,0,0,0.06)"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        ) : null}

        {/* Trace */}
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Endpoint dot */}
        {dots.length > 0 ? (
          <circle
            cx={dots[dots.length - 1].cx}
            cy={dots[dots.length - 1].cy}
            r={2.5}
            fill={color}
            stroke="white"
            strokeWidth={1}
          />
        ) : null}

        {/* Hover targets — invisible larger dots so tooltips work */}
        {dots.map((d, i) => (
          <g
            key={i}
            onMouseEnter={() => onHoverPoint?.(points[i])}
            onMouseLeave={() => onHoverPoint?.(null)}
          >
            <title>
              {`Health ${Math.round(d.score)} · ${new Date(d.capturedAt).toLocaleString()} · ${d.reason}`}
            </title>
            <circle cx={d.cx} cy={d.cy} r={4} fill="transparent" />
          </g>
        ))}
      </svg>
      {showLatest && latest ? (
        <span
          className="text-[11px] font-mono font-semibold tabular-nums"
          style={{ color }}
          title={`${points.length} snapshots from ${new Date(points[0].captured_at).toLocaleDateString()} → ${new Date(latest.captured_at).toLocaleDateString()}`}
        >
          {Math.round(latest.health_score)}
        </span>
      ) : null}
    </div>
  );
}
