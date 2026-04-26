"use client";

// ── RunEventStore ──
//
// Single-owner SSE connection for a pipeline run. Every consumer
// (painter, HUD, run-signals banner, analog rail, proposal rings,
// reasoning panels, chain-completion banner, ...) used to call
// `useStructuralEventStream(runId)` independently — each opening its
// OWN EventSource to /api/pipeline/stream/[runId]. Nine subscribers
// meant nine concurrent SSE connections per run, nine re-parses of
// the same event log, and race conditions whenever the runId
// changed. It was also a real server load issue: every reconnect
// replay burned CPU on nine connections in parallel.
//
// The store fixes that: ONE provider opens the stream, maintains
// one events[], and exposes it via context. Consumers call cheap
// selector hooks that memoize by the slice they care about.

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  useStructuralEventStream,
  type StreamedEvent,
  type StreamStatus,
  type UseStructuralEventStreamResult,
} from "./use-structural-event-stream";

interface RunEventStoreValue extends UseStructuralEventStreamResult {
  runId: string | null | undefined;
}

const Ctx = createContext<RunEventStoreValue | null>(null);

export interface RunEventStoreProviderProps {
  runId: string | null | undefined;
  children: ReactNode;
}

export function RunEventStoreProvider({
  runId,
  children,
}: RunEventStoreProviderProps) {
  const stream = useStructuralEventStream(runId);
  const value = useMemo<RunEventStoreValue>(
    () => ({ ...stream, runId }),
    // `stream.events` is the real driver — status/latest/lastEventAt
    // all tick alongside it. Keep the `events` reference stable when
    // nothing new arrived so consumers don't re-memo every render.
    [
      stream.events,
      stream.status,
      stream.error,
      stream.latest,
      stream.lastEventAtMs,
      runId,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Full store value. Drop-in replacement for
 *  `useStructuralEventStream(runId)` — same shape, no runId arg. */
export function useRunEventStore(): RunEventStoreValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useRunEventStore must be used inside a <RunEventStoreProvider>.",
    );
  }
  return v;
}

/** Optional variant that returns `null` when no provider is mounted.
 *  For widgets that might render outside a run context (detail pages,
 *  etc.) — lets them gracefully degrade to no-live-events instead of
 *  throwing. */
export function useRunEventStoreOptional(): RunEventStoreValue | null {
  return useContext(Ctx);
}

// ── Selector hooks ────────────────────────────────────────────────
//
// Consumers that only care about a specific slice of the event log
// use these. Each memoizes against its slice so a new `entity_added`
// event doesn't rerender a component that only watches `proposal_ready`.

/** Latest `stage_boundary` event (enter OR exit — freshest wins). */
export function useLatestStageBoundary(): StreamedEvent | null {
  const { events } = useRunEventStore();
  return useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].event.type === "stage_boundary") return events[i];
    }
    return null;
  }, [events]);
}

/** Events of a given type, memoized. */
export function useEventsOfType<T extends StreamedEvent["event"]["type"]>(
  type: T,
): StreamedEvent[] {
  const { events } = useRunEventStore();
  return useMemo(
    () => events.filter((e) => e.event.type === type),
    [events, type],
  );
}

/** SSE status, plain. */
export function useRunStatus(): StreamStatus {
  return useRunEventStore().status;
}

/** How many ms since the last event arrived. Ticks live via the
 *  store's lastEventAtMs + caller's own setInterval if they want
 *  subsecond precision. Returns Infinity when nothing has arrived. */
export function useStaleMs(): number {
  const { lastEventAtMs } = useRunEventStore();
  return lastEventAtMs === null ? Infinity : Date.now() - lastEventAtMs;
}
