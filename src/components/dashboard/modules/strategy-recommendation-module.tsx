"use client";

import React, { useState } from "react";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { Trophy, ChevronDown, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tier1CoreMove } from "@/components/strategy/tier-1-core-move";
import { Tier2ExecutionPlan } from "@/components/strategy/tier-2-execution-plan";
import { Tier3Evidence } from "@/components/strategy/tier-3-evidence";
import { StrategyHero } from "@/components/strategy/strategy-hero";
import { ReasoningTracePanel } from "@/components/strategy/reasoning-trace-panel";
import { StrategyLayersPanel } from "@/components/strategy/strategy-layers-panel";
import type {
  StrategicRecommendation,
  MicroTactic,
  RankedStrategy,
  StrategyStatus,
  StrategyChangeProposal,
  InfrastructureProposal,
} from "@/types/strategy";
import type { Entity } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { Cycle, Scenario } from "@/types";
import type { SuggestedObjective, ImprovementGoal, GoalRecommendation } from "@/types/goals";
import type { StrategyReasoningTrace, ProbabilitySpaceSummary } from "@/types/strategy-reasoning";

// ── BSC Fullscreen (kept inline — used by Tier1 expand) ──

import {
  Target,
  Zap,
  Shield,
  ArrowRight,
  Clock,
  GitBranch,
  RefreshCw,
  X,
  Workflow,
} from "lucide-react";
import { ExecutionFlowchart } from "@/components/strategy/execution-flowchart";

const postureConfig: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  aggressive_growth: { label: "Aggressive Growth", color: "text-green-700", bg: "bg-green-50", icon: <Zap className="h-3 w-3" /> },
  cautious_validation: { label: "Cautious Validation", color: "text-blue-700", bg: "bg-blue-50", icon: <Target className="h-3 w-3" /> },
  pivot_exploration: { label: "Pivot Exploration", color: "text-purple-700", bg: "bg-purple-50", icon: <GitBranch className="h-3 w-3" /> },
  consolidation: { label: "Consolidation", color: "text-amber-700", bg: "bg-amber-50", icon: <Shield className="h-3 w-3" /> },
  defensive: { label: "Defensive", color: "text-red-700", bg: "bg-red-50", icon: <Shield className="h-3 w-3" /> },
};

const perspectiveColors: Record<number, { bar: string; bg: string; text: string; border: string }> = {
  0: { bar: "bg-yellow-400", bg: "bg-yellow-50", text: "text-yellow-800", border: "border-yellow-200" },
  1: { bar: "bg-green-500", bg: "bg-green-50", text: "text-green-800", border: "border-green-200" },
  2: { bar: "bg-orange-400", bg: "bg-orange-50", text: "text-orange-800", border: "border-orange-200" },
  3: { bar: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-800", border: "border-blue-200" },
  4: { bar: "bg-purple-400", bg: "bg-purple-50", text: "text-purple-800", border: "border-purple-200" },
};

function ConfidenceRing({ value, size = 48 }: { value: number; size?: number }) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 70 ? "#22C55E" : value >= 40 ? "#F59E0B" : "#EF4444";
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F3F4F6" strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={4}
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-all duration-700" />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-sm font-bold text-gray-900">{value}</span>
      </div>
    </div>
  );
}

function EntityRef({ id, entityMap }: { id: string; entityMap: Map<string, Entity> }) {
  const entity = entityMap.get(id);
  const isExternal = id.startsWith("X");
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
      isExternal ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600"
    )}>
      {id}{entity ? `: ${entity.name}` : ""}
    </span>
  );
}

// ── BSC "Strategy on a Page" Fullscreen View ──

