"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Radio, Calendar, Users, Compass, Clock } from "lucide-react";
import type { Entity, Edge } from "@/types";
import type {
  IntelligenceSignal,
  SignalStatus,
  ResearchSchedule,
  ResearchAgent,
} from "@/types/intelligence";
import type { PriorityDecisionV2 } from "@/types/intelligence-v2";
import type {
  SuggestedBridge,
  StrategyRefreshResult,
  CoverageBreakdown,
} from "@/lib/hooks/use-intelligence-radar";
import type { CoverageImprovementRec } from "@/types/intelligence-v2";
import { SignalFilterBar, filterSignals, signalStatusCounts, type SignalFilterMode } from "./signal-filter-bar";
import { SignalItem } from "./signal-item";
import { ResearchSchedulePanel } from "./research-schedule-panel";
import { ResearchHistoryTimeline } from "./research-history-timeline";
import { AgentFleetPanel } from "./agent-fleet-panel";
import { StrategyImpactPanel } from "./strategy-impact-panel";
import { SuggestedBridgesPanel } from "./suggested-bridges-panel";
import { DecisionCardV2 } from "./decision-card-v2";
import { BackgroundRuntimePanel } from "./background-runtime-panel";
import { DEFAULT_RESEARCH_SCHEDULE } from "@/types/intelligence";

type OperationsTab = "signals" | "schedule" | "agents" | "strategy" | "history";

interface OperationsPanelProps {
  /** Anchor for the per-space cron-gate panel + any future space-scoped controls. */
  spaceId: string;

  // Signals & Decisions
  signals: IntelligenceSignal[];
  onSignalAction: (signalId: string, status: SignalStatus, note?: string) => Promise<void>;
  priorityDecisionsV2: PriorityDecisionV2[];
  onDecisionExecute?: (decision: PriorityDecisionV2) => void;
  onDecisionCreateGoal?: (decision: PriorityDecisionV2) => void;
  entities: Entity[];

  // Schedule
  schedule: ResearchSchedule | null;
  onUpdateSchedule: (schedule: Partial<ResearchSchedule>) => Promise<void>;
  researchLoading: boolean;
  onTriggerResearch: (depth?: string, focusAreas?: string[]) => Promise<void>;

  // Agent Fleet
  agentFleet: ResearchAgent[];

  // Strategy
  onTriggerStrategyRefresh: () => Promise<void>;
  strategyRefreshLoading: boolean;
  strategyRefreshResult: StrategyRefreshResult | null;
  strategyRefreshRecommended: boolean;
  strategyRefreshReason: string | null;
  escalatedSignalCount: number;

  // Bridges
  suggestedBridges: SuggestedBridge[];
  onCreateBridge: (externalEntityId: string, internalEntityId: string) => Promise<void>;

  // Coverage
  coverageBreakdown: CoverageBreakdown;
  coverageImprovements: CoverageImprovementRec[];
}

const TABS: Array<{ key: OperationsTab; label: string; icon: React.ReactNode }> = [
  { key: "signals", label: "Signals & Decisions", icon: <Radio className="h-3.5 w-3.5" /> },
  // "Schedules" (plural) — the tab now hosts both the research-loop schedule
  // AND the per-space cron-gate panel (Phase A runtime control). Both are
  // schedule-shaped controls; keeping them grouped makes the dashboard one
  // less surface for users to hunt for runtime knobs in.
  { key: "schedule", label: "Schedules", icon: <Calendar className="h-3.5 w-3.5" /> },
  { key: "agents", label: "Agent Fleet", icon: <Users className="h-3.5 w-3.5" /> },
  { key: "strategy", label: "Strategy Bridge", icon: <Compass className="h-3.5 w-3.5" /> },
  { key: "history", label: "History", icon: <Clock className="h-3.5 w-3.5" /> },
];

