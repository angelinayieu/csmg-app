"use client";

// ── useDecisionLogSignal ──────────────────────────────────────────
//
// Phase 12.A (12.A.9). Live-refresh primitive for the Causal System
// Map. Subscribes to the EXISTING decision-log feed (the same endpoint
// the Lab Notebook reads) rather than inventing a new channel: it polls
// GET .../decisions?limit=1 and watches the exact `total` count + the
// newest event id. When either changes, a NEW decision was logged
// (autopilot finished, a variation scored, chains enriched, layers
// regenerated, a sub-objective confirmed …) → the returned `signal`
// bumps, and the consumer can `router.refresh()` to pull fresh props.
//
// Design choices:
//   • Baseline-on-mount: the first poll establishes the baseline WITHOUT
//     signalling, so mounting never triggers a spurious refresh.
//   • Visibility-aware: pauses while the tab is hidden; re-polls on
//     return so a backgrounded canvas catches up immediately.
//   • Debounced by cadence: bursts of events (autopilot fan-out) collapse
//     into one bump per interval — no refresh storm.
//   • Soft-fail: network / abort errors skip the tick, never throw.
//
// Reused later by the room altitude (pass subObjectiveId) and any other
// surface that wants to react to the decision log.

import { useEffect, useRef, useState } from "react";
import type { NotebookEventPage } from "@/lib/objective-canvas/notebook-events";
import type { DecisionAction } from "@/lib/objective-canvas/decision-log";

interface Options {
  spaceId: string;
  /** Room scope. Omit / null → space-scoped feed (canvas altitude). */
  subObjectiveId?: string | null;
  /** Poll cadence. Default 8s — cheap (a single-row fetch). */
  intervalMs?: number;
  /** Pause polling when false (e.g. Cards view is active). */
  enabled?: boolean;
  /** Optional filter to only invalidating actions (§17.9 mapping).
   *  Omit to react to every logged decision. */
  actions?: DecisionAction[];
}

export interface DecisionLogSignal {
  /** Monotonic counter. 0 until the first NEW event is detected after
   *  mount; bumps once per detected change thereafter. Use as a
   *  useEffect dependency to trigger a refresh. */
  signal: number;
  /** ISO timestamp of the newest event seen, for "updated Xs ago" UI. */
  latestAt: string | null;
}

export function useDecisionLogSignal({
  spaceId,
  subObjectiveId = null,
  intervalMs = 8000,
  enabled = true,
  actions,
}: Options): DecisionLogSignal {
  const [state, setState] = useState<DecisionLogSignal>({
    signal: 0,
    latestAt: null,
  });

  // Composite key of (total, newest id). null = not yet baselined. A ref
  // so it survives re-renders and enabled toggles without re-baselining.
  const lastKeyRef = useRef<string | null>(null);

  // Stable primitive for the dependency array.
  const actionsKey =
    actions && actions.length > 0 ? [...actions].sort().join(",") : "";

  useEffect(() => {
    if (!enabled || !spaceId) return;

    let cancelled = false;
    let controller: AbortController | null = null;

    const base = subObjectiveId
      ? `/api/brainstorm/sub-objectives/${subObjectiveId}/decisions`
      : `/api/brainstorm/space/${spaceId}/decisions`;

    async function poll() {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return; // don't burn requests on a backgrounded tab
      }
      controller?.abort();
      controller = new AbortController();
      try {
        const qs = new URLSearchParams({ limit: "1" });
        if (actionsKey) qs.set("actions", actionsKey);
        const res = await fetch(`${base}?${qs.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok || cancelled) return;
        const page = (await res.json()) as NotebookEventPage;
        const newest = page.events?.[0] ?? null;
        const key = `${page.total ?? 0}:${newest?.id ?? ""}`;
        if (cancelled) return;

        if (lastKeyRef.current === null) {
          // First successful poll → baseline, no signal.
          lastKeyRef.current = key;
          if (newest) {
            setState((s) => ({ ...s, latestAt: newest.created_at }));
          }
          return;
        }
        if (key !== lastKeyRef.current) {
          lastKeyRef.current = key;
          setState((s) => ({
            signal: s.signal + 1,
            latestAt: newest?.created_at ?? s.latestAt,
          }));
        }
      } catch {
        // Aborted or network blip — retry next tick.
      }
    }

    void poll();
    const intervalId = setInterval(() => void poll(), intervalMs);

    function onVisibility() {
      if (document.visibilityState === "visible") void poll();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [spaceId, subObjectiveId, intervalMs, enabled, actionsKey]);

  return state;
}
