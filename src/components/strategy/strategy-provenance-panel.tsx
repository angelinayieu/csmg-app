"use client";

// ── Strategy provenance panel (Phase 8 of strategy rework) ──
//
// Apple-Vision-Pro-style glass surface showing how well the strategy is
// grounded in the upstream reasoning. Drop-in component; consumes
// StrategicRecommendation.provenance + optional coherence result.
//
// Visual language:
//   • Glass card with subtle backdrop blur
//   • Provenance score ring (tabular-nums, 0-100)
//   • Four breakdown pills: axioms / convergences / gaps / inversions
//   • Red "missed" chips ONLY when strategy left rigor on the table
//   • 8px rhythm, ring-1 color chips, restraint over color

import React from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { StrategicRecommendation } from "@/types/strategy";
import type { CoherenceCheckResult } from "@/lib/pipeline/validate-strategy-coherence";

interface Props {
  recommendation: StrategicRecommendation;
  /** Optional coherence result — if provided, issues surface with severity chips */
  coherence?: CoherenceCheckResult | null;
  /** Optional: strategy staleness — surfaces a "may be stale" banner above the panel */
  staleness?: {
    stale: boolean;
    primary_reason: string;
    summary: string;
  } | null;
  className?: string;
}

export function StrategyProvenancePanel({ recommendation, coherence, staleness, className }: Props) {
  const prov = recommendation.provenance;
  if (!prov) {
    return (
      <section className={cn("rounded-2xl border border-gray-200/70 bg-white/60 backdrop-blur-xl px-5 py-4", className)}>
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <Info className="h-3 w-3" />
          Provenance not yet computed. Regenerate the strategy to populate reasoning backlinks.
        </div>
      </section>
    );
  }

  const score = prov.overall_provenance_score;
  const scoreColor = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-amber-500" : "bg-red-500";
  const scoreTone = score >= 80 ? "text-green-700" : score >= 60 ? "text-amber-700" : "text-red-700";
  const totalMissed = prov.critical_axioms_missed.length + prov.hidden_axioms_missed.length + prov.strong_convergences_missed.length;

  return (
    <section
      className={cn(
        "rounded-2xl border border-gray-200/70 bg-white/60 backdrop-blur-xl px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] space-y-3",
        className,
      )}
    >
      {/* Staleness banner */}
      {staleness?.stale && (
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/60 px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-[1px]" />
          <div className="text-[11px] leading-snug text-amber-800">
            <span className="font-semibold">Strategy may be stale.</span> {staleness.summary}
          </div>
        </div>
      )}

      {/* Score ring + headline */}
      <div className="flex items-center gap-4">
        <span
          className={cn(
            "inline-flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold text-white tabular-nums shadow-sm",
            scoreColor,
          )}
          title="Provenance score: 50% critical-axiom coverage + 30% strong-convergence coverage + 20% gap-closure"
        >
          {score}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
            Strategy provenance
          </div>
          <div className={cn("text-[13px] font-semibold", scoreTone)}>
            {score >= 80
              ? "Grounded strategy"
              : score >= 60
                ? "Partially grounded"
                : "Weakly grounded"}
            {totalMissed === 0 && <span className="ml-2 text-[10px] text-gray-400 font-normal">· no upstream findings missed</span>}
            {totalMissed > 0 && <span className="ml-2 text-[10px] text-red-600 font-normal">· {totalMissed} finding{totalMissed === 1 ? "" : "s"} not addressed</span>}
          </div>
        </div>
        {coherence && (
          <div className="flex items-center gap-1">
            {coherence.passed ? (
              <CheckCircle2 className="h-3 w-3 text-green-600" />
            ) : (
              <AlertTriangle className="h-3 w-3 text-red-500" />
            )}
            <span className="text-[10px] tabular-nums text-gray-500">
              coherence {coherence.coherence_score}
            </span>
          </div>
        )}
      </div>

      {/* Four breakdown pills */}
      <div className="grid grid-cols-4 gap-2 text-[11px]">
        <BreakdownPill
          label="Axioms respected"
          count={prov.axioms_respected.length}
          missedCount={prov.critical_axioms_missed.length}
          tint="purple"
        />
        <BreakdownPill
          label="Convergences addressed"
          count={prov.convergences_addressed.length}
          missedCount={prov.strong_convergences_missed.length}
          tint="indigo"
        />
        <BreakdownPill
          label="Gaps closed"
          count={prov.coverage_gaps_closed.length}
          subtitle={typeof prov.coverage_pct_at_generation === "number" ? `cov ${prov.coverage_pct_at_generation}%` : undefined}
          tint="emerald"
        />
        <BreakdownPill
          label="Inversions tested"
          count={prov.inversions_considered.length}
          tint="pink"
        />
      </div>

      {/* Missed findings list */}
      {totalMissed > 0 && (
        <div className="rounded-xl bg-red-50/40 ring-1 ring-red-100 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-red-600 mb-1.5">
            Findings not addressed
          </div>
          <div className="flex flex-wrap gap-1.5">
            {prov.critical_axioms_missed.map((id) => (
              <span key={`crit-${id}`} className="rounded-full bg-white ring-1 ring-red-200 px-1.5 py-[1px] text-[9px] font-medium text-red-700 tabular-nums">
                critical {id}
              </span>
            ))}
            {prov.hidden_axioms_missed.map((id) => (
              <span key={`hid-${id}`} className="rounded-full bg-white ring-1 ring-rose-300 px-1.5 py-[1px] text-[9px] font-medium text-rose-700 tabular-nums">
                hidden {id}
              </span>
            ))}
            {prov.strong_convergences_missed.map((id) => (
              <span key={`conv-${id}`} className="rounded-full bg-white ring-1 ring-orange-200 px-1.5 py-[1px] text-[9px] font-medium text-orange-700 tabular-nums">
                conv {id}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Coherence issues (expandable) */}
      {coherence && coherence.issues.length > 0 && (
        <div className="rounded-xl bg-gray-50/60 ring-1 ring-gray-100 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-1.5">
            Coherence issues ({coherence.issues.length})
          </div>
          <div className="space-y-1">
            {coherence.issues.map((issue, i) => {
              const sevCls =
                issue.severity === "critical"
                  ? "bg-red-50 text-red-700 ring-red-200"
                  : issue.severity === "high"
                    ? "bg-orange-50 text-orange-700 ring-orange-200"
                    : issue.severity === "medium"
                      ? "bg-amber-50 text-amber-700 ring-amber-200"
                      : "bg-gray-50 text-gray-600 ring-gray-200";
              return (
                <div key={i} className="flex items-start gap-2">
                  <span className={cn("rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide shrink-0", sevCls)}>
                    {issue.severity}
                  </span>
                  <p className="text-[11px] leading-snug text-gray-700">{issue.message}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function BreakdownPill({
  label,
  count,
  missedCount,
  subtitle,
  tint,
}: {
  label: string;
  count: number;
  missedCount?: number;
  subtitle?: string;
  tint: "purple" | "indigo" | "emerald" | "pink";
}) {
  const tintCls: Record<typeof tint, string> = {
    purple: "bg-purple-50/50 ring-purple-100 text-purple-700",
    indigo: "bg-indigo-50/50 ring-indigo-100 text-indigo-700",
    emerald: "bg-emerald-50/50 ring-emerald-100 text-emerald-700",
    pink: "bg-pink-50/50 ring-pink-100 text-pink-700",
  };
  return (
    <div className={cn("rounded-xl ring-1 px-2.5 py-2", tintCls[tint])}>
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] opacity-70 mb-0.5">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[18px] font-bold tabular-nums">{count}</span>
        {typeof missedCount === "number" && missedCount > 0 && (
          <span className="text-[10px] text-red-600 tabular-nums">
            / {missedCount} missed
          </span>
        )}
        {subtitle && !missedCount && <span className="text-[10px] opacity-70">{subtitle}</span>}
      </div>
    </div>
  );
}
