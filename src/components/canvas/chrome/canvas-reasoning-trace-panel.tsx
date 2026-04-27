"use client";

// ── Canvas reasoning-trace panel ──
//
// Shows the LLM's actual reasoning as it streams in across stages,
// instead of a silent spinner. T1.2 (docs/KG_DEPTH_CRITIQUE.md)
// upgraded this from "Pass-1 only, auto-collapse on terminal" to
// "all stages visible, scrubbable via tabs, persists post-run."
//
// What it shows:
//   • Per-stage tab row — one tab per pipeline stage that has emitted
//     reasoning chunks (intake, landscape, kg, proposal, lab, results).
//     Tabs let the user scrub between stages instead of only seeing
//     the latest one. Active stage (the one currently emitting) shows
//     a spinner; completed stages show a checkmark.
//   • Token progress bar for the selected stage.
//   • Streaming reasoning text — scrolls to bottom while the stage
//     is "thinking"; freezes once it reports "complete."
//   • Candidate concepts: lightweight regex scanner finds Title-Case
//     phrases mentioned repeatedly. Surfaces forming entities BEFORE
//     Pass 2 structures them.
//
// Persistence rule (T1.2): NO auto-collapse on terminal status. The
// most important reasoning happens during proposal + synthesis stages,
// which fire AFTER intake — auto-collapsing on completion would hide
// exactly the reasoning users most want to scrub through. The chevron
// remains user-controllable; the panel stays open by default.
//
// Structural-events-only memory rule honored: reasoning_chunk events
// never become tldraw shapes on the main canvas. They live in this
// panel alone.

import { useMemo, useState } from "react";
import { BrainCircuit, Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRunEventStore } from "../hooks/run-event-store";
import type { PipelineStage } from "@/types/pipeline-events";

export interface CanvasReasoningTracePanelProps {
  runId: string | null;
}

interface StageSnapshot {
  stage: PipelineStage;
  textSoFar: string;
  tokenBudget: number;
  charsSoFar: number;
  phase: "thinking" | "complete";
  /** Sequence number of the latest reasoning_chunk event for this
   *  stage. Used to determine which stage was MOST RECENTLY active
   *  so we can default-select it. */
  latestSeq: number;
}

// Stages the reasoning panel renders tabs for, in canonical pipeline
// order. Stages that haven't emitted any chunks are filtered out at
// render time (no empty tabs). "results" rarely emits but is included
// so a future cron/post-processing phase wiring up reasoning chunks
// gets surfaced automatically.
const STAGE_ORDER: PipelineStage[] = [
  "intake",
  "landscape",
  "kg",
  "proposal",
  "lab",
  "results",
];

const STAGE_LABEL: Record<PipelineStage, string> = {
  intake: "Intake",
  landscape: "Landscape",
  kg: "KG",
  proposal: "Strategy",
  lab: "Lab",
  results: "Results",
};

/**
 * Find multi-word Title-Case phrases that appear 2+ times. Cheap
 * proxy for "things the LLM is treating as named concepts."
 */
function extractCandidateConcepts(text: string, max = 6): string[] {
  if (!text || text.length < 100) return [];
  // Require 2-4 words, each starting with uppercase, total 4-60 chars.
  const re = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,3})\b/g;
  const counts = new Map<string, number>();
  for (const m of text.matchAll(re)) {
    const phrase = m[1];
    if (phrase.length > 60) continue;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([phrase]) => phrase);
}

