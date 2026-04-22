"use client";

// ── Ready-to-Ship meter (Arc 1, Item 1) ──
//
// Single unified 0-100 dial rolling up four reasoning-layer scores into one
// "is this strategy ready?" signal. Replaces scattered confidence/coverage/
// provenance numbers that the user had to mentally aggregate.
//
// Inputs (all 0-100):
//   confidence           — LLM-reported confidence on the recommendation
//   coverage_pct         — % of critical findings the strategy addresses
//   provenance_score     — how well tactics cite their upstream axioms/convergences
//   coherence_score      — rule-based post-gen validation score
//
// Weighting (intentional, user-visible in tooltip):
//   coverage     × 0.30  — have we addressed the analysis?
//   confidence   × 0.25  — does the engine trust itself?
//   provenance   × 0.25  — is the strategy grounded in specific findings?
//   coherence    × 0.20  — does it pass structural validation?
//
// Visual: Apple-Vision-Pro-style circular ring, tabular-nums center score,
// four micro-bars around the perimeter for sub-scores, expandable breakdown
// panel on hover/focus.

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

export interface ReadyMeterInputs {
  confidence?: number | null;
  coverage_pct?: number | null;
  provenance_score?: number | null;
  coherence_score?: number | null;
}

interface Props {
  inputs: ReadyMeterInputs;
  /** Compact mode — smaller ring, inline horizontal layout */
  compact?: boolean;
  className?: string;
}

interface SubScore {
  key: "coverage" | "confidence" | "provenance" | "coherence";
  label: string;
  value: number | null;
  weight: number;
  hint: string;
}

const WEIGHTS = {
  coverage: 0.30,
  confidence: 0.25,
  provenance: 0.25,
  coherence: 0.20,
} as const;

