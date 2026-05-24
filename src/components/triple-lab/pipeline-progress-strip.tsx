"use client";

// Pipeline progress strip — slim banner across the top of the lab
// when a pipeline_run is in flight. Subscribes to SSE `stage_boundary`
// events to show the REAL stage the chain is in, not a faked label
// loop. Each completed stage gets a ✓ checkmark; the current stage
// shows a spinner; remaining stages render as dimmed labels.
//
// Replaces the earlier "Almost there…" fake-progress loop. Now the
// user knows exactly which step the pipeline is on (and how long it's
// taken) — which makes "is this stuck?" a question you can answer
// instead of guess.
//
// Dismisses ~1s after the last stage_boundary with phase=exit on the
// "results" stage (or when no events have arrived in 30s after a
// "results"-exit). If no run is active, returns null.

import { useEffect, useMemo, useState } from "react";
import { useEventsOfType } from "@/components/canvas/hooks/run-event-store";
import { colors, tracking } from "./tokens";

// Canonical pipeline stage order — used to derive "completed / current
// / remaining" from the cumulative stream of stage_boundary events.
// Maps each PipelineStage to a display label + glyph. Mirrors the
// PipelineStage union in src/types/pipeline-events.ts.
interface StageMeta {
  key: string;
  label: string;
  glyph: string;
}
const STAGES: StageMeta[] = [
  { key: "intake", label: "Intake", glyph: "◉" },
  { key: "landscape", label: "Landscape", glyph: "▦" },
  { key: "kg", label: "Decompose", glyph: "≡" },
  { key: "proposal", label: "Synthesize", glyph: "✦" },
  { key: "twin", label: "Strategy", glyph: "◆" },
  { key: "lab", label: "Lab options", glyph: "⚗" },
  { key: "reflexive", label: "Apps", glyph: "□" },
  { key: "results", label: "Results", glyph: "★" },
];

interface PipelineProgressStripProps {
  /** True when there's an active pipeline run for this space. Drives
   *  the visibility — when no run is active the strip renders null
   *  so it doesn't take vertical space. */
  hasActiveRun: boolean;
}

type StageStatus = "pending" | "running" | "complete";

