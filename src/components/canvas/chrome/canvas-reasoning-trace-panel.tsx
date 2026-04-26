"use client";

// ── Canvas reasoning-trace panel ──
//
// The user asked: "show the decomposition of entities on the side
// somewhere… and some lines of reasoning that's happening as the AI
// interprets the situation because I think even just seeing the lines
// of reasoning the AI has would be really cool and useful."
//
// This component is that. It subscribes to `reasoning_chunk` events on
// the active pipeline run, accumulates the latest full snapshot, and
// renders the model's actual Pass 1 output as it streams in — tokens
// flowing across the screen within 1-2s of submission instead of a
// 60s silent spinner.
//
// Also renders:
//   • Token progress bar: charsSoFar / (tokenBudget * 4) — rough, but
//     honest (we know the budget; chars-per-token is ~4 for prose).
//   • Typing cursor while phase="thinking"; removed on "complete".
//   • Extracted candidate concepts: a lightweight regex scanner finds
//     capitalized multi-word phrases mentioned repeatedly in the
//     stream and surfaces them as preview chips — the user's "show
//     the decomposition of entities on the side" request. These are
//     not persisted; the ghost painter takes over when Pass 2 lands.
//
// Auto-collapses once the run's status flips terminal (completed /
// failed). Users can click the chevron to re-expand and read the
// full trace afterward.
//
// Structural-events-only memory rule honored: reasoning_chunk events
// never become tldraw shapes on the main canvas. They live in this
// panel alone.

import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRunEventStore } from "../hooks/run-event-store";

export interface CanvasReasoningTracePanelProps {
  runId: string | null;
}

interface LatestChunk {
  textSoFar: string;
  tokenBudget: number;
  charsSoFar: number;
  phase: "thinking" | "complete";
  stage: string;
}

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
  const { events, status } = useRunEventStore();
  const [expanded, setExpanded] = useState(true);

  // Latest snapshot wins. reasoning_chunk events carry the FULL
  // accumulated text (not deltas), so we can render idempotently
  // even if events arrive out of order on reconnect.
  const latest = useMemo<LatestChunk | null>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i].event;
      if (e.type !== "reasoning_chunk") continue;
      return {
        textSoFar: e.textSoFar,
        tokenBudget: e.tokenBudget,
        charsSoFar: e.charsSoFar,
        phase: e.phase,
        stage: e.stage,
      };
    }
    return null;
  }, [events]);

  // Auto-collapse when the run terminates, but don't unmount — the
  // user might want to click back into the trace after the fact.
  useEffect(() => {
    if (status === "completed" || status === "failed" || status === "timeout") {
      setExpanded(false);
    }
  }, [status]);

  const candidates = useMemo(
    () => (latest ? extractCandidateConcepts(latest.textSoFar) : []),
    [latest],
  );

  if (!runId) return null;
  if (!latest) return null;

  // chars → tokens approximation: 4 chars ≈ 1 token for English prose.
  const approxTokens = Math.floor(latest.charsSoFar / 4);
  const pct = Math.min(
    100,
    Math.round((approxTokens / Math.max(1, latest.tokenBudget)) * 100),
  );
  const isThinking = latest.phase === "thinking";

  return (
    <aside
      className={cn(
        "pointer-events-auto absolute left-4 z-30 w-[360px] rounded-xl border border-gray-200/80 bg-white/95 shadow-lg backdrop-blur",
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
            {isThinking ? "AI reasoning · live" : "AI reasoning · complete"}
          </div>
          <div className="mt-0.5 font-mono text-[10px] tabular-nums text-gray-400">
            {approxTokens.toLocaleString()} / {latest.tokenBudget.toLocaleString()} tokens
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
              {latest.textSoFar}
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
