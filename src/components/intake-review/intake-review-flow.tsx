"use client";

// ── IntakeReviewFlow (Arc 5C.2 / P0.2) ─────────────────────────────────
//
// Main orchestrator for the 4-step intake review wizard. Owns:
//   • Current step
//   • IntakeReviewState (deferral choices + priority/target overrides)
//   • Submit handler that POSTs to strategy-refresh with action=confirm
//     and the deferred-keys arrays appended so the backend filters
//     materialization.
//
// Design: Apple Vision Pro — glass frame, 4-dot progress indicator at
// top, one focused step-content area, Back/Next at bottom (Confirm CTA
// lives inside StepConfirm so it's terminal).

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { toast } from "@/lib/hooks/use-toast";
import type { InfrastructureProposal, StrategicRecommendation } from "@/types/strategy";
import { StepProgress } from "./step-progress";
import { StepMetrics } from "./step-metrics";
import { StepApps } from "./step-apps";
import { StepTactics } from "./step-tactics";
import { StepConfirm } from "./step-confirm";
import {
  emptyIntakeReviewState,
  STEP_LABELS,
  STEP_ORDER,
  STEP_SUBTITLES,
  type IntakeStep,
} from "./types";

interface Props {
  spaceId: string;
  recommendation: StrategicRecommendation;
  /**
   * Infrastructure proposals live on the matching RankedStrategy, not on
   * StrategicRecommendation itself. Parent extracts them from
   * `ranked_strategies[matching].infrastructure_proposals[]` and passes
   * them explicitly — same source of truth as the confirm pipeline uses
   * for app materialization.
   */
  proposals: InfrastructureProposal[];
}

export function IntakeReviewFlow({ spaceId, recommendation, proposals }: Props) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [currentStep, setCurrentStep] = useState<IntakeStep>("metrics");
  const [state, setState] = useState(emptyIntakeReviewState());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Compute total tracker count once so StepConfirm can show the total
  // without re-running the preview logic.
  const totalMetricsCount = useMemo(() => {
    const rec = recommendation as unknown as {
      target_objective?: { name?: string };
      perspectives?: Array<{ key_metric?: { name?: string } }>;
      micro_tactics?: Array<{ metric?: { name?: string } }>;
      learning_loop?: {
        leading_indicators?: Array<{ name?: string }>;
        lagging_indicator?: { name?: string };
      };
    };
    let n = 0;
    if (rec.target_objective?.name) n++;
    for (const p of rec.perspectives ?? []) if (p.key_metric?.name) n++;
    for (const t of rec.micro_tactics ?? []) if (t.metric?.name) n++;
    if (rec.learning_loop?.lagging_indicator?.name) n++;
    for (const li of rec.learning_loop?.leading_indicators ?? []) {
      if (li?.name) n++;
    }
    return n;
  }, [recommendation]);

  const currentIndex = STEP_ORDER.indexOf(currentStep);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === STEP_ORDER.length - 1;

  const goPrev = useCallback(() => {
    if (isFirst) return;
    setCurrentStep(STEP_ORDER[currentIndex - 1]);
  }, [currentIndex, isFirst]);

  const goNext = useCallback(() => {
    if (isLast) return;
    setCurrentStep(STEP_ORDER[currentIndex + 1]);
  }, [currentIndex, isLast]);

  const handleConfirm = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          action: "confirm",
          // Arc 5C.2 intake-review deferred-keys extensions. Backend
          // filters the materialization arrays by these before upserting.
          deferred_tracker_keys: Array.from(state.deferredTrackerKeys),
          deferred_proposal_ids: Array.from(state.deferredProposalIds),
          deferred_tactic_ids: Array.from(state.deferredTacticIds),
          // Priority + target overrides apply BEFORE materialization so
          // the trackers / intervention rows carry the user's intent.
          tactic_priority_overrides: Object.fromEntries(state.tacticPriorityOverrides),
          tracker_target_overrides: Object.fromEntries(state.trackerTargetOverrides),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success("Strategy confirmed", {
        description: "Tracking is live. Dashboard will show your new pulse.",
      });
      router.push(`/app/space/${spaceId}`);
      router.refresh();
    } catch (e) {
      const msg = (e as Error).message ?? "Confirm failed";
      setSubmitError(msg);
      toast.error("Couldn't confirm strategy", { description: msg });
    } finally {
      setSubmitting(false);
    }
  }, [spaceId, state, router]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50/60 pb-16">
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-4 sm:px-6">
        {/* Top bar — close button + subtle breadcrumb */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-indigo-600">
              Intake review
            </div>
            <div className="text-[12.5px] text-slate-500">
              Check your strategy before it materializes.
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/app/space/${spaceId}`)}
            aria-label="Exit intake review"
            title="Exit without confirming"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700",
              !reducedMotion && "transition-colors duration-150",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress indicator */}
        <StepProgress currentStep={currentStep} onJumpTo={setCurrentStep} />

        {/* Step header */}
        <header className="mt-6 mb-4">
          <h1 className="text-[18px] font-bold tracking-tight text-slate-900">
            {STEP_LABELS[currentStep]}
          </h1>
          <p className="mt-1 text-[12.5px] text-slate-500 leading-relaxed">
            {STEP_SUBTITLES[currentStep]}
          </p>
        </header>

        {/* Step body */}
        <main
          className={cn(
            "rounded-2xl bg-white/85 backdrop-blur-xl ring-1 ring-slate-200/70 px-4 py-4 sm:px-5 sm:py-5",
            "shadow-[0_1px_3px_rgba(15,23,42,0.04)]",
            !reducedMotion && "transition-opacity duration-180",
          )}
        >
          {currentStep === "metrics" && (
            <StepMetrics
              recommendation={recommendation}
              state={state}
              onChange={setState}
            />
          )}
          {currentStep === "apps" && (
            <StepApps
              proposals={proposals}
              state={state}
              onChange={setState}
            />
          )}
          {currentStep === "tactics" && (
            <StepTactics
              recommendation={recommendation}
              state={state}
              onChange={setState}
            />
          )}
          {currentStep === "confirm" && (
            <StepConfirm
              recommendation={recommendation}
              proposals={proposals}
              state={state}
              onConfirm={handleConfirm}
              submitting={submitting}
              submitError={submitError}
              totalMetricsCount={totalMetricsCount}
            />
          )}
        </main>

        {/* Back / Next nav — Confirm CTA lives inside StepConfirm instead. */}
        {!isLast && (
          <footer className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={goPrev}
              disabled={isFirst}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold",
                isFirst
                  ? "text-slate-300 cursor-not-allowed"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
                !reducedMotion && "transition-colors duration-150",
              )}
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </button>
            <button
              type="button"
              onClick={goNext}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 px-4 py-2 text-[12px] font-semibold text-white",
                "shadow-[0_1px_2px_rgba(99,102,241,0.3)] hover:bg-indigo-600",
                !reducedMotion && "transition-colors duration-150",
              )}
            >
              Next
              <ArrowRight className="h-3 w-3" />
            </button>
          </footer>
        )}
        {isLast && (
          <footer className="mt-4 flex items-center justify-start">
            <button
              type="button"
              onClick={goPrev}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-[12px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
                !reducedMotion && "transition-colors duration-150",
              )}
            >
              <ArrowLeft className="h-3 w-3" />
              Back to adjust
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
