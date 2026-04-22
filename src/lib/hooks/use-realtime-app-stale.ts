"use client";

/**
 * Wave D L3.4 — live app staleness indicator.
 *
 * Apps can flip to `stale` via three cascades:
 *   - metric-change trigger (flagAppsByMetricChange)
 *   - surprise-deviation cascade (handleSurpriseDeviation)
 *   - intervention lifecycle (completeIntervention → recomputeAppHealth)
 *
 * The Synthesis view surfaces a "stale apps" chip so the user sees when
 * the plan's assumptions have drifted. Rather than polling /api/apps
 * every N seconds, this hook subscribes to apps UPDATE events filtered
 * by space_id and tracks which app_ids are currently flagged.
 *
 * Consumers: Synthesis view stale-apps chip (L4.2), app-detail page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { App } from "@/types/app";

interface UseRealtimeAppStaleState {
  staleApps: Array<{
    id: string;
    name: string | null;
    stale_reason: string | null;
    stale_since: string | null;
  }>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useRealtimeAppStale(
  spaceId: string | null,
): UseRealtimeAppStaleState {
  const [staleApps, setStaleApps] = useState<UseRealtimeAppStaleState["staleApps"]>([]);
  const [loading, setLoading] = useState(!!spaceId);
  const [error, setError] = useState<string | null>(null);
  const lastEventAtRef = useRef<number>(Date.now());
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const primeState = useCallback(async () => {
    if (!spaceId) {
      setLoading(false);
      return;
    }
    try {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: qErr } = await (supabase as any)
        .from("apps")
        .select("id, name, stale_reason, stale_since, status")
        .eq("space_id", spaceId)
        .eq("status", "stale");
      if (qErr) throw qErr;
      if (cancelledRef.current) return;
      setStaleApps(
        ((data ?? []) as Array<Pick<App, "id" | "name" | "stale_reason" | "stale_since">>).map(
          (a) => ({
            id: a.id,
            name: a.name ?? null,
            stale_reason: a.stale_reason ?? null,
            stale_since: a.stale_since ?? null,
          }),
        ),
      );
      setLoading(false);
      setError(null);
      lastEventAtRef.current = Date.now();
    } catch (err) {
      if (!cancelledRef.current) {
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [spaceId]);

  useEffect(() => {
    if (!spaceId) {
      setLoading(false);
      return;
    }
    cancelledRef.current = false;
    primeState();

    const supabase = createClient();
    const channel = supabase
      .channel(`apps-stale:${spaceId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "apps",
          filter: `space_id=eq.${spaceId}`,
        },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const next = payload.new as any;
          lastEventAtRef.current = Date.now();
          setStaleApps((prev) => {
            const without = prev.filter((a) => a.id !== next.id);
            if (next.status === "stale") {
              return [
                {
                  id: next.id,
                  name: next.name ?? null,
                  stale_reason: next.stale_reason ?? null,
                  stale_since: next.stale_since ?? null,
                },
                ...without,
              ];
            }
            return without;
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "apps",
          filter: `space_id=eq.${spaceId}`,
        },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const next = payload.new as any;
          if (next.status !== "stale") return;
          lastEventAtRef.current = Date.now();
          setStaleApps((prev) => {
            if (prev.some((a) => a.id === next.id)) return prev;
            return [
              {
                id: next.id,
                name: next.name ?? null,
                stale_reason: next.stale_reason ?? null,
                stale_since: next.stale_since ?? null,
              },
              ...prev,
            ];
          });
        },
      )
      .subscribe();

    watchdogRef.current = setInterval(() => {
      if (cancelledRef.current) return;
      if (Date.now() - lastEventAtRef.current > 120_000) {
        primeState();
      }
    }, 60_000);

    return () => {
      cancelledRef.current = true;
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      supabase.removeChannel(channel);
    };
  }, [spaceId, primeState]);

  return {
    staleApps,
    loading,
    error,
    refresh: primeState,
  };
}