function clamp(n: number | null | undefined, fallback = 0): number {
  if (typeof n !== "number" || Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

export function ReadyToShipMeter({ inputs, compact = false, className }: Props) {
  const [focused, setFocused] = useState(false);
  const reducedMotion = useReducedMotion();

  const subScores: SubScore[] = useMemo(
    () => [
      {
        key: "coverage",
        label: "Coverage",
        value: typeof inputs.coverage_pct === "number" ? inputs.coverage_pct : null,
        weight: WEIGHTS.coverage,
        hint: "% of critical findings (axioms, risks, signals) the strategy addresses.",
      },
      {
        key: "confidence",
        label: "Confidence",
        value: typeof inputs.confidence === "number" ? inputs.confidence : null,
        weight: WEIGHTS.confidence,
        hint: "Strategy engine's self-reported confidence in the recommendation.",
      },
      {
        key: "provenance",
        label: "Provenance",
        value: typeof inputs.provenance_score === "number" ? inputs.provenance_score : null,
        weight: WEIGHTS.provenance,
        hint: "How well tactics cite specific upstream axioms + convergences.",
      },
      {
        key: "coherence",
        label: "Coherence",
        value: typeof inputs.coherence_score === "number" ? inputs.coherence_score : null,
        weight: WEIGHTS.coherence,
        hint: "Post-generation validation: does the strategy contradict any critical axiom?",
      },
    ],
    [inputs],
  );

  // Weighted composite. Missing scores fall back to 50 (neutral) but reduce
  // confidence in the rollup proportionally.
  const hasData = subScores.some((s) => s.value !== null);
  const composite = useMemo(() => {
    if (!hasData) return 0;
    let total = 0;
    let weightUsed = 0;
    for (const s of subScores) {
      const v = s.value ?? 50;
      total += v * s.weight;
      weightUsed += s.weight;
    }
    return Math.round(total / weightUsed);
  }, [subScores, hasData]);

  const tier =
    composite >= 80 ? "ready"
    : composite >= 60 ? "partial"
    : composite >= 40 ? "weak"
    : "not_ready";

  const tierCopy = {
    ready: { label: "Ready to ship", tone: "text-emerald-600", ring: "stroke-emerald-500", glow: "shadow-[0_0_24px_rgba(16,185,129,0.25)]" },
    partial: { label: "Partially ready", tone: "text-amber-600", ring: "stroke-amber-500", glow: "shadow-[0_0_20px_rgba(245,158,11,0.2)]" },
    weak: { label: "Needs work", tone: "text-orange-600", ring: "stroke-orange-500", glow: "shadow-[0_0_16px_rgba(249,115,22,0.18)]" },
    not_ready: { label: "Not ready", tone: "text-red-600", ring: "stroke-red-500", glow: "shadow-[0_0_12px_rgba(239,68,68,0.15)]" },
  }[tier];

  if (!hasData) return null;

  const size = compact ? 56 : 88;
  const strokeWidth = compact ? 5 : 7;
  const radius = size / 2 - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (composite / 100) * circumference;

  return (
    <div
      className={cn(
        "group relative inline-flex items-center gap-3 rounded-2xl bg-white/70 backdrop-blur-xl border border-gray-200/70 px-3.5 py-2.5",
        !reducedMotion && "transition-all duration-300",
        focused && "ring-2 ring-offset-2",
        tier === "ready" && focused && "ring-emerald-300",
        tier === "partial" && focused && "ring-amber-300",
        tier === "weak" && focused && "ring-orange-300",
        tier === "not_ready" && focused && "ring-red-300",
        className,
      )}
      onMouseEnter={() => setFocused(true)}
      onMouseLeave={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      tabIndex={0}
      role="group"
      aria-label={`Strategy readiness: ${composite} out of 100, ${tierCopy.label}`}
    >
      {/* Ring */}
      <div className={cn("relative", !reducedMotion && "transition-shadow duration-500", tierCopy.glow)} style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          {/* Background ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={strokeWidth}
            fill="transparent"
            className="stroke-gray-200/70"
          />
          {/* Progress ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className={cn(!reducedMotion && "transition-all duration-700 ease-out", tierCopy.ring)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("tabular-nums font-bold leading-none", compact ? "text-[18px]" : "text-[26px]")}>
            {composite}
          </span>
          {!compact && (
            <span className="text-[8px] font-semibold uppercase tracking-[0.12em] text-gray-400 mt-0.5">
              of 100
            </span>
          )}
        </div>
      </div>

      {/* Label + sub-bars */}
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("text-[10px] font-bold uppercase tracking-[0.1em]", tierCopy.tone)}>
            {tierCopy.label}
          </span>
          <Info className="h-2.5 w-2.5 text-gray-400" aria-hidden />
        </div>
        <div className="flex flex-col gap-1">
          {subScores.map((s) => {
            const pct = clamp(s.value);
            const available = s.value !== null;
            const barCls = !available
              ? "bg-gray-200/50"
              : pct >= 80 ? "bg-emerald-500/80"
              : pct >= 60 ? "bg-amber-500/80"
              : pct >= 40 ? "bg-orange-500/80"
              : "bg-red-500/80";
            return (
              <div key={s.key} className="flex items-center gap-2" title={s.hint}>
                <span className="text-[9px] font-medium text-gray-500 w-[58px] shrink-0 uppercase tracking-wider">
                  {s.label}
                </span>
                <div className="flex-1 h-1 rounded-full bg-gray-100/80 overflow-hidden min-w-[60px]">
                  <div
                    className={cn("h-full rounded-full", !reducedMotion && "transition-[width] duration-700 ease-out", barCls)}
                    style={{ width: available ? `${pct}%` : "0%" }}
                  />
                </div>
                <span className="text-[9px] tabular-nums text-gray-500 w-6 text-right shrink-0">
                  {available ? pct : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expanded tooltip panel on hover/focus */}
      {focused && (
        <div
          className="absolute z-20 -top-1 left-full ml-3 w-[280px] rounded-2xl bg-gray-900/95 backdrop-blur-xl text-white p-3.5 shadow-2xl ring-1 ring-white/10 pointer-events-none"
          role="tooltip"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1.5">
            Composite readiness
          </div>
          <div className="text-[11px] leading-relaxed text-gray-200 mb-3">
            Weighted rollup of the four reasoning-layer scores. A value below 60
            means the strategy may ship gaps — regenerate with a constraint or
            review uncovered findings before approving.
          </div>
          <div className="space-y-1.5">
            {subScores.map((s) => (
              <div key={s.key} className="flex items-start gap-2">
                <span className="text-[9px] tabular-nums text-gray-400 w-8 shrink-0">
                  {Math.round(s.weight * 100)}%
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10.5px] font-semibold text-gray-100">
                    {s.label}
                    <span className="ml-1 text-[9px] tabular-nums text-gray-400">
                      {s.value !== null ? s.value : "—"}
                    </span>
                  </div>
                  <div className="text-[9.5px] text-gray-400 leading-snug">{s.hint}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
