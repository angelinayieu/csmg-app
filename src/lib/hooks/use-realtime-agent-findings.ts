"use client";

/**
 * Wave D L3.4 — live agent_findings feed.
 *
 * Subscribes to `agent_findings` INSERT + UPDATE events scoped to the
 * current user (RLS is already user-scoped, realtime filter narrows by
 * user_id so we don't spin up N channels per tab). Priming via a single
 * HTTP fetch keeps the initial render fast; the channel streams deltas.
 *
 * Consumers: AgentPulseModule, FloatingFeedSheet, AgentActivityBell.
 *
 * Follows the same shape as useAgentRuntime (prime → subscribe →
 * watchdog) for consistency.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AgentFinding } from "@/types";

interface UseRealtimeAgentFindingsState {
  findings: AgentFinding[];
  unreadCount: number;
  urgentCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  markReviewedLocal: (id: string, status: AgentFinding["status"]) => void;
}

interface UseRealtimeAgentFindingsOpts {
  spaceId?: string | null;
  limit?: number;
}

export function useRealtimeAgentFindings(
  userId: string | null,
  opts: UseRealtimeAgentFindingsOpts = {},
): UseRealtimeAgentFindingsState {
  const { spaceId = null, limit = 50 } = opts;
  const [findings, setFindings] = useState<AgentFinding[]>([]);
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
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (spaceId) params.set("space_id", spaceId);
      const res = await fetch(`/api/agent-findings?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        if (!cancelledRef.current) {
          setLoading(false);
          setError(err.error ?? `Failed to load findings (${res.status})`);
        }
        return;
      }
      const data = (await res.json()) as { findings: AgentFinding[] };
      if (cancelledRef.current) return;
      setFindings(data.findings ?? []);
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
    const channelTopic = `agent-findings:${userId}:${spaceId ?? "all"}:${Math.random()
      .toString(36)
      .slice(2)}`;
    const channel = supabase
      .channel(channelTopic)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_findings",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const next = payload.new as AgentFinding;
          // Client-side space filter when the hook is scoped.
          if (spaceId && next.space_id && next.space_id !== spaceId) return;
          setFindings((prev) => {
            if (prev.some((f) => f.id === next.id)) return prev;
            return [next, ...prev].slice(0, limit);
          });
          lastEventAtRef.current = Date.now();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "agent_findings",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const next = payload.new as AgentFinding;
          setFindings((prev) => prev.map((f) => (f.id === next.id ? next : f)));
          lastEventAtRef.current = Date.now();
        },
      )
      .subscribe();

    // Watchdog — re-prime if events stop flowing for 60s. agent_findings
    // are bursty (not a steady stream) so we use a longer quiet threshold
    // than useAgentRuntime.
    watchdogRef.current = setInterval(() => {
      if (cancelledRef.current) return;
      if (Date.now() - lastEventAtRef.current > 60_000) {
        primeState();
      }
    }, 30_000);

    return () => {
      cancelledRef.current = true;
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      supabase.removeChannel(channel);
    };
  }, [userId, spaceId, limit, primeState]);

  const markReviewedLocal = useCallback(
    (id: string, status: AgentFinding["status"]) => {
      setFindings((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status } : f)),
      );
    },
    [],
  );

  const unreadCount = findings.filter((f) => f.status === "unread").length;
  const urgentCount = findings.filter(
    (f) => f.status === "unread" && f.severity === "urgent",
  ).length;

  return {
    findings,
    unreadCount,
    urgentCount,
    loading,
    error,
    refresh: primeState,
    markReviewedLocal,
  };
}
