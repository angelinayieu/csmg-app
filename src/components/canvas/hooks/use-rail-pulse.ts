"use client";

// useRailPulse — single-fetch data hook for the right-rail Ambient mode.
//
// Fetches /api/spaces/[id]/rail-pulse on mount and refreshes on:
//   • interval tick (default 30s — cheap query, light load)
//   • window event "rail:refresh" (parent dispatches after major
//     state changes — e.g., a paper just landed, a card just decomposed)
//   • optional explicit refresh() returned to the caller
//
// Returns nullable data while loading, error string on failure. Idle
// when spaceId is null (canvas not yet hydrated).

import { useCallback, useEffect, useRef, useState } from "react";
import type { RailPulseResponse } from "@/app/api/spaces/[id]/rail-pulse/route";

const DEFAULT_REFRESH_MS = 30_000;

export interface UseRailPulseResult {
  data: RailPulseResponse | null;
  loading: boolean;
  error: string | null;
  /** Manually trigger a refetch. Useful for tests + explicit retry buttons. */
  refresh: () => Promise<void>;
  /** ISO timestamp of the most recent successful response. */
  lastFetchedAt: string | null;
}

export function useRailPulse(
  spaceId: string | null | undefined,
  options?: { refreshIntervalMs?: number; enabled?: boolean },
): UseRailPulseResult {
  const refreshIntervalMs = options?.refreshIntervalMs ?? DEFAULT_REFRESH_MS;
  const enabled = options?.enabled ?? true;
  const [data, setData] = useState<RailPulseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  // Avoid concurrent fetches piling up if the user mashes refresh.
  const inflightRef = useRef<AbortController | null>(null);

  const fetchPulse = useCallback(async () => {
    if (!spaceId || !enabled) return;
    // Cancel any in-flight fetch — we only care about the latest snapshot.
    if (inflightRef.current) inflightRef.current.abort();
    const ac = new AbortController();
    inflightRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/rail-pulse`, {
        signal: ac.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as RailPulseResponse;
      setData(payload);
      setLastFetchedAt(payload.computed_at);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "rail-pulse fetch failed");
    } finally {
      // Only clear loading if THIS fetch is still the active one.
      if (inflightRef.current === ac) {
        setLoading(false);
        inflightRef.current = null;
      }
    }
  }, [spaceId, enabled]);

  // Initial fetch + interval refresh
  useEffect(() => {
    if (!spaceId || !enabled) return;
    fetchPulse();
    const id = window.setInterval(() => {
      fetchPulse();
    }, refreshIntervalMs);
    return () => {
      window.clearInterval(id);
      if (inflightRef.current) inflightRef.current.abort();
    };
  }, [spaceId, enabled, refreshIntervalMs, fetchPulse]);

  // Window-event-triggered refresh — anything that dispatches
  // "rail:refresh" causes an immediate re-fetch. Used by the parent
  // canvas after major mutations (paper landed, decompose finished).
  useEffect(() => {
    if (!spaceId || !enabled) return;
    const handler = () => {
      fetchPulse();
    };
    window.addEventListener("rail:refresh", handler);
    return () => window.removeEventListener("rail:refresh", handler);
  }, [spaceId, enabled, fetchPulse]);

  return {
    data,
    loading,
    error,
    refresh: fetchPulse,
    lastFetchedAt,
  };
}
