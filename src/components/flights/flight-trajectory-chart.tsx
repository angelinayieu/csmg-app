// ── FlightTrajectoryChart (Phase 6) ───────────────────────────────
//
// Pure-SVG trajectory chart for a flight: per-step ramp/peak/persist
// curves overlaid on a shared wall-clock x-axis (days). Mirrors the
// user's first reference image's multi-line metrics chart with event
// lane below.
//
// INPUT
//
//   - edges[]: hydrated edges with Phase 3 pooled timing
//     (onset_days_p50/p10/p90, peak_days_p50/p10/p90,
//     persistence_days_p50, decay_kinetics_modal). Each edge becomes
//     one curve.
//   - phases[]: optional phase boundaries from flight.phases. Drawn
//     as vertical guide lines + phase labels along the top.
//
// CURVE MODEL
//
//   For each edge, we render a ramp using temporalRampFactor — the
//   same function the time-aware Monte Carlo (Phase 4) uses to
//   propagate effects. The y-axis is the per-edge contribution
//   factor in [0, 1]. Each edge gets its own color from a palette;
//   p10/p90 bands rendered as a translucent ribbon around p50.
//
// NO CHART LIBRARY DEPENDENCY — pure SVG keeps the bundle tight and
// the rendering fully deterministic.

"use client";

import { temporalRampFactor } from "@/lib/simulation/monte-carlo";

interface FlightChartEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  onset_days_p50: number | null;
  onset_days_p10: number | null;
  onset_days_p90: number | null;
  peak_days_p50: number | null;
  peak_days_p10: number | null;
  peak_days_p90: number | null;
  persistence_days_p50: number | null;
  decay_kinetics_modal:
    | "linear"
    | "exponential"
    | "sustained"
    | "biphasic"
    | "unknown"
    | null;
}

interface FlightChartEntity {
  id: string;
  name: string;
}

interface FlightChartPhase {
  phase: number;
  name: string;
  duration_weeks: number;
}

export interface FlightTrajectoryChartProps {
  edges: FlightChartEdge[];
  entities: FlightChartEntity[];
  phases?: FlightChartPhase[] | null;
  /** Total horizon in days; defaults to max(peak + persistence) +
   *  20% padding. */
  horizonDays?: number;
  /** Pixel width / height of the SVG. Caller can size the parent
   *  div; the SVG fills it via viewBox. */
  width?: number;
  height?: number;
}

// Apple-system palette extended for path edges (cycle when more
// edges than colors).
const EDGE_COLORS = [
  "#0071E3",
  "#34C759",
  "#FF9500",
  "#AF52DE",
  "#FF3B30",
  "#5856D6",
  "#FF2D55",
  "#06B6D4",
];

const PHASE_COLORS = [
  "rgba(0,113,227,0.10)",
  "rgba(52,199,89,0.10)",
  "rgba(255,149,0,0.10)",
  "rgba(175,82,222,0.10)",
];

