"use client";

import { useState, useMemo } from "react";
import { Search, Plus, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResearchAgent, AgentOverrides } from "@/types/intelligence";

interface AgentListViewProps {
  agents: ResearchAgent[];
  overridesByAgentId: Record<string, AgentOverrides>;
  selectedAgentId: string | null;
  onSelectAgent: (agent: ResearchAgent) => void;
  onCreateAgent?: () => void;
  className?: string;
}

type SortKey = "callsign" | "derived_from" | "findings_count" | "signals_today" | "lifecycle";
type FilterLifecycle = "all" | "active" | "paused" | "archived";
type FilterSource = "all" | "focus_area" | "continuation_signal" | "sub_objective" | "goal_tracking";

const SOURCE_COLOR: Record<string, string> = {
  focus_area: "bg-blue-50 text-[#007AFF]",
  continuation_signal: "bg-amber-50 text-amber-700",
  research_trigger: "bg-purple-50 text-purple-700",
  sub_objective: "bg-green-50 text-green-700",
  goal_tracking: "bg-gray-100 text-gray-600",
};

const SOURCE_LABEL: Record<string, string> = {
  focus_area: "Focus",
  continuation_signal: "Signal",
  research_trigger: "Trigger",
  sub_objective: "Objective",
  goal_tracking: "Goal",
};

export function AgentListView({
  agents,
  overridesByAgentId,
  selectedAgentId,
  onSelectAgent,
  onCreateAgent,
  className,
}: AgentListViewProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("findings_count");
  const [filterLifecycle, setFilterLifecycle] = useState<FilterLifecycle>("all");
  const [filterSource, setFilterSource] = useState<FilterSource>("all");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    let list = agents.filter((a) => {
      const lifecycle = overridesByAgentId[a.id]?.lifecycle ?? "active";
      if (filterLifecycle !== "all" && lifecycle !== filterLifecycle) return false;
      if (filterSource !== "all" && a.derived_from !== filterSource) return false;
      if (!q) return true;
      const hay = `${a.callsign ?? ""} ${a.name} ${a.specialty ?? ""} ${a.focus_areas.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });

    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case "callsign":
          return (a.callsign ?? a.name).localeCompare(b.callsign ?? b.name);
        case "derived_from":
          return a.derived_from.localeCompare(b.derived_from);
        case "signals_today":
          return (b.signals_today ?? 0) - (a.signals_today ?? 0);
        case "lifecycle": {
          const al = overridesByAgentId[a.id]?.lifecycle ?? "active";
          const bl = overridesByAgentId[b.id]?.lifecycle ?? "active";
          return al.localeCompare(bl);
        }
        case "findings_count":
        default:
          return b.findings_count - a.findings_count;
      }
    });

    return list;
  }, [agents, query, sortKey, filterLifecycle, filterSource, overridesByAgentId]);

  return (
    <div className={cn("flex h-full flex-col bg-white border-r border-gray-200", className)}>
      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Agents</h2>
            <p className="text-[11px] text-gray-500">
              {agents.length} total · {agents.filter((a) => (overridesByAgentId[a.id]?.lifecycle ?? "active") === "active").length} active
            </p>
          </div>
          {onCreateAgent && (
            <button
              onClick={onCreateAgent}
              className="inline-flex items-center gap-1 rounded-lg bg-[#007AFF] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0062CC] transition-all"
            >
              <Plus className="h-3 w-3" />
              New agent
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search callsign, focus..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-2.5 text-[12px] outline-none focus:border-[#007AFF] focus:bg-white"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="border-b border-gray-100 px-4 py-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="flex items-center gap-1 text-gray-400">
          <Filter className="h-3 w-3" />
          Filter
        </span>

        {/* Source filter */}
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value as FilterSource)}
          className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700"
        >
          <option value="all">All sources</option>
          <option value="focus_area">Focus area</option>
          <option value="sub_objective">Sub-objective</option>
          <option value="goal_tracking">Goal-tracking</option>
          <option value="continuation_signal">Signal-derived</option>
        </select>

        {/* Lifecycle filter */}
        <select
          value={filterLifecycle}
          onChange={(e) => setFilterLifecycle(e.target.value as FilterLifecycle)}
          className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700"
        >
          <option value="all">All states</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>

        {/* Sort */}
        <span className="ml-auto text-gray-400">Sort</span>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700"
        >
          <option value="findings_count">Findings</option>
          <option value="signals_today">Signals today</option>
          <option value="callsign">Callsign</option>
          <option value="derived_from">Source</option>
          <option value="lifecycle">Lifecycle</option>
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-xs text-gray-400">No agents match these filters.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((agent) => {
              const override = overridesByAgentId[agent.id];
              const lifecycle = override?.lifecycle ?? "active";
              const isSelected = selectedAgentId === agent.id;
              const signalsToday = agent.signals_today ?? 0;
              const isRunning = agent.status === "running" || agent.status === "sweeping";

              return (
                <li key={agent.id}>
                  <button
                    onClick={() => onSelectAgent(agent)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-2.5 text-left transition-all",
                      isSelected
                        ? "bg-blue-50/70 border-l-2 border-l-[#007AFF]"
                        : "border-l-2 border-l-transparent hover:bg-gray-50",
                      lifecycle !== "active" && "opacity-60",
                    )}
                  >
                    {/* Status dot */}
                    <span
                      className={cn(
                        "mt-1 h-2 w-2 flex-shrink-0 rounded-full",
                        lifecycle === "archived" ? "bg-gray-300" :
                        lifecycle === "paused" ? "bg-amber-400" :
                        isRunning ? "bg-[#007AFF] animate-pulse" :
                        agent.status === "error" ? "bg-red-500" :
                        "bg-green-500",
                      )}
                    />

                    {/* Main */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-bold tracking-tight text-gray-900">
                          {agent.callsign ?? agent.name.slice(0, 16).toUpperCase()}
                        </span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider",
                            SOURCE_COLOR[agent.derived_from] ?? "bg-gray-100 text-gray-600",
                          )}
                        >
                          {SOURCE_LABEL[agent.derived_from] ?? "Other"}
                        </span>
                        {lifecycle !== "active" && (
                          <span className="rounded px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider bg-gray-100 text-gray-500">
                            {lifecycle}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[11.5px] text-gray-500">
                        {override?.specialty ?? agent.specialty ?? agent.focus_areas[0] ?? "—"}
                      </p>
                    </div>

                    {/* Metrics */}
                    <div className="flex-shrink-0 text-right">
                      <div className="text-[12px] font-semibold tabular-nums text-gray-900">
                        {agent.findings_count}
                      </div>
                      <div className="text-[9px] uppercase tracking-wider text-gray-400">
                        findings
                      </div>
                      {signalsToday > 0 && (
                        <div className="mt-0.5 text-[10px] font-semibold text-[#007AFF]">
                          {signalsToday} today
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
