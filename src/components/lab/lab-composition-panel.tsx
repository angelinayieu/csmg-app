"use client";

// ── Lab Composition Panel (Phase 5A) ─────────────────────────────
//
// Right-rail panel that re-presents the same K/tau/rho/alpha data
// LabControlPanel exposes, but as horizontal "mechanism" bars
// (Buffer / Decay / Rehearsal / Attention) with their canonical
// greek symbol pills. Mirrors the photo's "COMPOSITION" panel.
//
// Read-only — sliders for editing live in LabControlPanel below.
// This panel is the at-a-glance visual: which mechanism is the
// load-bearing one for the current configuration?
//
// Each bar fills 0..100% normalized to the parameter's spec range
// from PARAMETER_SPECS (lab-formulas.ts).

import {
  PARAMETER_SPECS,
  type InstrumentParameters,
  type ParameterSpec,
} from "@/lib/lab-formulas";

interface LabCompositionPanelProps {
  parameters: InstrumentParameters;
  /** Optional ghost (counterfactual) parameters — when present, a
   *  subtle bar overlay shows the delta against the live values. */
  ghostParameters?: InstrumentParameters | null;
}

// Display name + greek-symbol-bar accent color per parameter.
const COMPOSITION_META: Record<
  keyof InstrumentParameters,
  { label: string; color: string; pillBg: string; pillFg: string }
> = {
  K: {
    label: "Buffer",
    color: "#10b981", // emerald
    pillBg: "rgba(16,185,129,0.18)",
    pillFg: "#34d399",
  },
  tau: {
    label: "Decay",
    color: "#f59e0b", // amber
    pillBg: "rgba(245,158,11,0.18)",
    pillFg: "#fbbf24",
  },
  rho: {
    label: "Rehearsal",
    color: "#3b82f6", // blue
    pillBg: "rgba(59,130,246,0.18)",
    pillFg: "#60a5fa",
  },
  alpha: {
    label: "Attention",
    color: "#ec4899", // pink
    pillBg: "rgba(236,72,153,0.18)",
    pillFg: "#f472b6",
  },
};

function pctOf(value: number, spec: ParameterSpec): number {
  const range = spec.max - spec.min;
  if (range <= 0) return 0;
  return Math.max(0, Math.min(100, ((value - spec.min) / range) * 100));
}

export function LabCompositionPanel({
  parameters,
  ghostParameters,
}: LabCompositionPanelProps) {
  return (
    <section className="border-b border-white/[0.06] bg-[rgba(8,12,22,0.5)] px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#7a8da8]">
          Composition
        </h3>
        <span className="text-[9px] font-medium text-[#6a7a95]">4 parts</span>
      </div>

      <div className="space-y-2">
        {PARAMETER_SPECS.map((spec) => {
          const key = spec.key as keyof InstrumentParameters;
          const meta = COMPOSITION_META[key];
          const value = parameters[key];
          const pct = pctOf(value, spec);
          const ghostPct = ghostParameters
            ? pctOf(ghostParameters[key], spec)
            : null;
          return (
            <div key={spec.key} className="flex items-center gap-2.5">
              {/* Greek symbol pill */}
              <span
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded font-mono text-[10.5px] font-bold"
                style={{ background: meta.pillBg, color: meta.pillFg }}
                title={`${meta.label} (${spec.symbol}) — current: ${value}${spec.unit ? ` ${spec.unit}` : ""}`}
              >
                {spec.symbol}
              </span>

              {/* Label + bar */}
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="w-[68px] flex-shrink-0 text-[10.5px] font-medium text-[#a8b8d0]">
                  {meta.label}
                </span>
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="absolute left-0 top-0 h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${pct}%`,
                      background: meta.color,
                    }}
                  />
                  {/* Ghost overlay — lighter band showing the
                      counterfactual value when present. */}
                  {ghostPct !== null && Math.abs(ghostPct - pct) > 1.5 && (
                    <div
                      aria-hidden
                      className="absolute top-0 h-full rounded-full"
                      style={{
                        left: 0,
                        width: `${ghostPct}%`,
                        background: meta.color,
                        opacity: 0.25,
                        mixBlendMode: "screen",
                      }}
                    />
                  )}
                </div>
                <span
                  className="w-[34px] flex-shrink-0 text-right font-mono text-[10.5px] font-semibold text-[#e8edf4]"
                  style={{ color: meta.pillFg }}
                >
                  {Math.round(pct)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