function BSCStrategyPage({
  rec,
  entityMap,
  infraProposals,
  onClose,
  onTacticClick,
}: {
  rec: StrategicRecommendation;
  entityMap: Map<string, Entity>;
  infraProposals: InfrastructureProposal[];
  onClose: () => void;
  onTacticClick?: (tactic: MicroTactic) => void;
}) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const posture = postureConfig[rec.strategic_posture] ?? postureConfig.cautious_validation;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-auto" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative m-4 w-full max-w-[1400px] rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-interaxis-600 to-interaxis-500 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">Execution Strategy</div>
            <h2 className="text-lg font-bold text-white">{rec.title}</h2>
          </div>
          <div className="flex items-center gap-3">
            <ConfidenceRing value={rec.confidence} size={40} />
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-white hover:bg-white/30 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Target Objective banner */}
        {rec.target_objective && (
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center justify-between">
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Strategy Target</span>
              <p className="text-sm font-semibold text-gray-800">{rec.target_objective.title}</p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">{rec.target_objective.current}</span>
              <ArrowRight className="h-4 w-4 text-gray-300" />
              <span className="font-bold text-green-600">{rec.target_objective.target}</span>
              <span className="text-[10px] text-gray-400">{rec.target_objective.metric}</span>
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex">
          <div className="flex-1 min-w-0 p-6">
            {/* Top objective bar */}
            <div className="mb-6 rounded-lg border border-gray-300 bg-white px-4 py-2.5 flex items-center">
              <span className="flex h-7 w-7 items-center justify-center rounded bg-green-600 text-sm font-bold text-white mr-3">1</span>
              <span className="text-sm font-semibold text-gray-800">{rec.summary}</span>
            </div>

            {/* Perspective rows */}
            <div className="space-y-0">
              {rec.perspectives.map((perspective, i) => {
                const color = perspectiveColors[i] ?? perspectiveColors[4];
                return (
                  <div key={i} className="flex">
                    <div className="flex-shrink-0 w-10 flex items-start pt-4">
                      <span className="flex h-8 w-8 items-center justify-center rounded bg-green-600 text-sm font-bold text-white">
                        {i + 2}
                      </span>
                    </div>
                    <div className={cn("flex-shrink-0 w-10 flex flex-col items-center", color.bar, "rounded-sm")}>
                      <div className="py-4 flex items-center justify-center h-full">
                        <span className="text-[10px] font-bold text-white uppercase tracking-wider [writing-mode:vertical-lr] rotate-180">
                          {perspective.name}
                        </span>
                      </div>
                    </div>
                    <div className={cn("flex-1 min-w-0 border-b", color.border, "p-4")}>
                      <div className="flex items-start gap-4">
                        <div className={cn("rounded-lg border px-3 py-2 max-w-[240px] flex-shrink-0", color.border, color.bg)}>
                          <p className={cn("text-xs font-medium leading-snug", color.text)}>
                            {perspective.objective}
                          </p>
                        </div>
                        <div className="flex-shrink-0 rounded border border-gray-200 bg-white px-2 py-1 text-center">
                          <div className="text-lg font-bold text-gray-800">
                            {perspective.key_metric.current || "—"}
                          </div>
                        </div>
                        <div className={cn("flex-1 min-w-0 rounded-lg border bg-gradient-to-br from-white to-gray-50 p-3", color.border)}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-base">{perspective.icon}</span>
                            <span className="text-xs font-bold text-gray-900">{perspective.name}</span>
                            <span className={cn("ml-auto text-[9px] font-semibold rounded-full px-1.5 py-0.5",
                              perspective.confidence === "high" ? "bg-green-100 text-green-700" :
                              perspective.confidence === "moderate" ? "bg-amber-100 text-amber-700" :
                              "bg-red-100 text-red-700"
                            )}>
                              {perspective.confidence}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mb-2 rounded bg-gray-50 px-2 py-1">
                            <Target className="h-3 w-3 text-gray-400" />
                            <span className="text-[10px] font-medium text-gray-600">{perspective.key_metric.name}</span>
                            <span className="ml-auto text-[10px]">
                              <span className="text-gray-400">{perspective.key_metric.current}</span>
                              <span className="text-gray-300 mx-0.5">→</span>
                              <span className="font-semibold text-green-600">{perspective.key_metric.target}</span>
                              {perspective.key_metric.unit && <span className="text-gray-400 ml-0.5">{perspective.key_metric.unit}</span>}
                            </span>
                          </div>
                          <div className="space-y-1">
                            {perspective.actions.map((action, ai) => {
                              const tfColors: Record<string, string> = {
                                now: "bg-green-500",
                                short_term: "bg-blue-500",
                                medium_term: "bg-amber-500",
                                long_term: "bg-gray-400",
                              };
                              return (
                                <div key={ai} className="flex items-center gap-2 text-[10px]">
                                  <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", tfColors[action.timeframe] ?? "bg-gray-300")} />
                                  <span className="text-gray-700 flex-1 truncate">{action.text}</span>
                                  {action.entity_id && <EntityRef id={action.entity_id} entityMap={entityMap} />}
                                </div>
                              );
                            })}
                          </div>
                          {perspective.supporting_entities.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1 pt-1.5 border-t border-gray-100">
                              {perspective.supporting_entities.map((id) => (
                                <EntityRef key={id} id={id} entityMap={entityMap} />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Temporal Flow */}
            {rec.temporal_phases.length > 0 && (
              <div className="mt-6">
                <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Execution Timeline
                </h4>
                <div className="flex gap-2">
                  {rec.temporal_phases.map((phase, i) => (
                    <div key={i} className="flex-1 rounded-lg border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-3 relative">
                      {i < rec.temporal_phases.length - 1 && (
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10">
                          <ArrowRight className="h-4 w-4 text-gray-300" />
                        </div>
                      )}
                      <div className="text-[11px] font-bold text-interaxis-600">{phase.label}</div>
                      <p className="mt-1 text-[10px] text-gray-700 font-medium leading-snug">{phase.focus}</p>
                      <div className="mt-2 space-y-1 border-t border-gray-100 pt-2">
                        <div className="text-[9px] text-gray-400">Milestone: <span className="text-green-600 font-medium">{phase.milestone}</span></div>
                        <div className="text-[9px] text-gray-400">Metric: <span className="text-gray-600">{phase.key_metric}</span></div>
                        {phase.loops_activated?.length ? (
                          <div className="text-[9px] text-blue-500 flex items-center gap-0.5">
                            <RefreshCw className="h-2 w-2" /> {phase.loops_activated.join(", ")}
                          </div>
                        ) : null}
                        {phase.infrastructure_deployed?.length ? (
                          <div className="flex flex-wrap gap-0.5 mt-0.5">
                            {phase.infrastructure_deployed.map((eid) => (
                              <EntityRef key={eid} id={eid} entityMap={entityMap} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Execution Flowchart */}
            {rec.micro_tactics.length > 0 && (
              <div className="mt-6">
                <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-interaxis-600 flex items-center gap-1.5">
                  <Workflow className="h-3 w-3" />
                  Execution Flowchart
                </h4>
                <ExecutionFlowchart
                  recommendation={rec}
                  entityMap={entityMap}
                  onTacticClick={onTacticClick}
                />
              </div>
            )}
          </div>

          {/* Right: Infrastructure Proposals */}
          {infraProposals.length > 0 && (
            <div className="w-[340px] flex-shrink-0 border-l border-gray-200 bg-gradient-to-b from-blue-50/40 to-white">
              <div className="sticky top-[72px] p-5">
                <div className="rounded-xl bg-gradient-to-br from-blue-100 to-blue-50 px-4 py-2.5 mb-4 text-center">
                  <h3 className="text-sm font-bold text-blue-800">Supporting Infrastructure</h3>
                  <p className="text-[10px] text-blue-600">Setup Proposals</p>
                </div>
                <div className="space-y-3">
                  {infraProposals.map((proposal, i) => (
                    <div key={proposal.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                      <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-[10px] font-bold text-indigo-600">
                            #{i + 1}
                          </span>
                          <span className="text-xs font-bold text-gray-900">{proposal.name}</span>
                          <span className="ml-auto rounded bg-indigo-50 px-1.5 py-0.5 text-[8px] font-medium text-indigo-500">
                            {proposal.type}
                          </span>
                        </div>
                      </div>
                      <div className="px-4 py-3">
                        <p className="text-[10px] text-gray-600 leading-relaxed">{proposal.description}</p>
                        {proposal.metrics_tracked?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {proposal.metrics_tracked.map((m, mi) => (
                              <span key={mi} className="rounded bg-green-50 px-1.5 py-0.5 text-[8px] text-green-600 font-medium">{m}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="px-4 py-2 border-t border-gray-100 flex justify-end">
                        <div className="flex items-center justify-center h-8 w-8 rounded-full border-2 border-green-400 text-green-500 hover:bg-green-50 cursor-pointer transition-colors">
                          <ArrowRight className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Module Props ──

interface StrategyRecommendationModuleProps {
  recommendation: StrategicRecommendation;
  entityMap: Map<string, Entity>;
  onTacticClick?: (tactic: MicroTactic) => void;
  // Evidence drill-down data (from synthesis)
  synthData?: SynthesisData | null;
  entities?: Entity[];
  cycles?: Cycle[];
  scenarios?: Scenario[];
  // Multi-strategy support
  rankedStrategies?: RankedStrategy[];
  strategyStatus?: StrategyStatus | null;
  changeProposals?: StrategyChangeProposal[];
  // Objectives alignment
  suggestedObjectives?: SuggestedObjective[];
  activeGoal?: ImprovementGoal | null;
  goalRecommendations?: GoalRecommendation[];
  // Actions
  onConfirm?: () => void;
  onSelectAlternative?: (rank: number) => void;
  onGenerateStrategy?: () => void;
  strategyLoading?: boolean;
  // Outcome feedback loop
  onRecordOutcome?: (recId: string, goalId: string, outcome: "effective" | "partial" | "ineffective", notes: string) => Promise<{ refinement_signals?: Array<{ entity_id: string; recommendation: string; reason: string }> } | null>;
  onTriggerResynthesize?: () => void;
  // Reasoning trace (from multi-step engine)
  reasoningTrace?: StrategyReasoningTrace | null;
  probabilitySpaceSummary?: ProbabilitySpaceSummary | null;
  // Space ID for execution briefs
  spaceId?: string;
}

// ── Main Component — Thin Orchestrator ──

export function StrategyRecommendationModule({
  recommendation: rec,
  entityMap,
  onTacticClick,
  synthData,
  entities = [],
  cycles = [],
  scenarios = [],
  rankedStrategies = [],
  strategyStatus,
  changeProposals = [],
  suggestedObjectives = [],
  activeGoal,
  goalRecommendations = [],
  onConfirm,
  onSelectAlternative,
  onGenerateStrategy,
  strategyLoading = false,
  onRecordOutcome,
  onTriggerResynthesize,
  reasoningTrace,
  probabilitySpaceSummary,
  spaceId,
}: StrategyRecommendationModuleProps) {
  const [showFullStrategy, setShowFullStrategy] = useState(false);
  const [showExecutionPlan, setShowExecutionPlan] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [showLayers, setShowLayers] = useState(false);

  const topRanked = rankedStrategies.find((r) => r.rank === 1);
  const infraProposals = topRanked?.infrastructure_proposals ?? [];
  const isConfirmed = strategyStatus === "confirmed";

  return (
    <DashboardCard
      title="Execution Labs"
      icon={<Trophy className="h-4 w-4 text-amber-500" />}
      collapsible={false}
      className="border-interaxis-200 shadow-md"
    >
      <div className="space-y-3">

        {/* ── HERO: Strategic direction at a glance ── */}
        <StrategyHero
          title={rec.title}
          summary={rec.summary}
          confidence={rec.confidence}
          posture={rec.strategic_posture}
        />

        {/* ── TIER 1: Core Move (always visible) ── */}
        <Tier1CoreMove
          recommendation={rec}
          entityMap={entityMap}
          strategyStatus={strategyStatus}
          changeProposals={changeProposals}
          rankedStrategies={rankedStrategies}
          isConfirmed={isConfirmed}
          onConfirm={onConfirm}
          onSelectAlternative={onSelectAlternative}
          onGenerateStrategy={onGenerateStrategy}
          strategyLoading={strategyLoading}
          onExpandFullStrategy={() => setShowFullStrategy(true)}
        />

        {/* ── REASONING TRACE (collapsible, between Tier 1 and Tier 2) ── */}
        {reasoningTrace && (
          <div className="border-t border-gray-100 pt-2">
            <button
              className="w-full flex items-center justify-between text-left group"
              onClick={() => setShowReasoning(!showReasoning)}
            >
              <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-600 group-hover:text-indigo-700">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a8 8 0 0 0-8 8c0 3.5 2 6 4 7.5V20h8v-2.5c2-1.5 4-4 4-7.5a8 8 0 0 0-8-8z" />
                  <path d="M10 20v1a2 2 0 0 0 4 0v-1" />
                </svg>
                Reasoning Trace
                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-medium text-indigo-500">
                  3 steps &middot; {(reasoningTrace.total_duration_ms / 1000).toFixed(1)}s
                </span>
              </h4>
              <ChevronDown className={cn("h-3.5 w-3.5 text-indigo-300 transition-transform", showReasoning && "rotate-180")} />
            </button>
            {showReasoning && (
              <div className="mt-2">
                <ReasoningTracePanel
                  reasoningTrace={reasoningTrace}
                  probabilitySpaceSummary={probabilitySpaceSummary}
                />
              </div>
            )}
          </div>
        )}

        {/* ── STRATEGY LAYERS: 4-layer reasoning architecture (collapsible) ── */}
        {rec.strategy_layers && (rec.strategy_layers.l1_outcomes?.length > 0 || rec.strategy_layers.l2_methods?.length > 0) && (
          <div className="border-t border-gray-100 pt-2">
            <button
              className="w-full flex items-center justify-between text-left group"
              onClick={() => setShowLayers(!showLayers)}
            >
              <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-600 group-hover:text-violet-700">
                <Layers className="h-3 w-3" />
                Strategy Architecture
                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-500">
                  {rec.strategy_layers.l1_outcomes?.length ?? 0} outcomes &middot; {rec.strategy_layers.l2_methods?.length ?? 0} methods &middot; {rec.strategy_layers.l4_insights?.length ?? 0} insights
                </span>
              </h4>
              <ChevronDown className={cn("h-3.5 w-3.5 text-violet-300 transition-transform", showLayers && "rotate-180")} />
            </button>
            {showLayers && (
              <div className="mt-2">
                <StrategyLayersPanel layers={rec.strategy_layers} />
              </div>
            )}
          </div>
        )}

        {/* ── TIER 2: Execution Plan (collapsible) ── */}
        <div className="border-t border-gray-100 pt-2">
          <button
            className="w-full flex items-center justify-between text-left group"
            onClick={() => setShowExecutionPlan(!showExecutionPlan)}
          >
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-600 group-hover:text-gray-800">
              <Workflow className="h-3 w-3" />
              Execution Plan
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-400">
                {rec.temporal_phases.length} phases &middot; {rec.micro_tactics.length} tactics
              </span>
            </h4>
            <ChevronDown className={cn("h-3.5 w-3.5 text-gray-300 transition-transform", showExecutionPlan && "rotate-180")} />
          </button>
          {showExecutionPlan && (
            <div className="mt-2">
              <Tier2ExecutionPlan
                recommendation={rec}
                entityMap={entityMap}
                infraProposals={infraProposals}
                spaceId={spaceId}
                onTacticClick={onTacticClick}
              />
            </div>
          )}
        </div>

        {/* ── TIER 3: Evidence & Deep Dive (collapsible) ── */}
        <div className="border-t border-gray-100 pt-2">
          <button
            className="w-full flex items-center justify-between text-left group"
            onClick={() => setShowEvidence(!showEvidence)}
          >
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 group-hover:text-gray-700">
              <Shield className="h-3 w-3" />
              Evidence & Deep Dive
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-400">
                {rec.perspectives.length} perspectives
                {rec.pre_mortem?.length ? ` · ${rec.pre_mortem.length} risks` : ""}
                {suggestedObjectives.length ? ` · ${suggestedObjectives.length} objectives` : ""}
              </span>
            </h4>
            <ChevronDown className={cn("h-3.5 w-3.5 text-gray-300 transition-transform", showEvidence && "rotate-180")} />
          </button>
          {showEvidence && (
            <div className="mt-2">
              <Tier3Evidence
                recommendation={rec}
                entityMap={entityMap}
                synthData={synthData}
                entities={entities}
                cycles={cycles}
                scenarios={scenarios}
                suggestedObjectives={suggestedObjectives}
                activeGoal={activeGoal}
                goalRecommendations={goalRecommendations}
                onRecordOutcome={onRecordOutcome}
                onTriggerResynthesize={onTriggerResynthesize}
                onTacticClick={onTacticClick}
              />
            </div>
          )}
        </div>

        {/* ── Footer: Evidence grounding ── */}
        <div className="flex items-center gap-3 text-[9px] text-gray-400 border-t border-gray-100 pt-2">
          <span>{rec.entity_references.length} entities referenced</span>
          {rec.external_evidence_count > 0 && (
            <>
              <span className="text-gray-200">&middot;</span>
              <span className="text-purple-500">{rec.external_evidence_count} external sources</span>
            </>
          )}
          {infraProposals.length > 0 && (
            <>
              <span className="text-gray-200">&middot;</span>
              <span className="text-indigo-500">{infraProposals.length} infrastructure proposals</span>
            </>
          )}
          {reasoningTrace && (
            <>
              <span className="text-gray-200">&middot;</span>
              <span className="text-indigo-500">Multi-step reasoning ({(reasoningTrace.total_duration_ms / 1000).toFixed(1)}s)</span>
            </>
          )}
        </div>
      </div>

      {/* ── Fullscreen BSC Strategy Page ── */}
      {showFullStrategy && (
        <BSCStrategyPage
          rec={rec}
          entityMap={entityMap}
          infraProposals={infraProposals}
          onClose={() => setShowFullStrategy(false)}
          onTacticClick={onTacticClick}
        />
      )}
    </DashboardCard>
  );
}
