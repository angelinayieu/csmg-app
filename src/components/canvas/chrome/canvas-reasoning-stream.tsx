"use client";

// ── CanvasReasoningStream (Phase 2E · PR 3) ──
//
// Top-left glass console that surfaces the LLM's live reasoning
// prose during a pipeline run. The `reasoning_chunk` events were
// previously routed only to the audit drawer (hidden by default);
// this component makes them visible on the main canvas so users
// see the model actually thinking.
//
// Design principles:
//   - SECONDARY information. The tree + origin + proposals are
//     the primary hierarchy; reasoning is supporting detail that
//     enriches the "AI is alive" feel without demanding attention.
//   - QUIET. Appears when chunks flow, auto-fades when they stop,
//     tucked in the top-left corner where it doesn't compete with
//     any other surface.
//   - CURSOR-AT-END. A blinking cursor on the latest char signals
//     "still streaming"; disappears when phase = "complete".
//   - FADE-OUT-AT-TOP. Older text fades upward via a mask gradient
//     so the panel always reads as a fresh stream, not a scroll
//     log.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useReasoningStream } from "../hooks/use-reasoning-stream";

export interface CanvasReasoningStreamProps {
  /** Active pipeline run id (from ?run=<uuid>). Null → no stream. */
  runId: string | null;
  /** Optional: start hidden even when a run is active. Useful if we
   *  add a user preference toggle later. */
  startHidden?: boolean;
}

const ACCENT = "#8B5CF6"; // violet — matches brainstorm + origin card
// Number of tail characters to render. Full prose can grow to tens
// of thousands of chars; we only show the tail so perf + legibility
// stay reasonable.
const TAIL_CHARS = 480;
// Milliseconds of silence after the last chunk before we fade out.
const AUTO_HIDE_MS = 8000;

export function CanvasReasoningStream({
  runId,
  startHidden = false,
}: CanvasReasoningStreamProps) {
  const { latestText, stage, phase, isActive, lastEventAt, charsSoFar } =
    useReasoningStream(runId);
  const [visible, setVisible] = useState(!startHidden);

  // Hide when there's nothing to show + fade out after silence.
  useEffect(() => {
    if (!latestText) {
      setVisible(false);
      return;
    }
    setVisible(true);
    // Reset the hide timer every time a new chunk arrives.
    const timer = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [lastEventAt, latestText]);

  if (!runId) return null;
  if (!latestText) return null;

  // Take only the tail so we don't blow out memory or legibility on
  // long runs. The CSS mask gradient handles the "older text fades"
  // treatment; the text component just renders what's in the tail.
  const displayText =
    latestText.length > TAIL_CHARS
      ? "…" + latestText.slice(-TAIL_CHARS)
      : latestText;

  // Approximate minutes/kchar for the footer.
  const chars = charsSoFar;
  const countLabel =
    chars < 1000
      ? `${chars} chars`
      : chars < 10000
        ? `${(chars / 1000).toFixed(1)}k chars`
        : `${Math.round(chars / 1000)}k chars`;

  return (
    <div
      className={cn(
        "pointer-events-auto absolute z-20 transition-opacity duration-500",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{
        top: 80, // below top bar
        left: 72, // past the tool dock
        width: 360,
      }}
      aria-hidden={!visible}
    >
      <GlassPanel
        tier="card"
        radius={14}
        accent={isActive ? ACCENT : null}
        className="overflow-hidden"
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid var(--glass-hairline)" }}
        >
          <div
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md"
            style={{
              background: `color-mix(in srgb, ${ACCENT} 14%, transparent)`,
            }}
          >
            {/* Custom sparkle glyph — single path so it's lightweight. */}
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path
                d="M5 0.5 L6 4 L9.5 5 L6 6 L5 9.5 L4 6 L0.5 5 L4 4 Z"
                fill={ACCENT}
                opacity={isActive ? 1 : 0.5}
                className={isActive ? "reasoning-sparkle-pulse" : ""}
              />
            </svg>
          </div>
          <span
            className="text-[9.5px] font-bold uppercase tracking-[0.14em]"
            style={{ color: ACCENT }}
          >
            AI reasoning
          </span>
          {stage && (
            <span className="truncate text-[9.5px] font-medium text-gray-400">
              · {stage}
            </span>
          )}
          <span
            className="ml-auto flex-shrink-0 font-mono text-[9px] font-semibold text-gray-400"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {countLabel}
          </span>
          {isActive && (
            <span
              className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{
                background: ACCENT,
                boxShadow: `0 0 6px ${ACCENT}`,
                animation: "reasoning-dot-pulse 1s ease-in-out infinite",
              }}
              aria-label="Streaming"
            />
          )}
        </div>

        {/* Streaming text — tail of latestText with top fade so the
            panel reads as a live stream, not a scrolling log. */}
        <div
          className="px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-gray-700"
          style={{
            maxHeight: 140,
            overflow: "hidden",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            // Fade the top 25% so older text feels like it's
            // dissolving as new lines arrive.
            maskImage:
              "linear-gradient(to bottom, transparent 0%, black 25%, black 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, black 25%, black 100%)",
          }}
        >
          {displayText}
          {phase === "thinking" && (
            <span
              className="inline-block align-baseline"
              style={{
                width: 2,
                height: "0.9em",
                marginLeft: 2,
                background: ACCENT,
                animation: "reasoning-cursor-blink 1s step-end infinite",
                verticalAlign: "middle",
              }}
              aria-hidden
            />
          )}
        </div>

        {/* Inline keyframes — scoped to this component so they don't
            pollute globals. */}
        <style jsx>{`
          :global(.reasoning-sparkle-pulse) {
            animation: reasoning-sparkle-pulse 1.6s ease-in-out infinite;
          }
          @keyframes reasoning-sparkle-pulse {
            0%,
            100% {
              opacity: 0.6;
            }
            50% {
              opacity: 1;
            }
          }
          @keyframes reasoning-dot-pulse {
            0%,
            100% {
              opacity: 0.6;
              transform: scale(1);
            }
            50% {
              opacity: 1;
              transform: scale(1.3);
            }
          }
          @keyframes reasoning-cursor-blink {
            0%,
            50% {
              opacity: 1;
            }
            51%,
            100% {
              opacity: 0;
            }
          }
        `}</style>
      </GlassPanel>
    </div>
  );
}
