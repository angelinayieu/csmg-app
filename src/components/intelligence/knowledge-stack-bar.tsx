"use client";

import { cn } from "@/lib/utils";
import { Database, Atom, Link2, Lightbulb, Loader2, Shield, TrendingUp, Activity, Zap } from "lucide-react";
import type { KnowledgeStackCounts, StackHealth } from "@/types/intelligence-v2";

interface KnowledgeStackBarProps {
  counts: KnowledgeStackCounts;
  health: StackHealth;
  researchLoading: boolean;
  researchQueueCount?: number;
  weakStage?: "sources" | "atoms" | "connections" | "insights" | null;
  className?: string;
  onStageClick?: (stage: string) => void;
  signalCount?: number;
  agentRunningCount?: number;
}

/** Tiny inline sparkline for the stack bar */
function BarSparkline({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-8 h-1.5 rounded-full bg-gray-200 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

const STAGES = [
  {
    key: "sources" as const,
    label: "Sources",
    icon: Database,
    getCount: (c: KnowledgeStackCounts) => c.sources.total,
    getDetail: (c: KnowledgeStackCounts) =>
      `avg ${c.sources.avg_credibility.toFixed(2)} cred`,
    color: "#007AFF",
  },
  {
    key: "atoms" as const,
    label: "Atoms",
    icon: Atom,
    getCount: (c: KnowledgeStackCounts) => c.atoms.total,
    getDetail: (c: KnowledgeStackCounts) =>
      `${c.atoms.verified} verified`,
    color: "#8B5CF6",
  },
  {
    key: "connections" as const,
    label: "Connections",
    icon: Link2,
    getCount: (c: KnowledgeStackCounts) => c.connections.typed,
    getDetail: (c: KnowledgeStackCounts) =>
      c.connections.floating > 0
        ? `${c.connections.floating} floating`
        : "all connected",
    color: "#10B981",
  },
  {
    key: "insights" as const,
    label: "Insights",
    icon: Lightbulb,
    getCount: (c: KnowledgeStackCounts) => c.insights.total,
    getDetail: (c: KnowledgeStackCounts) =>
      `${c.insights.high_impact} high-impact`,
    color: "#F59E0B",
  },
] as const;

export function KnowledgeStackBar({
  counts,
  health,
  researchLoading,
  researchQueueCount,
  weakStage,
  className,
  onStageClick,
  signalCount = 0,
  agentRunningCount = 0,
}: KnowledgeStackBarProps) {
  const integrityPct = Math.round(health.avg_credibility * 100);
  const insightYield = counts.atoms.total > 0
    ? (counts.insights.total / counts.atoms.total * 100).toFixed(0)
    : "0";
  const maxCount = Math.max(
    counts.sources.total,
    counts.atoms.total,
    counts.connections.typed,
    counts.insights.total,
    1,
  );

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white/80 backdrop-blur-sm px-3 py-2 shadow-sm",
        className
      )}
    >
      {/* Stack label */}
      <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mr-1 flex-shrink-0">
        Stack
      </span>

      {/* Pipeline steps */}
      {STAGES.map((stage, idx) => {
        const count = stage.getCount(counts);
        const detail = stage.getDetail(counts);
        const isWeak = weakStage === stage.key;
        const Icon = stage.icon;

        return (
          <div key={stage.key} className="flex items-center">
            {idx > 0 && (
              <svg width="14" height="10" className="text-gray-300 flex-shrink-0 mx-0.5">
                <path d="M2 5 L12 5" stroke="currentColor" strokeWidth="1.5" fill="none" markerEnd="url(#stackArrow)" />
                <defs>
                  <marker id="stackArrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto">
                    <path d="M0,0 L6,3 L0,6" fill="currentColor" />
                  </marker>
                </defs>
              </svg>
            )}

            <button
              onClick={() => onStageClick?.(stage.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-all",
                isWeak
                  ? "bg-amber-50 text-amber-700 border border-amber-200 ring-1 ring-amber-100"
                  : "bg-gray-50 text-gray-600 border border-gray-100 hover:border-gray-200 hover:bg-white"
              )}
            >
              <Icon className={cn("h-3 w-3 flex-shrink-0", isWeak ? "text-amber-500" : "text-gray-400")} />
              <span className={cn(
                "tabular-nums font-semibold",
                isWeak ? "text-amber-800" : "text-gray-800"
              )}>
                {count}
              </span>
              <span className="hidden sm:inline text-[10px]">{stage.label}</span>
              <BarSparkline value={count} max={maxCount} color={isWeak ? "#F59E0B" : stage.color} />
              <span className={cn(
                "hidden lg:inline text-[9px]",
                isWeak ? "text-amber-600" : "text-gray-400"
              )}>
                {detail}
              </span>
            </button>
          </div>
        );
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Harvest rate + integrity metrics */}
      <div className="hidden md:flex items-center gap-2 mr-2">
        <div className="flex items-center gap-1 text-[10px]" title="Integrity score (avg credibility)">
          <Shield className={cn(
            "h-3 w-3",
            integrityPct >= 70 ? "text-green-500" : integrityPct >= 40 ? "text-amber-500" : "text-red-400"
          )} />
          <span className={cn(
            "font-semibold tabular-nums",
            integrityPct >= 70 ? "text-green-600" : integrityPct >= 40 ? "text-amber-600" : "text-red-500"
          )}>
            {integrityPct}%
          </span>
        </div>
        <div className="w-px h-3 bg-gray-200" />
        <div className="flex items-center gap-1 text-[10px]" title="Insight yield rate">
          <TrendingUp className="h-3 w-3 text-gray-400" />
          <span className="font-semibold tabular-nums text-gray-600">{insightYield}%</span>
        </div>
        {signalCount > 0 && (
          <>
            <div className="w-px h-3 bg-gray-200" />
            <div className="flex items-center gap-1 text-[10px]" title="Active signals">
              <Zap className="h-3 w-3 text-blue-400" />
              <span className="font-semibold tabular-nums text-gray-600">{signalCount}</span>
            </div>
          </>
        )}
      </div>

      {/* Status pill */}
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition-all",
          researchLoading
            ? "bg-blue-50 text-blue-600 border border-blue-200"
            : agentRunningCount > 0
              ? "bg-blue-50 text-blue-600 border border-blue-200"
              : "bg-gray-50 text-gray-500 border border-gray-200"
        )}
      >
        {researchLoading ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Researching{researchQueueCount ? ` · ${researchQueueCount} queued` : ""}</span>
          </>
        ) : agentRunningCount > 0 ? (
          <>
            <Activity className="h-3 w-3 animate-pulse" />
            <span>{agentRunningCount} agent{agentRunningCount > 1 ? "s" : ""} active</span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            <span>Idle</span>
          </>
        )}
      </div>
    </div>
  );
}