export function FlightTrajectoryChart({
  edges,
  entities,
  phases,
  horizonDays,
  width = 760,
  height = 360,
}: FlightTrajectoryChartProps) {
  // ── Compute the horizon ─────────────────────────────────────────
  const inferredHorizon = computeHorizon(edges);
  const horizon = horizonDays ?? inferredHorizon;
  if (horizon <= 0) {
    return (
      <div
        style={{
          padding: 24,
          background: "rgba(0,0,0,0.02)",
          borderRadius: 12,
          color: "#86868b",
          fontSize: 13,
        }}
      >
        No temporal data on this flight&rsquo;s edges yet. Pool timing
        evidence (extract-temporal on a paper, or run deep-research with the
        temporal coverage flag) to populate this chart.
      </div>
    );
  }

  // ── Plot geometry ───────────────────────────────────────────────
  const padding = { top: 28, right: 24, bottom: 56, left: 56 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const xFromDay = (d: number) => padding.left + (d / horizon) * plotW;
  const yFromVal = (v: number) =>
    padding.top + plotH - clamp01(v) * plotH;

  // Sample 80 points across the horizon for smooth curves.
  const SAMPLE_COUNT = 80;
  const sampleDays: number[] = Array.from(
    { length: SAMPLE_COUNT + 1 },
    (_, i) => (i / SAMPLE_COUNT) * horizon,
  );

  // ── Phase backgrounds ───────────────────────────────────────────
  let cumulativeWeeks = 0;
  const phaseBands = (phases ?? []).map((p, idx) => {
    const start = cumulativeWeeks * 7;
    const end = (cumulativeWeeks + p.duration_weeks) * 7;
    cumulativeWeeks += p.duration_weeks;
    return {
      phase: p.phase,
      name: p.name,
      x0: xFromDay(start),
      x1: xFromDay(end),
      color: PHASE_COLORS[idx % PHASE_COLORS.length],
    };
  });

  // ── Per-edge curves ─────────────────────────────────────────────
  const curves = edges.map((edge, idx) => {
    const color = EDGE_COLORS[idx % EDGE_COLORS.length];
    const temporal = {
      onset_days: edge.onset_days_p50 ?? 0,
      peak_days: edge.peak_days_p50 ?? 0,
      persistence_days: edge.persistence_days_p50 ?? Infinity,
      decay_kinetics: edge.decay_kinetics_modal ?? null,
    };
    const p50Path = sampleDays
      .map((d, i) => {
        const v = temporalRampFactor(d, temporal);
        const cmd = i === 0 ? "M" : "L";
        return `${cmd}${xFromDay(d).toFixed(2)},${yFromVal(v).toFixed(2)}`;
      })
      .join(" ");

    // p10/p90 envelope from CI bounds when available — sample with
    // shifted onset/peak to approximate the band. Cheap +
    // good-enough; real CIs would be Monte Carlo.
    const tLow = {
      onset_days: edge.onset_days_p90 ?? edge.onset_days_p50 ?? 0,
      peak_days: edge.peak_days_p90 ?? edge.peak_days_p50 ?? 0,
      persistence_days: edge.persistence_days_p50 ?? Infinity,
      decay_kinetics: edge.decay_kinetics_modal ?? null,
    };
    const tHigh = {
      onset_days: edge.onset_days_p10 ?? edge.onset_days_p50 ?? 0,
      peak_days: edge.peak_days_p10 ?? edge.peak_days_p50 ?? 0,
      persistence_days: edge.persistence_days_p50 ?? Infinity,
      decay_kinetics: edge.decay_kinetics_modal ?? null,
    };
    const lowVals = sampleDays.map((d) => temporalRampFactor(d, tLow));
    const highVals = sampleDays.map((d) => temporalRampFactor(d, tHigh));
    const ribbonPath =
      sampleDays
        .map((d, i) => {
          const cmd = i === 0 ? "M" : "L";
          return `${cmd}${xFromDay(d).toFixed(2)},${yFromVal(highVals[i]).toFixed(2)}`;
        })
        .join(" ") +
      " " +
      sampleDays
        .slice()
        .reverse()
        .map((d, i) => {
          const idx2 = sampleDays.length - 1 - i;
          return `L${xFromDay(d).toFixed(2)},${yFromVal(lowVals[idx2]).toFixed(2)}`;
        })
        .join(" ") +
      " Z";

    const sourceName =
      entities.find((e) => e.id === edge.source_entity_id)?.name ?? "?";
    const targetName =
      entities.find((e) => e.id === edge.target_entity_id)?.name ?? "?";

    return {
      id: edge.id,
      label: `${sourceName} → ${targetName}`,
      color,
      p50Path,
      ribbonPath,
      onsetDay: edge.onset_days_p50,
      peakDay: edge.peak_days_p50,
    };
  });

  // ── Y-axis ticks ────────────────────────────────────────────────
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  // ── X-axis ticks: weeks at sensible intervals ────────────────
  const xTickStepDays = horizon > 180 ? 28 : horizon > 56 ? 14 : 7;
  const xTicks: number[] = [];
  for (let d = 0; d <= horizon + 0.001; d += xTickStepDays) xTicks.push(d);

  return (
    <div style={{ width: "100%" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ display: "block", maxHeight: height }}
      >
        {/* Phase background bands */}
        {phaseBands.map((b) => (
          <rect
            key={`phase-${b.phase}`}
            x={b.x0}
            y={padding.top}
            width={Math.max(0, b.x1 - b.x0)}
            height={plotH}
            fill={b.color}
          />
        ))}

        {/* Phase labels */}
        {phaseBands.map((b) => (
          <text
            key={`phase-label-${b.phase}`}
            x={(b.x0 + b.x1) / 2}
            y={padding.top - 10}
            textAnchor="middle"
            fontSize={10}
            fill="#86868b"
            fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
          >
            P{b.phase} · {b.name}
          </text>
        ))}

        {/* Y grid */}
        {yTicks.map((t) => (
          <line
            key={`yt-${t}`}
            x1={padding.left}
            x2={padding.left + plotW}
            y1={yFromVal(t)}
            y2={yFromVal(t)}
            stroke="rgba(0,0,0,0.05)"
            strokeWidth={1}
          />
        ))}
        {yTicks.map((t) => (
          <text
            key={`yl-${t}`}
            x={padding.left - 8}
            y={yFromVal(t) + 3}
            textAnchor="end"
            fontSize={9}
            fill="#86868b"
            fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
          >
            {Math.round(t * 100)}%
          </text>
        ))}

        {/* X grid + labels */}
        {xTicks.map((d) => (
          <g key={`xt-${d}`}>
            <line
              x1={xFromDay(d)}
              x2={xFromDay(d)}
              y1={padding.top}
              y2={padding.top + plotH}
              stroke="rgba(0,0,0,0.04)"
              strokeWidth={1}
            />
            <text
              x={xFromDay(d)}
              y={padding.top + plotH + 16}
              textAnchor="middle"
              fontSize={10}
              fill="#86868b"
              fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
            >
              {d === 0 ? "0" : `wk ${Math.round(d / 7)}`}
            </text>
          </g>
        ))}

        {/* Per-edge p10/p90 ribbons */}
        {curves.map((c) => (
          <path
            key={`ribbon-${c.id}`}
            d={c.ribbonPath}
            fill={c.color}
            opacity={0.10}
          />
        ))}

        {/* Per-edge p50 lines */}
        {curves.map((c) => (
          <path
            key={`p50-${c.id}`}
            d={c.p50Path}
            fill="none"
            stroke={c.color}
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}

        {/* Peak markers (small dot at peak_days_p50) */}
        {curves.map((c) =>
          typeof c.peakDay === "number" && c.peakDay >= 0 && c.peakDay <= horizon
            ? (
                <circle
                  key={`peak-${c.id}`}
                  cx={xFromDay(c.peakDay)}
                  cy={yFromVal(1)}
                  r={3.5}
                  fill={c.color}
                  stroke="white"
                  strokeWidth={1.5}
                />
              )
            : null,
        )}

        {/* Onset markers (small triangle at onset_days_p50) */}
        {curves.map((c) =>
          typeof c.onsetDay === "number" && c.onsetDay > 0 && c.onsetDay <= horizon
            ? (
                <polygon
                  key={`onset-${c.id}`}
                  points={trianglePoints(xFromDay(c.onsetDay), yFromVal(0), 4)}
                  fill={c.color}
                  stroke="white"
                  strokeWidth={1}
                />
              )
            : null,
        )}

        {/* X axis line */}
        <line
          x1={padding.left}
          x2={padding.left + plotW}
          y1={padding.top + plotH}
          y2={padding.top + plotH}
          stroke="rgba(0,0,0,0.2)"
          strokeWidth={1}
        />
      </svg>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          marginTop: 12,
          fontSize: 12,
          color: "#424245",
        }}
      >
        {curves.map((c) => (
          <div key={`leg-${c.id}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 12,
                height: 3,
                background: c.color,
                borderRadius: 2,
                display: "inline-block",
              }}
            />
            {c.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function trianglePoints(cx: number, cy: number, size: number): string {
  return `${cx - size},${cy + size} ${cx + size},${cy + size} ${cx},${cy}`;
}

/** Default horizon — covers all edges' peak + persistence with a
 *  ~20% pad so decay tails are visible. */
function computeHorizon(edges: FlightChartEdge[]): number {
  let max = 0;
  for (const e of edges) {
    const peak = typeof e.peak_days_p50 === "number" ? e.peak_days_p50 : 0;
    const persist =
      typeof e.persistence_days_p50 === "number" &&
      Number.isFinite(e.persistence_days_p50)
        ? e.persistence_days_p50
        : 0;
    const totalForEdge = peak + persist;
    if (totalForEdge > max) max = totalForEdge;
  }
  if (max === 0) return 0;
  return Math.ceil(max * 1.2);
}
