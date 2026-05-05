"use client";

// ── Drawer Strategy Header ─────────────────────────────────────────
//
// Strategy-aware context strip that mounts above the Intelligence
// drawer's tab body. Renders the active strategy headline + posture +
// confidence on the top row, and the live operations rollup (apps,
// agents, running cycles, next scan countdown) on the bottom row.
//
// Behavior:
//   - When `strategy` is null (synthesis hasn't produced a strategic
//     recommendation yet), the headline row is replaced with a quiet
//     "Strategy not yet committed" line so the rollup row still renders
//     real ops state.
//   - The "next scan" affordance is presentational only in Phase A;
//     Phase C wires it to open the BackgroundRuntimePanel popover.

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Compass,
  Boxes,
  Bot,
  Activity,
  Clock,
  AlertCircle,
} from "lucide-react";
import type { IntelligenceSpine } from "@/types/intelligence-spine";

interface Props {
  spine: IntelligenceSpine | null;
  loading: boolean;
  error: string | null;
  className?: string;
}

const POSTURE_LABEL: Record<string, string> = {
  aggressive_growth: "Aggressive growth",
  cautious_validation: "Cautious validation",
  pivot_exploration: "Pivot exploration",
  consolidation: "Consolidation",
  defensive: "Defensive",
};

export function DrawerStrategyHeader({
  spine,
  loading,
  error,
  className,
}: Props) {
  const rollup = useMemo(() => deriveRollup(spine), [spine]);

  if (loading && !spine) {
    return (
      <div
        className={cn(
          "border-b border-gray-100 bg-gradient-to-b from-gray-50/80 to-white px-5 py-3",
          className,
        )}
      >
        <div className="h-3 w-40 animate-pulse rounded bg-gray-100" />
        <div className="mt-2 h-3 w-full animate-pulse rounded bg-gray-100" />
        <div className="mt-2.5 h-3 w-2/3 animate-pulse rounded bg-gray-100" />
      </div>
    );
  }

  if (error && !spine) {
    return (
      <div
        className={cn(
          "border-b border-red-100 bg-red-50/40 px-5 py-3 text-[11px] text-red-700",
          className,
        )}
      >
        <div className="flex items-center gap-1.5">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="font-semibold">Couldn’t load strategy spine.</span>
          <span className="truncate text-red-600/80">{error}</span>
        </div>
      </div>
    );
  }

  const strategy = spine?.strategy ?? null;

  return (
    <div
      className={cn(
        "border-b border-gray-100 bg-gradient-to-b from-gray-50/80 to-white px-5 py-3",
        className,
      )}
    >
      {/* Row 1 — strategy identity */}
      {strategy && strategy.headline ? (
        <div className="flex items-start gap-2">
          <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-interaxis-600" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">
              <span>Strategy</span>
              {strategy.posture && (
                <span className="text-gray-400">·</span>
              )}
              {strategy.posture && (
                <span className="font-semibold normal-case tracking-normal text-gray-700">
                  {POSTURE_LABEL[strategy.posture] ?? strategy.posture}
                </span>
              )}
              {typeof strategy.confidence === "number" && (
                <>
                  <span className="text-gray-400">·</span>
                  <span className="font-semibold normal-case tracking-normal tabular-nums text-gray-700">
                    {Math.round(strategy.confidence)}% conf
                  </span>
                </>
              )}
              {strategy.committed_at && (
                <>
                  <span className="text-gray-400">·</span>
                  <span className="font-medium normal-case tracking-normal text-gray-500">
                    committed {formatRel(strategy.committed_at)}
                  </span>
                </>
              )}
              {!strategy.committed_at && strategy.status && (
                <>
                  <span className="text-gray-400">·</span>
                  <span className="font-medium normal-case tracking-normal text-amber-700">
                    {strategy.status === "reviewing"
                      ? "in review"
                      : strategy.status}
                  </span>
                </>
              )}
            </div>
            <p className="mt-1 text-[12.5px] font-medium leading-snug text-gray-900">
              “{strategy.headline}”
            </p>
            {strategy.target_objective && (
              <p className="mt-0.5 text-[10.5px] text-gray-500 leading-snug">
                Optimizing for{" "}
                <span className="font-semibold text-gray-700">
                  {strategy.target_objective.title}
                </span>{" "}
                · {strategy.target_objective.metric} →{" "}
                {strategy.target_objective.target}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">
              Strategy
            </div>
            <p className="mt-0.5 text-[11.5px] text-gray-500 leading-snug">
              Not yet committed — research operations below run on synthesis
              defaults.
            </p>
          </div>
        </div>
      )}

      {/* Row 2 — live ops rollup */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] tabular-nums text-gray-600">
        <RollupChip
          icon={<Boxes className="h-3 w-3" />}
          label={`${rollup.appCount} app${rollup.appCount === 1 ? "" : "s"}`}
        />
        <RollupChip
          icon={<Bot className="h-3 w-3" />}
          label={`${rollup.agentCount} agent${rollup.agentCount === 1 ? "" : "s"}`}
          subtle={
            rollup.agentRuns7d > 0 ? `${rollup.agentRuns7d}/7d` : undefined
          }
        />
        <RollupChip
          icon={<Activity className="h-3 w-3" />}
          label={
            rollup.runningCycles > 0
              ? `${rollup.runningCycles} cycle${rollup.runningCycles === 1 ? "" : "s"} running`
              : "0 cycles running"
          }
          tone={rollup.runningCycles > 0 ? "active" : undefined}
        />
        <RollupChip
          icon={<Clock className="h-3 w-3" />}
          label={rollup.nextScanLabel}
          tone={rollup.nextScanTone}
        />
      </div>
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────────

function RollupChip({
  icon,
  label,
  subtle,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  subtle?: string;
  tone?: "active" | "muted" | "warn";
}) {
  const toneClass =
    tone === "active"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "muted"
          ? "text-gray-400"
          : "text-gray-700";
  return (
    <span className={cn("inline-flex items-center gap-1", toneClass)}>
      <span className="opacity-70">{icon}</span>
      <span className="font-semibold">{label}</span>
      {subtle && <span className="text-gray-400">· {subtle}</span>}
    </span>
  );
}

interface Rollup {
  appCount: number;
  agentCount: number;
  agentRuns7d: number;
  runningCycles: number;
  nextScanLabel: string;
  nextScanTone: "active" | "muted" | "warn" | undefined;
}

function deriveRollup(spine: IntelligenceSpine | null): Rollup {
  if (!spine) {
    return {
      appCount: 0,
      agentCount: 0,
      agentRuns7d: 0,
      runningCycles: 0,
      nextScanLabel: "—",
      nextScanTone: "muted",
    };
  }
  const appCount = spine.apps.length;
  const agentCount = spine.agents.length;
  const agentRuns7d = spine.agents.reduce((s, a) => s + a.runs_7d, 0);
  const runningCycles = spine.recent_runs.filter(
    (r) => r.status === "running",
  ).length;

  const due = spine.runtime.next_due.agent_runtime;
  const settings = spine.runtime.settings.agent_runtime;
  const { label, tone } = formatNextScan(
    settings.enabled,
    !!settings.paused_until,
    due.due,
    due.seconds_until_due,
  );

  return {
    appCount,
    agentCount,
    agentRuns7d,
    runningCycles,
    nextScanLabel: label,
    nextScanTone: tone,
  };
}

function formatNextScan(
  enabled: boolean,
  paused: boolean,
  due: boolean,
  secondsUntilDue: number,
): { label: string; tone: Rollup["nextScanTone"] } {
  if (!enabled) return { label: "scans disabled", tone: "muted" };
  if (paused) return { label: "scans paused", tone: "warn" };
  if (due) return { label: "scan due now", tone: "active" };
  if (secondsUntilDue < 0) return { label: "—", tone: "muted" };
  return { label: `next scan ${formatSeconds(secondsUntilDue)}`, tone: undefined };
}

function formatSeconds(s: number): string {
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `in ${d}d ${h % 24}h`;
}

function formatRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
}
