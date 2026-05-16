// ── Phase 2 — Strategy doc progress + action surfaces ──
//
// Three components, all driven by the existing plan_step blocks +
// their per-step `meta.status` (Phase 2 user-authored) and the LLM-
// tagged Phase 1 fields (`first_action`, `category`, `duration_estimate`,
// `effort_level`, `depends_on`).
//
//   - ProgressStrip — thin effort-weighted progress line under the
//                     section title. Always renders when plan_steps
//                     exist; 0% bar at start is a soft commitment cue.
//   - TodayHero — action-first card above the doc body. Picks the
//                 first pending/in-progress step whose dependencies
//                 are all done (dependency-aware). Renders first_action
//                 as the hero sentence; falls back to body for
//                 pre-Phase-1 strategies.
//   - StrategyCompleteHero — celebration variant of TodayHero shown
//                            when every plan_step has status="done".
//
// All three are pure render — state lives in the parent. Status
// mutations happen via the existing PATCH endpoint (whitelisted +
// validated for "status" in Phase 2's API change).

"use client";

import { ArrowRight, Check, RefreshCw, Sparkles } from "lucide-react";
import { getStepIcon } from "@/lib/synergy/step-icons";
import type {
  PlanStepMeta,
  PlanStepStatus,
  SynergyStrategyBlock,
} from "@/lib/synergy/types";

// ── Effort weighting ──
// Heavy steps count for more than light steps in the progress %. The
// LLM authors `effort_level` for new strategies (Phase 1). Pre-Phase-1
// strategies fall through to a neutral weight of 1 — the progress
// strip still works, it just degrades to a step-count proxy.
const EFFORT_WEIGHT = { light: 1, medium: 2, heavy: 3 } as const;
function weightOf(meta: PlanStepMeta): number {
  if (meta.effort_level) return EFFORT_WEIGHT[meta.effort_level];
  return 1;
}

function statusOf(block: SynergyStrategyBlock): PlanStepStatus {
  const m = block.meta as PlanStepMeta;
  return (m.status as PlanStepStatus | undefined) ?? "pending";
}

/** Pick the next step the user should focus on.
 *
 * Walks the plan in order; for each not-yet-done step, checks that all
 * `depends_on` indices reference steps with status === "done". The
 * first eligible step wins. If no step is eligible (rare — usually
 * means a circular dependency or a malformed depends_on array), falls
 * back to the lowest-index non-done step so the hero is never empty.
 *
 * Prefers `in_progress` over `pending` when both are eligible — the
 * user already committed to that step; surfacing it back keeps the
 * momentum continuous across sessions.
 */
export function selectNextStep(
  planSteps: SynergyStrategyBlock[],
): { block: SynergyStrategyBlock; index: number } | null {
  if (planSteps.length === 0) return null;

  const stepStatuses = planSteps.map(statusOf);

  // Eligibility = not done AND all prerequisites done
  const isEligible = (i: number): boolean => {
    if (stepStatuses[i] === "done") return false;
    const meta = planSteps[i].meta as PlanStepMeta;
    const deps = meta.depends_on ?? [];
    return deps.every((d) => stepStatuses[d] === "done");
  };

  // Prefer in_progress
  for (let i = 0; i < planSteps.length; i++) {
    if (stepStatuses[i] === "in_progress" && isEligible(i)) {
      return { block: planSteps[i], index: i };
    }
  }
  // Then earliest eligible pending
  for (let i = 0; i < planSteps.length; i++) {
    if (stepStatuses[i] === "pending" && isEligible(i)) {
      return { block: planSteps[i], index: i };
    }
  }
  // Fallback: earliest non-done regardless of deps
  for (let i = 0; i < planSteps.length; i++) {
    if (stepStatuses[i] !== "done") {
      return { block: planSteps[i], index: i };
    }
  }
  return null;
}

// ── ProgressStrip ──

export function ProgressStrip({
  planSteps,
}: {
  planSteps: SynergyStrategyBlock[];
}) {
  if (planSteps.length === 0) return null;

  let totalWeight = 0;
  let doneWeight = 0;
  let doneCount = 0;
  for (const b of planSteps) {
    const w = weightOf(b.meta as PlanStepMeta);
    totalWeight += w;
    if (statusOf(b) === "done") {
      doneWeight += w;
      doneCount++;
    }
  }
  const effortPct =
    totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0;

  // If no step has an effort_level (pre-Phase 1), the effort % is
  // identical to step-count %, so we omit the effort suffix to avoid
  // redundancy.
  const anyEffortTagged = planSteps.some(
    (b) => !!(b.meta as PlanStepMeta).effort_level,
  );

  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-gray-200/70">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gray-900 transition-[width] duration-500 ease-out"
          style={{ width: `${effortPct}%` }}
        />
      </div>
      <div className="shrink-0 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
        {doneCount} of {planSteps.length} done
        {anyEffortTagged && doneCount > 0 ? ` · ${effortPct}% effort` : ""}
      </div>
    </div>
  );
}

// ── TodayHero ──

interface HeroProps {
  planSteps: SynergyStrategyBlock[];
  onStartStep: (block: SynergyStrategyBlock) => void | Promise<void>;
  onSkipStep: () => void;
}

