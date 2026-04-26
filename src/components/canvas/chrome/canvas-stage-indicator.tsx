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
import { Sparkles, Layers, Telescope, Combine, FlaskConical, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
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
  Icon: typeof Sparkles;
}

// Order matters — drives left-to-right rendering.
const STAGES: StageMeta[] = [
  {
    key: "intake",
    label: "Intake",
    description: "Parsing the prompt and opening the canvas.",
    Icon: Sparkles,
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

  // Determine which stages are "completed" (left of active), "active"
  // (current), and "pending" (right of active).
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
          const isActive = stage.key === activeStage;
          const isComplete = i < activeIdx;
          const isPending = i > activeIdx;
          const Icon = stage.Icon;
          return (
            <span
              key={stage.key}
              className="contents"
              data-stage={stage.key}
            >
              <span
                title={stage.description}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all",
                  isActive
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
              {/* Connector tick between chips */}
              {i < STAGES.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "h-px w-2 transition-colors",
                    isComplete ? "bg-emerald-300" : "bg-slate-200",
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
