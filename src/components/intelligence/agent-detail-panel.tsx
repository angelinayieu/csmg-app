"use client";

import { useState } from "react";
import { Play, Clock, DollarSign, Sparkles, Activity, Loader2, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResearchAgent, AgentOverrides } from "@/types/intelligence";
import type { SynthesisData } from "@/types/synthesis";
import type { SuggestedObjective, ImprovementGoal } from "@/types/goals";
import type { Entity } from "@/types";
import { AgentConfigForm } from "./agent-config-form";
import { AgentTraceDrawer } from "./agent-trace-drawer";

type DetailTab = "overview" | "config" | "runs" | "cost" | "trace";

interface AgentDetailPanelProps {
  agent: ResearchAgent;
  currentOverrides: AgentOverrides | undefined;
  synthesisData: SynthesisData | null;
  entities: Entity[];
  suggestedObjectives: SuggestedObjective[];
  goals: ImprovementGoal[];
  spaceId: string;
  onRunAgent?: () => void;
  onSaveOverrides: (newOverrides: AgentOverrides) => void;
  onResetOverrides: () => void;
  running?: boolean;
}

const TABS: { id: DetailTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: Sparkles },
  { id: "config",   label: "Config",   icon: Activity },
  { id: "runs",     label: "Runs",     icon: Clock },
  { id: "cost",     label: "Cost",     icon: DollarSign },
  { id: "trace",    label: "Trace",    icon: Activity },
];

export function AgentDetailPanel({
  agent,
  currentOverrides,
  synthesisData,
  entities,
  suggestedObjectives,
  goals,
  spaceId,
  onRunAgent,
  onSaveOverrides,
  onResetOverrides,
  running,
}: AgentDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const displayName = currentOverrides?.name ?? agent.name;
  const displaySpecialty = currentOverrides?.specialty ?? agent.specialty;
  const lifecycle = currentOverrides?.lifecycle ?? "active";

  // Phase B: detect goal binding + look up the goal title for the chip
  const boundGoalId = agent.source_goal_id;
  const boundGoal = boundGoalId ? goals.find((g) => g.id === boundGoalId) : undefined;
  const isBound = !!boundGoal;

  // "Research this goal now" → POST /api/coordinator/dispatch
  const handleResearchNow = async () => {
    if (!boundGoalId) return;
    setDispatching(true);
    setDispatchError(null);
    try {
      const res = await fetch("/api/coordinator/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId: boundGoalId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDispatchError(data.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : String(err));
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-mono text-[13px] font-bold text-gray-900">
              {agent.callsign ?? agent.name.slice(0, 16).toUpperCase()}
            </span>
            <StatusBadge agent={agent} lifecycle={lifecycle} />
          </div>
          <h2 className="text-lg font-bold text-gray-900">{displayName}</h2>
          {displaySpecialty && (
            <p className="mt-0.5 text-[13px] text-gray-500">{displaySpecialty}</p>
          )}
          {isBound && boundGoal && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">
              <Target className="h-3 w-3" />
              <span>Bound to goal</span>
              <span className="text-violet-900 truncate max-w-[220px]">
                {boundGoal.title}
              </span>
            </div>
          )}
          {dispatchError && (
            <p className="mt-1.5 text-[11px] text-red-600">
              Dispatch failed: {dispatchError}
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {isBound && lifecycle === "active" && (
            <button
              onClick={handleResearchNow}
              disabled={dispatching || running}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all",
                dispatching || running
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-violet-600 text-white hover:bg-violet-700",
              )}
              title="Dispatches a goal.research.requested event to the coordinator"
            >
              {dispatching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Target className="h-3.5 w-3.5" />
              )}
              {dispatching ? "Dispatching…" : "Research this goal now"}
            </button>
          )}
          {!isBound && onRunAgent && lifecycle === "active" && (
            <button
              onClick={onRunAgent}
              disabled={running}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all",
                running
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-[#007AFF] text-white hover:bg-[#0062CC]",
              )}
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {running ? "Running…" : "Run now"}
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b border-gray-200 px-6">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-semibold transition-colors",
                isActive ? "text-[#007AFF]" : "text-gray-500 hover:text-gray-800",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#007AFF]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {activeTab === "overview" && (
          <OverviewTab agent={agent} currentOverrides={currentOverrides} />
        )}

        {activeTab === "config" && (
          <AgentConfigForm
            agent={agent}
            currentOverrides={currentOverrides}
            spaceId={spaceId}
            onSaved={onSaveOverrides}
            onReset={onResetOverrides}
          />
        )}

        {activeTab === "runs" && <RunsTabPlaceholder />}

        {activeTab === "cost" && (
          <CostTabPlaceholder currentOverrides={currentOverrides} />
        )}

        {activeTab === "trace" && (
          <div className="-mx-6 -my-5 h-[calc(100%+2.5rem)]">
            <AgentTraceDrawer
              agent={agent}
              synthesisData={synthesisData}
              entities={entities}
              suggestedObjectives={suggestedObjectives}
              goals={goals}
              onClose={() => setActiveTab("overview")}
              mode="page"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Status badge ──

function StatusBadge({
  agent,
  lifecycle,
}: {
  agent: ResearchAgent;
  lifecycle: AgentOverrides["lifecycle"];
}) {
  if (lifecycle !== "active") {
    const label = lifecycle;
    const tone = lifecycle === "paused" ? "amber" : "gray";
    return (
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
          tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500",
        )}
      >
        {label}
      </span>
    );
  }

  const statusMap = {
    running:    { bg: "bg-blue-50",  text: "text-[#007AFF]",  label: "Sweeping",  pulse: true },
    sweeping:   { bg: "bg-blue-50",  text: "text-[#007AFF]",  label: "Sweeping",  pulse: true },
    analyzing:  { bg: "bg-green-50", text: "text-green-700",  label: "Analyzing", pulse: true },
    idle:       { bg: "bg-gray-100", text: "text-gray-500",   label: "Idle",      pulse: false },
    completed:  { bg: "bg-green-50", text: "text-green-700",  label: "Complete",  pulse: false },
    error:      { bg: "bg-red-50",   text: "text-red-700",    label: "Error",     pulse: false },
  } as const;

  const cfg = statusMap[agent.status] ?? statusMap.idle;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
        cfg.bg,
        cfg.text,
      )}
    >
      <span className={cn(
        "h-1.5 w-1.5 rounded-full",
        cfg.pulse && "animate-pulse",
      )} style={{ background: "currentColor", opacity: 0.7 }} />
      {cfg.label}
    </span>
  );
}

