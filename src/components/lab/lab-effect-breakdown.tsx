"use client";

// ── Lab Effect Breakdown (Phase 5A) ──────────────────────────────
//
// Right-rail panel listing the active modulator effects + their
// per-parameter contributions. Mirrors the photo's "EFFECT
// BREAKDOWN" panel:
//   • One line per active modulator (Optimal arousal +0.06,
//     Circadian +0.20)
//   • Greek symbol pill marking which parameter the effect lands on
//   • Color-keyed delta value (positive green / negative red)
//
// Computed from the live conditions bag + a small mapping of
// modulator-name → (target parameter, deterministic delta function).
// For v1 we use the modulator vocabulary already shipped in
// src/lib/subjects/modulators.ts when present, falling back to a
// generic "modulator -> alpha" placeholder otherwise.

import type { InstrumentParameters } from "@/lib/lab-formulas";

interface LabEffectBreakdownProps {
  /** Lifted live conditions from SpaceLab. Each non-null entry
   *  contributes one effect line (when the modulator vocabulary
   *  knows about it). */
  conditions: Record<string, number | string | null>;
  /** Live parameters AFTER modulator application. Used as the
   *  reference point for deltas. Optional — when absent, deltas
   *  are not displayed. */
  parameters?: InstrumentParameters;
  /** Pre-computed per-modulator deltas, when the caller already
   *  has them from useEntityParameters. Shape:
   *    { modulator_key: { target: "K"|"tau"|"rho"|"alpha", delta: number } }
   *  Falls back to a heuristic mapping when omitted. */
  effectDeltas?: Record<
    string,
    { target: keyof InstrumentParameters; delta: number; label?: string }
  > | null;
}

// Greek-symbol metadata (mirrors LabCompositionPanel's accents).
const PARAM_PILL: Record<
  keyof InstrumentParameters,
  { symbol: string; bg: string; fg: string }
> = {
  K: { symbol: "K", bg: "rgba(16,185,129,0.18)", fg: "#34d399" },
  tau: { symbol: "τ", bg: "rgba(245,158,11,0.18)", fg: "#fbbf24" },
  rho: { symbol: "ρ", bg: "rgba(59,130,246,0.18)", fg: "#60a5fa" },
  alpha: { symbol: "α", bg: "rgba(236,72,153,0.18)", fg: "#f472b6" },
};

// Generic fallback mapping when no effect_deltas were supplied. Used
// only for display heuristics — the real math lives in lab-formulas.
const HEURISTIC_TARGET: Record<string, keyof InstrumentParameters> = {
  sleep_h: "K",
  stress_0_10: "alpha",
  caffeine_mg: "alpha",
  time_of_day_24h: "K",
  arousal: "alpha",
  circadian: "K",
};

function humanize(key: string): string {
  return key
    .replace(/_h$/, " (hours)")
    .replace(/_0_10$/, "")
    .replace(/_mg$/, " (mg)")
    .replace(/_24h$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function LabEffectBreakdown({
  conditions,
  effectDeltas,
}: LabEffectBreakdownProps) {
  const activeEntries = Object.entries(conditions).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (activeEntries.length === 0) {
    return (
      <section className="border-b border-white/[0.06] bg-[rgba(8,12,22,0.5)] px-4 py-3">
        <h3 className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[#7a8da8]">
          Effect Breakdown
        </h3>
        <div className="text-[10.5px] italic text-[#6a7a95]">
          No active modulators. Adjust subject conditions to see how each
          contributes to predicted performance.
        </div>
      </section>
    );
  }

  return (
    <section className="border-b border-white/[0.06] bg-[rgba(8,12,22,0.5)] px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#7a8da8]">
          Effect Breakdown
        </h3>
        <span className="text-[9px] font-medium text-[#6a7a95]">
          {activeEntries.length} active
        </span>
      </div>

      <ul className="space-y-1.5">
        {activeEntries.map(([key, value]) => {
          const explicit = effectDeltas?.[key];
          const target =
            explicit?.target ?? HEURISTIC_TARGET[key] ?? "alpha";
          const pill = PARAM_PILL[target];
          const delta = explicit?.delta ?? null;
          const label = explicit?.label ?? humanize(key);
          const deltaColor =
            delta === null
              ? "#7a8da8"
              : delta > 0
                ? "#34d399"
                : delta < 0
                  ? "#f87171"
                  : "#a8b8d0";
          const deltaText =
            delta === null
              ? `· ${value}`
              : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`;
          return (
            <li
              key={key}
              className="flex items-center gap-2.5 text-[10.5px]"
              title={`Modulator "${key}" = ${value}. Maps to ${target}${delta === null ? "" : ` with delta ${delta.toFixed(3)}`}.`}
            >
              <span
                className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold"
                style={{ background: pill.bg, color: pill.fg }}
              >
                {pill.symbol}
              </span>
              <span className="min-w-0 flex-1 truncate text-[#a8b8d0]">
                {label}
              </span>
              <span
                className="flex-shrink-0 font-mono text-[10.5px] font-semibold"
                style={{ color: deltaColor }}
              >
                {deltaText}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
