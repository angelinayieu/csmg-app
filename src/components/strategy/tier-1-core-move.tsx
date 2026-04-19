"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Target,
  Zap,
  Shield,
  ArrowRight,
  Clock,
  GitBranch,
  ExternalLink,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  Maximize2,
  X,
} from "lucide-react";
import type {
  StrategicRecommendation,
  RankedStrategy,
  StrategyStatus,
  StrategyChangeProposal,
} from "@/types/strategy";
import type { Entity } from "@/types";

// ── Props ──

export interface Tier1CoreMoveProps {
  recommendation: StrategicRecommendation;
  entityMap: Map<string, Entity>;
  strategyStatus?: StrategyStatus | null;
  changeProposals?: StrategyChangeProposal[];
  rankedStrategies?: RankedStrategy[];
  isConfirmed: boolean;
  onConfirm?: () => void;
  onSelectAlternative?: (rank: number) => void;
  onGenerateStrategy?: () => void;
  strategyLoading?: boolean;
  onExpandFullStrategy?: () => void;
}

// ── Posture config ──

const postureConfig: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  aggressive_growth: { label: "Aggressive Growth", color: "text-green-700", bg: "bg-green-50", icon: <Zap className="h-3 w-3" /> },
  cautious_validation: { label: "Cautious Validation", color: "text-blue-700", bg: "bg-blue-50", icon: <Target className="h-3 w-3" /> },
  pivot_exploration: { label: "Pivot Exploration", color: "text-purple-700", bg: "bg-purple-50", icon: <GitBranch className="h-3 w-3" /> },
  consolidation: { label: "Consolidation", color: "text-amber-700", bg: "bg-amber-50", icon: <Shield className="h-3 w-3" /> },
  defensive: { label: "Defensive", color: "text-red-700", bg: "bg-red-50", icon: <Shield className="h-3 w-3" /> },
};

// ── Confidence ring ──

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

// ── Entity reference badge ──

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

// ── Quality signal icon config ──

const qualitySignalConfig: Array<{
  key: keyof StrategicRecommendation["quality_signals"];
  label: string;
  icon: React.ReactNode;
  color: string;
}> = [
  { key: "grounded_in_data", label: "Data-grounded", icon: <CheckCircle2 className="h-2.5 w-2.5" />, color: "text-green-600" },
  { key: "temporal_aware", label: "Time-aware", icon: <Clock className="h-2.5 w-2.5" />, color: "text-blue-600" },
  { key: "risk_addressed", label: "Risks addressed", icon: <Shield className="h-2.5 w-2.5" />, color: "text-amber-600" },
  { key: "external_validated", label: "Externally validated", icon: <ExternalLink className="h-2.5 w-2.5" />, color: "text-purple-600" },
  { key: "infrastructure_specified", label: "Infrastructure mapped", icon: <GitBranch className="h-2.5 w-2.5" />, color: "text-indigo-600" },
  { key: "objective_targeted", label: "Objective targeted", icon: <Target className="h-2.5 w-2.5" />, color: "text-emerald-600" },
];

// ── Main Component ──

