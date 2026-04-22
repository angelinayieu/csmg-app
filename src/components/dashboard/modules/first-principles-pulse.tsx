"use client";

// ── FirstPrinciplesPulse (Arc 5.5 Phase D) ─────────────────────────────
//
// Top-of-dashboard horizontal strip that makes the first-principles
// reasoning layer VISIBLE. Before this module, axioms + convergences +
// coverage were computed by synthesis and used by strategy generation,
// but nothing on the main dashboard signaled their existence.
//
// This module renders three segments, each linked to the relevant detail
// page:
//   1. Axioms   — N extracted · M grounding the strategy
//   2. Convergences — N detected across L1-L4 with a depth breakdown
//   3. Coverage — P% of critical findings covered + gaps summary
//
// Design: horizontal segmented bar with subtle depth shifts between
// segments. Apple Vision Pro language — restrained color, tabular-nums,
// reduced-motion respected.
//
// Data source: reads directly from props (synthData + strategyData) so
// no new API. Parent (dashboard-grid) owns the fetch.

import { useMemo } from "react";
import Link from "next/link";
import { Zap, Compass, Target, ArrowRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

// Types exported so dashboard-grid can type the props it threads through
// without having to `Parameters<typeof X>[0]` each field individually.
export interface FPPAxiom {
  id?: string;
  name?: string;
  statement?: string;
  tier?: string;
  is_critical?: boolean;
  is_hidden?: boolean;
}

export interface FPPConvergence {
  id?: string;
  insight?: string;
  pattern?: string;
  depth?: "L1" | "L2" | "L3" | "L4" | string;
  supporting_signals?: unknown[];
}

export interface FPPStrategyCoverage {
  critical_findings_total?: number;
  critical_findings_covered?: number;
  coverage_pct?: number;
  gaps?: Array<{ id?: string; description?: string }>;
}

export interface FPPStrategyProvenance {
  axioms_respected?: string[];
  convergences_addressed?: string[];
  coverage_gaps_closed?: string[];
}

type Axiom = FPPAxiom;
type Convergence = FPPConvergence;
type StrategyCoverage = FPPStrategyCoverage;
type StrategyProvenance = FPPStrategyProvenance;

interface Props {
  spaceId: string;
  axioms?: Axiom[] | null;
  convergences?: Convergence[] | null;
  coverage?: StrategyCoverage | null;
  strategyProvenance?: StrategyProvenance | null;
  className?: string;
}

const DEPTH_TINT: Record<string, string> = {
  L4: "bg-indigo-500",
  L3: "bg-amber-500",
  L2: "bg-violet-500",
  L1: "bg-cyan-500",
};

export function FirstPrinciplesPulse({
  spaceId,
  axioms,
  convergences,
  coverage,
  strategyProvenance,
  className,
}: Props) {
  const reducedMotion = useReducedMotion();

  const axiomStats = useMemo(() => {
    const list = axioms ?? [];
    const critical = list.filter((a) => a.is_critical).length;
    const hidden = list.filter((a) => a.is_hidden).length;
    const respectedSet = new Set(strategyProvenance?.axioms_respected ?? []);
    const respected = list.filter((a) => a.id && respectedSet.has(a.id)).length;
    return { total: list.length, critical, hidden, respected };
  }, [axioms, strategyProvenance?.axioms_respected]);

  const convergenceStats = useMemo(() => {
    const list = convergences ?? [];
    const byDepth = new Map<string, number>();
    for (const c of list) {
      const d = c.depth ?? "L1";
      byDepth.set(d, (byDepth.get(d) ?? 0) + 1);
    }
    const addressedSet = new Set(strategyProvenance?.convergences_addressed ?? []);
    const addressed = list.filter((c) => c.id && addressedSet.has(c.id)).length;
    return {
      total: list.length,
      byDepth,
      addressed,
    };
  }, [convergences, strategyProvenance?.convergences_addressed]);

  const coverageStats = useMemo(() => {
    if (!coverage) return null;
    const total = coverage.critical_findings_total ?? 0;
    const covered = coverage.critical_findings_covered ?? 0;
    const pct =
      typeof coverage.coverage_pct === "number"
        ? Math.round(coverage.coverage_pct)
        : total > 0
          ? Math.round((covered / total) * 100)
          : null;
    const gapCount = (coverage.gaps ?? []).length;
    return { total, covered, pct, gapCount };
  }, [coverage]);

  // Don't render if there's nothing to show (empty dashboards shouldn't
  // get a fake-busy pulse bar).
  const hasAny =
    axiomStats.total > 0 ||
    convergenceStats.total > 0 ||
    (coverageStats && coverageStats.pct !== null);
  if (!hasAny) return null;

  return (
    <section
      className={cn(
        "rounded-2xl bg-gradient-to-r from-indigo-50/40 via-white/85 to-amber-50/30 backdrop-blur-xl",
        "ring-1 ring-slate-200/70 shadow-[0_1px_3px_rgba(15,23,42,0.04)]",
        "overflow-hidden",
        className,
      )}
      aria-label="First-principles reasoning pulse"
    >
      <div className="flex items-stretch divide-x divide-slate-200/60">
        {/* Header label */}
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 ring-1 ring-indigo-200">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-indigo-700">
              Reasoning layer
            </div>
            <div className="text-[10.5px] font-medium text-slate-500">
              First-principles grounding
            </div>
          </div>
        </div>

        {/* Axioms segment */}
        <Segment
          href={`/app/space/${spaceId}/strategy`}
          label="Axioms"
          icon={<Zap className="h-3 w-3" />}
          iconTint="text-amber-600"
          reducedMotion={reducedMotion}
        >
          <div className="flex items-baseline gap-1">
            <span className="tabular-nums text-[18px] font-bold text-slate-900">
              {axiomStats.total}
            </span>
            <span className="text-[10px] font-medium text-slate-500">extracted</span>
          </div>
          <div className="mt-0.5 text-[10.5px] text-slate-600 tabular-nums">
            {axiomStats.respected > 0 ? (
              <>
                <span className="font-semibold text-emerald-700">
                  {axiomStats.respected}
                </span>{" "}
                grounding strategy
              </>
            ) : axiomStats.total > 0 ? (
              <span className="text-slate-500">strategy not confirmed yet</span>
            ) : null}
          </div>
          {axiomStats.critical > 0 && (
            <div className="mt-1 inline-flex items-center rounded-full bg-amber-50 px-1.5 py-[1px] text-[9.5px] font-semibold text-amber-700 ring-1 ring-amber-200 tabular-nums">
              {axiomStats.critical} critical
            </div>
          )}
        </Segment>

        {/* Convergences segment */}
        <Segment
          href={`/app/space/${spaceId}/convergence`}
          label="Convergences"
          icon={<Compass className="h-3 w-3" />}
          iconTint="text-indigo-600"
          reducedMotion={reducedMotion}
        >
          <div className="flex items-baseline gap-1">
            <span className="tabular-nums text-[18px] font-bold text-slate-900">
              {convergenceStats.total}
            </span>
            <span className="text-[10px] font-medium text-slate-500">detected</span>
          </div>
          <div className="mt-0.5 text-[10.5px] text-slate-600 tabular-nums">
            {convergenceStats.addressed > 0 ? (
              <>
                <span className="font-semibold text-emerald-700">
                  {convergenceStats.addressed}
                </span>{" "}
                addressed
              </>
            ) : convergenceStats.total > 0 ? (
              <span className="text-slate-500">strategy not confirmed yet</span>
            ) : null}
          </div>
          {convergenceStats.byDepth.size > 0 && (
            <div className="mt-1 flex items-center gap-1">
              {["L4", "L3", "L2", "L1"].map((depth) => {
                const count = convergenceStats.byDepth.get(depth) ?? 0;
                if (count === 0) return null;
                return (
                  <span
                    key={depth}
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-full px-1.5 py-[1px] text-[9.5px] font-semibold text-white tabular-nums",
                      DEPTH_TINT[depth] ?? "bg-slate-500",
                    )}
                    title={`${count} ${depth} convergence${count === 1 ? "" : "s"}`}
                  >
                    {depth} {count}
                  </span>
                );
              })}
            </div>
          )}
        </Segment>

        {/* Coverage segment */}
        <Segment
          href={`/app/space/${spaceId}/strategy`}
          label="Coverage"
          icon={<Target className="h-3 w-3" />}
          iconTint="text-emerald-600"
          reducedMotion={reducedMotion}
        >
          {coverageStats && coverageStats.pct !== null ? (
            <>
              <div className="flex items-baseline gap-1">
                <span
                  className={cn(
                    "tabular-nums text-[18px] font-bold",
                    coverageStats.pct >= 70
                      ? "text-emerald-700"
                      : coverageStats.pct >= 40
                        ? "text-amber-700"
                        : "text-rose-700",
                  )}
                >
                  {coverageStats.pct}%
                </span>
                <span className="text-[10px] font-medium text-slate-500">of findings</span>
              </div>
              <div className="mt-0.5 text-[10.5px] text-slate-600 tabular-nums">
                <span className="font-semibold text-slate-700">
                  {coverageStats.covered}
                </span>{" "}
                of {coverageStats.total} covered
              </div>
              {coverageStats.gapCount > 0 && (
                <div className="mt-1 inline-flex items-center rounded-full bg-rose-50 px-1.5 py-[1px] text-[9.5px] font-semibold text-rose-700 ring-1 ring-rose-200 tabular-nums">
                  {coverageStats.gapCount} gap{coverageStats.gapCount === 1 ? "" : "s"}
                </div>
              )}
            </>
          ) : (
            <div className="text-[11px] text-slate-400 italic">not yet computed</div>
          )}
        </Segment>
      </div>
    </section>
  );
}

function Segment({
  href,
  label,
  icon,
  iconTint,
  reducedMotion,
  children,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  iconTint: string;
  reducedMotion: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-1 flex-col gap-0.5 px-4 py-3 min-w-0",
        "hover:bg-white/60",
        !reducedMotion && "transition-colors duration-150",
      )}
      aria-label={`${label} — click to view details`}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn(iconTint)}>{icon}</span>
        <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-slate-500">
          {label}
        </span>
        <ArrowRight
          className={cn(
            "ml-auto h-3 w-3 text-slate-300 opacity-0 group-hover:opacity-100",
            !reducedMotion && "transition-opacity duration-150",
          )}
        />
      </div>
      {children}
    </Link>
  );
}
