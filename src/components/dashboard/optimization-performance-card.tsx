"use client";

// ── Optimization Performance card ──────────────────────────────────────
//
// Right column of CommandCenterRow. Per-agent performance metrics —
// each agent's recent run count + success rate. Click row to expand
// inline detail (no cross-card popover; matches CheckInUpdatesCard).
//
// Data: shared via useAgents hook (deduped + polled across consumers).

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import {
  TrendingUp,
  Activity,
  CheckCircle2,
  AlertCircle,
  Loader2,
  MinusCircle,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgents, type AgentRow, type AgentRunRow } from "@/lib/hooks/use-agents";

interface AgentSummary {
  id: string;
  kind: string;
  name: string;
  status: AgentRow["status"];
  last_run_at: string | null;
  /** Real runs only (excludes baseline_snapshot). */
  total_runs: number;
  completed: number;
  failed: number;
  running: number;
  /** True when a baseline_snapshot run exists — set by strategy approval. */
  has_baseline: boolean;
  baseline_captured_at: string | null;
}

interface Props {
  spaceId: string;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function summarize(agents: AgentRow[], runs: AgentRunRow[]): AgentSummary[] {
  const runsByAgent = new Map<string, AgentRunRow[]>();
  for (const r of runs) {
    const bucket = runsByAgent.get(r.agent_id) ?? [];
    bucket.push(r);
    runsByAgent.set(r.agent_id, bucket);
  }

  const summaries = agents
    .filter((a) => a.status !== "retired")
    .map((a) => {
      const ar = runsByAgent.get(a.id) ?? [];
      // Separate synthetic baseline snapshots from real runs so the card can
      // anchor "current vs. baseline" honestly. A baseline_snapshot is not a
      // real run and shouldn't inflate success rates or run counts.
      const baselineRuns = ar.filter((r) => r.trigger_event === "baseline_snapshot");
      const realRuns = ar.filter((r) => r.trigger_event !== "baseline_snapshot");
      const completed = realRuns.filter((r) => r.status === "completed").length;
      const failed = realRuns.filter(
        (r) => r.status === "failed" || r.status === "cancelled",
      ).length;
      const running = realRuns.filter((r) => r.status === "running").length;
      const baselineCapturedAt = baselineRuns.length > 0
        ? baselineRuns
            .map((r) => r.started_at)
            .sort()
            .reverse()[0] ?? null
        : null;
      return {
        id: a.id,
        kind: a.kind,
        name: a.display_name ?? prettifyKind(a.kind),
        status: a.status,
        last_run_at: a.last_run_at,
        total_runs: realRuns.length,
        completed,
        failed,
        running,
        has_baseline: baselineRuns.length > 0,
        baseline_captured_at: baselineCapturedAt,
      };
    });

  return summaries.sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (b.status === "running" && a.status !== "running") return 1;
    const ta = a.last_run_at ? new Date(a.last_run_at).getTime() : 0;
    const tb = b.last_run_at ? new Date(b.last_run_at).getTime() : 0;
    if (ta !== tb) return tb - ta;
    return b.completed - a.completed;
  });
}

