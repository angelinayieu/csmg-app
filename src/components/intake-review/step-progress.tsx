"use client";

// ── StepProgress (Arc 5C.2 / P0.2) ─────────────────────────────────────
//
// Sticky top indicator for the 4-step intake review. Each step renders
// as a labeled pill; the current step is indigo-solid, completed steps
// are emerald-outlined, future steps are slate-ghost.
//
// Clicking a completed step jumps back — future steps are non-clickable
// until reached. Keyboard: left/right arrows when focused inside.

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { STEP_LABELS, STEP_ORDER, type IntakeStep } from "./types";

interface Props {
  currentStep: IntakeStep;
  onJumpTo: (step: IntakeStep) => void;
  className?: string;
}

export function StepProgress({ currentStep, onJumpTo, className }: Props) {
  const reducedMotion = useReducedMotion();
  const currentIndex = STEP_ORDER.indexOf(currentStep);

  return (
    <nav
      aria-label="Intake review progress"
      className={cn(
        "flex items-center gap-2 rounded-2xl bg-white/82 backdrop-blur-xl ring-1 ring-slate-200/70",
        "shadow-[0_1px_3px_rgba(15,23,42,0.04)] px-3 py-2",
        className,
      )}
    >
      {STEP_ORDER.map((step, i) => {
        const isCurrent = step === currentStep;
        const isComplete = i < currentIndex;
        const isFuture = i > currentIndex;
        const canClick = !isFuture;
        return (
          <div key={step} className="flex items-center gap-2 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => canClick && onJumpTo(step)}
              aria-current={isCurrent ? "step" : undefined}
              disabled={isFuture}
              className={cn(
                "group flex items-center gap-2 rounded-xl px-3 py-1.5 min-w-0 flex-1",
                !reducedMotion && "transition-colors duration-150",
                isCurrent &&
                  "bg-indigo-500 text-white shadow-[0_1px_2px_rgba(99,102,241,0.3)]",
                isComplete &&
                  "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100",
                isFuture && "text-slate-400 cursor-not-allowed",
                !isCurrent && !isComplete && !isFuture && "text-slate-500 hover:bg-slate-50",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums",
                  isCurrent && "bg-white/20 text-white",
                  isComplete && "bg-emerald-500 text-white",
                  isFuture && "bg-slate-200 text-slate-400",
                  !isCurrent && !isComplete && !isFuture && "bg-slate-100 text-slate-500",
                )}
              >
                {isComplete ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="truncate text-[11.5px] font-semibold tracking-tight">
                {STEP_LABELS[step]}
              </span>
            </button>
            {i < STEP_ORDER.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-px flex-1 min-w-[12px]",
                  i < currentIndex ? "bg-emerald-200" : "bg-slate-200",
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
