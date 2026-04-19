"use client";

import { cn } from "@/lib/utils";
import { Users, Play, Clock, Hash, ChevronRight, Loader2, Cpu, Zap, CircleDot, Target, Flag } from "lucide-react";
import type { ResearchAgent } from "@/types/intelligence";

interface AgentFleetPanelProps {
  agents: ResearchAgent[];
  onRunAgent: (agent: ResearchAgent) => void;
  onEntityClick: (entityId: string) => void;
  researchLoading: boolean;
}

const STATUS_CONFIG: Record<ResearchAgent["status"], { label: string; dot: string; text: string; bg: string }> = {
  idle:      { label: "Idle",      dot: "bg-gray-300",             text: "text-gray-500", bg: "bg-gray-50" },
  running:   { label: "Running",   dot: "bg-blue-500 animate-pulse", text: "text-blue-600", bg: "bg-blue-50" },
  sweeping:  { label: "Sweeping",  dot: "bg-blue-500 animate-pulse", text: "text-blue-600", bg: "bg-blue-50" },
  analyzing: { label: "Analyzing", dot: "bg-green-500 animate-pulse", text: "text-green-600", bg: "bg-green-50" },
  completed: { label: "Completed", dot: "bg-green-500",            text: "text-green-600", bg: "bg-green-50" },
  error:     { label: "Error",     dot: "bg-red-500",              text: "text-red-600", bg: "bg-red-50" },
};

const DERIVATION_LABELS: Record<string, { label: string; icon: typeof Zap }> = {
  focus_area: { label: "Focus Area", icon: Hash },
  continuation_signal: { label: "Signal-Derived", icon: Zap },
  research_trigger: { label: "Trigger-Based", icon: CircleDot },
  sub_objective: { label: "Sub-Objective", icon: Target },
  goal_tracking: { label: "Goal-Tracking", icon: Flag },
};

/** Mini feed dots — shows activity level */
function FeedDots({ count }: { count: number }) {
  const dots = Math.min(5, Math.max(1, Math.ceil(count / 3)));
  return (
    <div className="flex items-center gap-0.5" title={`${count} findings`}>
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-1 w-1 rounded-full transition-all",
            i < dots ? "bg-blue-400" : "bg-gray-200"
          )}
        />
      ))}
    </div>
  );
}