export function PipelineProgressStrip({
  hasActiveRun,
}: PipelineProgressStripProps) {
  const stageEvents = useEventsOfType("stage_boundary");

  // `nowMs` ticks every second from a useEffect. We read it during
  // render instead of calling Date.now() inline, because React 19's
  // purity rule forbids impure calls in render. The tick interval
  // is gated on hasActiveRun so we don't burn CPU when idle.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // First-event timestamp — derived purely from stageEvents[0].
  // Memoized so the elapsed-seconds calc stays cheap even when
  // hundreds of events pile up. emittedAt is an ISO string from the
  // SSE store; we parse to epoch ms once.
  const firstEventAtMs = useMemo<number | null>(() => {
    if (stageEvents.length === 0) return null;
    const parsed = Date.parse(String(stageEvents[0].emittedAt));
    return Number.isFinite(parsed) ? parsed : null;
  }, [stageEvents]);

  // Derive each stage's status from the stream of boundary events.
  // The reducer walks events in order and updates a map of stage → status.
  const stageStatus: Record<string, StageStatus> = useMemo(() => {
    const status: Record<string, StageStatus> = {};
    for (const s of STAGES) status[s.key] = "pending";
    for (const ev of stageEvents) {
       
      const payload = ev.event as any;
      const stage = payload.stage as string | undefined;
      const phase = payload.phase as "enter" | "exit" | undefined;
      if (!stage || !phase) continue;
      if (phase === "enter") {
        status[stage] = "running";
      } else if (phase === "exit") {
        status[stage] = "complete";
      }
    }
    return status;
  }, [stageEvents]);

  // Most recent stage_boundary event — drives the headline label
  // ("Currently: Decompose · 47s") and the message subtext.
  const latest = stageEvents[stageEvents.length - 1];
   
  const latestStage = (latest?.event as any)?.stage as string | undefined;
   
  const latestPhase = (latest?.event as any)?.phase as
    | "enter"
    | "exit"
    | undefined;
   
  const latestMessage = (latest?.event as any)?.message as string | undefined;
  const currentMeta = STAGES.find((s) => s.key === latestStage);

  useEffect(() => {
    if (!hasActiveRun) return;
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [hasActiveRun]);

  // Auto-dismiss: when the last event is a "results" exit AND it's
  // been >5s since, slide the strip out. The 5s pause lets the user
  // see the final "✓ Results" state before it vanishes. emittedAt is
  // an ISO string — parse before subtracting.
  const latestEmittedMs = latest
    ? Date.parse(String(latest.emittedAt))
    : NaN;
  const allDone =
    latestStage === "results" &&
    latestPhase === "exit" &&
    Number.isFinite(latestEmittedMs) &&
    nowMs - latestEmittedMs > 5_000;

  // Don't show when no run is active OR all stages done + dismissed.
  if (!hasActiveRun && stageEvents.length === 0) return null;
  if (allDone) return null;

  const elapsedSec =
    firstEventAtMs !== null
      ? Math.floor((nowMs - firstEventAtMs) / 1000)
      : 0;
  const elapsedLabel =
    elapsedSec < 60
      ? `${elapsedSec}s`
      : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;

  // Count completed stages for the headline.
  const completedCount = STAGES.filter(
    (s) => stageStatus[s.key] === "complete",
  ).length;

  return (
    <div
      className="relative z-20 flex shrink-0 items-center gap-3 border-b px-4 py-2"
      style={{
        background: `linear-gradient(180deg, ${colors.brand.bgSoft} 0%, white 100%)`,
        borderBottomColor: colors.brand.haloSoft,
      }}
    >
      {/* Spinner */}
      <Spinner color={colors.brand.fg} />

      {/* Headline */}
      <div className="flex items-baseline gap-2">
        <span
          className="text-[9.5px] font-bold uppercase"
          style={{
            color: colors.brand.fgDark,
            letterSpacing: tracking.eyebrow,
          }}
        >
          ◉ Pipeline running
        </span>
        {currentMeta && (
          <span className="text-[11px] font-semibold text-slate-900">
            · {currentMeta.label}
            {latestPhase === "enter" && " (in progress)"}
          </span>
        )}
        <span className="text-[10px] text-slate-500">· {elapsedLabel}</span>
        <span className="text-[10px] text-slate-400">
          · {completedCount}/{STAGES.length} stages
        </span>
      </div>

      {/* Stage chips — compact row showing all stages with status */}
      <div className="ml-auto flex items-center gap-1 overflow-x-auto">
        {STAGES.map((s) => {
          const status = stageStatus[s.key];
          return (
            <StageChip
              key={s.key}
              label={s.label}
              glyph={s.glyph}
              status={status}
            />
          );
        })}
      </div>

      {/* Optional message (last server-side hint) — only shown when
       *  present + we're not at the headline-only stage */}
      {latestMessage && (
        <span
          className="ml-2 max-w-[200px] truncate text-[10px] italic text-slate-500"
          title={latestMessage}
        >
          {latestMessage}
        </span>
      )}

      {/* Animated underline progress bar */}
      <div
        className="absolute bottom-0 left-0 right-0 h-0.5"
        style={{ background: "rgba(15, 23, 42, 0.04)" }}
      >
        <div
          className="h-full transition-[width]"
          style={{
            width: `${Math.min(100, (completedCount / STAGES.length) * 100)}%`,
            background: colors.brand.gradient,
            transitionDuration: "600ms",
          }}
        />
      </div>
    </div>
  );
}

// ── Single stage chip ────────────────────────────────────────────────
function StageChip({
  label,
  glyph,
  status,
}: {
  label: string;
  glyph: string;
  status: StageStatus;
}) {
  const isRunning = status === "running";
  const isComplete = status === "complete";
  return (
    <div
      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-semibold transition-colors"
      style={{
        background: isComplete
          ? colors.state.okSoft
          : isRunning
          ? colors.brand.bgChip
          : "transparent",
        color: isComplete
          ? colors.state.okFg
          : isRunning
          ? colors.brand.fgDark
          : colors.neutral.fg400,
        border: `1px solid ${
          isComplete
            ? "rgba(13, 148, 136, 0.25)"
            : isRunning
            ? colors.brand.haloSoft
            : "transparent"
        }`,
      }}
    >
      <span className="font-mono text-[10px]">
        {isComplete ? "✓" : isRunning ? glyph : "·"}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

function Spinner({ color }: { color: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      style={{ animation: "upload-toast-spin 0.9s linear infinite" }}
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke={color}
        strokeWidth="1.6"
        fill="none"
        strokeDasharray="22 30"
        strokeLinecap="round"
      />
    </svg>
  );
}
