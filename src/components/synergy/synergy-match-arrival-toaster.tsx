// ── Synergy match arrival toaster ──
//
// Mount-once-per-page component that subscribes to component_matches
// realtime INSERTs and fires a toast for each arrival. Rate-limits to
// avoid toast spam if the matcher dumps many rows in quick succession
// (e.g. when extract runs for the first time and lands 20+ matches).
//
// Why a toaster vs. inline UI? Because match arrival is a notification
// — the user might be on /app, /discover, or anywhere. Surfacing
// inline only works on the discover page. Toast + bell-badge bump is
// the universal pattern: "you have something new, click to see."
//
// Mount sites: /app dashboard, /discover, /requests inbox. Anywhere
// the user might be sitting when a match lands.

"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/hooks/use-toast";
import {
  useRealtimeMatches,
  type RealtimeMatchEvent,
} from "@/hooks/synergy/use-realtime-matches";

// Rate-limit: at most one toast per WINDOW_MS, with a queue accumulating
// further arrivals into a single grouped "+N more" toast.
const WINDOW_MS = 2500;

interface Props {
  enabled?: boolean;
}

export function SynergyMatchArrivalToaster({ enabled = true }: Props) {
  const router = useRouter();
  const queueRef = useRef<RealtimeMatchEvent[]>([]);
  const lastShownRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  // Dedupe by match id — realtime delivers the same INSERT once, but
  // re-subscriptions on hot-reload can occasionally double-fire.
  const seenIdsRef = useRef<Set<string>>(new Set());

  const flush = () => {
    flushTimerRef.current = null;
    const queue = queueRef.current;
    if (queue.length === 0) return;
    queueRef.current = [];
    lastShownRef.current = Date.now();

    if (queue.length === 1) {
      const m = queue[0];
      toast.info("New match", {
        description: `${Math.round(m.finalScore)}/100 — ${m.rationale.slice(0, 120)}`,
        ttl: 7000,
        action: {
          label: "View",
          onClick: () => router.push("/app/synergy/discover"),
        },
      });
    } else {
      const top = queue.reduce((a, b) =>
        a.finalScore >= b.finalScore ? a : b,
      );
      toast.info(`${queue.length} new matches`, {
        description: `Top fit ${Math.round(top.finalScore)}/100 — ${top.rationale.slice(0, 100)}`,
        ttl: 9000,
        action: {
          label: "Browse",
          onClick: () => router.push("/app/synergy/discover"),
        },
      });
    }
  };

  useRealtimeMatches(enabled, (event) => {
    if (seenIdsRef.current.has(event.matchId)) return;
    seenIdsRef.current.add(event.matchId);
    queueRef.current.push(event);

    // If we haven't toasted recently, flush immediately. Otherwise
    // schedule the flush at the end of the window so subsequent
    // arrivals coalesce.
    const now = Date.now();
    const sinceLast = now - lastShownRef.current;
    if (sinceLast >= WINDOW_MS && flushTimerRef.current === null) {
      flush();
    } else if (flushTimerRef.current === null) {
      flushTimerRef.current = window.setTimeout(flush, WINDOW_MS - sinceLast);
    }
  });

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  return null; // Headless — toast manager handles rendering
}
