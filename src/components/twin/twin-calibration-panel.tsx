"use client";

// ── TwinCalibrationPanel ────────────────────────────────────────────
//
// The "is the twin actually correct?" visualization. Reads resolved
// rows from prediction_ledger and shows two views side by side:
//
//   1. Residual plot — for each resolved prediction, the % deviation
//      from predicted (actual - predicted) / |predicted|, plotted
//      chronologically. Reference line at 0 = perfect call. Points
//      colored by deviation_tag, sized by confidence at predict-time.
//      This is the standard forecast-accuracy scientific visualization.
//
//   2. Surprise timeline — the same rows projected onto a continuous
//      time strip with deviation_tag color. Shows clusters of
//      surprise (regime shifts) at a glance.
//
// Footer carries the headline numbers: N resolved, K surprises, P%
// surprise rate. These are the same numbers the twin's risk_exposure
// uses for its Tier 6 surprise-density penalty (see compute-twin-state
// lines 74–96), so the panel is a transparent view of why the health
// score is what it is — closes the "twin is a vibes dashboard" gap.
//
// Self-hides body when no resolved rows exist; surfaces a quiet
// "calibration accumulating" footer instead so the user sees what
// the panel will become.

import { useEffect, useMemo, useState } from "react";

interface ResolvedRow {
  id: string;
  metric_label: string;
  metric_unit?: string | null;
  predicted_at: string;
  horizon_at: string;
  resolved_at: string | null;
  predicted_value: number | null;
  resolved_actual: number | null;
  confidence: number | null;
  deviation: number | null;
  deviation_tag:
    | "expected"
    | "regime_shift"
    | "surprise"
    | "qualitative"
    | "failed"
    | null;
  rationale: string | null;
}

interface Props {
  spaceId: string;
  /** Hide entirely when there are zero resolved predictions. Default false (shows
   * empty-state placeholder so users know the panel exists). */
  hideWhenEmpty?: boolean;
}

const TAG_COLOR: Record<string, string> = {
  expected: "#30D158", // calibrated — green
  regime_shift: "#FF9F0A", // structural shift — amber
  surprise: "#FF453A", // unexpected — red
  qualitative: "#5E5CE6", // qualitative outcome — indigo
  failed: "#86868B", // unresolvable — gray
};

const TAG_LABEL: Record<string, string> = {
  expected: "Expected",
  regime_shift: "Regime shift",
  surprise: "Surprise",
  qualitative: "Qualitative",
  failed: "Failed",
};

