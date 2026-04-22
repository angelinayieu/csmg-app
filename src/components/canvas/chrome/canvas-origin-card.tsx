"use client";

// ── CanvasOriginCard (Phase 2E — PR 2) ──
//
// Compact "thought origin" card that renders at the top-center of
// the whiteboard during and shortly after an intake run. Reads the
// user's original prompt (from spaces.input_text) and keeps it
// visible so the root entities materializing below literally appear
// to grow FROM the thought — the tree-of-roots metaphor.
//
// Chrome-layer component (not a tldraw shape). Lives above the
// canvas, ignores camera zoom/pan so the prompt stays anchored
// while the user explores the graph beneath it.
//
// Lifecycle:
//   - Appears when the page mounts with an active run OR a recent
//     run (within last 5 min of completion).
//   - A subtle downward-flowing line connects it to the first root
//     entity beneath (decorative — lines up visually with the
//     painter's anchor at y=0 where roots are placed).
//   - Minimizable: click the card to collapse into a tiny pill.

import { useEffect, useState } from "react";
import { ChevronUp, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassPanel } from "@/components/ui/glass-panel";

export interface CanvasOriginCardProps {
  /** User's original intake text from spaces.input_text. Null when
   *  the space wasn't created via intake (manual canvas, etc). */
  inputText: string | null;
  /** True while a pipeline run is active — card glows + pulse line.
   *  False once the run completes — card remains but goes quiet. */
  runActive: boolean;
  /** Current stage message from the event stream, shown as a
   *  subtitle under the prompt while the run is live. */
  stageMessage?: string | null;
  /** Entity count already rendered — quick visible progress. */
  entityCount?: number;
  /** Dismisses the card permanently for this session. */
  onDismiss?: () => void;
}

const ACCENT = "#8B5CF6"; // violet — matches brainstorm family
const MAX_PREVIEW_CHARS = 260;

export function CanvasOriginCard({
  inputText,
  runActive,
  stageMessage,
  entityCount,
  onDismiss,
}: CanvasOriginCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Auto-collapse 10s after the run completes so the user gets a
  // clear canvas once the tree is done unfurling.
  useEffect(() => {
    if (runActive) return;
    const t = setTimeout(() => setCollapsed(true), 10_000);
    return () => clearTimeout(t);
  }, [runActive]);

  if (dismissed) return null;
  if (!inputText || inputText.trim().length === 0) return null;

  const preview =
    inputText.length > MAX_PREVIEW_CHARS
      ? inputText.slice(0, MAX_PREVIEW_CHARS).trim() + "…"
      : inputText;

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-20 z-20 flex -translate-x-1/2 flex-col items-center"
      style={{ width: collapsed ? 260 : 460 }}
    >
      {/* Flowing connector line — subtle vertical pulse from the
          card down into the tree area. Only visible while the run
          is active (drops out once entities are settled). */}
      {runActive && !collapsed && (
        <div
          className="origin-flow-line pointer-events-none absolute left-1/2 top-full h-[120px] w-[2px] -translate-x-1/2"
          aria-hidden
          style={{
            background: `linear-gradient(180deg, ${ACCENT} 0%, color-mix(in srgb, ${ACCENT} 30%, transparent) 60%, transparent 100%)`,
          }}
        />
      )}

      <GlassPanel
        tier={runActive ? "float" : "card"}
        radius={16}
        accent={runActive ? ACCENT : null}
        className={cn(
          "pointer-events-auto overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]",
          collapsed ? "px-3 py-1.5" : "px-4 py-3",
        )}
      >
        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="flex items-center gap-2 text-[11px] font-semibold text-gray-700"
            title="Expand the origin prompt"
          >
            <Sparkles className="h-3 w-3" strokeWidth={1.75} style={{ color: ACCENT }} />
            <span className="truncate">Origin</span>
            <ChevronUp className="h-3 w-3 text-gray-400" />
          </button>
        ) : (
          <div className="flex items-start gap-3">
            <div
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
              style={{
                background: runActive
                  ? `color-mix(in srgb, ${ACCENT} 16%, transparent)`
                  : "rgba(15, 23, 42, 0.04)",
              }}
            >
              <Sparkles
                className={cn("h-3.5 w-3.5", runActive && "animate-pulse")}
                strokeWidth={1.75}
                style={{ color: runActive ? ACCENT : "#64748b" }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className="text-[9.5px] font-bold uppercase tracking-[0.14em]"
                  style={{ color: runActive ? ACCENT : "#64748b" }}
                >
                  {runActive ? "Thinking from" : "Origin"}
                </span>
                {runActive && stageMessage && (
                  <span className="truncate text-[10px] font-medium text-gray-500">
                    · {stageMessage}
                  </span>
                )}
                {!runActive && typeof entityCount === "number" && entityCount > 0 && (
                  <span className="text-[10px] font-medium text-gray-500">
                    · {entityCount} nodes
                  </span>
                )}
              </div>
              <div
                className="mt-0.5 text-[12.5px] font-medium leading-snug text-gray-800"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
                title={inputText}
              >
                {preview}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={() => setCollapsed(true)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                title="Collapse"
                aria-label="Collapse origin card"
              >
                <ChevronUp className="h-3 w-3 rotate-180" />
              </button>
              {onDismiss && (
                <button
                  onClick={() => {
                    setDismissed(true);
                    onDismiss();
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  title="Dismiss"
                  aria-label="Dismiss origin card"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </GlassPanel>

      {/* Pulse animation on the flow line when active — decorative
          but reads as "thought energy flowing down". CSS keyframe
          defined inline so we don't pollute globals for a single-
          use effect. */}
      {runActive && !collapsed && (
        <style jsx>{`
          .origin-flow-line::after {
            content: "";
            position: absolute;
            inset: 0;
            background: linear-gradient(
              180deg,
              transparent 0%,
              ${ACCENT} 40%,
              ${ACCENT} 55%,
              transparent 100%
            );
            animation: origin-flow-pulse 2.4s ease-in-out infinite;
          }
          @keyframes origin-flow-pulse {
            0% {
              transform: translateY(-80%);
              opacity: 0;
            }
            20% {
              opacity: 1;
            }
            80% {
              opacity: 1;
            }
            100% {
              transform: translateY(80%);
              opacity: 0;
            }
          }
        `}</style>
      )}
    </div>
  );
}
