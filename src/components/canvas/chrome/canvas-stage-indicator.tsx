"use client";

// ── Canvas stage indicator (Phase 8) ──
//
// Top-center chrome strip that names where the active pipeline run
// currently is in the breadth → depth → weave → strategize → test
// narrative. Reads from the existing `useLatestStageBoundary` hook
// and maps the canonical `PipelineStage` enum to user-facing labels.
//
// The user explicitly raised that the canvas didn't visually convey
// the order of generation: "we focus on breadth (expanding the KG
// and their respective branches) before going into depth, then we
// look at how things weave together." This strip surfaces exactly
// that ordering.
//
// Renders nothing when:
//   - no run context (no provider mounted, no active SSE)
//   - no stage_boundary event has fired yet
//   - run terminal status is older than 8 seconds (auto-fades after
//     the run completes so the strip doesn't linger)
//
// Mounted via the InFrontOfTheCanvas slot in interaxis-canvas.tsx so
// it lives inside the canvas chrome stack.

import { useEffect, useMemo, useState } from "react";
import { Layers, Telescope, Combine, FlaskConical, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { IntakeRoomIcon } from "@/components/canvas/icons";
import {
  useEventsOfType,
  useLatestStageBoundary,
  useRunEventStoreOptional,
  useRunStatus,
} from "../hooks/run-event-store";
import type { PipelineStage } from "@/types/pipeline-events";

interface StageMeta {
  /** Canonical key from PipelineStage. */
  key: PipelineStage;
  /** User-facing label rendered in the strip. */
  label: string;
  /** One-line tooltip explaining what's happening at this stage. */
  description: string;
  Icon: React.ComponentType<{ className?: string; size?: number }>;
}

// Order matters — drives left-to-right rendering.
const STAGES: StageMeta[] = [
  {
    key: "intake",
    label: "Intake",
    description: "Parsing the prompt and opening the canvas.",
    Icon: IntakeRoomIcon,
  },
  {
    key: "landscape",
    label: "Breadth",
    description: "Frame extractor opening axes — broad lenses on the situation.",
    Icon: Telescope,
  },
  {
    key: "kg",
    label: "Depth",
    description: "Per-axis generators deepening each branch + cycle detection.",
    Icon: Layers,
  },
  {
    key: "proposal",
    label: "Weave",
    description: "Cross-axis synthesis + strategy ranking.",
    Icon: Combine,
  },
  {
    key: "lab",
    label: "Test",
    description: "Lab dissection of proposed systems.",
    Icon: FlaskConical,
  },
  {
    key: "results",
    label: "Done",
    description: "Run completed.",
    Icon: CheckCircle2,
  },
];

// How long the strip stays visible after the run ends. After this
// the strip auto-fades so it doesn't clutter the post-run canvas.
const HIDE_AFTER_TERMINAL_MS = 8000;

export function CanvasStageIndicator() {
  // Defensive — only render when inside a RunEventStoreProvider.
  const ctx = useRunEventStoreOptional();
  if (!ctx) return null;
  return <CanvasStageIndicatorInner />;
}

function CanvasStageIndicatorInner() {
  const latest = useLatestStageBoundary();
  const status = useRunStatus();
  const stageBoundaryEvents = useEventsOfType("stage_boundary");

  // Per-stage event-driven status. A stage is "done" once we see its
  // exit event; "active" on enter-but-no-exit; "pending" if neither.
  // Exit always wins over enter (re-entered stages don't regress).
  //
  // U1 (docs/KG_DEPTH_CRITIQUE.md audit) — added "error" state. When
  // run.status flips to failed/timeout, any stage that's "active" gets
  // re-mapped to "error" (red), and stages still "pending" stay
  // pending (un-reached, NOT auto-promoted to done). Earlier stages
  // that exited cleanly stay "done" — they really did succeed before
  // the failure cascade. This replaces the prior bug where the cancel
  // route emitted a fake `stage: "results", phase: "exit"` event that
  // tricked the indicator into painting a green ✓ on Results despite
  // a fail-during-intake.
  //
  // This replaces the old POSITIONAL logic (`isComplete = i < activeIdx`)
  // which marked any stage left of the current one as complete — that
  // produced the contradiction where Intake showed "active" (its enter
  // fired) AND Graph showed "complete" (it was left of the current
  // stage by index) simultaneously. The fix: trust the event log.
  const stageStateByName = useMemo(() => {
    const state: Record<
      PipelineStage,
      "pending" | "active" | "done" | "error"
    > = {
      intake: "pending",
      landscape: "pending",
      kg: "pending",
      proposal: "pending",
      lab: "pending",
      results: "pending",
    };
    for (const s of stageBoundaryEvents) {
      if (s.event.type !== "stage_boundary") continue;
      if (s.event.phase === "enter") {
        if (state[s.event.stage] === "pending") state[s.event.stage] = "active";
      } else if (s.event.phase === "exit") {
        state[s.event.stage] = "done";
      }
    }
    // Apply U1 — re-map active stages to error on terminal failure.
    if (status === "failed" || status === "timeout") {
      for (const k of Object.keys(state) as PipelineStage[]) {
        if (state[k] === "active") state[k] = "error";
      }
    }
    return state;
  }, [stageBoundaryEvents, status]);

  // Track when the stage transition happened so we can play a
  // one-shot pulse animation on the new stage's chip.
  const [pulseStage, setPulseStage] = useState<PipelineStage | null>(null);
  const [pulseSeq, setPulseSeq] = useState(0);
  const activeStage = useMemo<PipelineStage | null>(() => {
    if (!latest) return null;
    if (latest.event.type !== "stage_boundary") return null;
    return latest.event.stage as PipelineStage;
  }, [latest]);

  useEffect(() => {
    if (!activeStage) return;
    setPulseStage(activeStage);
    setPulseSeq((n) => n + 1);
  }, [activeStage]);

  // Fade rules: hide entirely when no stage event yet, OR when the
  // run finished + the auto-hide window has elapsed.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (status !== "completed" && status !== "failed") {
      setHidden(false);
      return;
    }
    const t = window.setTimeout(() => setHidden(true), HIDE_AFTER_TERMINAL_MS);
    return () => window.clearTimeout(t);
  }, [status]);

  if (!activeStage) return null;
  if (hidden) return null;

  // activeIdx kept only for aria-label below; no longer drives chip status.
  const activeIdx = STAGES.findIndex((s) => s.key === activeStage);
  const phaseHint =
    latest && latest.event.type === "stage_boundary"
      ? latest.event.phase
      : "enter";

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 z-[40] -translate-x-1/2"
      role="status"
      aria-label={`Pipeline stage: ${STAGES[activeIdx]?.label ?? activeStage}`}
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-2 py-1 shadow-sm backdrop-blur-md",
          "transition-opacity duration-300",
          (status === "completed" || status === "failed") && "opacity-80",
        )}
        style={{
          boxShadow:
            "0 4px 12px -4px rgba(15, 23, 42, 0.10), 0 1px 2px rgba(15, 23, 42, 0.04)",
        }}
      >
        {STAGES.map((stage, i) => {
          const stageState = stageStateByName[stage.key];
          const isActive = stageState === "active";
          const isComplete = stageState === "done";
          const isError = stageState === "error";
          const Icon = isError ? AlertCircle : stage.Icon;
          // Title hint mirrors the visible state so screen readers and
          // hover tooltips match what the user sees.
          const stateLabel = isError
            ? `${stage.label} — error`
            : isComplete
              ? `${stage.label} — complete`
              : isActive
                ? `${stage.label} — in progress`
                : `${stage.label} — pending`;
          return (
            <span
              key={stage.key}
              className="contents"
              data-stage={stage.key}
              data-stage-state={stageState}
            >
              <span
                title={`${stateLabel} · ${stage.description}`}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all",
                  isError
                    ? "bg-red-50 text-red-600 ring-1 ring-red-200"
                    : isActive
                      ? "bg-violet-100 text-violet-700 ring-1 ring-violet-300"
                      : isComplete
                        ? "text-emerald-600"
                        : "text-slate-400",
                  isActive &&
                    pulseStage === stage.key &&
                    "stage-chip-pulse",
                )}
                data-pulse-seq={pulseSeq}
              >
                <Icon
                  className={cn(
                    "h-3 w-3",
                    isActive && phaseHint === "enter" && "stage-icon-spin",
                  )}
                />
                {stage.label}
              </span>
              {/* Connector tick between chips. Red when the right side
                  is the error stage so the visual cascade reads clearly. */}
              {i < STAGES.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "h-px w-2 transition-colors",
                    isComplete
                      ? "bg-emerald-300"
                      : stageStateByName[STAGES[i + 1].key] === "error"
                        ? "bg-red-200"
                        : "bg-slate-200",
                  )}
                />
              )}
            </span>
          );
        })}
      </div>
      <style jsx>{`
        :global(.stage-chip-pulse) {
          animation: stage-chip-glow 1100ms cubic-bezier(0.2, 0.8, 0.2, 1) 1;
        }
        @keyframes stage-chip-glow {
          0% {
            transform: scale(0.94);
            box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.45);
          }
          50% {
            transform: scale(1.06);
            box-shadow: 0 0 0 6px rgba(124, 58, 237, 0);
          }
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(124, 58, 237, 0);
          }
        }
        :global(.stage-icon-spin) {
          animation: stage-icon-spin-once 600ms ease-out 1;
        }
        @keyframes stage-icon-spin-once {
          from {
            transform: rotate(-25deg);
            opacity: 0.6;
          }
          to {
            transform: rotate(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