export function TwinCalibrationPanel({ spaceId, hideWhenEmpty = false }: Props) {
  const [rows, setRows] = useState<ResolvedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/predictions?space_id=${encodeURIComponent(spaceId)}&status=resolved&limit=200`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`status=${res.status}`);
        const json = (await res.json()) as { rows?: ResolvedRow[] };
        if (!cancelled) setRows(json.rows ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // Compute residuals and summary stats. Normalizes per-row to a relative
  // deviation in % so multiple metric scales coexist on one plot.
  const { resolved, surprises, surpriseRate, residualPoints, timelinePoints } = useMemo(() => {
    const all = rows ?? [];
    // Drop rows where we can't compute a residual numerically.
    const numeric = all.filter(
      (r) =>
        typeof r.predicted_value === "number" &&
        typeof r.resolved_actual === "number" &&
        Number.isFinite(r.predicted_value) &&
        Number.isFinite(r.resolved_actual) &&
        r.resolved_at,
    );
    const resolvedCount = all.length;
    const surpriseCount = all.filter(
      (r) => r.deviation_tag === "surprise" || r.deviation_tag === "regime_shift",
    ).length;
    const rate = resolvedCount > 0 ? surpriseCount / resolvedCount : 0;

    // Sort by resolved_at ascending for chronological residual plot.
    const sorted = [...numeric].sort(
      (a, b) =>
        new Date(a.resolved_at!).getTime() - new Date(b.resolved_at!).getTime(),
    );

    const residuals = sorted.map((r, i) => {
      const denom = Math.abs(r.predicted_value!) || 1;
      const rel = ((r.resolved_actual! - r.predicted_value!) / denom) * 100;
      // Cap for plotting; record the uncapped value for hover.
      const clamped = Math.max(-150, Math.min(150, rel));
      return {
        id: r.id,
        index: i,
        rel,
        clamped,
        tag: r.deviation_tag ?? "qualitative",
        confidence: r.confidence ?? 0.5,
        metric: r.metric_label,
        unit: r.metric_unit ?? "",
        predicted: r.predicted_value!,
        actual: r.resolved_actual!,
        resolvedAt: r.resolved_at!,
      };
    });

    // Timeline uses ALL resolved rows (numeric or qualitative) to also
    // show "qualitative" / "failed" markers. We position by resolved_at.
    const timeline = all
      .filter((r) => r.resolved_at)
      .map((r) => ({
        id: r.id,
        tag: r.deviation_tag ?? "qualitative",
        resolvedAt: r.resolved_at!,
        metric: r.metric_label,
        confidence: r.confidence ?? 0.5,
      }))
      .sort(
        (a, b) =>
          new Date(a.resolvedAt).getTime() - new Date(b.resolvedAt).getTime(),
      );

    return {
      resolved: resolvedCount,
      surprises: surpriseCount,
      surpriseRate: rate,
      residualPoints: residuals,
      timelinePoints: timeline,
    };
  }, [rows]);

  if (rows === null && !error) {
    return (
      <Shell>
        <Header
          resolved={null}
          surprises={null}
          surpriseRate={null}
          loading
        />
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <Header resolved={0} surprises={0} surpriseRate={0} />
        <div className="px-4 pb-4 text-[12px] text-[color:var(--muted-fg,#86868b)]">
          Calibration data unavailable: {error}
        </div>
      </Shell>
    );
  }

  if (resolved === 0) {
    if (hideWhenEmpty) return null;
    return (
      <Shell>
        <Header resolved={0} surprises={0} surpriseRate={0} />
        <div className="px-4 pb-4 text-[12px] leading-relaxed text-[color:var(--muted-fg,#86868b)]">
          No resolved predictions yet. As outcomes from the prediction
          ledger resolve, they’ll plot here — predicted vs actual
          deviation over time, color-coded by surprise tag — so you can
          see whether the twin is calibrated.
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Header
        resolved={resolved}
        surprises={surprises}
        surpriseRate={surpriseRate}
      />

      <div className="grid grid-cols-1 gap-5 px-4 pb-4 lg:grid-cols-[1.6fr_1fr]">
        <ResidualPlot points={residualPoints} />
        <SurpriseTimeline points={timelinePoints} />
      </div>

      <Legend />
    </Shell>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="relative overflow-hidden rounded-[18px] border border-white/60 bg-gradient-to-br from-white/85 via-white/70 to-white/55 shadow-[0_4px_14px_rgba(15,23,42,0.04)]"
      style={{
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
      }}
      aria-label="Twin calibration"
    >
      {children}
    </section>
  );
}

function Header({
  resolved,
  surprises,
  surpriseRate,
  loading,
}: {
  resolved: number | null;
  surprises: number | null;
  surpriseRate: number | null;
  loading?: boolean;
}) {
  const ratePct = surpriseRate != null ? Math.round(surpriseRate * 100) : null;
  const rateColor =
    surpriseRate == null
      ? "#86868B"
      : surpriseRate > 0.4
        ? "#FF453A"
        : surpriseRate > 0.15
          ? "#FF9F0A"
          : "#30D158";
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/40 px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className="h-[6px] w-[6px] rounded-full"
          style={{ background: rateColor, boxShadow: `0 0 10px ${rateColor}AA` }}
        />
        <div>
          <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-[color:var(--muted-fg,#6b7280)]">
            Twin Calibration
          </div>
          <div className="mt-0.5 text-[13px] font-medium text-[color:var(--fg,#1d1d1f)]">
            {loading
              ? "Loading prediction history…"
              : resolved === 0
                ? "Awaiting resolved predictions"
                : `${resolved} resolved · ${surprises} surprise${surprises === 1 ? "" : "s"}`}
          </div>
        </div>
      </div>
      {ratePct != null && resolved! > 0 ? (
        <div
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums"
          style={{
            color: rateColor,
            borderColor: `${rateColor}55`,
            background: `${rateColor}12`,
          }}
        >
          {ratePct}% surprise rate
        </div>
      ) : null}
    </div>
  );
}

// ── Residual plot ────────────────────────────────────────────────────
//
// X axis: ordinal chronological index.
// Y axis: relative deviation in % (capped ±150 for plotting).
// Zero line emphasized — that's perfect calibration.
// ±50% bands shown faintly as reference.

function ResidualPlot({
  points,
}: {
  points: Array<{
    id: string;
    index: number;
    rel: number;
    clamped: number;
    tag: string;
    confidence: number;
    metric: string;
    unit: string;
    predicted: number;
    actual: number;
    resolvedAt: string;
  }>;
}) {
  const W = 460;
  const H = 200;
  const padX = 36;
  const padY = 18;
  const innerW = W - padX - 12;
  const innerH = H - padY * 2;

  if (points.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-white/40 bg-white/30 p-4 text-[12px] text-[color:var(--muted-fg,#86868b)]">
        No numeric residuals to plot yet.
      </div>
    );
  }

  const xScale = (i: number) =>
    padX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yScale = (rel: number) => padY + ((150 - rel) / 300) * innerH;

  return (
    <div className="overflow-hidden rounded-xl border border-white/40 bg-white/40 p-2">
      <div className="mb-1 flex items-baseline justify-between px-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-fg,#6b7280)]">
          Predicted vs actual
        </div>
        <div className="text-[10px] text-[color:var(--muted-fg,#86868b)]">
          y = (actual − predicted) / |predicted|
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="200"
        role="img"
        aria-label="Residual plot of resolved predictions"
      >
        {/* ±50% reference bands */}
        <line
          x1={padX}
          x2={W - 12}
          y1={yScale(50)}
          y2={yScale(50)}
          stroke="rgba(0,0,0,0.06)"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <line
          x1={padX}
          x2={W - 12}
          y1={yScale(-50)}
          y2={yScale(-50)}
          stroke="rgba(0,0,0,0.06)"
          strokeWidth="1"
          strokeDasharray="2 3"
        />

        {/* Zero line — perfect calibration */}
        <line
          x1={padX}
          x2={W - 12}
          y1={yScale(0)}
          y2={yScale(0)}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="1"
        />

        {/* Y axis tick labels */}
        {[100, 50, 0, -50, -100].map((v) => (
          <text
            key={v}
            x={padX - 6}
            y={yScale(v) + 3}
            textAnchor="end"
            fontSize="9"
            fill="rgba(0,0,0,0.45)"
            fontFamily="ui-monospace, monospace"
          >
            {v > 0 ? `+${v}%` : `${v}%`}
          </text>
        ))}

        {/* Connector polyline so the eye sees the trajectory */}
        {points.length > 1 ? (
          <polyline
            fill="none"
            stroke="rgba(0,0,0,0.10)"
            strokeWidth="1"
            points={points
              .map((p) => `${xScale(p.index)},${yScale(p.clamped)}`)
              .join(" ")}
          />
        ) : null}

        {/* Points */}
        {points.map((p) => {
          const r = 3 + p.confidence * 4; // 3–7 px by confidence
          const color = TAG_COLOR[p.tag] ?? "#86868B";
          return (
            <g key={p.id}>
              <title>
                {`${p.metric} — predicted ${formatNum(p.predicted)}${p.unit ? " " + p.unit : ""}, actual ${formatNum(p.actual)}${p.unit ? " " + p.unit : ""} (${formatRel(p.rel)})\nresolved ${new Date(p.resolvedAt).toLocaleDateString()} · ${TAG_LABEL[p.tag] ?? p.tag}`}
              </title>
              <circle
                cx={xScale(p.index)}
                cy={yScale(p.clamped)}
                r={r}
                fill={color}
                fillOpacity={0.85}
                stroke="white"
                strokeWidth={1.2}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Surprise timeline ────────────────────────────────────────────────
//
// Compact horizontal strip: oldest → newest. Each resolved prediction
// is a dot at its resolved_at position. Color = deviation_tag.
// Two-week window-grouping at the bottom shows surprise clustering.

function SurpriseTimeline({
  points,
}: {
  points: Array<{
    id: string;
    tag: string;
    resolvedAt: string;
    metric: string;
    confidence: number;
  }>;
}) {
  const W = 280;
  const H = 200;
  const padX = 16;
  const innerW = W - padX * 2;

  if (points.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-white/40 bg-white/30 p-4 text-[12px] text-[color:var(--muted-fg,#86868b)]">
        No timeline yet.
      </div>
    );
  }

  const t0 = new Date(points[0].resolvedAt).getTime();
  const tN = new Date(points[points.length - 1].resolvedAt).getTime();
  const span = Math.max(tN - t0, 1);
  const xAt = (iso: string) =>
    padX + ((new Date(iso).getTime() - t0) / span) * innerW;

  // Density bins — 12 buckets across the span.
  const BINS = 12;
  const bins = new Array(BINS).fill(0);
  const surpriseBins = new Array(BINS).fill(0);
  for (const p of points) {
    const t = new Date(p.resolvedAt).getTime();
    const bin = Math.min(BINS - 1, Math.floor(((t - t0) / span) * BINS));
    bins[bin] += 1;
    if (p.tag === "surprise" || p.tag === "regime_shift") surpriseBins[bin] += 1;
  }
  const maxBin = Math.max(1, ...bins);

  const dotY = 96;
  const histTop = 130;
  const histH = 50;

  return (
    <div className="overflow-hidden rounded-xl border border-white/40 bg-white/40 p-2">
      <div className="mb-1 flex items-baseline justify-between px-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-fg,#6b7280)]">
          Surprise timeline
        </div>
        <div className="text-[10px] text-[color:var(--muted-fg,#86868b)]">
          oldest → newest
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="200"
        role="img"
        aria-label="Resolved-prediction surprise timeline"
      >
        {/* Axis line */}
        <line
          x1={padX}
          x2={W - padX}
          y1={dotY}
          y2={dotY}
          stroke="rgba(0,0,0,0.10)"
          strokeWidth="1"
        />

        {/* Resolved-prediction dots */}
        {points.map((p) => (
          <g key={p.id}>
            <title>
              {`${p.metric} — ${TAG_LABEL[p.tag] ?? p.tag}\nresolved ${new Date(p.resolvedAt).toLocaleDateString()}`}
            </title>
            <circle
              cx={xAt(p.resolvedAt)}
              cy={dotY}
              r={3 + p.confidence * 2}
              fill={TAG_COLOR[p.tag] ?? "#86868B"}
              fillOpacity={0.85}
              stroke="white"
              strokeWidth={1}
            />
          </g>
        ))}

        {/* Density histogram below */}
        {bins.map((count, i) => {
          const h = (count / maxBin) * histH;
          const x = padX + (i / BINS) * innerW;
          const w = innerW / BINS - 1.5;
          const surpriseShare = count > 0 ? surpriseBins[i] / count : 0;
          const color =
            surpriseShare > 0.5
              ? TAG_COLOR.surprise
              : surpriseShare > 0
                ? TAG_COLOR.regime_shift
                : TAG_COLOR.expected;
          return (
            <rect
              key={i}
              x={x}
              y={histTop + (histH - h)}
              width={w}
              height={h}
              fill={color}
              fillOpacity={0.55}
              rx={1.5}
            />
          );
        })}

        {/* Histogram baseline */}
        <line
          x1={padX}
          x2={W - padX}
          y1={histTop + histH}
          y2={histTop + histH}
          stroke="rgba(0,0,0,0.10)"
          strokeWidth="1"
        />

        {/* Endpoint labels */}
        <text
          x={padX}
          y={H - 4}
          fontSize="9"
          fill="rgba(0,0,0,0.45)"
          fontFamily="ui-monospace, monospace"
        >
          {new Date(t0).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </text>
        <text
          x={W - padX}
          y={H - 4}
          fontSize="9"
          textAnchor="end"
          fill="rgba(0,0,0,0.45)"
          fontFamily="ui-monospace, monospace"
        >
          {new Date(tN).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </text>
      </svg>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────

function Legend() {
  const tags: Array<keyof typeof TAG_LABEL> = [
    "expected",
    "regime_shift",
    "surprise",
    "qualitative",
    "failed",
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/40 px-4 py-2 text-[10px] text-[color:var(--muted-fg,#6b7280)]">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: TAG_COLOR[t] }}
          />
          {TAG_LABEL[t]}
        </span>
      ))}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000)
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function formatRel(rel: number): string {
  if (!Number.isFinite(rel)) return "—";
  const s = rel.toFixed(0);
  return rel > 0 ? `+${s}%` : `${s}%`;
}
