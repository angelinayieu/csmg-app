"use client";

// PipelineErrorBanner — surfaces pipeline_error SSE events at the top
// of the Synthesis Lab so failures are visible instead of silently
// stalling the pipeline. Subscribes via the run-event store to all
// `pipeline_error` events for the active run and renders the most
// recent one (oldest errors stay in the audit drawer but only one
// banner stays on screen at a time so we don't pile up).
//
// Two tones:
//   • fatal:true  → rose / blocking — chain is cancelled, no more
//                   stages will fire. User must hit Retry.
//   • fatal:false → amber / soft — one stage produced no artifact
//                   but the chain proceeds.
//
// Dismissable. The banner stays on screen until the user clicks ×
// (or until a NEWER pipeline_error event arrives, which replaces it).
// Sits below the PipelineProgressStrip but above the 3-panel grid
// so it's the first thing the eye lands on when something breaks.

import { useMemo, useState } from "react";
import { useEventsOfType } from "@/components/canvas/hooks/run-event-store";
import { colors } from "./tokens";

interface PipelineErrorBannerProps {
  /** Optional retry handler — if provided, renders a "Retry" CTA in
   *  the banner. Caller is responsible for re-firing the pipeline
   *  (typically by hitting /api/pipeline/decompose again). */
  onRetry?: () => void;
}

interface DerivedError {
  /** Stable key from sequence + code so React diffs cleanly when a
   *  new error replaces the current one. */
  key: string;
  stage: string;
  code: string;
  message: string;
  fatal: boolean;
  emittedAtMs: number;
}

export function PipelineErrorBanner({ onRetry }: PipelineErrorBannerProps) {
  const errorEvents = useEventsOfType("pipeline_error");
  // We only ever need to remember ONE dismissed key — the most-recent
  // one the user closed. When a newer error arrives (different key),
  // it bypasses the dismissal and shows again automatically. This is
  // simpler than tracking a Set and avoids the setState-in-effect
  // pattern that React 19 forbids.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const latest = useMemo<DerivedError | null>(() => {
    if (errorEvents.length === 0) return null;
    const tail = errorEvents[errorEvents.length - 1];
     
    const ev = tail.event as any;
    const stage = typeof ev.stage === "string" ? ev.stage : "unknown";
    const code = typeof ev.code === "string" ? ev.code : "unknown_error";
    const message =
      typeof ev.message === "string" ? ev.message : "Pipeline error";
    const fatal = ev.fatal === true;
    const emittedAtMs = Date.parse(String(tail.emittedAt));
    return {
      key: `${tail.sequence}-${code}`,
      stage,
      code,
      message,
      fatal,
      // Fall back to 0 when the ISO timestamp is unparseable —
      // we don't display this value, only use it as a stable key
      // fingerprint, so 0 is fine. (Date.now() would violate the
      // react-hooks/purity rule inside useMemo.)
      emittedAtMs: Number.isFinite(emittedAtMs) ? emittedAtMs : 0,
    };
  }, [errorEvents]);

  if (latest === null) return null;
  if (dismissedKey === latest.key) return null;

  const isFatal = latest.fatal;
  const accent = isFatal ? colors.state.bottleneck : "#D97706"; // amber-600
  const bgSoft = isFatal
    ? colors.state.bottleneckSoft
    : "rgba(217, 119, 6, 0.08)";
  const fg = isFatal ? colors.state.bottleneckFg : "#92400E";

  return (
    <div
      role="alert"
      aria-live="polite"
      className="relative z-20 flex shrink-0 items-start gap-3 border-b px-4 py-2"
      style={{
        background: bgSoft,
        borderBottomColor: `${accent}33`,
      }}
    >
      <div
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{ background: accent, color: "white" }}
      >
        <span className="text-[11px] font-bold">{isFatal ? "!" : "△"}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="text-[9.5px] font-bold uppercase tracking-wider"
            style={{ color: accent, letterSpacing: "0.06em" }}
          >
            {isFatal ? "Pipeline halted" : "Pipeline warning"}
          </span>
          <span className="text-[10px] text-slate-600">
            · {humanStage(latest.stage)} · {latest.code}
          </span>
        </div>
        <div
          className="mt-0.5 text-[12px] font-medium leading-snug"
          style={{ color: fg }}
        >
          {latest.message}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors hover:opacity-90"
            style={{
              background: accent,
              color: "white",
            }}
          >
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissedKey(latest.key)}
          aria-label="Dismiss"
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-black/5"
        >
          <span className="text-[14px]">×</span>
        </button>
      </div>
    </div>
  );
}

// Map raw stage codes to user-facing labels — matches the
// PipelineProgressStrip's STAGES list so the user sees the same
// vocabulary in both places.
function humanStage(stage: string): string {
  switch (stage) {
    case "intake":
      return "Intake";
    case "landscape":
      return "Landscape";
    case "kg":
    case "decompose":
      return "Decompose";
    case "proposal":
    case "synthesis":
      return "Synthesize";
    case "twin":
    case "strategy":
      return "Strategy";
    case "lab":
      return "Lab options";
    case "reflexive":
    case "apps":
      return "Apps";
    case "results":
      return "Results";
    default:
      return stage;
  }
}