function prettifyKind(kind: string): string {
  return kind
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function StatusGlyph({ status }: { status: AgentRow["status"] }) {
  if (status === "running" || status === "queued")
    return <Loader2 className="h-3 w-3 text-indigo-500 animate-spin" />;
  if (status === "error") return <AlertCircle className="h-3 w-3 text-red-500" />;
  if (status === "paused") return <MinusCircle className="h-3 w-3 text-gray-400" />;
  return <CheckCircle2 className="h-3 w-3 text-gray-400" />;
}

export function OptimizationPerformanceCard({ spaceId }: Props) {
  const { data, loading } = useAgents(spaceId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const summaries = data ? summarize(data.agents, data.recent_runs) : [];
  const visible = summaries.slice(0, 5);
  const totalRuns = summaries.reduce((acc, a) => acc + a.total_runs, 0);
  const baselined = summaries.filter((a) => a.has_baseline).length;
  const awaitingFirstRun =
    summaries.length > 0 && totalRuns === 0 && baselined > 0;

  return (
    <GlassCard variant="dashboard" className="flex flex-col h-[380px] p-5">
      <header className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-50 to-indigo-100 ring-1 ring-white">
            <TrendingUp className="h-3.5 w-3.5 text-indigo-600" />
          </span>
          <div>
            <h3 className="text-[13px] font-semibold text-gray-900 leading-tight">
              Optimization Performance
            </h3>
            <p className="text-[10.5px] text-gray-500 leading-tight">
              Per-agent activity vs. baseline
            </p>
          </div>
        </div>
        {totalRuns > 0 ? (
          <span className="text-[10px] tabular-nums text-gray-500 bg-white/60 ring-1 ring-black/5 rounded-full px-2 py-0.5">
            {totalRuns} runs
          </span>
        ) : awaitingFirstRun ? (
          <span className="text-[10px] font-medium text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200 rounded-full px-2 py-0.5">
            baseline set
          </span>
        ) : null}
      </header>

      <div className="flex-1 -mx-2 overflow-y-auto overscroll-contain">
        {loading && (
          <div className="px-2 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-11 rounded-lg bg-white/40 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div className="h-full grid place-items-center text-center px-4">
            <div className="space-y-1.5">
              <Activity className="h-5 w-5 text-gray-300 mx-auto" />
              <p className="text-[11.5px] text-gray-500 max-w-[200px]">
                Approve a strategy to seed your agent fleet and capture a baseline.
              </p>
            </div>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <ul className="space-y-1 px-2">
            {visible.map((agent) => (
              <PerformanceRow
                key={agent.id}
                agent={agent}
                isExpanded={expandedId === agent.id}
                onToggle={() =>
                  setExpandedId((prev) => (prev === agent.id ? null : agent.id))
                }
              />
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}

function PerformanceRow({
  agent,
  isExpanded,
  onToggle,
}: {
  agent: AgentSummary;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const successRate =
    agent.total_runs > 0 ? Math.round((agent.completed / agent.total_runs) * 100) : null;
  // Three states: (1) real runs exist → show success rate; (2) only baseline
  // captured → show "at baseline"; (3) neither → show "awaiting".
  const isAtBaseline = agent.total_runs === 0 && agent.has_baseline;

  return (
    <li className="rounded-lg ring-1 ring-transparent hover:ring-black/5 hover:bg-white/70 transition-colors">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-white/90 to-indigo-50 ring-1 ring-black/5 shrink-0">
          <StatusGlyph status={agent.status} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-gray-800 truncate">{agent.name}</div>
          <div className="flex items-center gap-2 text-[10.5px] text-gray-500 leading-tight">
            {isAtBaseline ? (
              <span className="text-indigo-700">
                At baseline · awaiting first run
              </span>
            ) : (
              <span className="tabular-nums">
                {agent.total_runs} runs
                {successRate !== null && agent.total_runs > 0 ? ` · ${successRate}% ok` : ""}
                {agent.has_baseline && agent.baseline_captured_at ? " · vs. baseline" : ""}
              </span>
            )}
            <span>
              {isAtBaseline
                ? relTime(agent.baseline_captured_at)
                : relTime(agent.last_run_at)}
            </span>
          </div>
        </div>
        {agent.running > 0 && (
          <span className="text-[9px] font-medium text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200 rounded-full px-1.5 py-[1px] shrink-0">
            running
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-gray-300 transition-transform shrink-0",
            isExpanded && "rotate-180 text-gray-500",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2.5 pt-0.5">
              <div className="text-[10px] text-gray-500 mb-1 capitalize">
                {agent.kind.replace(/_/g, " ")}
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                <dt className="text-gray-500">Status</dt>
                <dd className="text-gray-800 capitalize">{agent.status}</dd>
                <dt className="text-gray-500">Total runs</dt>
                <dd className="text-gray-800 tabular-nums">{agent.total_runs}</dd>
                <dt className="text-gray-500">Completed</dt>
                <dd className="text-gray-800 tabular-nums">{agent.completed}</dd>
                {agent.failed > 0 && (
                  <>
                    <dt className="text-red-700">Failed</dt>
                    <dd className="text-red-700 tabular-nums">{agent.failed}</dd>
                  </>
                )}
                <dt className="text-gray-500">Last run</dt>
                <dd className="text-gray-800">{relTime(agent.last_run_at)}</dd>
                {agent.has_baseline && (
                  <>
                    <dt className="text-indigo-700">Baseline</dt>
                    <dd className="text-indigo-700">
                      {relTime(agent.baseline_captured_at)}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
