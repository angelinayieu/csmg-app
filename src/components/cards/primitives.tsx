"use client";

// ── Card viz primitives ─────────────────────────────────────────────
//
// Small SVG/HTML building blocks that the archetype renderers compose.
// Each primitive is pure presentational — takes data + colors, no data
// fetching, no state. Ported from the original sketches in
// /design/preflight/node-signature-band so the production cards and
// the design preflight render identically.

import { DAYS_M_S, HAIRLINE, MONO_FONT } from "./tokens";

// ── BarChart7 ─────────────────────────────────────────────────────────
// 7 vertical bars + day labels. Peak bar uses solid color, rest use the
// faint variant. Used by consumer-health monitor/tracker archetypes.

export function BarChart7({
  values,
  color,
  faintColor,
}: {
  values: number[];
  color: string;
  faintColor: string;
}) {
  const W = 138;
  const H = 56;
  const barW = 7;
  const gap = (W - barW * 7) / 6;
  const maxV = Math.max(...values, 1);
  return (
    <svg width={W} height={H + 16} viewBox={`0 0 ${W} ${H + 16}`}>
      {values.map((v, i) => {
        const h = Math.max(6, (v / maxV) * H);
        const x = i * (barW + gap);
        const isPeak = v === maxV;
        return (
          <rect
            key={i}
            x={x}
            y={H - h}
            width={barW}
            height={h}
            rx={3.5}
            fill={isPeak ? color : faintColor}
          />
        );
      })}
      {DAYS_M_S.map((l, i) => (
        <text
          key={i}
          x={i * (barW + gap) + barW / 2}
          y={H + 13}
          fontSize="9"
          fill="#9aa3b1"
          textAnchor="middle"
          fontFamily="-apple-system, system-ui"
          fontWeight={500}
        >
          {l}
        </text>
      ))}
    </svg>
  );
}

// ── RingGrid7 ─────────────────────────────────────────────────────────
// 7 small rings with hit/miss state. Used by sleep/streak monitors —
// quick "did I hit it" scan across a week.

export function RingGrid7({ hits, color }: { hits: boolean[]; color: string }) {
  const W = 138;
  const H = 56;
  const slot = W / 7;
  const r = 8;
  const cy = H - r - 2;
  return (
    <svg width={W} height={H + 16} viewBox={`0 0 ${W} ${H + 16}`}>
      {hits.map((hit, i) => {
        const cx = slot * i + slot / 2;
        return (
          <g key={i}>
            <text
              x={cx}
              y={cy - r - 5}
              fontSize="9"
              fill={hit ? "#6b7180" : "#cbd5dc"}
              textAnchor="middle"
              fontFamily="-apple-system, system-ui"
              fontWeight={500}
            >
              {hit ? "✓" : "✕"}
            </text>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={hit ? color : "#dee3eb"}
              strokeWidth={1.8}
            />
          </g>
        );
      })}
      {DAYS_M_S.map((l, i) => (
        <text
          key={i}
          x={slot * i + slot / 2}
          y={H + 13}
          fontSize="9"
          fill="#9aa3b1"
          textAnchor="middle"
          fontFamily="-apple-system, system-ui"
          fontWeight={500}
        >
          {l}
        </text>
      ))}
    </svg>
  );
}

// ── LineChart7 ────────────────────────────────────────────────────────
// Smooth line + gradient fill, 7 points + day labels. Used for
// continuous-metric monitors (mood, weight, hydration trend).

