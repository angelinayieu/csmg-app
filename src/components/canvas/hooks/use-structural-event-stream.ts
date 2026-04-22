"use client";

// ── useStructuralEventStream ──
// Client-side hook that connects to GET /api/pipeline/stream/[runId]
// and accumulates structural events as they arrive.
//
// Exposes { events, status, error }. Consumer (ghost painter + audit
// drawer) reacts to events as they land.

import { useEffect, useRef, useState } from "react";
import type { StructuralEvent } from "@/types/pipeline-events";

export interface StreamedEvent {
  sequence: number;
  emittedAt: string;
  event: StructuralEvent;
}

export type StreamStatus =
  | "idle"
  | "connecting"
  | "open"
  | "completed"
  | "failed"
  | "timeout";

export interface UseStructuralEventStreamResult {
  events: StreamedEvent[];
  status: StreamStatus;
  error: string | null;
  /** Most recent event (convenience for "last step" UIs). */
  latest: StreamedEvent | null;
}

export function useStructuralEventStream(
  runId: string | null | undefined,
): UseStructuralEventStreamResult {
  const [events, setEvents] = useState<StreamedEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      setStatus("idle");
      setError(null);
      return;
    }

    setStatus("connecting");
    setError(null);
    setEvents([]);

    const es = new EventSource(`/api/pipeline/stream/${runId}`);
    esRef.current = es;

    es.onopen = () => setStatus("open");

    es.addEventListener("structural", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as StreamedEvent;
        setEvents((prev) => {
          // Dedupe by sequence (reconnect replays).
          if (prev.some((p) => p.sequence === parsed.sequence)) return prev;
          return [...prev, parsed].sort((a, b) => a.sequence - b.sequence);
        });
      } catch {
        // ignore malformed frames
      }
    });

    es.addEventListener("done", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as {
          status: "completed" | "failed" | "timeout";
          errorMessage?: string | null;
        };
        if (parsed.status === "completed") setStatus("completed");
        else if (parsed.status === "timeout") setStatus("timeout");
        else {
          setStatus("failed");
          if (parsed.errorMessage) setError(parsed.errorMessage);
        }
      } catch {
        setStatus("completed");
      }
      es.close();
    });

    es.addEventListener("error", () => {
      // EventSource auto-reconnects on transient errors. Only treat as
      // terminal failure when the underlying connection is actually
      // closed (readyState === 2). Checking against a captured `status`
      // closure would race — we read the live readyState instead.
      if (es.readyState === EventSource.CLOSED) {
        setStatus((prev) => (prev === "completed" ? prev : "failed"));
        setError((prev) => prev ?? "connection failed");
      }
    });

    return () => {
      es.close();
      esRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const latest = events.length > 0 ? events[events.length - 1] : null;
  return { events, status, error, latest };
}
