"use client";

/**
 * Wave D L3.4 — live user_events feed.
 *
 * user_events are the Wave C behavior stream (goal_approved, intervention
 * completed, prediction surprise, etc.). Consumers wire this into small
 * live dots / ticker UIs — the Pulse module prefers agent_findings for
 * headline signal, but user_events power the "something just happened"
 * microcopy and the digest-ready counters on the dashboard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { UserEvent } from "@/types";

interface UseRealtimeUserEventsState {
  events: UserEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface UseRealtimeUserEventsOpts {
  spaceId?: string | null;
  limit?: number;
}

export function useRealtimeUserEvents(
  userId: string | null,
  opts: UseRealtimeUserEventsOpts = {},
): UseRealtimeUserEventsState {
  const { spaceId = null, limit = 40 } = opts;
  const [events, setEvents] = useState<UserEvent[]>([]);
  const [loading, setLoading] = useState(!!userId);
  const [error, setError] = useState<string | null>(null);
  const lastEventAtRef = useRef<number>(Date.now());
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const primeState = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      const supabase = createClient();
      let query = supabase
        .from("user_events")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (spaceId) query = query.eq("space_id", spaceId);
      const { data, error: qErr } = await query;
      if (qErr) throw qErr;
      if (cancelledRef.current) return;
      setEvents((data ?? []) as UserEvent[]);
      setLoading(false);
      setError(null);
      lastEventAtRef.current = Date.now();
    } catch (err) {
      if (!cancelledRef.current) {
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [userId, spaceId, limit]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    cancelledRef.current = false;
    primeState();

    const supabase = createClient();
    const channel = supabase
      .channel(`user-events:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_events",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const next = payload.new as UserEvent;
          if (spaceId && next.space_id && next.space_id !== spaceId) return;
          setEvents((prev) => {
            if (prev.some((e) => e.id === next.id)) return prev;
            return [next, ...prev].slice(0, limit);
          });
          lastEventAtRef.current = Date.now();
        },
      )
      .subscribe();

    watchdogRef.current = setInterval(() => {
      if (cancelledRef.current) return;
      if (Date.now() - lastEventAtRef.current > 90_000) {
        primeState();
      }
    }, 30_000);

    return () => {
      cancelledRef.current = true;
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      supabase.removeChannel(channel);
    };
  }, [userId, spaceId, limit, primeState]);

  return {
    events,
    loading,
    error,
    refresh: primeState,
  };
}
