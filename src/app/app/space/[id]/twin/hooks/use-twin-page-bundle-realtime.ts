"use client";

// ── useTwinPageBundleRealtime ──────────────────────────────────────
//
// W3. Subscribes to Supabase postgres_changes channels for the rows
// that drive the Twin Detail Page. When the right table mutates,
// the relevant data is refetched and handed back to the caller
// via setBundle.
//
// Channels (one per concern, all space-scoped):
//   - mechanisms        → bundle refetch (Overview cards, System)
//   - prediction_ledger → bundle refetch (Outcomes prediction history)
//   - pain_metrics      → bundle refetch (Outcomes pain cards)
//   - twin_proposals    → bundle refetch (fidelity strip + proposal pill)
//   - observations      → bundle refetch (Outcomes feed)
//
// Coalescing: all events run through a single 300ms debounce timer.
// If 5 events land in a burst, only one bundle refetch fires.
//
// In-flight protection: if a refetch is already running when another
// event arrives, the trailing event re-arms the timer so we still
// pick up its mutation, but we never run two refetches at once.
//
// Soft-fail throughout — a dropped subscription leaves the page
// still functioning via the 5-min TTL.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

interface Options {
  /** When false the hook is a no-op. Useful in tests / SSR. */
  enabled?: boolean;
  /** Override the debounce window. Defaults to 300ms. */
  debounceMs?: number;
}

interface ReturnShape {
  /** Set to the timestamp of the most recent realtime event so
   *  UI surfaces can flash a "just updated" indicator. */
  lastEventAt: number | null;
}

// Tables we watch + the columns we filter on. All these tables have
// `space_id` so the filter is identical.
const WATCHED_TABLES = [
  "mechanisms",
  "prediction_ledger",
  "pain_metrics",
  "twin_proposals",
  "observations",
] as const;

export function useTwinPageBundleRealtime(
  spaceId: string,
  setBundle: (next: TwinPageBundle) => void,
  options: Options = {},
): ReturnShape {
  const enabled = options.enabled ?? true;
  const debounceMs = options.debounceMs ?? 300;
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  // Refs for fetch coalescing — never re-render the consumer just
  // because we tracked an in-flight flag.
  const fetchingRef = useRef(false);
  const trailingArmedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bundle refetch — surgically replaces the cached bundle with a
  // fresh one. cache:no-store forces the route to recompute (or
  // hand back its own freshly cached row).
  const refetchBundle = useCallback(async () => {
    if (fetchingRef.current) {
      // Mark a trailing fetch so we don't lose the event that just
      // arrived during the current refetch.
      trailingArmedRef.current = true;
      return;
    }
    fetchingRef.current = true;
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/twin-page-bundle`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { bundle: TwinPageBundle };
      setBundle(json.bundle);
    } catch (err) {
      console.warn("[twin-realtime] bundle refetch failed:", err);
    } finally {
      fetchingRef.current = false;
      // If events landed during the fetch, re-fire after a beat so
      // the page picks them up. Reuses the same debounce timer.
      if (trailingArmedRef.current) {
        trailingArmedRef.current = false;
        scheduleRefetch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, setBundle]);

  // Schedule a debounced refetch. Idempotent — multiple calls within
  // the debounce window collapse to a single fetch.
  const scheduleRefetch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void refetchBundle();
    }, debounceMs);
  }, [refetchBundle, debounceMs]);

  useEffect(() => {
    if (!enabled || !spaceId) return;

    const supabase = createClient();
    const channel = supabase.channel(`twin-page:${spaceId}`);

    for (const table of WATCHED_TABLES) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `space_id=eq.${spaceId}`,
        },
        () => {
          setLastEventAt(Date.now());
          scheduleRefetch();
        },
      );
    }

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Optional: light status logging for dev. Subscribe doesn't
        // mean events will come — just that the channel is open.
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("[twin-realtime] channel status:", status);
      }
    });

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [spaceId, enabled, scheduleRefetch]);

  return { lastEventAt };
}
