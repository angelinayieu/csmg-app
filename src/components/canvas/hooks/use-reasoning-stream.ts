"use client";

// ── useReasoningStream (Phase 2E · PR 3) ──
//
// Filters the structural event stream down to `reasoning_chunk`
// events so the canvas can surface live LLM prose as it streams.
// Previously these events were routed only to the audit drawer
// (hidden). Exposing them as a first-class hook lets a canvas-level
// "reasoning whisper" component read the latest thought without
// duplicating the SSE subscription.
//
// Returns the latest textSoFar + stage + phase plus an `isActive`
// flag that's true when a chunk has arrived within the last 2
// seconds. Consumers use `isActive` to drive pulse indicators
// (cursor blink, dot glow) and fade-out timing.

import { useMemo } from "react";
import type { StreamedEvent } from "./use-structural-event-stream";
import { useRunEventStore } from "./run-event-store";

export interface ReasoningStreamState {
  /** Accumulated text from the most recent reasoning_chunk event. */
  latestText: string;
  /** Which stage emitted the latest chunk (decompose / synthesize / etc). */
  stage: string | null;
  /** "thinking" while streaming, "complete" on the final chunk. */
  phase: "thinking" | "complete" | null;
  /** ISO timestamp of the most recent chunk — used for fade-out timing. */
  lastEventAt: string | null;
  /** Characters received in the latest chunk snapshot. */
  charsSoFar: number;
  /** True when a chunk arrived within the last `ACTIVE_WINDOW_MS`. */
  isActive: boolean;
}

// Treat the stream as "actively thinking" for 2s after the most
// recent chunk. Longer pauses collapse the cursor animation so the
// user can tell when the LLM is idle vs working.
const ACTIVE_WINDOW_MS = 2000;

export function useReasoningStream(
  // runId kept for backward-compat with existing callers; the store
  // owns the actual SSE connection. Arg is accepted but unused.
  _runId?: string | null,
): ReasoningStreamState {
  const { events } = useRunEventStore();

  return useMemo(() => {
    // Walk backward to find the most recent reasoning_chunk — we don't
    // need to keep the full history, just the latest snapshot.
    let latest: StreamedEvent | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].event.type === "reasoning_chunk") {
        latest = events[i];
        break;
      }
    }
    if (!latest || latest.event.type !== "reasoning_chunk") {
      return {
        latestText: "",
        stage: null,
        phase: null,
        lastEventAt: null,
        charsSoFar: 0,
        isActive: false,
      };
    }

    const chunk = latest.event;
    const emittedAtMs = new Date(latest.emittedAt).getTime();
    const isActive =
      chunk.phase === "thinking" &&
      Date.now() - emittedAtMs < ACTIVE_WINDOW_MS;

    return {
      latestText: chunk.textSoFar,
      stage: chunk.stage,
      phase: chunk.phase,
      lastEventAt: latest.emittedAt,
      charsSoFar: chunk.charsSoFar,
      isActive,
    };
  }, [events]);
}
