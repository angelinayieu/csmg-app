"use client";

// ── StepConfirm (Arc 5C.2 / P0.2) ──────────────────────────────────────
//
// Step 4 of the intake review. Shows the final materialization diff:
//   • X of Y metrics will be tracked (Z deferred)
//   • A of B apps will be built (C deferred)
//   • D of E tactics will be scheduled (F deferred)
//   • Tactic priority overrides summary (if any)
//
// Big CONFIRM CTA at the bottom. On click, the parent posts to
// strategy-refresh with action=confirm + all the deferred-keys arrays.

import { CheckCircle2, Target, LayoutGrid, CircleDot, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import type { InfrastructureProposal, MicroTactic, StrategicRecommendation } from "@/types/strategy";
import type { IntakeReviewState } from "./types";

interface Props {
  recommendation: StrategicRecommendation;
  /** Pulled from ranked_strategies[matching] at the parent. */
  proposals: InfrastructureProposal[];
  state: IntakeReviewState;
  onConfirm: () => void;
  submitting: boolean;
  submitError: string | null;
  /** Used to compute the metrics total (mirrors StepMetrics preview). */
  totalMetricsCount: number;
}

export function StepConfirm({
  recommendation,
  proposals,
  state,
  onConfirm,
  submitting,
  submitError,
  totalMetricsCount,
}: Props) {
  const reducedMotion = useReducedMotion();

  const tactics: MicroTactic[] = recommendation.micro_tactics ?? [];

  const metricsActive = totalMetricsCount - state.deferredTrackerKeys.size;
  const appsActive = proposals.length - state.deferredProposalIds.size;
  const tacticsActive = tactics.length - state.deferredTacticIds.size;

  const reprioritizedCount = state.tacticPriorityOverrides.size;
  const targetOverrideCount = state.trackerTargetOverrides.size;

  return (
    <div className="space-y-4">
      <header className="flex items-start gap-3">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
            Ready to commit
          </div>
          <p className="mt-0.5 text-[12.5px] text-slate-600 leading-relaxed">
            Here&apos;s exactly what will be created. You can still go back to any step to
            adjust — nothing is saved until you press Confirm.
          </p>
        </div>
      </header>

      {/* Summary cards */}
      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <SummaryCard
          icon={<Target className="h-3.5 w-3.5" />}
          label="Metrics"
          active={metricsActive}
          total={totalMetricsCount}
          deferred={state.deferredTrackerKeys.size}
          accent="text-emerald-600 bg-emerald-50 ring-emerald-200"
          note={
            targetOverrideCount > 0
              ? `${targetOverrideCount} target${targetOverrideCount === 1 ? "" : "s"} adjusted`
              : null
          }
        />
        <SummaryCard
          icon={<LayoutGrid className="h-3.5 w-3.5" />}
          label="Apps"
          active={appsActive}
          total={proposals.length}
          deferred={state.deferredProposalIds.size}
          accent="text-indigo-600 bg-indigo-50 ring-indigo-200"
          note={null}
        />
        <SummaryCard
          icon={<CircleDot className="h-3.5 w-3.5" />}
          label="Tactics"
          active={tacticsActive}
          total={tactics.length}
          deferred={state.deferredTacticIds.size}
          accent="text-amber-600 bg-amber-50 ring-amber-200"
          note={
            reprioritizedCount > 0
              ? `${reprioritizedCount} reprioritized`
              : null
          }
        />
      </ul>

      {/* Deferred list (brief peek, optional expansion) */}
      {(state.deferredTrackerKeys.size > 0 ||
        state.deferredProposalIds.size > 0 ||
        state.deferredTacticIds.size > 0) && (
        <details className="rounded-2xl bg-slate-50/70 ring-1 ring-slate-200/70 px-3 py-2">
          <summary className="text-[11px] font-semibold text-slate-600 cursor-pointer">
            Deferred items (click to expand)
          </summary>
          <div className="mt-2 space-y-1 text-[11px] text-slate-500">
            {state.deferredTrackerKeys.size > 0 && (
              <div>
                <span className="font-semibold text-slate-600">Metrics:</span>{" "}
                {Array.from(state.deferredTrackerKeys).slice(0, 5).join(", ")}
                {state.deferredTrackerKeys.size > 5 &&
                  ` + ${state.deferredTrackerKeys.size - 5} more`}
              </div>
            )}
            {state.deferredProposalIds.size > 0 && (
              <div>
                <span className="font-semibold text-slate-600">Apps:</span>{" "}
                {proposals
                  .filter((p: InfrastructureProposal) => state.deferredProposalIds.has(p.id))
                  .slice(0, 5)
                  .map((p: InfrastructureProposal) => p.name)
                  .join(", ")}
                {state.deferredProposalIds.size > 5 &&
                  ` + ${state.deferredProposalIds.size - 5} more`}
              </div>
            )}
            {state.deferredTacticIds.size > 0 && (
              <div>
                <span className="font-semibold text-slate-600">Tactics:</span>{" "}
                {tactics
                  .filter((t) => state.deferredTacticIds.has(t.id))
                  .slice(0, 5)
                  .map((t) => t.title)
                  .join(", ")}
                {state.deferredTacticIds.size > 5 &&
                  ` + ${state.deferredTacticIds.size - 5} more`}
              </div>
            )}
          </div>
        </details>
      )}

      {/* Error */}
      {submitError && (
        <div
          className="rounded-xl bg-rose-50/60 ring-1 ring-rose-200/70 px-3 py-2 text-[11.5px] text-rose-700"
          role="alert"
        >
          {submitError}
        </div>
      )}

      {/* Confirm CTA */}
      <button
        type="button"
        onClick={onConfirm}
        disabled={submitting}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3.5 text-[14px] font-semibold text-white",
          "shadow-[0_2px_8px_rgba(16,185,129,0.25)]",
          "hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-70",
          !reducedMotion && "transition-all duration-150 hover:scale-[1.005] active:scale-[0.995]",
        )}
        aria-live="polite"
      >
        <CheckCircle2 className="h-4 w-4" />
        {submitting ? "Materializing…" : "Confirm & launch workflow"}
      </button>
      <p className="text-center text-[10.5px] text-slate-400">
        Creates the metric trackers, apps, and interventions you&apos;ve selected. Deferred
        items can be revisited later from the strategy page.
      </p>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  active,
  total,
  deferred,
  accent,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  active: number;
  total: number;
  deferred: number;
  accent: string;
  note: string | null;
}) {
  return (
    <li
      className={cn(
        "rounded-2xl bg-white ring-1 ring-slate-200/70 px-3.5 py-3",
        "shadow-[0_1px_3px_rgba(15,23,42,0.03)]",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-lg ring-1",
            accent,
          )}
        >
          {icon}
        </span>
        <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
          {label}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="tabular-nums text-[22px] font-bold text-slate-900">{active}</span>
        <span className="text-[11px] text-slate-400">of {total}</span>
      </div>
      {deferred > 0 && (
        <div className="mt-0.5 text-[10px] text-slate-400 tabular-nums">
          {deferred} deferred
        </div>
      )}
      {note && <div className="mt-0.5 text-[10px] text-slate-500">{note}</div>}
    </li>
  );
}
