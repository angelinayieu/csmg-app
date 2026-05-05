"use client";

// ── useIntelligenceSpine ────────────────────────────────────────────
//
// Hydrates `/api/spaces/[id]/intelligence-spine` and keeps the payload
// fresh while the Intelligence drawer is open. Two refresh sources:
//
//   1. Polling — every 30s as a baseline. Catches state that doesn't
//      come through realtime (synthesis_data updates from
//      strategy-refresh, runtime_settings changes from another tab).
//
//   2. Realtime — Supabase channel on app_agent_runs + pipeline_runs
//      so an in-flight cron tick or pipeline run lands within ~1s.
//      Realtime events trigger a debounced re-fetch (we don't splice
//      individual rows; the spine is a derived rollup, not a list).
//
// Skipped entirely when `enabled === false` — the drawer passes false
// while closed so we don't burn requests.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { IntelligenceSpine } from "@/types/intelligence-spine";

const POLL_INTERVAL_MS = 30_000;
const REALTIME_DEBOUNCE_MS = 800;

interface UseIntelligenceSpineState {
  spine: IntelligenceSpine | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useIntelligenceSpine(
  spaceId: string | null,
  enabled: boolean,
): UseIntelligenceSpineState {
  const [spine, setSpine] = useState<IntelligenceSpine | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSpine = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(id)}/intelligence-spine`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          if (!cancelledRef.current) {
            setError(body?.error ?? `HTTP ${res.status}`);
            setLoading(false);
          }
          return;
        }
        const payload = (await res.json()) as IntelligenceSpine;
        if (cancelledRef.current) return;
        setSpine(payload);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (!cancelledRef.current) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    },
    [],
  );

  const scheduleRefetch = useCallback(
    (id: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (!cancelledRef.current) void fetchSpine(id);
      }, REALTIME_DEBOUNCE_MS);
    },
    [fetchSpine],
  );

  useEffect(() => {
    if (!enabled || !spaceId) {
      // Idle — don't load, don't subscribe. Reset state on disable so
      // the next open starts fresh rather than flashing stale data.
      if (!enabled) {
        setSpine(null);
        setError(null);
      }
      return;
    }

    cancelledRef.current = false;
    setLoading(true);
    void fetchSpine(spaceId);

    const supabase = createClient();
    const channel = supabase
      .channel(`intelligence-spine:${spaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "app_agent_runs",
          filter: `space_id=eq.${spaceId}`,
        },
        () => scheduleRefetch(spaceId),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pipeline_runs",
          filter: `space_id=eq.${spaceId}`,
        },
        () => scheduleRefetch(spaceId),
      )
      .subscribe();

    pollRef.current = setInterval(() => {
      if (!cancelledRef.current) void fetchSpine(spaceId);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      supabase.removeChannel(channel);
    };
  }, [spaceId, enabled, fetchSpine, scheduleRefetch]);

  const refresh = useCallback(() => {
    if (spaceId && enabled) void fetchSpine(spaceId);
  }, [spaceId, enabled, fetchSpine]);

  return { spine, loading, error, refresh };
}
