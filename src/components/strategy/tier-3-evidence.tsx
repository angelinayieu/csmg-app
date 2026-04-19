"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
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
  ArrowUpRight,
  ShieldAlert,
  BarChart3,
  X,
} from "lucide-react";
import { Ring } from "@/components/ui/ring";
import { LeverageCard } from "@/components/synthesis/leverage-card";
import { RiskCard } from "@/components/synthesis/risk-card";
import type {
  StrategicRecommendation,
  StrategyPerspective,
  MicroTactic,
} from "@/types/strategy";
import type { Entity, Cycle, Scenario } from "@/types";
import type { SynthesisData, RichBottleneck, RichFeedbackLoop } from "@/types/synthesis";
import type {
  SuggestedObjective,
  ObjectiveType,
  ImprovementGoal,
  GoalRecommendation,
} from "@/types/goals";

// ── Props ──

export interface Tier3EvidenceProps {
  recommendation: StrategicRecommendation;
  entityMap: Map<string, Entity>;
  synthData?: SynthesisData | null;
  entities?: Entity[];
  cycles?: Cycle[];
  scenarios?: Scenario[];
  suggestedObjectives?: SuggestedObjective[];
  activeGoal?: ImprovementGoal | null;
  goalRecommendations?: GoalRecommendation[];
  onRecordOutcome?: (recId: string, goalId: string, outcome: "effective" | "partial" | "ineffective", notes: string) => Promise<{ refinement_signals?: Array<{ entity_id: string; recommendation: string; reason: string }> } | null>;
  onTriggerResynthesize?: () => void;
  onTacticClick?: (tactic: MicroTactic) => void;
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

// ── Perspective Card ──

function PerspectiveCard({ perspective, entityMap }: { perspective: StrategyPerspective; entityMap: Map<string, Entity> }) {
  const [expanded, setExpanded] = useState(false);
  const confColor = perspective.confidence === "high" ? "text-green-600" : perspective.confidence === "moderate" ? "text-amber-600" : "text-red-500";

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-lg flex-shrink-0">{perspective.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-800">{perspective.name}</span>
            <span className={cn("text-[9px] font-medium", confColor)}>{perspective.confidence}</span>
          </div>
          <p className="text-[11px] text-gray-500 truncate">{perspective.objective}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-[9px] text-gray-400">{perspective.key_metric.name}</div>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-500">{perspective.key_metric.current}</span>
            <ArrowRight className="h-2.5 w-2.5 text-gray-300" />
            <span className="font-semibold text-green-600">{perspective.key_metric.target}</span>
          </div>
        </div>
        <ChevronDown className={cn("h-3.5 w-3.5 text-gray-300 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-3 py-2.5 space-y-2">
          <div className="space-y-1.5">
            {perspective.actions.map((action, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={cn(
                  "mt-0.5 h-4 w-4 flex items-center justify-center rounded text-[8px] font-bold flex-shrink-0",
                  action.timeframe === "now" ? "bg-green-100 text-green-700" :
                  action.timeframe === "short_term" ? "bg-blue-100 text-blue-700" :
                  action.timeframe === "medium_term" ? "bg-amber-100 text-amber-700" :
                  "bg-gray-100 text-gray-500"
                )}>
                  {action.timeframe === "now" ? "!" : action.timeframe === "short_term" ? "S" : action.timeframe === "medium_term" ? "M" : "L"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-700">{action.text}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {action.entity_id && <EntityRef id={action.entity_id} entityMap={entityMap} />}
                    {action.dynamic_role && (
                      <span className="text-[8px] text-gray-400 italic">{action.dynamic_role.replace(/_/g, " ")}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {perspective.supporting_entities.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1 border-t border-gray-50">
              {perspective.supporting_entities.map((id) => (
                <EntityRef key={id} id={id} entityMap={entityMap} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Objective type config ──

const objectiveTypeConfig: Record<ObjectiveType, { icon: string; color: string; bg: string; label: string }> = {
  maximize: { icon: "\u2191", color: "text-green-700", bg: "bg-green-50", label: "Maximize" },
  minimize: { icon: "\u2193", color: "text-red-700", bg: "bg-red-50", label: "Minimize" },
  maintain: { icon: "=", color: "text-blue-700", bg: "bg-blue-50", label: "Maintain" },
  explore: { icon: "?", color: "text-purple-700", bg: "bg-purple-50", label: "Explore" },
  avoid: { icon: "!", color: "text-amber-700", bg: "bg-amber-50", label: "Avoid" },
};

// ── Objective alignment computation ──

function computeObjectiveAlignment(
  obj: SuggestedObjective,
  perspectives: StrategyPerspective[],
  targetObjective?: { title: string; metric: string } | null,
): { isTarget: boolean; alignedPerspectives: Array<{ name: string; reason: string }> } {
  const isTarget = targetObjective?.title === obj.title || targetObjective?.metric === obj.metric_name;
  const alignedPerspectives: Array<{ name: string; reason: string }> = [];
  for (const p of perspectives) {
    if (obj.source_entity_id && p.supporting_entities.includes(obj.source_entity_id)) {
      alignedPerspectives.push({ name: p.name, reason: "Entity referenced" });
      continue;
    }
    const metricLower = obj.metric_name.toLowerCase();
    if (p.key_metric.name.toLowerCase().includes(metricLower) || metricLower.includes(p.key_metric.name.toLowerCase())) {
      alignedPerspectives.push({ name: p.name, reason: "Metric aligned" });
      continue;
    }
    const objWords = obj.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const pWords = (p.name + " " + p.objective).toLowerCase();
    const matchCount = objWords.filter(w => pWords.includes(w)).length;
    if (matchCount >= 2) {
      alignedPerspectives.push({ name: p.name, reason: "Topic aligned" });
    }
  }
  return { isTarget, alignedPerspectives };
}

// ── Outcome badge config ──

const outcomeBadgeConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  effective: { label: "Effective", color: "text-green-700", bg: "bg-green-50 border-green-200", icon: "\u2713" },
  partial: { label: "Partial", color: "text-amber-700", bg: "bg-amber-50 border-amber-200", icon: "~" },
  ineffective: { label: "Ineffective", color: "text-red-700", bg: "bg-red-50 border-red-200", icon: "\u2717" },
};

// ── Goal Recommendations with Outcome Recording ──

function GoalRecommendationsWithOutcomes({
  goalRecommendations,
  activeGoal,
  entityMap,
  onRecordOutcome,
  onTriggerResynthesize,
}: {
  goalRecommendations: GoalRecommendation[];
  activeGoal?: ImprovementGoal | null;
  entityMap: Map<string, Entity>;
  onRecordOutcome?: Tier3EvidenceProps["onRecordOutcome"];
  onTriggerResynthesize?: () => void;
}) {
  const [showRecs, setShowRecs] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<{ recId: string; outcome: "effective" | "partial" | "ineffective" } | null>(null);
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [demoteNotification, setDemoteNotification] = useState<string[] | null>(null);

  const recordedCount = goalRecommendations.filter((r) => r.outcome && r.outcome !== "not_tested").length;

  const handleOutcomeClick = (recId: string, outcome: "effective" | "partial" | "ineffective") => {
    setPendingOutcome({ recId, outcome });
    setOutcomeNotes("");
  };

  const handleSubmitOutcome = async () => {
    if (!pendingOutcome || !activeGoal || !onRecordOutcome) return;
    setSaving(true);
    try {
      const result = await onRecordOutcome(pendingOutcome.recId, activeGoal.id, pendingOutcome.outcome, outcomeNotes);
      if (result?.refinement_signals) {
        const demoteSignals = result.refinement_signals.filter((s) => s.recommendation === "demote");
        if (demoteSignals.length > 0) {
          setDemoteNotification(demoteSignals.map((s) => s.reason));
        }
      }
      setPendingOutcome(null);
      setOutcomeNotes("");
      setRecordingId(null);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const impactConfig: Record<string, string> = {
    high: "bg-green-100 text-green-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-gray-100 text-gray-500",
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/20 p-2.5">
      <button
        className="w-full flex items-center justify-between text-left"
        onClick={() => setShowRecs(!showRecs)}
      >
        <div className="flex items-center gap-1.5">
          <Zap className="h-3 w-3 text-amber-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">
            Goal Recommendations
          </span>
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-600">
            {goalRecommendations.length} ranked
          </span>
          {recordedCount > 0 && (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-600">
              {recordedCount} tested
            </span>
          )}
        </div>
        <ChevronDown className={cn("h-3 w-3 text-amber-300 transition-transform", showRecs && "rotate-180")} />
      </button>

      {showRecs && (
        <div className="mt-2 space-y-1.5">
          {/* Demote notification */}
          {demoteNotification && demoteNotification.length > 0 && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-orange-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-orange-700">Some findings may need re-evaluation</p>
                  {demoteNotification.map((reason, i) => (
                    <p key={i} className="text-[10px] text-orange-600 mt-0.5">{reason}</p>
                  ))}
                  {onTriggerResynthesize && (
                    <button
                      onClick={() => { onTriggerResynthesize(); setDemoteNotification(null); }}
                      className="mt-1.5 flex items-center gap-1 rounded-md bg-orange-100 px-2 py-1 text-[10px] font-semibold text-orange-700 hover:bg-orange-200 transition-colors"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Re-analyze
                    </button>
                  )}
                </div>
                <button onClick={() => setDemoteNotification(null)} className="text-orange-300 hover:text-orange-500">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {goalRecommendations.map((rec) => {
            const badge = rec.outcome ? outcomeBadgeConfig[rec.outcome] : null;
            const isRecording = recordingId === rec.id;
            const isPending = pendingOutcome?.recId === rec.id;

            return (
              <div key={rec.id} className="rounded-md border border-amber-100 bg-white px-2.5 py-2">
                <div className="flex items-start gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white flex-shrink-0">
                    {rec.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[11px] font-semibold text-gray-800">{rec.title}</p>
                      {badge && (
                        <span className={cn("inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[8px] font-bold", badge.bg, badge.color)}>
                          {badge.icon} {badge.label}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-gray-500 line-clamp-2">{rec.reasoning}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      {rec.impact_estimate && (
                        <span className={cn("rounded px-1 py-0.5 text-[8px] font-medium", impactConfig[rec.impact_estimate] ?? "bg-gray-100 text-gray-500")}>
                          {rec.impact_estimate} impact
                        </span>
                      )}
                      <span className="text-[8px] text-gray-400">{rec.source_type.replace(/_/g, " ")}</span>
                      {rec.source_entity_id && (
                        <EntityRef id={rec.source_entity_id} entityMap={entityMap} />
                      )}
                    </div>

                    {recordedCount >= 3 && rec.outcome && (
                      <div className="mt-1 flex items-center gap-1 text-[9px] text-gray-400">
                        <BarChart3 className="h-2.5 w-2.5" />
                        <span>{recordedCount} outcomes tracked -- reliability signals active</span>
                      </div>
                    )}

                    {/* Outcome recording buttons */}
                    {!rec.outcome && onRecordOutcome && (
                      <div className="mt-1.5">
                        {!isRecording ? (
                          <button
                            onClick={() => setRecordingId(rec.id)}
                            className="text-[9px] text-blue-500 hover:text-blue-700 font-medium transition-colors"
                          >
                            Record outcome...
                          </button>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1">
                              {(["effective", "partial", "ineffective"] as const).map((o) => (
                                <button
                                  key={o}
                                  onClick={() => handleOutcomeClick(rec.id, o)}
                                  className={cn(
                                    "rounded border px-1.5 py-0.5 text-[9px] font-medium transition-colors",
                                    isPending && pendingOutcome?.outcome === o
                                      ? o === "effective" ? "border-green-400 bg-green-100 text-green-700"
                                        : o === "partial" ? "border-amber-400 bg-amber-100 text-amber-700"
                                        : "border-red-400 bg-red-100 text-red-700"
                                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                                  )}
                                >
                                  {o === "effective" ? "\u2713 Effective" : o === "partial" ? "~ Partial" : "\u2717 Ineffective"}
                                </button>
                              ))}
                              <button
                                onClick={() => { setRecordingId(null); setPendingOutcome(null); }}
                                className="text-[9px] text-gray-300 hover:text-gray-500 ml-1"
                              >
                                cancel
                              </button>
                            </div>
                            {isPending && (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={outcomeNotes}
                                  onChange={(e) => setOutcomeNotes(e.target.value)}
                                  placeholder="Optional notes..."
                                  className="flex-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] text-gray-700 placeholder:text-gray-300 focus:border-blue-300 focus:outline-none"
                                />
                                <button
                                  onClick={handleSubmitOutcome}
                                  disabled={saving}
                                  className="rounded bg-blue-500 px-2 py-1 text-[10px] font-semibold text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
                                >
                                  {saving ? "..." : "Save"}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {rec.outcome && rec.outcome_notes && (
                      <p className="mt-1 text-[9px] italic text-gray-400">Note: {rec.outcome_notes}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Objectives Alignment Section ──

function ObjectivesAlignmentSection({
  suggestedObjectives,
  activeGoal,
  goalRecommendations,
  perspectives,
  targetObjective,
  entityMap,
  onRecordOutcome,
  onTriggerResynthesize,
}: {
  suggestedObjectives: SuggestedObjective[];
  activeGoal?: ImprovementGoal | null;
  goalRecommendations?: GoalRecommendation[];
  perspectives: StrategyPerspective[];
  targetObjective?: { title: string; metric: string } | null;
  entityMap: Map<string, Entity>;
  onRecordOutcome?: Tier3EvidenceProps["onRecordOutcome"];
  onTriggerResynthesize?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const depthOrder: Record<string, number> = { fundamental: 0, structural: 1, surface: 2 };
  const sorted = [...suggestedObjectives].sort((a, b) => {
    const aDepth = depthOrder[a.depth ?? "surface"] ?? 2;
    const bDepth = depthOrder[b.depth ?? "surface"] ?? 2;
    if (aDepth !== bDepth) return aDepth - bDepth;
    const aAlign = computeObjectiveAlignment(a, perspectives, targetObjective);
    const bAlign = computeObjectiveAlignment(b, perspectives, targetObjective);
    if (aAlign.isTarget && !bAlign.isTarget) return -1;
    if (!aAlign.isTarget && bAlign.isTarget) return 1;
    const aConv = a.convergence_score ?? 0;
    const bConv = b.convergence_score ?? 0;
    if (aConv !== bConv) return bConv - aConv;
    return a.priority - b.priority;
  });

  const fundamentalCount = sorted.filter(o => o.depth === "fundamental").length;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-3">
      <button
        className="w-full flex items-center justify-between text-left group"
        onClick={() => setExpanded(!expanded)}
      >
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-600 group-hover:text-emerald-700">
          <Target className="h-3 w-3" />
          Objectives Alignment
          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600">
            {sorted.length} detected
          </span>
          {fundamentalCount > 0 && (
            <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-600">
              {fundamentalCount} fundamental
            </span>
          )}
        </h4>
        <ChevronDown className={cn("h-3.5 w-3.5 text-emerald-300 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {/* Active goal banner */}
          {activeGoal && (
            <div className="rounded-lg border border-emerald-200 bg-gradient-to-r from-emerald-50/60 to-white px-3 py-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-500">Active Goal</div>
                  <p className="text-xs font-semibold text-gray-800">{activeGoal.title}</p>
                </div>
                <div className="text-right">
                  <div className="text-[9px] text-gray-400">{activeGoal.metric_name}</div>
                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="text-gray-500">{activeGoal.current_value}{activeGoal.metric_unit ? ` ${activeGoal.metric_unit}` : ""}</span>
                    <ArrowRight className="h-2.5 w-2.5 text-gray-300" />
                    <span className="font-semibold text-emerald-600">{activeGoal.target_value}{activeGoal.metric_unit ? ` ${activeGoal.metric_unit}` : ""}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Objective cards */}
          {sorted.map((obj) => {
            const config = objectiveTypeConfig[obj.objective_type] ?? objectiveTypeConfig.maximize;
            const alignment = computeObjectiveAlignment(obj, perspectives, targetObjective);
            const sourceEntity = obj.source_entity_id ? entityMap.get(obj.source_entity_id) : null;
            const depthConfig: Record<string, { label: string; color: string; bg: string }> = {
              fundamental: { label: "Fundamental", color: "text-rose-700", bg: "bg-rose-50" },
              structural: { label: "Structural", color: "text-indigo-700", bg: "bg-indigo-50" },
              surface: { label: "Surface", color: "text-gray-600", bg: "bg-gray-100" },
            };
            const depthInfo = obj.depth ? depthConfig[obj.depth] : null;

            return (
              <div
                key={obj.key}
                className={cn(
                  "rounded-lg border p-2.5 transition-all",
                  obj.depth === "fundamental"
                    ? "border-rose-200 bg-gradient-to-r from-rose-50/40 to-white shadow-sm ring-1 ring-rose-100"
                    : alignment.isTarget
                    ? "border-emerald-300 bg-gradient-to-r from-emerald-50/80 to-white shadow-sm"
                    : alignment.alignedPerspectives.length > 0
                    ? "border-gray-200 bg-white"
                    : "border-gray-100 bg-gray-50/30"
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold", config.bg, config.color)}>
                      {config.icon}
                    </div>
                    {obj.convergence_score != null && obj.convergence_score > 1 && (
                      <div className="flex items-center gap-0.5" title={`${obj.convergence_score} causal chains converge here`}>
                        {Array.from({ length: Math.min(obj.convergence_score, 5) }).map((_, i) => (
                          <div key={i} className={cn(
                            "h-1 w-1 rounded-full",
                            obj.convergence_score! >= 4 ? "bg-rose-400" :
                            obj.convergence_score! >= 3 ? "bg-amber-400" : "bg-blue-400"
                          )} />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-gray-800">{obj.title}</span>
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[8px] font-medium", config.bg, config.color)}>
                        {config.label}
                      </span>
                      {depthInfo && (
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[8px] font-bold", depthInfo.bg, depthInfo.color)}>
                          {depthInfo.label}
                        </span>
                      )}
                      {alignment.isTarget && (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[8px] font-bold text-emerald-700 flex items-center gap-0.5">
                          <Target className="h-2 w-2" /> Strategy Target
                        </span>
                      )}
                      {obj.convergence_score != null && obj.convergence_score >= 3 && (
                        <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[8px] font-bold text-rose-600">
                          {obj.convergence_score} paths converge
                        </span>
                      )}
                      {obj.confidence && (
                        <span className={cn(
                          "rounded-full px-1.5 py-0.5 text-[8px] font-medium",
                          obj.confidence === "high" ? "bg-green-100 text-green-700" :
                          obj.confidence === "moderate" ? "bg-amber-100 text-amber-700" :
                          "bg-red-100 text-red-700"
                        )}>
                          {obj.confidence}
                        </span>
                      )}
                    </div>

                    {obj.description && (
                      <p className="mt-0.5 text-[10px] text-gray-500 leading-relaxed">{obj.description}</p>
                    )}

                    <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                      <span className="text-gray-400">Metric:</span>
                      <span className="font-medium text-gray-600">{obj.metric_name}</span>
                      {obj.baseline_estimate != null && obj.target_estimate != null && (
                        <span className="flex items-center gap-0.5 text-gray-400">
                          ({obj.baseline_estimate}
                          <ArrowRight className="h-2 w-2" />
                          <span className="font-semibold text-green-600">{obj.target_estimate}</span>
                          {obj.metric_unit && <span className="ml-0.5">{obj.metric_unit}</span>})
                        </span>
                      )}
                    </div>

                    {/* Causal chain */}
                    {obj.causal_chain && obj.causal_chain.length > 1 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-0.5">
                        <span className="text-[8px] text-gray-400 mr-0.5">Chain:</span>
                        {obj.causal_chain.map((eid, ci) => (
                          <span key={ci} className="flex items-center gap-0.5">
                            <EntityRef id={eid} entityMap={entityMap} />
                            {ci < obj.causal_chain!.length - 1 && (
                              <ArrowRight className="h-2 w-2 text-gray-300" />
                            )}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Propellant */}
                    {obj.propellant && (
                      <div className="mt-1.5 rounded-md border border-amber-200 bg-gradient-to-r from-amber-50/60 to-white px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <Zap className="h-2.5 w-2.5 text-amber-500 flex-shrink-0" />
                          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600">Propellant</span>
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-[7px] font-medium text-amber-600">
                            {obj.propellant.mechanism.replace(/_/g, " ")}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          <EntityRef id={obj.propellant.entity_id} entityMap={entityMap} />
                          <span className="text-[10px] font-medium text-gray-700">{obj.propellant.action}</span>
                        </div>
                        <p className="mt-0.5 text-[9px] text-gray-500">{obj.propellant.why}</p>
                      </div>
                    )}

                    {/* Side benefits */}
                    {obj.side_benefits && obj.side_benefits.length > 0 && (
                      <div className="mt-1.5 rounded-md border border-teal-100 bg-teal-50/30 px-2 py-1.5">
                        <div className="flex items-center gap-1 mb-1">
                          <GitBranch className="h-2.5 w-2.5 text-teal-500" />
                          <span className="text-[9px] font-bold uppercase tracking-wider text-teal-600">Side Benefits</span>
                          <span className="text-[8px] text-teal-400">{obj.side_benefits.length} discovered</span>
                        </div>
                        <div className="space-y-1">
                          {obj.side_benefits.map((sb, si) => (
                            <div key={si} className="flex items-start gap-1.5 text-[9px]">
                              <span className="text-teal-400 mt-0.5">+</span>
                              <div className="flex-1 min-w-0">
                                <span className="font-medium text-teal-700">{sb.title}</span>
                                <span className="text-gray-500 ml-1">{sb.description}</span>
                                {sb.entity_id && (
                                  <span className="ml-1"><EntityRef id={sb.entity_id} entityMap={entityMap} /></span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Source entity + alignment */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {sourceEntity && (
                        <>
                          <span className="text-[9px] text-gray-400">Source:</span>
                          <EntityRef id={obj.source_entity_id!} entityMap={entityMap} />
                        </>
                      )}
                      {alignment.alignedPerspectives.length > 0 && (
                        <>
                          <span className="text-[9px] text-gray-400 ml-1">Links to:</span>
                          {alignment.alignedPerspectives.map((ap, i) => (
                            <span key={i} className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[8px] font-medium text-blue-600">
                              {ap.name}
                            </span>
                          ))}
                        </>
                      )}
                    </div>
                    {alignment.alignedPerspectives.length === 0 && !alignment.isTarget && !obj.propellant && (
                      <div className="mt-1 text-[9px] text-gray-400 italic">
                        No direct strategy linkage -- consider as future objective
                      </div>
                    )}

                    {/* External evidence */}
                    {obj.external_evidence && (
                      <div className="mt-1.5 flex items-start gap-1 rounded-md bg-purple-50/50 border border-purple-100 px-2 py-1">
                        <ExternalLink className="h-2.5 w-2.5 text-purple-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="text-[8px] font-medium text-purple-500 uppercase">{obj.external_evidence.type}</span>
                          <p className="text-[9px] text-purple-600">{obj.external_evidence.source}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Goal Recommendations with Outcome Recording */}
          {goalRecommendations && goalRecommendations.length > 0 && (
            <GoalRecommendationsWithOutcomes
              goalRecommendations={goalRecommendations}
              activeGoal={activeGoal}
              entityMap={entityMap}
              onRecordOutcome={onRecordOutcome}
              onTriggerResynthesize={onTriggerResynthesize}
            />
          )}

          {sorted.length === 0 && (!goalRecommendations || goalRecommendations.length === 0) && (
            <div className="text-center py-4">
              <p className="text-[11px] text-gray-400">No objectives detected yet -- click Refresh to auto-detect objectives from synthesis</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

export function Tier3Evidence({
  recommendation: rec,
  entityMap,
  synthData,
  entities = [],
  cycles = [],
  scenarios = [],
  suggestedObjectives = [],
  activeGoal,
  goalRecommendations = [],
  onRecordOutcome,
  onTriggerResynthesize,
  onTacticClick,
}: Tier3EvidenceProps) {
  const [showPreMortem, setShowPreMortem] = useState(false);
  const [showLearningLoop, setShowLearningLoop] = useState(false);
  const [showBSC, setShowBSC] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  // Evidence entities from synthesis findings
  const bottleneckEntity = entities.find((e) => e.is_master_bottleneck);
  const richBottleneck: RichBottleneck | null = synthData?.master_bottleneck ?? null;
  const leverageEntities = entities
    .filter((e) => e.is_leverage_point)
    .sort((a, b) => (a.centrality_rank ?? 99) - (b.centrality_rank ?? 99))
    .slice(0, 3);
  const riskEntities = entities
    .filter((e) => e.is_risk_point)
    .sort((a, b) => (b.blast_radius ?? 0) - (a.blast_radius ?? 0))
    .slice(0, 3);
  const hasEvidence = bottleneckEntity || leverageEntities.length > 0 || riskEntities.length > 0 ||
    (synthData?.feedback_loops?.length ?? 0) > 0 || scenarios.length > 0;

  return (
    <div className="border-t border-gray-200 pt-3 space-y-3">
      {/* ── Pre-Mortem Analysis ── */}
      {rec.pre_mortem && rec.pre_mortem.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-3">
          <button
            className="w-full flex items-center justify-between text-left group"
            onClick={() => setShowPreMortem(!showPreMortem)}
          >
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 group-hover:text-gray-700">
              <ShieldAlert className="h-3 w-3" />
              Pre-Mortem Analysis
              <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-medium text-red-500">
                {rec.pre_mortem.filter((f) => f.probability === "high").length} high-probability
              </span>
            </h4>
            <ChevronDown className={cn("h-3.5 w-3.5 text-gray-300 transition-transform", showPreMortem && "rotate-180")} />
          </button>

          {showPreMortem && (
            <div className="mt-2.5 space-y-2">
              {rec.pre_mortem.map((fm, i) => {
                const sevColors: Record<string, string> = {
                  catastrophic: "bg-red-100 text-red-700 border-red-200",
                  major: "bg-amber-100 text-amber-700 border-amber-200",
                  moderate: "bg-gray-100 text-gray-600 border-gray-200",
                };
                const probColors: Record<string, string> = {
                  high: "text-red-600",
                  moderate: "text-amber-600",
                  low: "text-gray-500",
                };
                return (
                  <div key={i} className="rounded-lg border border-gray-200 bg-white px-3 py-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[9px] font-medium uppercase text-gray-400">{fm.category}</span>
                      <span className={cn("rounded border px-1.5 py-0.5 text-[8px] font-semibold", sevColors[fm.severity] ?? sevColors.moderate)}>
                        {fm.severity}
                      </span>
                      <span className={cn("text-[9px] font-medium", probColors[fm.probability] ?? "text-gray-500")}>
                        {fm.probability} probability
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-700 leading-relaxed italic">{fm.narrative}</p>
                    {fm.early_warnings?.length > 0 && (
                      <div>
                        <span className="text-[9px] font-semibold text-gray-500">Early warning signs:</span>
                        <div className="mt-0.5 space-y-0.5">
                          {fm.early_warnings.map((w, j) => (
                            <div key={j} className="flex items-start gap-1 text-[10px] text-gray-500">
                              <AlertTriangle className="h-2.5 w-2.5 text-amber-400 flex-shrink-0 mt-0.5" />
                              {w}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="text-[9px] text-gray-400">
                      Exposes assumption: <span className="text-gray-500">{fm.assumption_exposed}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Strategy Learning Loop ── */}
      {rec.learning_loop && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-3">
          <button
            className="w-full flex items-center justify-between text-left group"
            onClick={() => setShowLearningLoop(!showLearningLoop)}
          >
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 group-hover:text-gray-700">
              <RefreshCw className="h-3 w-3" />
              Strategy Learning Loop
              <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-500">
                {rec.learning_loop.leading_indicators?.length ?? 0} indicators
              </span>
            </h4>
            <ChevronDown className={cn("h-3.5 w-3.5 text-gray-300 transition-transform", showLearningLoop && "rotate-180")} />
          </button>

          {showLearningLoop && (
            <div className="mt-2.5 space-y-3">
              {/* Leading indicators */}
              {rec.learning_loop.leading_indicators?.length > 0 && (
                <div>
                  <span className="text-[9px] font-semibold text-gray-500 uppercase">Leading Indicators</span>
                  <div className="mt-1.5 space-y-1.5">
                    {rec.learning_loop.leading_indicators.map((ind, i) => (
                      <div key={i} className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-gray-800">{ind.metric}</span>
                          <span className="text-[9px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{ind.cadence}</span>
                        </div>
                        <p className="text-[10px] text-gray-500">{ind.measurement_method}</p>
                        <div className="flex gap-2 text-[9px]">
                          <span className="text-green-600">G: {ind.green_reading}</span>
                          <span className="text-amber-600">Y: {ind.yellow_reading}</span>
                          <span className="text-red-600">R: {ind.red_reading}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pivot criteria */}
              {rec.learning_loop.pivot_criteria?.length > 0 && (
                <div>
                  <span className="text-[9px] font-semibold text-gray-500 uppercase">Pivot Criteria</span>
                  <div className="mt-1.5 space-y-1">
                    {rec.learning_loop.pivot_criteria.map((pc, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[10px] rounded-lg border border-red-100 bg-red-50/20 px-2.5 py-1.5">
                        <ArrowUpRight className="h-3 w-3 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="text-gray-700">{pc.signal}</span>
                          <span className="text-gray-400"> by {pc.timeline} -- </span>
                          <span className="text-red-600 font-medium">{pc.specific_action}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Review cadence */}
              {rec.learning_loop.review_cadence && (
                <div className="flex items-center gap-3 text-[10px] text-gray-500 bg-white rounded-lg px-2.5 py-2 border border-gray-100">
                  <Clock className="h-3 w-3 text-gray-400" />
                  <span>Metrics: {rec.learning_loop.review_cadence.metric_checks}</span>
                  <span className="text-gray-300">|</span>
                  <span>Full review: {rec.learning_loop.review_cadence.full_strategy_review}</span>
                  <span className="text-gray-300">|</span>
                  <span>{rec.learning_loop.review_cadence.total_cycles_in_timeline} cycles</span>
                </div>
              )}

              {/* Persistence signals */}
              {rec.learning_loop.persistence_signals?.length > 0 && (
                <div>
                  <span className="text-[9px] font-semibold text-gray-500 uppercase">Stay-the-Course Signals</span>
                  <div className="mt-1 space-y-0.5">
                    {rec.learning_loop.persistence_signals.map((ps, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[10px]">
                        <CheckCircle2 className="h-3 w-3 text-green-400 flex-shrink-0 mt-0.5" />
                        <span className="text-gray-600">{ps.signal} -- <span className="text-gray-400">{ps.meaning}</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── BSC Perspectives (Strategy on a Page) ── */}
      <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-3">
        <button
          className="w-full flex items-center justify-between text-left group"
          onClick={() => setShowBSC(!showBSC)}
        >
          <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 group-hover:text-gray-700">
            Strategy on a Page
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-400">
              {rec.perspectives.length} perspectives
            </span>
          </h4>
          <ChevronDown className={cn("h-3.5 w-3.5 text-gray-300 transition-transform", showBSC && "rotate-180")} />
        </button>

        {showBSC && (
          <div className="mt-2 space-y-1.5">
            {rec.perspectives.map((perspective, i) => (
              <PerspectiveCard key={i} perspective={perspective} entityMap={entityMap} />
            ))}
          </div>
        )}
      </div>

      {/* ── Objectives Alignment ── */}
      {(suggestedObjectives.length > 0 || goalRecommendations.length > 0 || activeGoal) && (
        <ObjectivesAlignmentSection
          suggestedObjectives={suggestedObjectives}
          activeGoal={activeGoal}
          goalRecommendations={goalRecommendations}
          perspectives={rec.perspectives}
          targetObjective={rec.target_objective}
          entityMap={entityMap}
          onRecordOutcome={onRecordOutcome}
          onTriggerResynthesize={onTriggerResynthesize}
        />
      )}

      {/* ── Supporting Evidence (synthesis drill-down) ── */}
      {hasEvidence && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-3">
          <button
            className="w-full flex items-center justify-between text-left group"
            onClick={() => setShowEvidence(!showEvidence)}
          >
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 group-hover:text-gray-700">
              Supporting Evidence & Analysis
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-400">
                {[bottleneckEntity ? 1 : 0, leverageEntities.length, riskEntities.length, synthData?.feedback_loops?.length ?? 0, scenarios.length].reduce((a, b) => a + b, 0)} findings
              </span>
            </h4>
            <ChevronDown className={cn("h-3.5 w-3.5 text-gray-300 transition-transform", showEvidence && "rotate-180")} />
          </button>

          {showEvidence && (
            <div className="mt-3 space-y-3">
              {/* Critical Constraint */}
              {bottleneckEntity && (
                <div className="rounded-lg border border-red-200 bg-red-50/20 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-red-600">Critical Constraint</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-red-500">{bottleneckEntity.entity_id}</span>
                        <span className="text-xs font-semibold text-gray-900">{bottleneckEntity.name}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-600 leading-relaxed">
                        {richBottleneck?.summary ?? bottleneckEntity.description}
                      </p>
                    </div>
                    <Ring value={bottleneckEntity.confidence} size={32} showValue />
                  </div>
                  {richBottleneck?.reasoning && richBottleneck.reasoning.length > 0 && (
                    <div className="mt-2 rounded-md bg-white/60 border border-red-100 px-2.5 py-2">
                      <div className="text-[9px] font-semibold uppercase text-red-500 mb-1">Why this is critical</div>
                      {richBottleneck.reasoning.map((r, i) => (
                        <p key={i} className="text-[10px] text-gray-600 leading-relaxed">{r}</p>
                      ))}
                    </div>
                  )}
                  {richBottleneck?.counterfactual_unlock && (
                    <div className="mt-2 rounded-md bg-green-50/60 border border-green-200 px-2.5 py-2">
                      <div className="text-[9px] font-semibold uppercase text-green-600 mb-1">If resolved, what opens up</div>
                      <p className="text-[10px] text-green-800 leading-relaxed">{richBottleneck.counterfactual_unlock}</p>
                    </div>
                  )}
                  {richBottleneck?.candidates_considered && richBottleneck.candidates_considered.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      <div className="text-[9px] font-semibold uppercase text-gray-400">Other constraints considered</div>
                      {richBottleneck.candidates_considered.map((c, i) => (
                        <div key={i} className="text-[10px] text-gray-500">
                          <span className="font-medium">{c.candidate}</span> -- {c.why_not}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <div className="flex-1 rounded-md bg-white/60 border border-red-100 px-2 py-1.5">
                      <div className="text-sm font-bold text-red-600">{bottleneckEntity.blast_radius}</div>
                      <div className="text-[9px] text-gray-500">downstream affected</div>
                    </div>
                    <div className="flex-1 rounded-md bg-white/60 border border-red-100 px-2 py-1.5">
                      <div className="text-sm font-bold text-red-600">
                        {entities.length > 0 ? Math.round((bottleneckEntity.blast_radius / entities.length) * 100) : 0}%
                      </div>
                      <div className="text-[9px] text-gray-500">system dependency</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Leverage Points */}
              {leverageEntities.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <ArrowUpRight className="h-3.5 w-3.5 text-green-500" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">Leverage Points</span>
                    <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-medium text-green-600">{leverageEntities.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {leverageEntities.map((entity, i) => {
                      const richPoint = synthData?.leverage_points?.find(
                        (lp) => lp.entity_id === entity.entity_id
                      );
                      return richPoint ? (
                        <LeverageCard key={entity.id} point={richPoint} entity={entity} rank={i + 1} delay={0} />
                      ) : (
                        <div key={entity.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/50 px-2.5 py-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-[10px] font-bold text-white">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <EntityRef id={entity.entity_id} entityMap={entityMap} />
                              <span className="text-xs font-medium text-gray-800">{entity.name}</span>
                            </div>
                          </div>
                          <Ring value={entity.confidence} size={28} showValue />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Risk Points */}
              {riskEntities.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">Critical Risks</span>
                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-600">{riskEntities.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {riskEntities.map((entity, i) => {
                      const richPoint = synthData?.risk_points?.find(
                        (rp) => rp.entity_id === entity.entity_id
                      );
                      return richPoint ? (
                        <RiskCard key={entity.id} point={richPoint} entity={entity} rank={i + 1} totalEntities={entities.length} delay={0} />
                      ) : (
                        <div key={entity.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/50 px-2.5 py-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <EntityRef id={entity.entity_id} entityMap={entityMap} />
                              <span className="text-xs font-medium text-gray-800">{entity.name}</span>
                            </div>
                          </div>
                          <Ring value={entity.confidence} size={28} showValue />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Feedback Loops */}
              {(synthData?.feedback_loops?.length ?? 0) > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">Feedback Loops</span>
                    <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-600">{synthData!.feedback_loops!.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {synthData!.feedback_loops!.map((loop: RichFeedbackLoop, li: number) => (
                      <div key={li} className="rounded-md border border-gray-100 bg-gray-50/50 px-2.5 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            "rounded-full px-1.5 py-0.5 text-[8px] font-bold",
                            loop.type === "positive" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                          )}>
                            {loop.type === "positive" ? "REINFORCING" : "BALANCING"}
                          </span>
                          <span className="text-[11px] font-medium text-gray-800">{loop.name}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {loop.steps.map((step, si) => (
                            <span key={si} className="flex items-center gap-0.5">
                              <span className={cn(
                                "rounded px-1.5 py-0.5 text-[9px]",
                                si === loop.intervention_at ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-500"
                              )}>
                                {step}
                              </span>
                              {si < loop.steps.length - 1 && <span className="text-[9px] text-gray-300">&rarr;</span>}
                            </span>
                          ))}
                        </div>
                        <p className="mt-1 text-[10px] text-gray-500">{loop.how_to}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Scenarios */}
              {scenarios.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="h-3.5 w-3.5 text-purple-500" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">Scenarios</span>
                    <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">{scenarios.length}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {scenarios.map((scenario) => (
                      <div key={scenario.id} className="flex-1 rounded-md border border-gray-100 bg-gray-50/50 px-2 py-1.5 text-center">
                        <div className="text-[9px] font-medium text-gray-500">{scenario.name}</div>
                        <div className="mt-0.5 text-base font-bold" style={{
                          color: scenario.probability === "likely" ? "#34C759" : scenario.probability === "unlikely" ? "#FF3B30" : "#FF9500",
                        }}>
                          {scenario.outcome_value}
                        </div>
                        <div className="text-[8px] text-gray-400">{scenario.outcome_label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