export function OperationsPanel({
  spaceId,
  signals,
  onSignalAction,
  priorityDecisionsV2,
  onDecisionExecute,
  onDecisionCreateGoal,
  entities,
  schedule,
  onUpdateSchedule,
  researchLoading,
  onTriggerResearch,
  agentFleet,
  onTriggerStrategyRefresh,
  strategyRefreshLoading,
  strategyRefreshResult,
  strategyRefreshRecommended,
  strategyRefreshReason,
  escalatedSignalCount,
  suggestedBridges,
  onCreateBridge,
  coverageBreakdown,
  coverageImprovements,
}: OperationsPanelProps) {
  const [activeTab, setActiveTab] = useState<OperationsTab>("signals");
  const [signalFilter, setSignalFilter] = useState<SignalFilterMode>("active_escalated");

  const filteredSignals = filterSignals(signals, signalFilter);
  const statusCounts = signalStatusCounts(signals);

  // ── Pulse strip: signal frequency over last 7 days ──
  const pulseData = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const buckets = Array.from({ length: 14 }, (_, i) => {
      const dayStart = now - (13 - i) * dayMs;
      const dayEnd = dayStart + dayMs;
      const count = signals.filter((s) => {
        const t = new Date(s.detected_at).getTime();
        return t >= dayStart && t < dayEnd;
      }).length;
      return { day: 13 - i, count };
    });
    const maxCount = Math.max(1, ...buckets.map((b) => b.count));
    return { buckets, maxCount };
  }, [signals]);

  return (
    <div className="p-4">
      {/* Tab bar */}
      <div className="flex gap-1 mb-3 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all whitespace-nowrap",
              activeTab === tab.key
                ? "bg-interaxis-50 text-interaxis-700 border border-interaxis-200 shadow-sm"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Signals & Decisions ── */}
      {activeTab === "signals" && (
        <div className="space-y-3">
          {/* Pulse strip — signal frequency histogram */}
          {signals.length > 0 && (
            <div className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Signal Velocity</span>
                <span className="text-[9px] text-gray-400 tabular-nums">{signals.length} total · last 14d</span>
              </div>
              <div className="flex items-end gap-[3px] h-6">
                {pulseData.buckets.map((b, i) => {
                  const height = b.count > 0 ? Math.max(3, (b.count / pulseData.maxCount) * 24) : 1;
                  const isRecent = i >= 12;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "flex-1 rounded-sm transition-all",
                        b.count === 0 ? "bg-gray-200" :
                        isRecent ? "bg-blue-400" : "bg-blue-300/70"
                      )}
                      style={{ height: `${height}px` }}
                      title={`${b.count} signal${b.count !== 1 ? "s" : ""} · ${b.day}d ago`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <SignalFilterBar mode={signalFilter} onModeChange={setSignalFilter} counts={statusCounts} />

          {/* Signal list */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {filteredSignals.length === 0 ? (
              <p className="text-[11px] text-gray-400 text-center py-4">No signals match this filter.</p>
            ) : (
              filteredSignals.map((signal) => (
                <SignalItem
                  key={signal.id}
                  signal={signal}
                  onAction={onSignalAction}
                  entities={entities}
                />
              ))
            )}
          </div>

          {/* Priority decisions */}
          {priorityDecisionsV2.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                Priority Decisions ({priorityDecisionsV2.length})
              </p>
              <div className="space-y-2">
                {priorityDecisionsV2.slice(0, 3).map((d) => (
                  <DecisionCardV2
                    key={d.id}
                    decision={d}
                    onExecute={onDecisionExecute ? () => onDecisionExecute(d) : undefined}
                    onCreateGoal={onDecisionCreateGoal ? () => onDecisionCreateGoal(d) : undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Schedules — research loop + per-space cron gating ── */}
      {activeTab === "schedule" && (
        <div className="space-y-3">
          {/* Phase A — Background Runtime panel. Sits at the top of the
              schedule tab so the user sees per-space cron control (the
              expensive crons: agent-runtime + predictions-resolve) BEFORE
              the research-loop cadence (which most users never touch). */}
          <BackgroundRuntimePanel spaceId={spaceId} />

          <ResearchSchedulePanel
            schedule={schedule ?? DEFAULT_RESEARCH_SCHEDULE}
            onUpdate={onUpdateSchedule}
          />
        </div>
      )}

      {/* ── Agent Fleet ── */}
      {activeTab === "agents" && (
        <AgentFleetPanel
          agents={agentFleet}
          onRunAgent={(agent) => onTriggerResearch(undefined, agent.focus_areas)}
          onEntityClick={() => {}} // Entity click handled at graph level
          researchLoading={researchLoading}
        />
      )}

      {/* ── Strategy Bridge ── */}
      {activeTab === "strategy" && (
        <div className="space-y-4">
          <StrategyImpactPanel
            onRefresh={onTriggerStrategyRefresh}
            loading={strategyRefreshLoading}
            result={strategyRefreshResult}
            recommended={strategyRefreshRecommended}
            reason={strategyRefreshReason}
            escalatedCount={escalatedSignalCount}
          />

          {suggestedBridges.length > 0 && (
            <SuggestedBridgesPanel
              bridges={suggestedBridges}
              onCreateBridge={onCreateBridge}
            />
          )}
        </div>
      )}

      {/* ── Research History ── */}
      {activeTab === "history" && (
        <div className="space-y-3">
          {signals.length === 0 ? (
            <div className="text-center py-6">
              <Clock className="h-8 w-8 text-gray-200 mx-auto mb-2" />
              <p className="text-[12px] text-gray-400">No research history yet.</p>
              <p className="text-[10px] text-gray-300 mt-1">Run a research cycle to populate the timeline.</p>
            </div>
          ) : (
            <ResearchHistoryTimeline signals={signals} />
          )}
        </div>
      )}
    </div>
  );
}
