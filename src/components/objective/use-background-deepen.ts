"use client";

// ── useBackgroundDeepen (Arc 3.3) ──────────────────────────────────
//
// "Fast shell + background deepen." A room renders its cards instantly
// from already-generated entities, but each card's DEEP detail
// (definition / variations / planning) is produced lazily by
// /item/expand on first drawer-open — which is the spinner the user
// hits. This hook eliminates that wait: once the room is loaded, it
// fires /item/expand for every card in the background (throttled,
// fire-and-forget) so the detail is cached BEFORE the user opens
// anything. By the time they click a card, it's instant.
//
// Safe + cheap: /item/expand is idempotent and short-circuits on
// already-expanded cards (returns the cache without an LLM call), so
// re-runs and already-deep cards cost almost nothing. Each id is
// attempted once per mount (doneRef), concurrency-capped so we never
// hammer the API.

import { useEffect, useRef } from "react";

export function useBackgroundDeepen(
  /** Card entity ids to pre-deepen (pains + mechanisms + outcomes). */
  entityIds: string[],
  /** Gate — only run once the room is actually generated. */
  enabled: boolean,
  /** Max concurrent /item/expand calls. */
  concurrency = 3,
) {
  // Survives re-renders so we never re-fire an id we've already kicked.
  const doneRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const todo = entityIds.filter((id) => id && !doneRef.current.has(id));
    if (todo.length === 0) return;
    for (const id of todo) doneRef.current.add(id);

    let cancelled = false;
    let cursor = 0;

    async function worker() {
      while (!cancelled && cursor < todo.length) {
        const id = todo[cursor++];
        try {
          await fetch("/api/brainstorm/item/expand", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ entityId: id }),
          });
        } catch {
          // Best-effort prefetch — a failure just means the card
          // expands on open as before. Never surface it.
        }
      }
    }

    const pool = Array.from(
      { length: Math.min(concurrency, todo.length) },
      () => worker(),
    );
    void Promise.all(pool);

    return () => {
      cancelled = true;
    };
  }, [entityIds, enabled, concurrency]);
}