export function CanvasReasoningTracePanel({
  runId,
}: CanvasReasoningTracePanelProps) {
  const { events } = useRunEventStore();
  const [expanded, setExpanded] = useState(true);
  const [selectedStage, setSelectedStage] = useState<PipelineStage | null>(null);

  // Per-stage latest snapshot. reasoning_chunk events carry the FULL
  // accumulated text (not deltas) so the latest event per stage is
  // the authoritative state. We also track the latest SEQ across all
  // stages so we know which stage was most recently active (for
  // default tab selection).
  const stageMap = useMemo(() => {
    const m = new Map<PipelineStage, StageSnapshot>();
    for (const s of events) {
      const e = s.event;
      if (e.type !== "reasoning_chunk") continue;
      const stage = e.stage as PipelineStage;
      const existing = m.get(stage);
      if (!existing || s.sequence > existing.latestSeq) {
        m.set(stage, {
          stage,
          textSoFar: e.textSoFar,
          tokenBudget: e.tokenBudget,
          charsSoFar: e.charsSoFar,
          phase: e.phase,
          latestSeq: s.sequence,
        });
      }
    }
    return m;
  }, [events]);

  // Stages with any reasoning chunks, in canonical order.
  const visibleStages = useMemo(
    () => STAGE_ORDER.filter((s) => stageMap.has(s)),
    [stageMap],
  );

  // Auto-select the most recently active stage when no manual
  // selection has been made, OR when the most recent stage advances
  // past the user's last selection (ensures users see live reasoning
  // by default but stop following them once they explicitly pick a
  // tab to read).
  const mostRecentStage = useMemo<PipelineStage | null>(() => {
    let best: PipelineStage | null = null;
    let bestSeq = -1;
    for (const snap of stageMap.values()) {
      if (snap.latestSeq > bestSeq) {
        bestSeq = snap.latestSeq;
        best = snap.stage;
      }
    }
    return best;
  }, [stageMap]);

  // Determine which stage to actually display. Priority:
  //   1. User's manual selection (if still emitting)
  //   2. Most recently active stage (default — follows live reasoning)
  const activeStage: PipelineStage | null = (() => {
    if (selectedStage && stageMap.has(selectedStage)) return selectedStage;
    return mostRecentStage;
  })();

  const active = activeStage ? stageMap.get(activeStage) ?? null : null;

  if (!runId && stageMap.size === 0) return null;
  if (!active) return null;

  // chars → tokens approximation: 4 chars ≈ 1 token for English prose.
  const approxTokens = Math.floor(active.charsSoFar / 4);
  const pct = Math.min(
    100,
    Math.round((approxTokens / Math.max(1, active.tokenBudget)) * 100),
  );
  const isThinking = active.phase === "thinking";
  const candidates = extractCandidateConcepts(active.textSoFar);

  return (
    <aside
      className={cn(
        "pointer-events-auto absolute left-4 z-30 w-[380px] rounded-xl border border-gray-200/80 bg-white/95 shadow-lg backdrop-blur",
        // Sits below the run-context panel which lives at top-4.
        "top-[320px]",
      )}
      aria-label="AI reasoning trace"
    >
      <header
        className="flex cursor-pointer items-center gap-2 px-3.5 py-2.5"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-indigo-100 to-purple-100">
          {isThinking ? (
            <Loader2 className="h-3 w-3 animate-spin text-indigo-600" />
          ) : (
            <BrainCircuit className="h-3 w-3 text-indigo-600" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">
            AI reasoning · {STAGE_LABEL[active.stage]}
            {isThinking ? " · live" : " · done"}
          </div>
          <div className="mt-0.5 font-mono text-[10px] tabular-nums text-gray-400">
            {approxTokens.toLocaleString()} / {active.tokenBudget.toLocaleString()} tokens
            <span className="ml-1.5">({pct}%)</span>
          </div>
        </div>
        <button
          className="flex-shrink-0 rounded-md p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </header>

      {/* Token progress bar — always visible, even when collapsed */}
      <div className="h-[3px] overflow-hidden bg-gray-100">
        <div
          className={cn(
            "h-full transition-all duration-300",
            isThinking
              ? "bg-gradient-to-r from-indigo-500 to-purple-500"
              : "bg-emerald-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {expanded && (
        <>
          {/* T1.2 — Per-stage tab row. Hidden when only one stage has
              emitted (avoids visual clutter on a fresh run). Active
              stage shows spinner; completed stages show checkmark. */}
          {visibleStages.length > 1 && (
            <div
              className="flex items-center gap-1 border-t border-gray-200/70 px-2.5 py-1.5 overflow-x-auto"
              role="tablist"
              aria-label="Reasoning stages"
            >
              {visibleStages.map((stage) => {
                const snap = stageMap.get(stage)!;
                const isActiveTab = stage === active.stage;
                const isStageThinking = snap.phase === "thinking";
                return (
                  <button
                    key={stage}
                    role="tab"
                    aria-selected={isActiveTab}
                    onClick={() => setSelectedStage(stage)}
                    className={cn(
                      "flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] transition",
                      isActiveTab
                        ? "bg-indigo-100 text-indigo-700 shadow-sm"
                        : "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
                    )}
                    title={`${STAGE_LABEL[stage]} stage`}
                  >
                    {isStageThinking ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Check className="h-2.5 w-2.5 text-emerald-600" />
                    )}
                    {STAGE_LABEL[stage]}
                  </button>
                );
              })}
            </div>
          )}

          {/* Candidate concepts — extracted from the streaming text so
              the user sees "things the AI is treating as named
              concepts" forming in real time. These are not persisted;
              the ghost painter + run-context panel take over once
              Pass 2 structures them into real entities. */}
          {candidates.length > 0 && (
            <div className="border-t border-gray-200/70 px-3.5 py-2.5">
              <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                Candidate concepts forming
              </div>
              <div className="flex flex-wrap gap-1">
                {candidates.map((c) => (
                  <span
                    key={c}
                    className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10.5px] font-medium text-indigo-700 ring-1 ring-indigo-200"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Streaming reasoning text — scrollable, pinned to bottom
              so the user sees the freshest output without scrolling. */}
          <div
            className="relative max-h-[280px] overflow-y-auto border-t border-gray-200/70 px-3.5 py-2.5 text-[11.5px] leading-[1.5] text-gray-700"
            ref={(el) => {
              if (el && isThinking) el.scrollTop = el.scrollHeight;
            }}
          >
            <div className="whitespace-pre-wrap font-sans">
              {active.textSoFar}
              {isThinking && (
                <span
                  className="ml-0.5 inline-block h-3 w-1 -translate-y-[1px] animate-pulse bg-indigo-500 align-middle"
                  aria-hidden
                />
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
