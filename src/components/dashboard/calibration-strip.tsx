"use client";

// ── CalibrationStrip ────────────────────────────────────────────────
//
// Renders the user's confidence-calibration receipts on the space
// dashboard. The strip says, in plain language, whether the system's
// stated confidence is empirically reliable — e.g. "Your 0.8-confidence
// claims have a 0.61 realized hit rate." This is the first artifact in
// the codebase that grounds the model's stated uncertainty in measured
// outcomes; without it, every confidence number is unfalsifiable theater.
//
// Self-hiding contract: when the user has fewer than MIN_SAMPLE_FOR_
// CALIBRATION (20) calibratable predictions resolved, the strip renders
// nothing. We refuse to report small-sample numbers that would mislead.
//
// Data source: /api/spaces/[id]/calibration-reliability (user-scoped by
// default — calibration is a personal property that grows across spaces).
// The endpoint computes on demand from prediction_ledger so the strip
// works even for spaces with no domain_learning_measurements row yet.

import { useEffect, useState } from "react";
import type { ReliabilityBin } from "@/lib/learning/calibration-metrics";

interface CalibrationReliabilityResponse {
  scope: "user" | "space";
  resolved_count: number;
  calibratable_count: number;
  enough_data: boolean;
  min_sample: number;
  brier: number | null;
  ece: number | null;
  reliability_bins: ReliabilityBin[] | null;
}

interface Props {
  spaceId: string;
}

