"use client";

// Live-synthesis refresh hook — keeps the right-panel insights, the
// left-panel raw signal counts, and the middle-panel KG view fresh
// without requiring the user to manually reload. Two triggers:
//
//   1. Event-driven (fast path): when the SSE event store emits a
//      "synthesis-completing" event (strategy_consensus_ready,
//      signal_detected, proposal_ready, etc.), schedule a router
//      refresh on a 1.5s debounce so bursts of events collapse into
//      one re-fetch instead of N.
//
//   2. Time-driven (slow path): every 12s while an active run is in
//      flight, refresh anyway — in case the SSE missed an event or
//      the run wrote synthesis_data without emitting one.
//
// Why router.refresh() and not a direct API call:
//   - The layout's SSR queries include synthesis_data, entities,
//     edges, cycles, bridges — all of which the panels consume.
//     router.refresh() re-runs the whole layout, so every surface
//     stays consistent without one-off fetches.
//   - The cost is one round of layout queries (~5 parallel) which
//     completes in <1s. Acceptable given runs only fire occasionally.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRunEventStoreOptional } from "@/components/canvas/hooks/run-event-store";

// Events that almost always coincide with a synthesis_data write.
// On any of these we kick a debounced refresh.
const SYNTHESIS_TRIGGER_EVENTS = new Set<string>([
  "strategy_consensus_ready",
  "proposal_ready",
  "twin_proposal_ready",
  "signal_detected",
  "signal_cluster",
  "cycle_detected",
  "bridge_formed",
  "root_cause_identified",
  "why_chain_deepened",
  "convergence_detected",
  "contradiction_found",
  "lab_proposed",
  "framing_approved",
]);

interface UseLiveSynthesisRefreshOpts {
  /** When non-null, run is in flight — enable both event-driven and
   *  time-driven refresh. When null, only event-driven (so a user
   *  catching up on a completed run still gets fresh data when an
   *  event arrives via SSE replay). */
  activeRunId: string | null;
  /** Optional override for the polling cadence. Default 12s — slow
   *  enough that it doesn't dominate API load, fast enough that the
   *  user sees synthesis sections fill in during a 60-90s chain. */
  pollIntervalMs?: number;
  /** Debounce for event-triggered refreshes. Default 1500ms — short
   *  enough that the user feels immediate updates, long enough that
   *  rapid event bursts collapse to a single refresh. */
  debounceMs?: number;
}

export function useLiveSynthesisRefresh({
  activeRunId,
  pollIntervalMs = 12_000,
  debounceMs = 1500,
}: UseLiveSynthesisRefreshOpts): void {
  const router = useRouter();
  const store = useRunEventStoreOptional();
  // Cursor: the index of the last event we've seen, so we can detect
  // NEW events without firing on every store update. Holding it in a
  // ref means our effect doesn't have to depend on store.events
  // identity for correctness.
  const lastEventCursorRef = useRef<number>(0);
  const debounceTimerRef = useRef<number | null>(null);

  // ── Event-driven refresh ────────────────────────────────────────
  useEffect(() => {
    if (!store) return;
    // Detect new events since last cursor. We compare lengths because
    // the store appends only — old events never mutate.
    const total = store.events.length;
    if (total <= lastEventCursorRef.current) return;
    let triggered = false;
    for (let i = lastEventCursorRef.current; i < total; i++) {
      const t = store.events[i].event.type;
      if (SYNTHESIS_TRIGGER_EVENTS.has(t)) {
        triggered = true;
        break;
      }
    }
    lastEventCursorRef.current = total;
    if (!triggered) return;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      router.refresh();
    }, debounceMs);
  }, [store, router, debounceMs]);

  // ── Time-driven fallback ────────────────────────────────────────
  useEffect(() => {
    if (!activeRunId) return;
    const interval = window.setInterval(() => {
      router.refresh();
    }, pollIntervalMs);
    return () => window.clearInterval(interval);
  }, [activeRunId, router, pollIntervalMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);
}

// ── Tiny wrapper component ───────────────────────────────────────────
// Calls the hook from inside RunEventStoreProvider's children tree
// (the hook reads useRunEventStoreOptional which needs the provider
// in scope). Renders null — purely a side-effect carrier.
export function LiveSynthesisRefresh({
  activeRunId,
}: {
  activeRunId: string | null;
}) {
  useLiveSynthesisRefresh({ activeRunId });
  return null;
}
