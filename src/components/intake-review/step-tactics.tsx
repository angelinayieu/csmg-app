"use client";

// ── StepTactics (Arc 5C.2 / P0.2) ──────────────────────────────────────
//
// Step 3 of the intake review. Shows micro_tactics in priority order with
// per-row:
//   • Priority number (editable → reprioritize override)
//   • Title + description
//   • Effort × impact pills
//   • Implementation intention (if-then) — the most actionable signal
//   • Defer toggle
//
// The user benefits here because the strategy might have generated 12
// tactics and they realistically only want to start with 5. Deferring
// prevents those interventions from being upserted.

import { useMemo } from "react";
import { CircleDot, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import type { StrategicRecommendation } from "@/types/strategy";
import type { IntakeReviewState } from "./types";

const EFFORT_CHIP: Record<"low" | "medium" | "high", string> = {
  low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  high: "bg-rose-50 text-rose-700 ring-rose-200",
};

const IMPACT_CHIP: Record<"low" | "medium" | "high", string> = {
  low: "bg-slate-50 text-slate-600 ring-slate-200",
  medium: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  high: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

const TIMEFRAME_LABEL: Record<string, string> = {
  now: "Now",
  short_term: "Short term",
  medium_term: "Medium term",
  long_term: "Long term",
};

interface Props {
  recommendation: StrategicRecommendation;
  state: IntakeReviewState;
  onChange: (next: IntakeReviewState) => void;
}

export function StepTactics({ recommendation, state, onChange }: Props) {
  const reducedMotion = useReducedMotion();

  // Sort tactics by user-overridden priority when set, else by strategy priority.
  const sortedTactics = useMemo(() => {
    const list = [...(recommendation.micro_tactics ?? [])];
    return list.sort((a, b) => {
      const pa = state.tacticPriorityOverrides.get(a.id) ?? a.priority;
      const pb = state.tacticPriorityOverrides.get(b.id) ?? b.priority;
      return pa - pb;
    });
  }, [recommendation.micro_tactics, state.tacticPriorityOverrides]);

  const toggleDefer = (id: string) => {
    const next = new Set(state.deferredTacticIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...state, deferredTacticIds: next });
  };

  const moveTactic = (id: string, direction: "up" | "down") => {
    // Build an ordered array of active (non-deferred) ids so "up"/"down"
    // swaps relative to what the user sees. Deferred tactics are included
    // at their positions but can still be reordered.
    const ordered = sortedTactics.map((t) => t.id);
    const idx = ordered.indexOf(id);
    if (idx < 0) return;
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ordered.length) return;
    [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
    // Write new priorities (1-based) as overrides for everything —
    // ensures the sort order reflects the user's intent.
    const next = new Map(state.tacticPriorityOverrides);
    ordered.forEach((tid, i) => next.set(tid, i + 1));
    onChange({ ...state, tacticPriorityOverrides: next });
  };

  const activeCount = sortedTactics.length - state.deferredTacticIds.size;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-2 text-[11.5px] text-slate-500">
        <CircleDot className="h-3.5 w-3.5 text-emerald-600" />
        <span>
          <span className="font-semibold tabular-nums text-slate-900">{activeCount}</span>{" "}
          of <span className="tabular-nums">{sortedTactics.length}</span> tactics will become
          interventions. Reorder or defer as needed.
        </span>
      </div>

      {/* Tactic cards */}
      {sortedTactics.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          <CircleDot className="h-7 w-7 text-slate-300" aria-hidden />
          <p className="text-[12.5px] text-slate-500">No tactics in this strategy yet.</p>
        </div>
      ) : (
        <ol className="space-y-1.5">
          {sortedTactics.map((t, i) => {
            const deferred = state.deferredTacticIds.has(t.id);
            const displayedPriority =
              state.tacticPriorityOverrides.get(t.id) ?? t.priority;
            return (
              <li
                key={t.id}
                className={cn(
                  "rounded-xl bg-white ring-1 px-3 py-2.5",
                  !reducedMotion && "transition-[opacity,background] duration-150",
                  deferred
                    ? "opacity-50 bg-slate-50 ring-slate-200"
                    : "ring-slate-200/70 hover:shadow-[0_1px_4px_rgba(15,23,42,0.05)]",
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Priority column */}
                  <div className="flex flex-col items-center gap-1 pt-0.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => moveTactic(t.id, "up")}
                      disabled={i === 0}
                      aria-label="Move up"
                      className={cn(
                        "text-slate-300 hover:text-indigo-500 disabled:opacity-30",
                        !reducedMotion && "transition-colors duration-150",
                      )}
                    >
                      <ArrowUpCircle className="h-3 w-3" />
                    </button>
                    <span className="text-[11px] font-bold tabular-nums text-slate-500">
                      {displayedPriority}
                    </span>
                    <button
                      type="button"
                      onClick={() => moveTactic(t.id, "down")}
                      disabled={i === sortedTactics.length - 1}
                      aria-label="Move down"
                      className={cn(
                        "text-slate-300 hover:text-indigo-500 disabled:opacity-30",
                        !reducedMotion && "transition-colors duration-150",
                      )}
                    >
                      <ArrowDownCircle className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-bold text-slate-900">
                      {t.title}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 line-clamp-2">
                      {t.description}
                    </p>

                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-semibold",
                          EFFORT_CHIP[t.effort],
                        )}
                      >
                        {t.effort} effort
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-semibold",
                          IMPACT_CHIP[t.impact],
                        )}
                      >
                        {t.impact} impact
                      </span>
                      {t.timeframe && (
                        <span className="text-[9.5px] text-slate-500 tabular-nums">
                          · {TIMEFRAME_LABEL[t.timeframe] ?? t.timeframe}
                        </span>
                      )}
                    </div>

                    {/* Implementation intention — the highest-signal line */}
                    {t.implementation_intention?.trigger && (
                      <p className="mt-1.5 text-[10.5px] italic leading-relaxed text-slate-500">
                        <span className="font-semibold not-italic text-slate-400">If:</span>{" "}
                        {t.implementation_intention.trigger}
                        {t.implementation_intention.action && (
                          <>
                            <span className="mx-1 text-slate-300">—</span>
                            <span className="font-semibold not-italic text-slate-400">
                              Then:
                            </span>{" "}
                            {t.implementation_intention.action}
                          </>
                        )}
                      </p>
                    )}
                  </div>

                  {/* Defer toggle */}
                  <button
                    type="button"
                    onClick={() => toggleDefer(t.id)}
                    aria-pressed={!deferred}
                    aria-label={deferred ? `Re-enable ${t.title}` : `Defer ${t.title}`}
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-semibold flex-shrink-0 self-start",
                      !reducedMotion && "transition-colors duration-150",
                      deferred
                        ? "bg-slate-200 text-slate-600 hover:bg-slate-300"
                        : "bg-emerald-500 text-white hover:bg-emerald-600",
                    )}
                  >
                    {deferred ? "Deferred" : "Active"}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