export function CalibrationStrip({ spaceId }: Props) {
  const [data, setData] = useState<CalibrationReliabilityResponse | null>(null);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/calibration-reliability`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as CalibrationReliabilityResponse;
        if (!cancelled) setData(json);
      } catch {
        /* non-fatal — strip stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // Hide entirely when we don't have a verdict yet OR when the sample
  // is too small to defend. The dashboard already has plenty above-fold;
  // a placeholder here would be noise.
  if (!data) return null;
  if (!data.enough_data || !data.reliability_bins) return null;
  if (data.brier === null || data.ece === null) return null;

  const verdict = describeCalibration(data.ece, data.brier);

  return (
    <section
      aria-label="Confidence calibration"
      className="relative overflow-hidden rounded-[18px] border border-white/60 bg-gradient-to-br from-white/85 via-white/70 to-white/55 px-5 py-4 shadow-[0_4px_14px_rgba(15,23,42,0.04)]"
      style={{
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
      }}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-[color:var(--muted-fg,#6b7280)]">
            Calibration receipts
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-[color:var(--fg,#1d1d1f)]">
            {verdict.headline}
          </span>
          <span className="text-[11px] leading-[1.5] text-[color:var(--muted-fg,#86868b)]">
            {verdict.body}
          </span>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-[color:var(--muted-fg,#86868b)]">
            <span>
              Brier{" "}
              <strong className="text-[color:var(--fg,#1d1d1f)] tabular-nums">
                {data.brier.toFixed(3)}
              </strong>
            </span>
            <span aria-hidden>·</span>
            <span>
              ECE{" "}
              <strong className="text-[color:var(--fg,#1d1d1f)] tabular-nums">
                {data.ece.toFixed(3)}
              </strong>
            </span>
            <span aria-hidden>·</span>
            <span>
              n ={" "}
              <strong className="text-[color:var(--fg,#1d1d1f)] tabular-nums">
                {data.calibratable_count}
              </strong>
            </span>
          </div>
        </div>

        <ReliabilityDiagram bins={data.reliability_bins} />
      </div>
    </section>
  );
}

// ── Reliability diagram ──
// Small SVG: x = stated confidence (decile bins), y = realized hit rate.
// Diagonal dashed line = perfect calibration. Bars = per-bin hit rate;
// bar opacity scales with bin count so empty/sparse bins are visually
// quiet. Width matches a typical sparkline so this fits next to a
// label without dominating.

function ReliabilityDiagram({ bins }: { bins: ReliabilityBin[] }) {
  const W = 180;
  const H = 90;
  const PAD = 4;
  const plotW = W - 2 * PAD;
  const plotH = H - 2 * PAD;

  const totalCount = bins.reduce((s, b) => s + b.count, 0);
  const maxCount = Math.max(1, ...bins.map((b) => b.count));

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Reliability diagram. Bars show realized hit rate per stated-confidence decile; diagonal shows perfect calibration."
      className="shrink-0"
    >
      {/* plot box */}
      <rect
        x={PAD}
        y={PAD}
        width={plotW}
        height={plotH}
        fill="rgba(255,255,255,0.4)"
        stroke="rgba(15,23,42,0.08)"
        strokeWidth={1}
        rx={4}
      />
      {/* perfect-calibration diagonal */}
      <line
        x1={PAD}
        y1={PAD + plotH}
        x2={PAD + plotW}
        y2={PAD}
        stroke="rgba(15,23,42,0.25)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      {/* bins */}
      {bins.map((b, i) => {
        if (b.count === 0) return null;
        const barWidth = plotW / bins.length;
        const x = PAD + i * barWidth;
        const barH = b.hit_rate * plotH;
        const y = PAD + (plotH - barH);
        // Color: green when bin is well-calibrated (close to diagonal),
        // amber/red as the gap widens. Threshold at 0.15 (Brier-meaningful).
        const gap = Math.abs(b.mean_confidence - b.hit_rate);
        const color =
          gap < 0.08
            ? "#30D158"
            : gap < 0.15
              ? "#FF9F0A"
              : "#FF453A";
        const opacity = 0.4 + 0.6 * (b.count / maxCount);
        return (
          <rect
            key={i}
            x={x + 1}
            y={y}
            width={Math.max(0, barWidth - 2)}
            height={barH}
            fill={color}
            opacity={opacity}
          >
            <title>
              {`Stated ${(b.mean_confidence * 100).toFixed(0)}% confidence → ${(b.hit_rate * 100).toFixed(0)}% hit rate (n=${b.count})`}
            </title>
          </rect>
        );
      })}
      {/* baseline */}
      <line
        x1={PAD}
        y1={PAD + plotH}
        x2={PAD + plotW}
        y2={PAD + plotH}
        stroke="rgba(15,23,42,0.15)"
        strokeWidth={1}
      />
      {/* sample-count footer (subtle) */}
      <text
        x={W - PAD - 2}
        y={H - PAD - 1}
        textAnchor="end"
        fontSize={8}
        fill="rgba(15,23,42,0.4)"
      >
        {totalCount} preds
      </text>
    </svg>
  );
}

// Plain-English interpretation. Thresholds are deliberate:
//   ECE < 0.05  — well calibrated (a 3-decile bin is within 5 percentage
//                 points of the diagonal on average).
//   ECE < 0.10  — passable.
//   ECE >= 0.10 — meaningfully miscalibrated; user should discount
//                 stated confidence accordingly.
// Brier is included as a corroborating signal — a low Brier with
// moderate ECE means the system is decisive (close to {0,1}) but
// systematically over- or under-confident.

function describeCalibration(
  ece: number,
  brier: number,
): { headline: string; body: string } {
  if (ece < 0.05) {
    return {
      headline: "Stated confidence is well calibrated.",
      body: `Predictions land within ${(ece * 100).toFixed(1)} pp of the diagonal on average — claims of 0.8 confidence are roughly right about 80% of the time. Brier ${brier.toFixed(3)} is consistent with that.`,
    };
  }
  if (ece < 0.1) {
    return {
      headline: "Stated confidence is passably calibrated.",
      body: `Predictions sit ~${(ece * 100).toFixed(0)} pp off the diagonal on average. Treat confidence numbers as approximate, not strict probabilities.`,
    };
  }
  return {
    headline: "Stated confidence is meaningfully miscalibrated.",
    body: `Predictions diverge from the diagonal by ${(ece * 100).toFixed(0)} pp on average. Brier ${brier.toFixed(3)}. Read the chart for the directional bias and discount confidence in the worst-calibrated buckets.`,
  };
}
