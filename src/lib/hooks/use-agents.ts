"use client";

// ── Shared agents fetcher ─────────────────────────────────────────────
//
// Wraps GET /api/agents?space_id= so the dashboard's three consumers
// (SpaceInsightsStrip contributors, ExperimentTwinCard live indicator,
// OptimizationPerformanceCard) don't each fire their own poll. Caches per
// spaceId in-module so multiple mounts dedupe to one network request and
// one polling timer.
//
// useAgentStatuses (different file) is the workflow-overlay-specific
// projection that returns just `Map<node_id, status>`. This hook returns
// the raw rows so consumers can render names, run history, etc.

import { useEffect, useState, useCallback } from "react";

export interface AgentRow {
  id: string;
  kind: string;
  display_name?: string | null;
  status: "idle" | "queued" | "running" | "paused" | "error" | "retired";
  last_run_at: string | null;
}

export interface AgentRunRow {
  id: string;
  agent_id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  started_at: string;
  completed_at: string | null;
  /**
   * Distinguishes real agent runs from synthetic snapshots. The value
   * `"baseline_snapshot"` is written by `strategy-refresh/confirm` so the
   * dashboard can anchor Optimization Performance at baseline from the
   * moment a strategy is approved — before any real run has happened.
   */
  trigger_event?: string | null;
}

export interface AgentsPayload {
  agents: AgentRow[];
  recent_runs: AgentRunRow[];
}

interface CacheEntry {
  data: AgentsPayload | null;
  inflight: Promise<AgentsPayload | null> | null;
  fetchedAt: number;
  subscribers: Set<(p: AgentsPayload | null) => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const CACHE = new Map<string, CacheEntry>();
const POLL_INTERVAL_MS = 8000;

function ensure(spaceId: string): CacheEntry {
  let entry = CACHE.get(spaceId);
  if (!entry) {
    entry = {
      data: null,
      inflight: null,
      fetchedAt: 0,
      subscribers: new Set(),
      timer: null,
    };
    CACHE.set(spaceId, entry);
  }
  return entry;
}

async function fetchAgents(spaceId: string): Promise<AgentsPayload | null> {
  const entry = ensure(spaceId);
  if (entry.inflight) return entry.inflight;

  entry.inflight = (async () => {
    try {
      const res = await fetch(`/api/agents?space_id=${encodeURIComponent(spaceId)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Partial<AgentsPayload>;
      const payload: AgentsPayload = {
        agents: data.agents ?? [],
        recent_runs: data.recent_runs ?? [],
      };
      entry.data = payload;
      entry.fetchedAt = Date.now();
      for (const cb of entry.subscribers) cb(payload);
      return payload;
    } catch {
      return entry.data; // keep prior data on error
    } finally {
      entry.inflight = null;
    }
  })();

  return entry.inflight;
}

export function useAgents(spaceId: string | null | undefined): {
  data: AgentsPayload | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<AgentsPayload | null>(() =>
    spaceId ? ensure(spaceId).data : null,
  );

  useEffect(() => {
    if (!spaceId) {
      setData(null);
      return;
    }
    const entry = ensure(spaceId);

    // Subscribe.
    const cb = (p: AgentsPayload | null) => setData(p);
    entry.subscribers.add(cb);

    // Initial fetch (deduped via inflight) and warm cache for new subscribers.
    if (!entry.data) void fetchAgents(spaceId);
    else setData(entry.data);

    // Start the shared poll if this is the first subscriber.
    if (!entry.timer) {
      entry.timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        if (entry.subscribers.size === 0) return;
        void fetchAgents(spaceId);
      }, POLL_INTERVAL_MS);
    }

    return () => {
      entry.subscribers.delete(cb);
      // Stop polling when the last subscriber unmounts.
      if (entry.subscribers.size === 0 && entry.timer) {
        clearInterval(entry.timer);
        entry.timer = null;
      }
    };
  }, [spaceId]);

  const refresh = useCallback(async () => {
    if (!spaceId) return;
    await fetchAgents(spaceId);
  }, [spaceId]);

  return {
    data,
    loading: data === null,
    refresh,
  };
}