export function Tier1CoreMove({
  recommendation: rec,
  entityMap,
  strategyStatus,
  changeProposals = [],
  rankedStrategies = [],
  isConfirmed,
  onConfirm,
  onSelectAlternative,
  onGenerateStrategy,
  strategyLoading = false,
  onExpandFullStrategy,
}: Tier1CoreMoveProps) {
  const [showDecisionDetail, setShowDecisionDetail] = useState(false);
  const [showPolicyDetail, setShowPolicyDetail] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);

  const posture = postureConfig[rec.strategic_posture] ?? postureConfig.cautious_validation;
  const alternativeStrategies = rankedStrategies.filter((r) => r.rank > 1);
  const hasEnhancedStrategy = !!(rec.guiding_policy || rec.pre_mortem?.length || rec.learning_loop);

  return (
    <div className="space-y-4">
      {/* ── Status bar + actions ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-bold text-green-700 uppercase tracking-wider">
            #1 Recommendation
          </span>
          {isConfirmed && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-bold text-blue-700 uppercase flex items-center gap-0.5">
              <CheckCircle2 className="h-2.5 w-2.5" /> Confirmed
            </span>
          )}
          {strategyStatus === "reviewing" && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-700 uppercase">Reviewing</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {onExpandFullStrategy && (
            <button
              onClick={onExpandFullStrategy}
              className="flex items-center gap-1 text-[10px] font-medium text-gray-500 hover:text-gray-700 transition-colors px-2 py-1 rounded-md hover:bg-gray-50"
              title="Expand to full Execution Page"
            >
              <Maximize2 className="h-3 w-3" /> Expand
            </button>
          )}
          {alternativeStrategies.length > 0 && (
            <button
              onClick={() => setShowAlternatives(!showAlternatives)}
              className="text-[10px] font-medium text-interaxis-600 hover:text-interaxis-700 transition-colors px-2 py-1 rounded-md hover:bg-interaxis-50"
            >
              {showAlternatives ? "Hide" : "See all"} {rankedStrategies.length} strategies
            </button>
          )}
          {!isConfirmed && onConfirm && (
            <button
              onClick={onConfirm}
              className="flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-green-700 transition-colors"
            >
              <CheckCircle2 className="h-3 w-3" /> Confirm Strategy
            </button>
          )}
          {onGenerateStrategy && (
            <button
              onClick={onGenerateStrategy}
              disabled={strategyLoading}
              className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", strategyLoading && "animate-spin")} />
              {strategyLoading ? "Generating..." : "Refresh"}
            </button>
          )}
        </div>
      </div>

      {/* ── Enhanced strategy nudge ── */}
      {!hasEnhancedStrategy && onGenerateStrategy && !strategyLoading && (
        <button
          onClick={onGenerateStrategy}
          className="flex w-full items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2 text-left transition-colors hover:bg-indigo-50"
        >
          <Zap className="h-3.5 w-3.5 flex-shrink-0 text-indigo-500" />
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-semibold text-indigo-700">Enhanced analysis available</span>
            <span className="ml-1.5 text-[10px] text-indigo-500">
              -- refresh to unlock guiding policy, pre-mortem risk analysis, and learning loop tracking
            </span>
          </div>
          <RefreshCw className="h-3 w-3 flex-shrink-0 text-indigo-400" />
        </button>
      )}

      {/* ── Alternative Strategies ── */}
      {showAlternatives && alternativeStrategies.length > 0 && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/30 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Alternative Strategies</div>
          {alternativeStrategies.map((alt) => {
            const altPosture = postureConfig[alt.recommendation.strategic_posture] ?? postureConfig.cautious_validation;
            return (
              <div key={alt.rank} className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-[11px] font-bold text-gray-600 flex-shrink-0">
                  #{alt.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-800">{alt.recommendation.title}</span>
                    <ConfidenceRing value={alt.recommendation.confidence} size={24} />
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[8px] font-medium", altPosture.bg, altPosture.color)}>
                      {altPosture.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-gray-500 line-clamp-2">{alt.recommendation.summary}</p>
                  {alt.tradeoff_vs_top && (
                    <p className="mt-1 text-[9px] text-amber-600 italic">Tradeoff: {alt.tradeoff_vs_top}</p>
                  )}
                  <p className="mt-0.5 text-[9px] text-gray-400">{alt.ranking_rationale}</p>
                  {alt.infrastructure_proposals?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {alt.infrastructure_proposals.map((p) => (
                        <span key={p.id} className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[8px] text-indigo-600 font-medium">
                          {p.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {onSelectAlternative && (
                  <button
                    onClick={() => onSelectAlternative(alt.rank)}
                    className="flex-shrink-0 rounded-md border border-interaxis-200 px-2 py-1 text-[9px] font-medium text-interaxis-600 hover:bg-interaxis-50 transition-colors"
                  >
                    Select
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Change Proposals banner ── */}
      {isConfirmed && changeProposals.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Proposed Changes</span>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-600">{changeProposals.length}</span>
          </div>
          <div className="space-y-1.5">
            {changeProposals.map((cp, i) => (
              <div key={i} className="rounded-md border border-amber-100 bg-white px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className={cn(
                    "rounded px-1 py-0.5 text-[8px] font-bold uppercase",
                    cp.impact === "high" ? "bg-red-100 text-red-700" : cp.impact === "medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                  )}>
                    {cp.impact} impact
                  </span>
                  <span className={cn(
                    "rounded px-1 py-0.5 text-[8px] font-bold uppercase",
                    cp.urgency === "high" ? "bg-red-100 text-red-700" : cp.urgency === "medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                  )}>
                    {cp.urgency} urgency
                  </span>
                  <span className="text-[9px] text-gray-400">{cp.change_type.replace(/_/g, " ")}</span>
                </div>
                <p className="mt-1 text-[10px] font-medium text-gray-800">{cp.target}</p>
                <p className="mt-0.5 text-[10px] text-gray-500">{cp.reasoning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quality Signals + Details ── */}
      <div className="rounded-xl border border-interaxis-100 bg-gradient-to-br from-interaxis-50/60 to-white p-4">
        {/* Quality signal icons */}
        {qualitySignalConfig.some((qs) => rec.quality_signals[qs.key]) && (
          <div className="flex items-center gap-1 mb-3">
            {qualitySignalConfig
              .filter((qs) => rec.quality_signals[qs.key])
              .map((qs) => (
                <span key={qs.key} className={cn(qs.color, "cursor-default flex items-center gap-0.5 rounded-full bg-gray-50 px-2 py-0.5 text-[11px]")} title={qs.label}>
                  {qs.icon}
                  <span className="text-gray-500">{qs.label}</span>
                </span>
              ))}
          </div>
        )}

        {/* Target Objective: current -> target */}
        {rec.target_objective && (
          <div className="mt-3 rounded-lg border border-green-100 bg-green-50/40 px-3 py-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-green-600">
                  Target
                </div>
                <p className="text-xs font-medium text-gray-800 mt-0.5">{rec.target_objective.title}</p>
              </div>
              <div className="text-right">
                <div className="text-[9px] text-gray-400">{rec.target_objective.metric}</div>
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="text-gray-500">{rec.target_objective.current}</span>
                  <ArrowRight className="h-2.5 w-2.5 text-gray-300" />
                  <span className="font-semibold text-green-600">{rec.target_objective.target}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Key Decision panel (expandable) */}
        <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/40 px-3 py-2">
          <button
            className="w-full flex items-center justify-between text-left"
            onClick={() => setShowDecisionDetail(!showDecisionDetail)}
          >
            <div className="flex-1">
              <div className="text-[12px] font-semibold text-amber-600">Key Decision</div>
              <p className="text-xs font-medium text-gray-800 mt-0.5">{rec.key_decision.question}</p>
              <p className="text-[11px] text-green-700 font-medium mt-0.5">Recommended: {rec.key_decision.recommended}</p>
            </div>
            <ChevronDown className={cn("h-3.5 w-3.5 text-amber-400 transition-transform", showDecisionDetail && "rotate-180")} />
          </button>

          {showDecisionDetail && (
            <div className="mt-2 border-t border-amber-100 pt-2 space-y-2">
              <p className="text-[11px] text-gray-600 leading-relaxed">{rec.key_decision.reasoning}</p>
              {rec.key_decision.alternatives.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[9px] font-semibold text-gray-500 uppercase">Alternatives:</span>
                  {rec.key_decision.alternatives.map((alt, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[10px]">
                      <span className="text-gray-400 flex-shrink-0">vs.</span>
                      <span className="text-gray-600">{alt.option} <span className="text-gray-400">-- tradeoff: {alt.tradeoff}</span></span>
                    </div>
                  ))}
                </div>
              )}
              {rec.key_decision.supporting_entities.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {rec.key_decision.supporting_entities.map((id) => (
                    <EntityRef key={id} id={id} entityMap={entityMap} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Guiding Policy (collapsed single-line subtitle, expandable) ── */}
      {rec.guiding_policy && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 px-3 py-2.5">
          <button
            className="w-full flex items-center justify-between text-left"
            onClick={() => setShowPolicyDetail(!showPolicyDetail)}
          >
            <div className="flex-1">
              <div className="text-[12px] font-semibold text-indigo-600">Guiding Policy</div>
              <p className="text-xs font-medium text-gray-800 mt-0.5">{rec.guiding_policy.policy_statement}</p>
            </div>
            <ChevronDown className={cn("h-3.5 w-3.5 text-indigo-400 transition-transform", showPolicyDetail && "rotate-180")} />
          </button>

          {showPolicyDetail && (
            <div className="mt-2 border-t border-indigo-100 pt-2 space-y-2.5">
              <div>
                <span className="text-[11px] font-semibold text-gray-500">Logic</span>
                <p className="text-[12px] text-gray-600 leading-relaxed mt-0.5">{rec.guiding_policy.strategic_logic}</p>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-gray-500">Leverage</span>
                <p className="text-[12px] text-gray-600 mt-0.5">{rec.guiding_policy.leverage_source}</p>
              </div>
              {rec.guiding_policy.what_this_excludes?.length > 0 && (
                <div>
                  <span className="text-[11px] font-semibold text-gray-500">Excluded</span>
                  <div className="mt-1 space-y-0.5">
                    {rec.guiding_policy.what_this_excludes.map((ex, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[10px]">
                        <X className="h-3 w-3 text-red-400 flex-shrink-0 mt-0.5" />
                        <span className="text-gray-600">{ex}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {rec.guiding_policy.coherence_test && (
                <div className="rounded-md border border-indigo-100 bg-white/60 px-2.5 py-2">
                  <span className="text-[9px] font-semibold text-indigo-500 uppercase">Coherence Test</span>
                  <div className="mt-1.5 space-y-1.5">
                    <div className="text-[10px]">
                      <span className="text-gray-400">If: </span>
                      <span className="text-gray-600">{rec.guiding_policy.coherence_test.situation_1}</span>
                      <br />
                      <span className="text-gray-400">Then: </span>
                      <span className="text-indigo-700 font-medium">{rec.guiding_policy.coherence_test.guidance_1}</span>
                    </div>
                    <div className="text-[10px]">
                      <span className="text-gray-400">If: </span>
                      <span className="text-gray-600">{rec.guiding_policy.coherence_test.situation_2}</span>
                      <br />
                      <span className="text-gray-400">Then: </span>
                      <span className="text-indigo-700 font-medium">{rec.guiding_policy.coherence_test.guidance_2}</span>
                    </div>
                    <p className="text-[10px] text-gray-500 italic">{rec.guiding_policy.coherence_test.reinforcing_explanation}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Footer: Evidence grounding summary ── */}
      <div className="flex items-center gap-3 text-[11px] text-gray-400 border-t border-gray-100 pt-2">
        <span>{rec.entity_references.length} entities referenced</span>
        {rec.external_evidence_count > 0 && (
          <>
            <span className="text-gray-200">&middot;</span>
            <span className="text-purple-500">{rec.external_evidence_count} external sources</span>
          </>
        )}
      </div>
    </div>
  );
}