export function TodayHero({ planSteps, onStartStep, onSkipStep }: HeroProps) {
  const next = selectNextStep(planSteps);
  if (!next) return null;

  const { block, index } = next;
  const meta = block.meta as PlanStepMeta;
  const status: PlanStepStatus = (meta.status as PlanStepStatus) ?? "pending";
  const Icon = getStepIcon(meta, block.body);

  // The hero sentence: prefer LLM-authored first_action (Phase 1),
  // fall back to block body for pre-Phase-1 strategies.
  const heroSentence = meta.first_action?.trim() || block.body;

  // Compact meta pills under the hero — duration + effort. Same source
  // as the per-row pills but rendered slightly larger so they read as
  // first-class info rather than metadata.
  const duration = meta.duration_estimate?.trim();
  const effortLabel = meta.effort_level
    ? meta.effort_level.charAt(0).toUpperCase() + meta.effort_level.slice(1)
    : null;

  const isResuming = status === "in_progress";

  return (
    <section
      aria-label={`Next action — Step ${index + 1}`}
      className="relative mb-6 overflow-hidden rounded-3xl bg-white/85 ring-1 ring-black/[0.04] backdrop-blur-2xl"
      style={{
        boxShadow:
          "0 20px 50px -24px rgba(15,23,42,0.16), 0 1px 0 rgba(255,255,255,0.6) inset",
      }}
    >
      {/* Left-edge blue rail signals "primary attention point" — same
          treatment as the elevator pitch from Tier 1 so the visual
          vocabulary is consistent across the doc. */}
      <span
        aria-hidden
        className="absolute left-0 top-5 bottom-5 w-[3px] rounded-full bg-blue-600/85"
      />

      <div className="px-7 py-5 pl-9">
        {/* Mono caps label + position */}
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
            {isResuming ? "Continue" : "Do today"}{" "}
            <span className="text-gray-400">
              · Step {index + 1} of {planSteps.length}
            </span>
          </div>
        </div>

        {/* Glyph + title — large, action-oriented */}
        <div className="mt-3 flex items-start gap-3">
          <div
            className="mt-[1px] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-gray-700 ring-1 ring-black/[0.06]"
            style={{
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(15,23,42,0.04)",
            }}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
          <h2 className="font-display-tight flex-1 text-[19px] font-semibold leading-snug tracking-tight text-gray-900">
            {meta.title || "Step"}
          </h2>
        </div>

        {/* The hero sentence — the do-able-right-now action. */}
        <p className="mt-3 text-[15px] leading-[1.55] text-gray-700">
          {heroSentence}
        </p>

        {/* Meta pills + success signal */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {duration && (
            <span className="inline-flex items-center rounded-md bg-gray-50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-gray-600 ring-1 ring-black/[0.04]">
              {duration}
            </span>
          )}
          {effortLabel && (
            <span className="inline-flex items-center rounded-md bg-gray-50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-gray-600 ring-1 ring-black/[0.04]">
              {effortLabel} effort
            </span>
          )}
        </div>

        {meta.success_signal && (
          <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-400">
              done when
            </span>{" "}
            · {meta.success_signal}
          </p>
        )}

        {/* Action row */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => onStartStep(block)}
            className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-gray-700"
          >
            {isResuming ? "Mark done" : "Mark started"}
            <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
          </button>
          {planSteps.length > 1 && (
            <button
              onClick={onSkipStep}
              className="inline-flex items-center text-[12px] font-medium text-gray-500 transition hover:text-gray-900"
            >
              Skip for now
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ── StrategyCompleteHero ──

export function StrategyCompleteHero({
  totalSteps,
  onRegenerate,
}: {
  totalSteps: number;
  onRegenerate: () => void;
}) {
  return (
    <section
      aria-label="Strategy complete"
      className="relative mb-6 overflow-hidden rounded-3xl bg-white/85 ring-1 ring-black/[0.04] backdrop-blur-2xl"
      style={{
        boxShadow:
          "0 20px 50px -24px rgba(15,23,42,0.16), 0 1px 0 rgba(255,255,255,0.6) inset",
      }}
    >
      {/* Soft emerald rail — different from the hero blue, signals
          "you finished" without being loud about it. */}
      <span
        aria-hidden
        className="absolute left-0 top-5 bottom-5 w-[3px] rounded-full bg-emerald-500/80"
      />

      <div className="px-7 py-5 pl-9">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-700">
          Strategy complete
        </div>

        <div className="mt-3 flex items-start gap-3">
          <div className="mt-[1px] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60">
            <Check className="h-4 w-4" strokeWidth={2.25} />
          </div>
          <h2 className="font-display-tight flex-1 text-[19px] font-semibold leading-snug tracking-tight text-gray-900">
            {totalSteps} of {totalSteps} steps done
          </h2>
        </div>

        <p className="mt-3 text-[15px] leading-[1.55] text-gray-700">
          Everything you wrote yourself up to do, you did. What did you learn —
          and what comes next?
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={onRegenerate}
            className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-gray-700"
          >
            <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
            Regenerate from updates
          </button>
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-gray-500">
            <Sparkles className="h-3 w-3" />
            (or share what you learned via the Share button)
          </span>
        </div>
      </div>
    </section>
  );
}
