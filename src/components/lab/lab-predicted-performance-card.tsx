"use client";

// ── Lab Predicted Performance Card (Phase 5A) ────────────────────
//
// Top of the right rail. Mirrors the photo's "PREDICTED PERFORMANCE"
// panel:
//   • Big "Success probability" metric (left) + "Effective K" (right)
//   • Demand bar with progress indicator (current vs max)
//   • Confidence interval line below
//
// Computed entirely from the InstrumentParameters (K/tau/rho/alpha)
// + an optional task demand. When no subject/task in scope, falls
// back to a generic "Throughput" framing.
//
// This is presentation-only. The actual MC simulation lives in
// LabDistribution; this card just shows the headline number.

import type { InstrumentParameters } from "@/lib/lab-formulas";
import { Activity } from "lucide-react";

interface LabPredictedPerformanceCardProps {
  parameters: InstrumentParameters;
  /** Live throughput value from `computeThroughput(parameters)`.
   *  Already memoized in SpaceLab. */
  liveThroughput: number;
  /** Optional task demand (e.g. K=4 for a Digit Span task). When
   *  provided, drives the success-probability bar. Defaults to
   *  parameters.K which makes the bar always full ("nominal"). */
  taskDemand?: number | null;
  /** Approximate ±1σ band around effective K. Driven by the
   *  parameter hook's variance estimate when present; falls back
   *  to a heuristic ± 0.4×K. */
  effectiveKBand?: { lower: number; upper: number } | null;
}

export function LabPredictedPerformanceCard({
  parameters,
  liveThroughput,
  taskDemand,
  effectiveKBand,
}: LabPredictedPerformanceCardProps) {
  const effectiveK = parameters.K;
  const demand = taskDemand ?? effectiveK;
  const successProb = demand > 0 ? Math.min(1, effectiveK / demand) : 0;
  const successPct = Math.round(successProb * 100);
  const band = effectiveKBand ?? {
    lower: Math.max(0, effectiveK - effectiveK * 0.4 / 2),
    upper: effectiveK + effectiveK * 0.4 / 2,
  };

  return (
    <section className="border-b border-white/[0.06] bg-[rgba(8,12,22,0.5)] px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Activity className="h-3 w-3 text-cyan-400" />
        <h3 className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#7a8da8]">
          Predicted Performance
        </h3>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[9.5px] font-semibold uppercase tracking-wider text-[#7a8da8]">
            Success probability
          </div>
          <div className="mt-0.5 font-mono text-[26px] font-bold leading-none tracking-tight text-[#e8edf4]">
            {successPct}
            <span className="ml-0.5 text-[14px] font-medium text-[#7a8da8]">
              %
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9.5px] font-semibold uppercase tracking-wider text-[#7a8da8]">
            Effective K
          </div>
          <div className="mt-0.5 font-mono text-[22px] font-bold leading-none tracking-tight text-emerald-300">
            {effectiveK.toFixed(1)}
          </div>
        </div>
      </div>

      {/* Demand bar — fills from 0 to max(K, demand) */}
      <div className="mt-3">
        <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400"
            style={{ width: `${successPct}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[9.5px] text-[#7a8da8]">
          <span>0</span>
          <span className="font-medium text-[#a8b8d0]">
            Demand
          </span>
          <span>Max</span>
        </div>
      </div>

      {/* CI + task demand */}
      <div className="mt-2 flex items-center justify-between text-[10px]">
        <span
          className="text-[#7a8da8]"
          title={`95% CI on effective K — derived from per-parameter variance${effectiveKBand ? "" : " (heuristic fallback ±20%)"}`}
        >
          95% CI{" "}
          <span className="font-mono text-[#a8b8d0]">
            [{band.lower.toFixed(1)}, {band.upper.toFixed(1)}]
          </span>
        </span>
        {taskDemand !== null && taskDemand !== undefined && (
          <span
            className="font-mono text-[#7a8da8]"
            title={`Task demand: K=${taskDemand}. Success probability is min(1, effectiveK / demand).`}
          >
            demand <span className="text-[#a8b8d0]">K={taskDemand}</span>
          </span>
        )}
      </div>

      {/* Live throughput sub-line */}
      <div className="mt-1 text-[9.5px] text-[#6a7a95]">
        Throughput ·{" "}
        <span className="font-mono text-[#a8b8d0]">
          {liveThroughput.toFixed(2)}
        </span>{" "}
        items / cycle
      </div>
    </section>
  );
}
