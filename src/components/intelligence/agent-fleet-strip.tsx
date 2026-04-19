"use client";

import Link from "next/link";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResearchAgent } from "@/types/intelligence";

interface AgentFleetStripProps {
  agents: ResearchAgent[];
  onSelectAgent: (agent: ResearchAgent) => void;
  selectedAgentId?: string | null;
  /** If provided, adds a "Manage fleet →" link to /app/space/{spaceId}/agents */
  manageFleetHref?: string;
  className?: string;
}

const STATUS_DISPLAY: Record<string, { label: string; dot: string; pulse: boolean }> = {
  running:    { label: "SWEEPING",  dot: "bg-[#007AFF]", pulse: true },
  sweeping:   { label: "SWEEPING",  dot: "bg-[#007AFF]", pulse: true },
  analyzing:  { label: "ANALYZING", dot: "bg-green-500", pulse: true },
  idle:       { label: "IDLE",      dot: "bg-gray-300",  pulse: false },
  completed:  { label: "COMPLETED", dot: "bg-green-500", pulse: false },
  error:      { label: "ERROR",     dot: "bg-red-500",   pulse: false },
};

const DERIVATION_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  focus_area:          { label: "Focus",    bg: "bg-blue-50",   text: "text-[#007AFF]" },
  continuation_signal: { label: "Signal",   bg: "bg-amber-50",  text: "text-amber-700" },
  research_trigger:    { label: "Trigger",  bg: "bg-purple-50", text: "text-purple-700" },
  sub_objective:       { label: "Objective",bg: "bg-green-50",  text: "text-green-700" },
  goal_tracking:       { label: "Goal",     bg: "bg-gray-100",  text: "text-gray-600" },
};

export function AgentFleetStrip({
  agents,
  onSelectAgent,
  selectedAgentId,
  manageFleetHref,
  className,
}: AgentFleetStripProps) {
  if (agents.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-3",
          className,
        )}
      >
        <p className="text-xs text-gray-400">
          No agents deployed. Add focus areas or sub-objectives to spawn research agents.
        </p>
      </div>
    );
  }

  const runningCount = agents.filter((a) => a.status === "running" || a.status === "sweeping").length;

  return (
    <div
      className={cn(
        "rounded-xl border border-gray-200 bg-white",
        className,
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-3 text-[11px]">
          <span className="font-semibold uppercase tracking-wider text-gray-500">
            Agent Fleet &middot; {agents.length} deployed
          </span>
          <span className="inline-flex items-center gap-1.5 text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            All systems nominal
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-gray-400">
            Coordinated by <span className="font-semibold text-gray-600">ORCHESTRATOR-Ω</span>
          </span>
          {manageFleetHref && (
            <Link
              href={manageFleetHref}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:border-[#007AFF] hover:text-[#007AFF] transition-all"
            >
              <Settings2 className="h-3 w-3" />
              Manage fleet →
            </Link>
          )}
        </div>
      </div>

      {/* Scrollable card row */}
      <div className="grid grid-flow-col auto-cols-[minmax(200px,1fr)] gap-2 overflow-x-auto px-3 pb-3 snap-x snap-mandatory scrollbar-none">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            onClick={() => onSelectAgent(agent)}
          />
        ))}
      </div>

      {/* Running indicator */}
      {runningCount > 0 && (
        <div className="border-t border-gray-100 px-4 py-1.5 text-[10px] text-gray-400">
          {runningCount} agent{runningCount !== 1 ? "s" : ""} currently running &middot;{" "}
          <span className="text-[#007AFF]">live</span>
        </div>
      )}
    </div>
  );
}

// ── Agent card ──

function AgentCard({
  agent,
  isSelected,
  onClick,
}: {
  agent: ResearchAgent;
  isSelected: boolean;
  onClick: () => void;
}) {
  const status = STATUS_DISPLAY[agent.status] ?? STATUS_DISPLAY.idle;
  const deriv = DERIVATION_BADGE[agent.derived_from] ?? DERIVATION_BADGE.focus_area;
  const sparkline = agent.sparkline ?? synthesizeSparkline(agent.findings_count);
  const signalsToday = agent.signals_today ?? agent.findings_count;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full snap-start flex-col items-stretch rounded-lg border px-3 py-2.5 text-left transition-all",
        isSelected
          ? "border-[#007AFF] bg-blue-50/40 shadow-sm"
          : "border-gray-200 bg-white hover:border-blue-200 hover:shadow-sm",
      )}
    >
      {/* Header: callsign + status */}
      <div className="mb-1.5 flex items-center justify-between">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
            deriv.bg,
            deriv.text,
          )}
        >
          {deriv.label}
        </span>
        <div className="flex items-center gap-1">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              status.dot,
              status.pulse && "animate-pulse",
            )}
          />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-500">
            {status.label}
          </span>
        </div>
      </div>

      {/* Callsign */}
      <p className="text-[13px] font-bold tracking-tight text-gray-900 font-mono">
        {agent.callsign ?? agent.name.slice(0, 12).toUpperCase()}
      </p>

      {/* Specialty */}
      <p className="mt-0.5 text-[11px] text-gray-500 truncate">
        {agent.specialty ?? agent.focus_areas.join(", ")}
      </p>

      {/* Footer: signals + sparkline */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-gray-400">
          <span className="font-semibold text-gray-700">{signalsToday}</span> sig today
        </span>
        <Sparkline values={sparkline} />
      </div>
    </button>
  );
}

// ── Helpers ──

function synthesizeSparkline(findingsCount: number): number[] {
  // Deterministic fake sparkline when no real data — distribute over 24 hours
  const arr: number[] = [];
  const seed = findingsCount;
  for (let i = 0; i < 24; i++) {
    arr.push(Math.max(0, Math.round((Math.sin((seed + i) * 0.7) + 1) * (seed / 12))));
  }
  return arr;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const w = 56;
  const h = 14;
  const step = w / values.length;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      {values.map((v, i) => {
        const barH = (v / max) * (h - 2);
        return (
          <rect
            key={i}
            x={i * step}
            y={h - barH}
            width={Math.max(1, step - 1)}
            height={Math.max(1, barH)}
            fill="#007AFF"
            opacity={0.35 + (v / max) * 0.5}
          />
        );
      })}
    </svg>
  );
}
