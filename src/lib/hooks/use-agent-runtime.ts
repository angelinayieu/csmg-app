"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AnalysisAgent, AgentRun } from "@/types";
import type { ResearchAgent } from "@/types/intelligence";
import { getAgentKindMeta } from "@/lib/agents/kinds";

interface AgentRuntimeState {
  /** Raw agent rows */
  agents: AnalysisAgent[];
  /** Raw run rows (most recent 200, desc) */
  recentRuns: AgentRun[];
  /** Projected ResearchAgent[] matching the existing UI contract */
  fleet: ResearchAgent[];
  /** True while priming initial state via HTTP */
  loading: boolean;
  error: string | null;
  /** Convenience: agents currently running */
  runningCount: number;
  /** Manual reprime (useful after user-triggered analyses kick off) */
  refresh: () => void;
}

/**
 * Live agent runtime — subscribes to agents + agent_runs via Supabase Realtime
 * and projects rows into the `ResearchAgent` shape the Intelligence Radar
 * already consumes.
 *
 * Mirrors the `useJobStream` pattern: HTTP primer → realtime channel → 15s
 * watchdog re-prime on quiet periods.
 */
export function useAgentRuntime(spaceId: string | null): AgentRuntimeState {
  const [agents, setAgents] = useState<AnalysisAgent[]>([]);
  const [recentRuns, setRecentRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(!!spaceId);
  const [error, setError] = useState<string | null>(null);
  const lastEventAtRef = useRef<number>(Date.now());
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const primeState = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/agents?space_id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        if (!cancelledRef.current) {
          setLoading(false);
          setError(err.error ?? `Failed to load agents (${res.status})`);
        }
        return;
      }
      const data = (await res.json()) as { agents: AnalysisAgent[]; recent_runs: AgentRun[] };
      if (cancelledRef.current) return;
      setAgents(data.agents);
      setRecentRuns(data.recent_runs);
      setLoading(false);
      setError(null);
      lastEventAtRef.current = Date.now();
    } catch (err) {
      if (!cancelledRef.current) {
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  useEffect(() => {
    if (!spaceId) {
      setLoading(false);
      return;
    }

    cancelledRef.current = false;
    primeState(spaceId);

    const supabase = createClient();
    const channel = supabase
      .channel(`agents:${spaceId}`)
      // New agent runs
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_runs", filter: `space_id=eq.${spaceId}` },
        (payload) => {
          setRecentRuns((prev) => [payload.new as AgentRun, ...prev].slice(0, 200));
          lastEventAtRef.current = Date.now();
        }
      )
      // Run status updates (completion, heartbeat, failure)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "agent_runs", filter: `space_id=eq.${spaceId}` },
        (payload) => {
          const next = payload.new as AgentRun;
          setRecentRuns((prev) => prev.map((r) => (r.id === next.id ? next : r)));
          lastEventAtRef.current = Date.now();
        }
      )
      // Agent metadata / status updates (driven by DB trigger when runs transition)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "agents", filter: `space_id=eq.${spaceId}` },
        (payload) => {
          const next = payload.new as AnalysisAgent;
          setAgents((prev) => prev.map((a) => (a.id === next.id ? next : a)));
          lastEventAtRef.current = Date.now();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agents", filter: `space_id=eq.${spaceId}` },
        (payload) => {
          const next = payload.new as AnalysisAgent;
          setAgents((prev) => (prev.some((a) => a.id === next.id) ? prev : [...prev, next]));
          lastEventAtRef.current = Date.now();
        }
      )
      .subscribe();

    // Watchdog — if no events arrive for 15s while we have running agents,
    // re-prime via HTTP to avoid a stale UI after dropped subscriptions.
    watchdogRef.current = setInterval(() => {
      if (cancelledRef.current) return;
      const quiet = Date.now() - lastEventAtRef.current;
      const anyRunning = agents.some((a) => a.status === "running" || a.status === "queued");
      if (quiet > 15_000 && anyRunning) primeState(spaceId);
    }, 5_000);

    return () => {
      cancelledRef.current = true;
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, primeState]);

  const refresh = useCallback(() => {
    if (spaceId) primeState(spaceId);
  }, [spaceId, primeState]);

  // Project agents + recentRuns into the ResearchAgent shape the UI consumes.
  // Keyed by `agent-runtime-${agent.id}` so it merges cleanly with mock agents
  // (different ID namespace).
  const fleet = useMemo<ResearchAgent[]>(() => {
    return agents.map((a) => {
      const kindMeta = getAgentKindMeta(a.kind);
      const runsForAgent = recentRuns.filter((r) => r.agent_id === a.id);
      const latestRun = runsForAgent[0]; // already sorted desc
      const status: ResearchAgent["status"] = (() => {
        if (a.status === "running") return "running";
        if (a.status === "error") return "error";
        if (latestRun?.status === "failed") return "error";
        if (latestRun?.status === "completed") return "completed";
        return "idle";
      })();

      // 24-hour sparkline: count findings per hour from recent runs
      const now = Date.now();
      const sparkline: number[] = Array(24).fill(0);
      let signalsToday = 0;
      for (const r of runsForAgent) {
        const runTime = new Date(r.started_at).getTime();
        const hoursAgo = Math.floor((now - runTime) / 3_600_000);
        if (hoursAgo >= 0 && hoursAgo < 24) {
          sparkline[23 - hoursAgo] += r.findings_count;
          signalsToday += r.findings_count;
        }
      }

      const findingsCount = runsForAgent.reduce((sum, r) => sum + (r.findings_count ?? 0), 0);
      const entityIds = Array.from(
        new Set(runsForAgent.flatMap((r) => r.entity_ids_discovered ?? []))
      );

      const research: ResearchAgent = {
        id: `agent-runtime-${a.id}`,
        name: a.name,
        focus_areas: a.focus_areas.length > 0 ? a.focus_areas : kindMeta.focus_areas,
        status,
        last_run_at: a.last_run_at,
        findings_count: findingsCount,
        entity_ids: entityIds,
        derived_from:
          a.source_objective_id
            ? "sub_objective"
            : a.source_goal_id
              ? "goal_tracking"
              : "focus_area",
        callsign: a.callsign ?? kindMeta.callsign,
        specialty: a.specialty ?? kindMeta.specialty,
        sparkline,
        signals_today: signalsToday,
        source_objective_id: a.source_objective_id ?? undefined,
        source_goal_id: a.source_goal_id ?? undefined,
      };
      return research;
    });
  }, [agents, recentRuns]);

  const runningCount = useMemo(
    () => fleet.filter((a) => a.status === "running").length,
    [fleet]
  );

  return { agents, recentRuns, fleet, loading, error, runningCount, refresh };
}
