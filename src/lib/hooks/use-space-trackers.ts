"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimum shape of a tracker row returned by GET /api/spaces/[id]/metric-trackers.
 * Kept local to avoid coupling the hook to the full Database.Row type.
 */
export interface TrackerWithLatest {
  id: string;
  label: string;
  source_kind:
    | "goal"
    | "target_objective"
    | "perspective_key_metric"
    | "micro_tactic_metric"
    | "leading_indicator"
    | "lagging_indicator";
  depth_tier: "light" | "mid" | "heavy" | null;
  data_category: string | null;
  unit: string | null;
  cadence: "daily" | "weekly" | "biweekly" | "monthly" | "adhoc";
  baseline_value: number | null;
  current_value: number | null;
  target_value: number | null;
  baseline_text: string | null;
  current_text: string | null;
  target_text: string | null;
  status: "active" | "superseded" | "archived";
  latest_observation: {
    recorded_at?: string;
    value?: number | null;
    value_text?: string | null;
    note?: string | null;
    source?: string | null;
  } | null;
}

interface UseSpaceTrackersResult {
  trackers: TrackerWithLatest[];
  loading: boolean;
  error: string | null;
  /** Refetch from the server (after a successful observation insert, etc.). */
  refresh: () => Promise<void>;
  /**
   * Submit an observation for a tracker. On success the tracker list refreshes
   * so the knownness pill + current value + latest_observation all update.
   */
  logObservation: (
    trackerId: string,
    payload: { value?: number | null; value_text?: string | null; note?: string | null }
  ) => Promise<{ ok: true; posteriorUpdates: number } | { ok: false; error: string }>;
}

/**
 * Client-side hook used by the trackers lab panel. Fetches the space's
 * active trackers on mount, exposes a submitter for POSTing observations,
 * and auto-refreshes the list after a successful submit so the UI reflects
 * the new posterior state without a full page reload.
 */
export function useSpaceTrackers(spaceId: string): UseSpaceTrackersResult {
  const [trackers, setTrackers] = useState<TrackerWithLatest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/spaces/${spaceId}/metric-trackers`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { trackers?: TrackerWithLatest[] };
      if (!mountedRef.current) return;
      setTrackers(Array.isArray(data.trackers) ? data.trackers : []);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError((err as Error).message ?? "Failed to load trackers");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const logObservation = useCallback<
    UseSpaceTrackersResult["logObservation"]
  >(async (trackerId, payload) => {
    try {
      const res = await fetch(
        `/api/metric-trackers/${trackerId}/observations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Failed" }));
        return { ok: false, error: errBody.error ?? `HTTP ${res.status}` };
      }
      const body = (await res.json()) as {
        posterior_updates?: number;
      };
      await load();
      return { ok: true, posteriorUpdates: body.posterior_updates ?? 0 };
    } catch (err) {
      return { ok: false, error: (err as Error).message ?? "Network error" };
    }
  }, [load]);

  return { trackers, loading, error, refresh: load, logObservation };
}
