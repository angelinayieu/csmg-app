"use client";

// Live agent status hook — joins agents + agent_runs into a map the
// Experiment Twin renders on its workflow nodes.
//
// Polls GET /api/agents?space_id= at a configurable interval so the twin
// animates in near-real-time when the pipeline is running. Polling stops
// automatically when the tab is hidden (page visibility API) to avoid
// useless network traffic on stale tabs.
//
// The mapping from DB rows → workflow node ids is intentional and narrow:
// the workflow's stable node ids are `agent:<kind>`, matching the
// `agents.kind` enum. Any node with an id that doesn't start with `agent:`
// (inputs, data products, outputs, criteria) is simply not in the map —
// the renderer leaves them in their neutral state.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentWorkflowNode } from "@/types/agent-workflow";

// ── Types ─────────────────────────────────────────────────────────────

/** Trimmed shape of what /api/agents returns, narrowed to what we use. */
interface AgentRow {
  id: string;
  kind: string;
  status: "idle" | "queued" | "running" | "paused" | "error" | "retired";
  last_run_at: string | null;
}

interface AgentRunRow {
  id: string;
  agent_id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  started_at: string;
  completed_at: string | null;
}

export type WorkflowNodeStatus = AgentWorkflowNode["status"]; // "idle"|"running"|"done"|"failed"|null

export interface UseAgentStatusesResult {
  statusByNodeId: Map<string, WorkflowNodeStatus>;
  loading: boolean;
  error: string | null;
  /** Force an immediate re-fetch (e.g. right after the user triggered an action). */
  refresh: () => Promise<void>;
}

// ── Hook ──────────────────────────────────────────────────────────────

export interface UseAgentStatusesOptions {
  /** Poll interval in ms. Default 5s. Set to 0 to disable polling. */
  intervalMs?: number;
}

export function useAgentStatuses(
  spaceId: string | null | undefined,
  options?: UseAgentStatusesOptions
): UseAgentStatusesResult {
  const intervalMs = options?.intervalMs ?? 5000;

  const [statusByNodeId, setStatusByNodeId] = useState<
    Map<string, WorkflowNodeStatus>
  >(new Map());
  const [loading, setLoading] = useState(Boolean(spaceId));
  const [error, setError] = useState<string | null>(null);

  // Track the latest spaceId in a ref so the poll closure always sees the
  // newest id even if it's changed between ticks.
  const spaceIdRef = useRef(spaceId);
  spaceIdRef.current = spaceId;

  const load = useCallback(async () => {
    const sid = spaceIdRef.current;
    if (!sid) {
      setStatusByNodeId(new Map());
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/agents?space_id=${encodeURIComponent(sid)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        // Non-fatal: workflow still renders without the live overlay.
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        agents?: AgentRow[];
        recent_runs?: AgentRunRow[];
      };

      setStatusByNodeId(computeStatusMap(json.agents ?? [], json.recent_runs ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent statuses");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + polling.
  useEffect(() => {
    if (!spaceId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      await load();
    };

    // Fire immediately on mount / spaceId change.
    void tick();

    if (intervalMs > 0) {
      timer = setInterval(tick, intervalMs);
    }

    // Tab visibility: refresh eagerly when the user returns, and stop
    // triggering fetches while hidden (useEffect's `document.hidden`
    // check above already short-circuits polled ticks).
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) void tick();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [spaceId, intervalMs, load]);

  return { statusByNodeId, loading, error, refresh: load };
}

// ── Status computation ───────────────────────────────────────────────

/**
 * Map (agents + recent_runs) → {node_id → status}.
 *
 * Algorithm per agent:
 *   1. If `agents.status === "running"` or `"queued"` → node status = "running"
 *   2. Else look at most recent run for this agent:
 *        "running"    → running
 *        "completed"  → done
 *        "failed"     → failed
 *        "cancelled"  → failed  (display as same-severity "did not finish")
 *   3. Else fall back to agents.status → done / idle / failed mapping
 *
 * Multiple agents with the same `kind` collapse to the most-significant
 * status: running > failed > done > idle.
 */
export function computeStatusMap(
  agents: AgentRow[],
  runs: AgentRunRow[]
): Map<string, WorkflowNodeStatus> {
  // Group runs by agent_id, keep most recent first.
  const runsByAgent = new Map<string, AgentRunRow[]>();
  const sortedRuns = [...runs].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
  for (const run of sortedRuns) {
    const bucket = runsByAgent.get(run.agent_id);
    if (bucket) bucket.push(run);
    else runsByAgent.set(run.agent_id, [run]);
  }

  // Per-agent computed status.
  const byAgent = new Map<string, WorkflowNodeStatus>();
  for (const a of agents) {
    byAgent.set(a.id, computeAgentStatus(a, runsByAgent.get(a.id) ?? []));
  }

  // Collapse by kind to a single node status (workflow uses kind-keyed ids).
  const byKind = new Map<string, WorkflowNodeStatus>();
  for (const a of agents) {
    const s = byAgent.get(a.id) ?? null;
    const prior = byKind.get(a.kind) ?? null;
    byKind.set(a.kind, mergeStatuses(prior, s));
  }

  // Produce the final node_id → status map. Keys match our default
  // workflow's `agent:<kind>` nodes.
  const out = new Map<string, WorkflowNodeStatus>();
  for (const [kind, status] of byKind.entries()) {
    out.set(`agent:${kind}`, status);
  }
  return out;
}

function computeAgentStatus(
  agent: AgentRow,
  recentRuns: AgentRunRow[]
): WorkflowNodeStatus {
  // 1. Live running / queued on the agent row always wins.
  if (agent.status === "running" || agent.status === "queued") return "running";
  if (agent.status === "error") return "failed";

  // 2. Most recent run (if any).
  const latest = recentRuns[0];
  if (latest) {
    if (latest.status === "running") return "running";
    if (latest.status === "completed") return "done";
    if (latest.status === "failed" || latest.status === "cancelled") return "failed";
  }

  // 3. Fallback mapping for agent_row.status when no runs exist.
  if (agent.status === "paused" || agent.status === "retired") return "idle";
  if (agent.status === "idle") {
    return agent.last_run_at ? "done" : "idle";
  }

  return "idle";
}

/**
 * Merge two WorkflowNodeStatus values into the most-significant state.
 * running > failed > done > idle > null.
 */
function mergeStatuses(
  a: WorkflowNodeStatus,
  b: WorkflowNodeStatus
): WorkflowNodeStatus {
  const rank = (s: WorkflowNodeStatus): number => {
    if (s === "running") return 4;
    if (s === "failed") return 3;
    if (s === "done") return 2;
    if (s === "idle") return 1;
    return 0;
  };
  return rank(a) >= rank(b) ? a : b;
}