export function AgentFleetPanel({
  agents,
  onRunAgent,
  onEntityClick,
  researchLoading,
}: AgentFleetPanelProps) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
          <Users className="h-6 w-6 text-gray-300" />
        </div>
        <p className="text-[13px] text-gray-400 font-medium">No research agents configured</p>
        <p className="text-[11px] text-gray-300 mt-1 max-w-xs">
          Add focus areas in the Research Schedule to automatically spawn specialized research agents.
        </p>
      </div>
    );
  }

  // Separate by derivation source
  const focusAgents = agents.filter((a) => a.derived_from === "focus_area");
  const signalAgents = agents.filter((a) => a.derived_from === "continuation_signal");
  const triggerAgents = agents.filter((a) => a.derived_from === "research_trigger");
  const objectiveAgents = agents.filter((a) => a.derived_from === "sub_objective");
  const goalAgents = agents.filter((a) => a.derived_from === "goal_tracking");

  const renderAgentCard = (agent: ResearchAgent) => {
    const status = STATUS_CONFIG[agent.status];
    const derivation = DERIVATION_LABELS[agent.derived_from] ?? DERIVATION_LABELS.focus_area;
    const DerivIcon = derivation.icon;

    return (
      <div
        key={agent.id}
        className="rounded-xl border border-gray-200 bg-white overflow-hidden hover:border-gray-300 transition-all"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", status.dot)} />
            <h4 className="text-[12px] font-semibold text-gray-700 truncate">{agent.name}</h4>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[9px] font-medium border",
              status.bg, status.text,
              agent.status === "running" ? "border-blue-200" :
              agent.status === "completed" ? "border-green-200" :
              agent.status === "error" ? "border-red-200" : "border-gray-200"
            )}>
              {status.label}
            </span>
            <button
              onClick={() => onRunAgent(agent)}
              disabled={researchLoading || agent.status === "running"}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all",
                researchLoading || agent.status === "running"
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-interaxis-50 text-interaxis-600 hover:bg-interaxis-100 border border-interaxis-200 active:scale-[0.97]"
              )}
            >
              {agent.status === "running" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              Run
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-3 py-2.5 space-y-2.5">
          {/* Spec row */}
          <div className="flex items-center gap-3 text-[10px] text-gray-400">
            <span className="flex items-center gap-1">
              <Cpu className="h-2.5 w-2.5" />
              <span className="text-gray-500">claude-sonnet</span>
            </span>
            <span className="flex items-center gap-1">
              <DerivIcon className="h-2.5 w-2.5" />
              <span className="capitalize text-gray-500">{derivation.label}</span>
            </span>
            <FeedDots count={agent.findings_count} />
          </div>

          {/* Focus areas */}
          <div className="flex flex-wrap gap-1">
            {agent.focus_areas.map((area) => (
              <span
                key={area}
                className="inline-flex items-center gap-1 rounded-md bg-gray-50 border border-gray-100 px-2 py-0.5 text-[10px] text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <Hash className="h-2.5 w-2.5 text-gray-400" />
                {area}
              </span>
            ))}
          </div>

          {/* Metadata row */}
          <div className="flex items-center gap-3 text-[10px] text-gray-400">
            <span className="tabular-nums font-medium text-gray-500">{agent.findings_count} findings</span>
            {agent.last_run_at && (
              <span className="flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                {new Date(agent.last_run_at).toLocaleDateString(undefined, {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })}
              </span>
            )}
          </div>

          {/* Entity findings (clickable) */}
          {agent.entity_ids.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Discoveries</p>
              <div className="flex flex-wrap gap-1">
                {agent.entity_ids.slice(0, 8).map((eid) => (
                  <button
                    key={eid}
                    onClick={() => onEntityClick(eid)}
                    className="flex items-center gap-0.5 rounded-md bg-blue-50 px-1.5 py-0.5 text-[9px] text-blue-600 hover:bg-blue-100 border border-blue-100 transition-all active:scale-[0.97]"
                  >
                    {eid.length > 20 ? eid.slice(0, 18) + "..." : eid}
                    <ChevronRight className="h-2.5 w-2.5" />
                  </button>
                ))}
                {agent.entity_ids.length > 8 && (
                  <span className="px-1.5 py-0.5 text-[9px] text-gray-400">
                    +{agent.entity_ids.length - 8} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderGroup = (title: string, items: ResearchAgent[]) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">{title}</p>
        {items.map(renderAgentCard)}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Fleet summary strip */}
      <div className="flex items-center gap-3 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-[11px] font-semibold text-gray-700">{agents.length}</span>
          <span className="text-[11px] text-gray-500">agents</span>
        </div>
        <div className="w-px h-3 bg-gray-200" />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-gray-700">
            {agents.reduce((s, a) => s + a.findings_count, 0)}
          </span>
          <span className="text-[11px] text-gray-500">total findings</span>
        </div>
        <div className="w-px h-3 bg-gray-200" />
        <div className="flex items-center gap-1.5">
          {agents.filter((a) => a.status === "running").length > 0 ? (
            <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-green-400" />
          )}
          <span className="text-[11px] font-semibold text-gray-700">
            {agents.filter((a) => a.status === "running").length}
          </span>
          <span className="text-[11px] text-gray-500">running</span>
        </div>
      </div>

      {renderGroup("Sub-Objective Agents", objectiveAgents)}
      {renderGroup("Goal-Tracking Agents", goalAgents)}
      {renderGroup("Focus Area Agents", focusAgents)}
      {renderGroup("Signal-Derived Agents", signalAgents)}
      {renderGroup("Trigger-Derived Agents", triggerAgents)}
    </div>
  );
}