// ── Overview tab ──

function OverviewTab({
  agent,
  currentOverrides,
}: {
  agent: ResearchAgent;
  currentOverrides: AgentOverrides | undefined;
}) {
  const signalsToday = agent.signals_today ?? 0;
  const sparkline = agent.sparkline ?? [];

  return (
    <div className="space-y-5">
      {/* Key metrics */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Findings" value={String(agent.findings_count)} />
        <MetricCard label="Signals today" value={String(signalsToday)} accent />
        <MetricCard
          label="Last run"
          value={agent.last_run_at ? formatRel(agent.last_run_at) : "—"}
        />
        <MetricCard
          label="Source"
          value={formatSource(agent.derived_from)}
          small
        />
      </div>

      {/* Sparkline */}
      {sparkline.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Activity · last 24h
          </div>
          <Sparkline values={sparkline} height={40} />
        </div>
      )}

      {/* Focus areas */}
      <div>
        <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Focus areas
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {[...agent.focus_areas, ...(currentOverrides?.extra_focus_areas ?? [])].map((fa) => (
            <span
              key={fa}
              className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-[#007AFF]"
            >
              #{fa}
            </span>
          ))}
          {agent.focus_areas.length === 0 && (
            <span className="text-[11px] text-gray-400">No focus areas defined</span>
          )}
        </div>
      </div>

      {/* Override status */}
      {currentOverrides && hasActiveOverrides(currentOverrides) && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#007AFF] mb-1">
            Customized
          </div>
          <ul className="space-y-0.5 text-[11px] text-gray-700">
            {currentOverrides.depth && (
              <li>· Depth override: <strong>{currentOverrides.depth}</strong></li>
            )}
            {currentOverrides.cadence && currentOverrides.cadence !== "inherit" && (
              <li>· Cadence: <strong>{currentOverrides.cadence}</strong></li>
            )}
            {currentOverrides.budget_per_run != null && (
              <li>· Per-run cap: <strong>${currentOverrides.budget_per_run.toFixed(2)}</strong></li>
            )}
            {currentOverrides.budget_monthly != null && (
              <li>· Monthly cap: <strong>${currentOverrides.budget_monthly.toFixed(2)}</strong></li>
            )}
            {currentOverrides.prompt_addendum && (
              <li>· Custom prompt addendum ({currentOverrides.prompt_addendum.length} chars)</li>
            )}
          </ul>
        </div>
      )}

      {/* Entity discoveries */}
      <div>
        <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Recent discoveries · {agent.entity_ids.length}
        </h4>
        {agent.entity_ids.length === 0 ? (
          <p className="text-[11px] text-gray-400">No entities discovered yet. Run this agent to populate discoveries.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {agent.entity_ids.slice(0, 20).map((eid) => (
              <span
                key={eid}
                className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] text-gray-700"
              >
                {eid.length > 20 ? eid.slice(0, 18) + "…" : eid}
              </span>
            ))}
            {agent.entity_ids.length > 20 && (
              <span className="text-[10px] text-gray-400">
                +{agent.entity_ids.length - 20} more
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Runs placeholder (requires Phase J data) ──

function RunsTabPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Clock className="h-10 w-10 text-gray-200 mb-3" />
      <h4 className="text-sm font-semibold text-gray-600">Run history coming soon</h4>
      <p className="mt-1 max-w-sm text-[12px] text-gray-400">
        Per-run execution records (search queries, LLM reasoning, entities created, cost)
        become available once the research pipeline persists research_runs.
      </p>
    </div>
  );
}

// ── Cost placeholder ──

function CostTabPlaceholder({
  currentOverrides,
}: {
  currentOverrides: AgentOverrides | undefined;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Per-run cap"
          value={currentOverrides?.budget_per_run != null ? `$${currentOverrides.budget_per_run.toFixed(2)}` : "—"}
        />
        <MetricCard
          label="Monthly cap"
          value={currentOverrides?.budget_monthly != null ? `$${currentOverrides.budget_monthly.toFixed(2)}` : "—"}
        />
      </div>

      <div className="flex flex-col items-center justify-center py-10 text-center">
        <DollarSign className="h-8 w-8 text-gray-200 mb-2" />
        <h4 className="text-sm font-semibold text-gray-600">Spend tracking pending</h4>
        <p className="mt-1 max-w-sm text-[11px] text-gray-400">
          Historical spend charts activate once research runs are persisted with cost_usd.
          Configure budget caps in the Config tab.
        </p>
      </div>
    </div>
  );
}

// ── Helpers ──

function MetricCard({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-bold tabular-nums",
          small ? "text-[13px]" : "text-lg",
          accent ? "text-[#007AFF]" : "text-gray-900",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Sparkline({ values, height = 30 }: { values: number[]; height?: number }) {
  const max = Math.max(...values, 1);
  const w = 600;
  const step = w / values.length;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
      {values.map((v, i) => {
        const barH = (v / max) * (height - 2);
        return (
          <rect
            key={i}
            x={i * step}
            y={height - barH}
            width={Math.max(2, step - 2)}
            height={Math.max(2, barH)}
            fill="#007AFF"
            opacity={0.35 + (v / max) * 0.5}
          />
        );
      })}
    </svg>
  );
}

function formatRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatSource(source: ResearchAgent["derived_from"]): string {
  switch (source) {
    case "focus_area":          return "Focus area";
    case "continuation_signal": return "Signal";
    case "research_trigger":    return "Trigger";
    case "sub_objective":       return "Objective";
    case "goal_tracking":       return "Goal";
    default:                    return "Other";
  }
}

function hasActiveOverrides(o: AgentOverrides): boolean {
  return !!(
    o.depth ||
    (o.cadence && o.cadence !== "inherit") ||
    o.budget_per_run != null ||
    o.budget_monthly != null ||
    o.prompt_addendum ||
    (o.extra_focus_areas?.length ?? 0) > 0 ||
    (o.excluded_focus_areas?.length ?? 0) > 0 ||
    (o.avoid_domains?.length ?? 0) > 0 ||
    o.lifecycle !== "active"
  );
}