export function LineChart7({ values, color }: { values: number[]; color: string }) {
  const W = 138;
  const H = 56;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(0.01, max - min);
  const points = values.map((v, i) => {
    const x = (i / 6) * W;
    const y = H - ((v - min) / range) * H * 0.85 - 4;
    return { x, y };
  });
  const pathParts: string[] = [];
  pathParts.push(`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cx = (prev.x + curr.x) / 2;
    pathParts.push(
      `Q ${cx.toFixed(1)} ${prev.y.toFixed(1)} ${cx.toFixed(1)} ${((prev.y + curr.y) / 2).toFixed(1)}`,
    );
    pathParts.push(`Q ${cx.toFixed(1)} ${curr.y.toFixed(1)} ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`);
  }
  const linePath = pathParts.join(" ");
  const fillPath = `${linePath} L ${W} ${H} L 0 ${H} Z`;
  // Deterministic gradient id from color so repeated mounts don't churn.
  const gradientId = `lc-${color.replace("#", "")}-${values.length}`;
  return (
    <svg width={W} height={H + 16} viewBox={`0 0 ${W} ${H + 16}`}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {DAYS_M_S.map((l, i) => (
        <text
          key={i}
          x={(i / 6) * W}
          y={H + 13}
          fontSize="9"
          fill="#9aa3b1"
          textAnchor={i === 0 ? "start" : i === 6 ? "end" : "middle"}
          fontFamily="-apple-system, system-ui"
          fontWeight={500}
        >
          {l}
        </text>
      ))}
    </svg>
  );
}

// ── DoseResponseCurve ─────────────────────────────────────────────────
// Logistic curve with a dot marking the current dose. Used by
// clinical-intervention to visualize where the recommended dose sits
// on the dose-response sigmoid.

export function DoseResponseCurve({ color, dosePct = 0.62 }: { color: string; dosePct?: number }) {
  const W = 200;
  const H = 64;
  const k = 8;
  const x0 = 0.5;
  const points: [number, number][] = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const y = 1 / (1 + Math.exp(-k * (t - x0)));
    points.push([t * W, H - y * (H - 8) - 4]);
  }
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const dotX = dosePct * W;
  const dotY = H - (1 / (1 + Math.exp(-k * (dosePct - x0)))) * (H - 8) - 4;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <line x1={0} y1={H - 1} x2={W} y2={H - 1} stroke="rgba(20,30,60,0.08)" strokeWidth={1} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={dotX} cy={dotY} r={4} fill={color} stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}

// ── OutcomeBars ───────────────────────────────────────────────────────
// Horizontal mini-bars with label + percentage. Used by
// clinical-intervention to show predicted-effect on each outcome.

export function OutcomeBars({
  items,
  color,
}: {
  items: Array<{ label: string; pct: number }>;
  color: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "100px 1fr 32px",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "rgba(20,30,60,0.7)",
              letterSpacing: "-0.005em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {it.label}
          </span>
          <div
            style={{
              position: "relative",
              height: 4,
              background: "rgba(20,30,60,0.06)",
              borderRadius: 2,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                height: "100%",
                width: `${Math.max(0, Math.min(100, it.pct))}%`,
                background: color,
                borderRadius: 2,
              }}
            />
          </div>
          <span
            style={{
              fontSize: 11,
              color: "rgba(20,30,60,0.55)",
              fontFamily: MONO_FONT,
              fontVariantNumeric: "tabular-nums",
              textAlign: "right",
              fontWeight: 500,
            }}
          >
            {Math.round(it.pct)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ── StreakDots ────────────────────────────────────────────────────────
// 7 streak circles, filled when done. Used by workflow-habit.

export function StreakDots({ done, color }: { done: boolean[]; color: string }) {
  const W = 138;
  const H = 56;
  const slot = W / 7;
  const r = 6;
  const cy = H / 2;
  return (
    <svg width={W} height={H + 14} viewBox={`0 0 ${W} ${H + 14}`}>
      {done.map((d, i) => (
        <circle
          key={i}
          cx={slot * i + slot / 2}
          cy={cy}
          r={r}
          fill={d ? color : "transparent"}
          stroke={d ? color : "#cdd2da"}
          strokeWidth={1.6}
        />
      ))}
      {DAYS_M_S.map((l, i) => (
        <text
          key={i}
          x={slot * i + slot / 2}
          y={H + 11}
          fontSize="9"
          fill="#9aa3b1"
          textAnchor="middle"
          fontFamily="-apple-system, system-ui"
          fontWeight={500}
        >
          {l}
        </text>
      ))}
    </svg>
  );
}

// ── BiomarkerMiniLine ─────────────────────────────────────────────────
// Tiny line + soft fill, no labels. Used inside biomarker-time-course
// rows where each row already has its own label/value chrome.

export function BiomarkerMiniLine({ values, color }: { values: number[]; color: string }) {
  const W = 130;
  const H = 22;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(0.01, max - min);
  const points = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return [x, y] as [number, number];
  });
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const fillPath = `${path} L ${W} ${H} L 0 ${H} Z`;
  const id = `bm-${color.replace("#", "")}-${values.length}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${id})`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── CohortAvatars ─────────────────────────────────────────────────────
// Up to 5 colored avatar circles + "+N" overflow chip. Used by
// social-cohort to show the group at a glance.

export function CohortAvatars({ colors, total }: { colors: string[]; total: number }) {
  const visible = colors.slice(0, 5);
  const overflow = Math.max(0, total - visible.length);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {visible.map((c, i) => (
        <div
          key={i}
          style={{
            width: 26,
            height: 26,
            borderRadius: 999,
            background: c,
            border: "2px solid #fff",
            marginLeft: i === 0 ? 0 : -8,
            boxShadow: "0 1px 3px rgba(8,30,80,0.12)",
          }}
        />
      ))}
      {overflow > 0 && (
        <div
          style={{
            marginLeft: -8,
            paddingLeft: 10,
            paddingRight: 8,
            height: 26,
            borderRadius: 999,
            background: "#f1f3f7",
            border: "2px solid #fff",
            display: "grid",
            placeItems: "center",
            fontSize: 10.5,
            fontWeight: 600,
            color: "rgba(20,30,60,0.6)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

// ── ProgressBar ───────────────────────────────────────────────────────
// Slim horizontal progress bar with optional level labels at the ends.
// Used by game-progression.

export function ProgressBar({
  progress,
  color,
  startLabel,
  endLabel,
}: {
  progress: number;
  color: string;
  startLabel?: string;
  endLabel?: string;
}) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          position: "relative",
          height: 6,
          borderRadius: 3,
          background: "rgba(20,30,60,0.06)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            background: color,
            borderRadius: 3,
          }}
        />
      </div>
      {(startLabel || endLabel) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "rgba(20,30,60,0.55)",
            fontFamily: MONO_FONT,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>{startLabel ?? ""}</span>
          <span>{endLabel ?? ""}</span>
        </div>
      )}
    </div>
  );
}

// ── ScoreRangeBar ─────────────────────────────────────────────────────
// Horizontal range with current "best" tick. Used by game-progression
// to show range + personal best within it.

export function ScoreRangeBar({
  range,
  best,
  color,
}: {
  range: [number, number];
  best: number;
  color: string;
}) {
  const [min, max] = range;
  const span = Math.max(0.0001, max - min);
  const pct = Math.max(0, Math.min(1, (best - min) / span)) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5 }}>
      <span
        style={{
          color: "rgba(20,30,60,0.55)",
          fontFamily: MONO_FONT,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {min}
      </span>
      <div
        style={{
          position: "relative",
          flex: 1,
          height: 4,
          borderRadius: 2,
          background: "rgba(20,30,60,0.06)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -3,
            left: `calc(${pct}% - 1px)`,
            width: 2,
            height: 10,
            background: color,
            borderRadius: 1,
          }}
          title={`Best: ${best}`}
        />
      </div>
      <span
        style={{
          color: "rgba(20,30,60,0.55)",
          fontFamily: MONO_FONT,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {max}
      </span>
    </div>
  );
}

// Re-export from tokens for convenience — most callers want both.
export { HAIRLINE };
