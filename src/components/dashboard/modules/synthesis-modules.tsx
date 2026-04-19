"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Ring } from "@/components/ui/ring";
import { StatusBadge } from "@/components/ui/status-badge";
import { CalloutBox } from "@/components/ui/callout-box";
import { ExpandableCard } from "@/components/ui/expandable-card";
import { IntensityDot } from "@/components/ui/intensity-dot";
import { LeverageCard } from "@/components/synthesis/leverage-card";
import { RiskCard } from "@/components/synthesis/risk-card";
import { ConditionalActionPlan } from "@/components/synthesis/conditional-action-plan";
import { ExternalContextSection } from "@/components/synthesis/external-context-section";
import { CrossContextSection } from "@/components/synthesis/cross-context-section";
import {
  AlertTriangle,
  ArrowUpRight,
  ShieldAlert,
  RefreshCw,
  BarChart3,
  Link2,
  HelpCircle,
  ListChecks,
  BookOpen,
  Zap,
  Target,
  Clipboard,
  Blocks,
  Link,
} from "lucide-react";
import type { SuggestedObjective } from "@/types/goals";
import type {
  Space,
  Entity,
  Cycle,
  NovelConnection,
  Contradiction,
  Scenario,
  ActionItem,
  Proposition,
  Bridge,
} from "@/types";
import type {
  SynthesisData,
  SynthesisQualityScore,
  GoalFitnessResult,
  RichBottleneck,
  RichFeedbackLoop,
  RichOpenQuestion,
  WorthConsidering,
  CrossContextInsight,
} from "@/types/synthesis";

interface SynthesisModulesProps {
  space: Space;
  entities: Entity[];
  cycles: Cycle[];
  novelConnections: NovelConnection[];
  contradictions: Contradiction[];
  scenarios: Scenario[];
  actionItems: ActionItem[];
  propositions: Proposition[];
  bridges?: Bridge[];
  domainMap?: Record<string, { name: string; index: number }>;
  /** When strategy module exists, skip cards that are now embedded as evidence drill-downs */
  hasStrategy?: boolean;
  /** Callback for action item completion tracking */
  onToggleActionDone?: (actionId: string, done: boolean) => void;
  /** Render only the "Insights" cards (Analysis Intelligence, Open Questions, Discovered Connections, Contradictions, Domain Expertise) */
  insightsOnly?: boolean;
  /** Render only the "Strategy Analysis" cards (Bottleneck, Leverage, Risks, Loops, Scenarios, Actions) */
  strategyOnly?: boolean;
  /** When set, render only the specified section (e.g. "bottleneck", "leverage", "risks", "loops", "scenarios", "actions") */
  sectionFilter?: string;
}

export function SynthesisModules({
  space,
  entities,
  cycles,
  novelConnections,
  contradictions,
  scenarios,
  actionItems,
  propositions,
  bridges = [],
  domainMap = {},
  hasStrategy = false,
  onToggleActionDone,
  insightsOnly = false,
  strategyOnly = false,
  sectionFilter,
}: SynthesisModulesProps) {
  const synthData = useMemo<SynthesisData | null>(() => {
    if (!space.synthesis_data) return null;
    try {
      return (typeof space.synthesis_data === "string"
        ? JSON.parse(space.synthesis_data)
        : space.synthesis_data) as SynthesisData;
    } catch {
      return null;
    }
  }, [space.synthesis_data]);

  const bottleneckEntity = useMemo(
    () => entities.find((e) => e.is_master_bottleneck),
    [entities]
  );
  const richBottleneck: RichBottleneck | null = synthData?.master_bottleneck ?? null;

  const leverageEntities = useMemo(
    () =>
      entities
        .filter((e) => e.is_leverage_point)
        .sort((a, b) => (a.centrality_rank ?? 99) - (b.centrality_rank ?? 99))
        .slice(0, 3),
    [entities]
  );

  const riskEntities = useMemo(
    () =>
      entities
        .filter((e) => e.is_risk_point)
        .sort((a, b) => (b.blast_radius ?? 0) - (a.blast_radius ?? 0))
        .slice(0, 3),
    [entities]
  );

  const openQuestions = useMemo(
    () => propositions.filter((p) => p.proposition_type === "irreducible"),
    [propositions]
  );

  const entityMap = useMemo(() => {
    const map = new Map<string, Entity>();
    for (const e of entities) map.set(e.entity_id, e);
    return map;
  }, [entities]);

  const externalEntities = useMemo(
    () => entities.filter((e) => e.knowledge_layer === "external"),
    [entities]
  );

  const crossContextInsights = useMemo<CrossContextInsight[]>(() => {
    if (synthData?.cross_context_insights?.length) return synthData.cross_context_insights;
    const sd = synthData as Record<string, unknown> | null;
    if (Array.isArray(sd?.agent7_cross_context_insights) && (sd.agent7_cross_context_insights as unknown[]).length > 0) {
      return (sd.agent7_cross_context_insights as Array<{
        insight: string;
        external_entities_involved?: string[];
        confidence?: string;
        type?: string;
      }>).map((ins) => ({
        insight: ins.insight,
        internal_entities: [],
        external_entities: ins.external_entities_involved ?? [],
        confidence: (ins.confidence as "high" | "moderate" | "low") ?? "moderate",
      }));
    }
    return (sd?.cross_context_insights ?? []) as CrossContextInsight[];
  }, [synthData]);

  const entityByUuid = useMemo(() => {
    const map = new Map<string, Entity>();
    for (const e of entities) map.set(e.id, e);
    return map;
  }, [entities]);

  const spaceNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const [spaceId, { name }] of Object.entries(domainMap)) {
      map.set(spaceId, name);
    }
    return map;
  }, [domainMap]);

  // Map entity IDs → suggested objectives that reference them
  const objectiveByEntity = useMemo(() => {
    const map = new Map<string, SuggestedObjective>();
    const suggested = synthData?.suggested_objectives;
    if (!Array.isArray(suggested)) return map;
    for (const obj of suggested as SuggestedObjective[]) {
      if (obj.source_entity_id) {
        map.set(obj.source_entity_id, obj);
      }
    }
    return map;
  }, [synthData?.suggested_objectives]);

  const cards: React.ReactNode[] = [];

  // ── Card 0: Analysis Intelligence (Quality, Fitness, Trajectory, Signals) ──
  {
    const qualityScore = synthData?.quality_score as SynthesisQualityScore | undefined;
    const goalFitness = synthData?.goal_fitness as GoalFitnessResult | undefined;
    const trajectoryEstimate = (synthData as Record<string, unknown> | null)?.goal_trajectory_estimate as { estimated_weeks: number; confidence: string; critical_path: string[] } | undefined;
    const regenMeta = (synthData as Record<string, unknown> | null)?.regen_metadata as { attempted: boolean; original_score: number; regen_score: number | null; flags_addressed: string[]; kept: string; regen_at: string } | undefined;
    const contSignals = (synthData as Record<string, unknown> | null)?.continuation_signals as Array<{ type: string; description: string; priority: string }> | undefined;
    const signalExtraction = (synthData as Record<string, unknown> | null)?.signal_extraction as { signals?: Array<{ severity: string }> } | undefined;
    const researchTriggers = (synthData as Record<string, unknown> | null)?.research_triggers as { triggers?: Array<{ type: string }> } | undefined;

    const hasAnyIntelData = qualityScore || goalFitness || trajectoryEstimate || regenMeta?.attempted || contSignals?.length || signalExtraction?.signals?.length || researchTriggers?.triggers?.length;

    if (hasAnyIntelData) {
      cards.push(
        <DashboardCard
          key="analysis-intel"
          title="Analysis Intelligence"
          icon={<BarChart3 className="h-4 w-4" />}
          subtitle="Quality metrics, goal trajectory, and research signals"
          defaultExpanded={false}
          fullscreenable
          className="border-indigo-200"
        >
          <div className="space-y-4">
            {/* Quality Score + Goal Fitness row */}
            {(qualityScore || goalFitness) && (
              <div className="flex gap-3">
                {qualityScore && (
                  <div className="flex-1 rounded-lg border border-gray-200 bg-white p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Synthesis Quality</span>
                      <span className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white",
                        qualityScore.overall >= 70 ? "bg-green-500" : qualityScore.overall >= 40 ? "bg-amber-500" : "bg-red-500"
                      )}>
                        {qualityScore.overall}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {(Object.entries(qualityScore.dimensions) as [string, number][]).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-1.5">
                          <span className="w-24 text-[9px] text-gray-500 capitalize truncate">{key.replace(/_/g, " ")}</span>
                          <div className="h-1 flex-1 rounded-full bg-gray-100">
                            <div className={cn("h-1 rounded-full", value >= 70 ? "bg-green-400" : value >= 40 ? "bg-amber-400" : "bg-red-400")} style={{ width: `${value}%` }} />
                          </div>
                          <span className="w-5 text-right text-[9px] font-medium text-gray-400">{value}</span>
                        </div>
                      ))}
                    </div>
                    {qualityScore.flags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {qualityScore.flags.map((flag) => (
                          <span key={flag} className={cn("rounded-full px-1.5 py-0.5 text-[8px] font-medium", flag === "overconfident" || flag === "ungrounded_risk" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600")}>
                            {flag.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {goalFitness && (
                  <div className="flex-1 rounded-lg border border-gray-200 bg-white p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Goal Fitness</span>
                      <span className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white",
                        goalFitness.score >= 70 ? "bg-green-500" : goalFitness.score >= 40 ? "bg-amber-500" : "bg-red-500"
                      )}>
                        {goalFitness.score}
                      </span>
                    </div>
                    <div className="flex gap-2 mb-2">
                      <div className="flex-1 rounded bg-green-50 px-2 py-1 text-center">
                        <div className="text-sm font-bold text-green-600">{goalFitness.on_critical_path.length}</div>
                        <div className="text-[8px] text-gray-500">on path</div>
                      </div>
                      <div className="flex-1 rounded bg-gray-50 px-2 py-1 text-center">
                        <div className="text-sm font-bold text-gray-500">{goalFitness.off_critical_path.length}</div>
                        <div className="text-[8px] text-gray-500">off path</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {goalFitness.bottleneck_blocks_goal && <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[8px] font-medium text-green-700">Bottleneck blocks goal</span>}
                      {goalFitness.action_plan_addresses_goal && <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[8px] font-medium text-green-700">Actions aligned</span>}
                    </div>
                    {goalFitness.issues.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {goalFitness.issues.slice(0, 3).map((issue, idx) => (
                          <div key={idx} className={cn("rounded px-2 py-1 text-[9px]", issue.severity === "error" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600")}>
                            {issue.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Goal Trajectory Estimate */}
            {trajectoryEstimate && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-3 w-3 text-blue-500" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">Goal Trajectory Estimate</span>
                </div>
                <div className="flex items-center gap-4">
                  <div>
                    <div className="text-xl font-bold text-blue-700">{trajectoryEstimate.estimated_weeks}w</div>
                    <div className="text-[9px] text-gray-500">estimated</div>
                  </div>
                  <div>
                    <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-medium", trajectoryEstimate.confidence === "high" ? "bg-green-100 text-green-700" : trajectoryEstimate.confidence === "moderate" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
                      {trajectoryEstimate.confidence} confidence
                    </span>
                  </div>
                </div>
                {trajectoryEstimate.critical_path?.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[9px] font-medium text-gray-500 mb-1">Critical Path</div>
                    <div className="flex flex-wrap gap-1">
                      {trajectoryEstimate.critical_path.map((step, i) => (
                        <span key={i} className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-[9px] text-blue-700">
                          {i > 0 && <span className="text-blue-400 mr-0.5">&rarr;</span>}
                          {step}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Regen Metadata */}
            {regenMeta?.attempted && (
              <div className={cn("rounded-lg border p-2.5 flex items-center gap-2 text-[10px]", regenMeta.kept === "regen" ? "border-green-200 bg-green-50/30" : "border-gray-200 bg-gray-50/30")}>
                <Zap className="h-3 w-3 text-amber-500 flex-shrink-0" />
                <span className="text-gray-600">
                  Auto-regeneration {regenMeta.kept === "regen" ? "improved" : "attempted"}: {regenMeta.original_score} → {regenMeta.regen_score ?? "—"}
                </span>
                {regenMeta.flags_addressed.length > 0 && (
                  <span className="text-[9px] text-gray-400">
                    (addressed: {regenMeta.flags_addressed.join(", ").replace(/_/g, " ")})
                  </span>
                )}
              </div>
            )}

            {/* Continuation Signals */}
            {contSignals && contSignals.length > 0 && (
              <div>
                <h5 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Research Continuation Signals</h5>
                <div className="space-y-1">
                  {contSignals.map((sig, i) => (
                    <div key={i} className={cn("rounded-lg border px-2.5 py-1.5 text-[10px]", sig.priority === "critical" ? "border-red-200 bg-red-50/30" : sig.priority === "high" ? "border-amber-200 bg-amber-50/30" : "border-gray-200 bg-gray-50/30")}>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("rounded px-1 py-0.5 text-[8px] font-medium", sig.priority === "critical" ? "bg-red-100 text-red-700" : sig.priority === "high" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600")}>
                          {sig.priority}
                        </span>
                        <span className="rounded bg-gray-100 px-1 py-0.5 text-[8px] text-gray-500">{sig.type.replace(/_/g, " ")}</span>
                      </div>
                      <p className="mt-1 text-gray-600">{sig.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Signal Extraction + Research Triggers summary row */}
            {(signalExtraction?.signals?.length || researchTriggers?.triggers?.length) && (
              <div className="flex gap-3">
                {signalExtraction?.signals && signalExtraction.signals.length > 0 && (
                  <div className="flex-1 rounded-lg border border-gray-200 bg-white p-2.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Detected Signals</span>
                    <div className="mt-1.5 flex gap-2">
                      {(() => {
                        const counts = { high: 0, medium: 0, low: 0 };
                        signalExtraction.signals.forEach(s => { counts[s.severity as keyof typeof counts] = (counts[s.severity as keyof typeof counts] || 0) + 1; });
                        return (
                          <>
                            {counts.high > 0 && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-medium text-red-600">{counts.high} high</span>}
                            {counts.medium > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600">{counts.medium} medium</span>}
                            {counts.low > 0 && <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">{counts.low} low</span>}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
                {researchTriggers?.triggers && researchTriggers.triggers.length > 0 && (
                  <div className="flex-1 rounded-lg border border-gray-200 bg-white p-2.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Research Triggers</span>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(() => {
                        const typeCounts: Record<string, number> = {};
                        researchTriggers.triggers.forEach(t => { typeCounts[t.type] = (typeCounts[t.type] || 0) + 1; });
                        return Object.entries(typeCounts).map(([type, count]) => (
                          <span key={type} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-600">
                            {count} {type.replace(/_/g, " ")}
                          </span>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </DashboardCard>
      );
    }
  }

  // ── Card 1: Master Bottleneck (skip when strategy module shows this as evidence) ──
  if (bottleneckEntity && !hasStrategy) {
    cards.push(
      <DashboardCard
        key="bottleneck"
        title="Highest-Impact Constraint"
        icon={<AlertTriangle className="h-4 w-4" />}
        subtitle={`Affects ${bottleneckEntity.blast_radius} downstream elements`}
        defaultExpanded
        fullscreenable
        className="border-red-200"
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-red-600">
                  {bottleneckEntity.entity_id}
                </span>
                <h3 className="text-base font-semibold text-gray-900">
                  {bottleneckEntity.name}
                </h3>
              </div>
              {(richBottleneck?.summary ?? bottleneckEntity.description) && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600">
                  {richBottleneck?.summary ?? bottleneckEntity.description}
                </p>
              )}
            </div>
            <Ring value={bottleneckEntity.confidence} size={40} showValue />
          </div>

          {richBottleneck?.reasoning && richBottleneck.reasoning.length > 0 && (
            <CalloutBox type="insight" label="Why this is the critical constraint">
              {richBottleneck.reasoning.map((r, i) => (
                <p key={i} className={i < richBottleneck.reasoning.length - 1 ? "mb-2" : ""}>
                  {r}
                </p>
              ))}
            </CalloutBox>
          )}

          {richBottleneck?.counterfactual_unlock && (
            <CalloutBox type="action" label="If resolved, what opens up">
              <p>{richBottleneck.counterfactual_unlock}</p>
            </CalloutBox>
          )}

          {richBottleneck?.candidates_considered && richBottleneck.candidates_considered.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-semibold text-gray-500">Alternative constraints considered</div>
              <div className="space-y-1">
                {richBottleneck.candidates_considered.map((c, i) => (
                  <div key={i} className="flex gap-2 rounded-lg bg-gray-50 px-3 py-2">
                    <div>
                      <div className="text-xs font-medium text-gray-800">{c.candidate}</div>
                      <div className="mt-0.5 text-xs leading-snug text-gray-500">{c.why_not}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {richBottleneck?.when_matters && richBottleneck.when_matters.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-semibold text-gray-500">When this matters most</div>
              <div className="space-y-1">
                {richBottleneck.when_matters.map((w, i) => (
                  <div key={i} className="flex gap-2 rounded-lg bg-gray-50 px-3 py-2">
                    <IntensityDot level={w.intensity} />
                    <div>
                      <div className="text-xs font-medium text-gray-800">{w.situation}</div>
                      <div className="mt-0.5 text-xs leading-snug text-gray-500">{w.impact}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <div className="flex-1 rounded-lg border border-red-200 bg-red-50/40 p-3">
              <div className="text-xl font-bold text-red-600">{bottleneckEntity.blast_radius}</div>
              <div className="text-[11px] text-gray-500">downstream elements affected</div>
            </div>
            <div className="flex-1 rounded-lg border border-red-200 bg-red-50/40 p-3">
              <div className="text-xl font-bold text-red-600">
                {entities.length > 0
                  ? Math.round((bottleneckEntity.blast_radius / entities.length) * 100)
                  : 0}%
              </div>
              <div className="text-[11px] text-gray-500">of system depends on this</div>
            </div>
          </div>
        </div>
      </DashboardCard>
    );
  }

  // ── Card 2: Leverage Points (skip when strategy module shows this as evidence) ──
  if (leverageEntities.length > 0 && !hasStrategy) {
    cards.push(
      <DashboardCard
        key="leverage"
        title="Highest-Leverage Changes"
        icon={<ArrowUpRight className="h-4 w-4" />}
        subtitle={`${leverageEntities.length} ranked by downstream impact`}
        defaultExpanded
        fullscreenable
      >
        <div className="space-y-2">
          {leverageEntities.map((entity, i) => {
            const richPoint = synthData?.leverage_points?.find(
              (lp) => lp.entity_id === entity.entity_id
            );
            const linkedObjective = objectiveByEntity.get(entity.entity_id);
            return (
              <div key={entity.id}>
                {richPoint ? (
                  <LeverageCard point={richPoint} entity={entity} rank={i + 1} delay={i * 60} spaceId={space.id} />
                ) : (
                  <ExpandableCard variant="leverage" rank={i + 1} entityId={entity.entity_id} title={entity.name} score={entity.confidence}>
                    {entity.description && (
                      <p className="text-[13px] leading-relaxed text-gray-600">{entity.description}</p>
                    )}
                  </ExpandableCard>
                )}
                {linkedObjective && (
                  <div className="ml-4 mt-1 flex items-center gap-1.5 rounded-md bg-interaxis-50 border border-interaxis-100 px-2.5 py-1">
                    <Target className="h-3 w-3 text-interaxis-500 flex-shrink-0" />
                    <span className="text-[10px] text-interaxis-700">
                      Drives objective: <span className="font-semibold">{linkedObjective.title}</span>
                    </span>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase",
                      linkedObjective.objective_type === "maximize" ? "bg-green-50 text-green-600" :
                      linkedObjective.objective_type === "minimize" ? "bg-red-50 text-red-600" :
                      linkedObjective.objective_type === "explore" ? "bg-purple-50 text-purple-600" :
                      linkedObjective.objective_type === "avoid" ? "bg-amber-50 text-amber-600" :
                      "bg-blue-50 text-blue-600"
                    )}>
                      {linkedObjective.objective_type}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DashboardCard>
    );
  }

  // ── Card 3: Critical Risks (skip when strategy module shows this as evidence) ──
  if (riskEntities.length > 0 && !hasStrategy) {
    cards.push(
      <DashboardCard
        key="risks"
        title="Critical Risks"
        icon={<ShieldAlert className="h-4 w-4" />}
        subtitle={`${riskEntities.length} ranked by blast radius`}
        defaultExpanded
        fullscreenable
      >
        <div className="space-y-2">
          {riskEntities.map((entity, i) => {
            const richPoint = synthData?.risk_points?.find(
              (rp) => rp.entity_id === entity.entity_id
            );
            const linkedObjective = objectiveByEntity.get(entity.entity_id);
            return (
              <div key={entity.id}>
                {richPoint ? (
                  <RiskCard point={richPoint} entity={entity} rank={i + 1} totalEntities={entities.length} delay={i * 60} spaceId={space.id} />
                ) : (
                  <ExpandableCard variant="risk" rank={i + 1} entityId={entity.entity_id} title={entity.name} score={entity.confidence}>
                    {entity.description && (
                      <p className="text-[13px] leading-relaxed text-gray-600">{entity.description}</p>
                    )}
                  </ExpandableCard>
                )}
                {linkedObjective && (
                  <div className="ml-4 mt-1 flex items-center gap-1.5 rounded-md bg-red-50/60 border border-red-100 px-2.5 py-1">
                    <Target className="h-3 w-3 text-red-500 flex-shrink-0" />
                    <span className="text-[10px] text-red-700">
                      Drives objective: <span className="font-semibold">{linkedObjective.title}</span>
                    </span>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase",
                      linkedObjective.objective_type === "minimize" ? "bg-red-100 text-red-600" :
                      linkedObjective.objective_type === "avoid" ? "bg-amber-100 text-amber-600" :
                      "bg-gray-100 text-gray-600"
                    )}>
                      {linkedObjective.objective_type}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DashboardCard>
    );
  }

  // ── Card 4: Feedback Loops (skip when strategy module shows this as evidence) ──
  if ((synthData?.feedback_loops?.length ?? cycles.length) > 0 && !hasStrategy) {
    cards.push(
      <DashboardCard
        key="loops"
        title="Feedback Loops"
        icon={<RefreshCw className="h-4 w-4" />}
        subtitle="Self-reinforcing dynamics"
        defaultExpanded={false}
        fullscreenable
      >
        <div className="space-y-2">
          {synthData?.feedback_loops?.length ? (
            synthData.feedback_loops.map((loop: RichFeedbackLoop, li: number) => {
              const isPositive = loop.type === "positive";
              return (
                <ExpandableCard
                  key={li}
                  variant={isPositive ? "cycle-positive" : "cycle-negative"}
                  rank={li + 1}
                  title={loop.name}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-1 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    {loop.steps.map((step, si) => (
                      <span key={si} className="flex items-center gap-1">
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 text-xs font-medium",
                            si === loop.intervention_at
                              ? isPositive
                                ? "border border-green-300 bg-green-50 text-green-700"
                                : "border border-red-300 bg-red-50 text-red-700"
                              : "text-gray-600"
                          )}
                        >
                          {step}
                        </span>
                        {si < loop.steps.length - 1 && (
                          <span className="text-[11px] text-gray-400">→</span>
                        )}
                      </span>
                    ))}
                  </div>
                  <CalloutBox type="insight" label="What drives this loop">{loop.explanation}</CalloutBox>
                  <CalloutBox type="intervention" label={isPositive ? "How to strengthen this" : "How to break this"}>{loop.how_to}</CalloutBox>
                  {loop.when_active?.length > 0 && (
                    <div>
                      <div className="mb-2 text-[11px] font-semibold text-gray-500">When this loop is active</div>
                      <div className="space-y-1">
                        {loop.when_active.map((w, wi) => (
                          <div key={wi} className="flex gap-2 rounded-lg bg-gray-50 px-3 py-2">
                            <IntensityDot level={w.intensity} />
                            <div>
                              <div className="text-xs font-medium text-gray-800">{w.situation}</div>
                              <div className="mt-0.5 text-xs leading-snug text-gray-500">{w.impact}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </ExpandableCard>
              );
            })
          ) : (
            cycles.map((cycle, ci) => {
              const isPositive = cycle.classification === "reinforcing_positive";
              const isNegative = cycle.classification === "reinforcing_negative";
              return (
                <ExpandableCard
                  key={cycle.id}
                  variant={isPositive ? "cycle-positive" : isNegative ? "cycle-negative" : "cycle-balancing"}
                  rank={ci + 1}
                  title={cycle.name ?? cycle.cycle_id}
                >
                  <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <span className="font-mono text-xs text-gray-500">
                      {cycle.entity_ids.join(" → ")} → {cycle.entity_ids[0]}
                    </span>
                  </div>
                  {cycle.description && (
                    <CalloutBox type="insight" label="What drives this loop">{cycle.description}</CalloutBox>
                  )}
                  {cycle.intervention_description && (
                    <CalloutBox type="intervention" label={isNegative ? "How to break this" : "How to strengthen this"}>
                      {cycle.intervention_description}
                    </CalloutBox>
                  )}
                </ExpandableCard>
              );
            })
          )}
        </div>
      </DashboardCard>
    );
  }

  // ── Card 5: Scenarios (skip when strategy module shows this as evidence) ──
  if (scenarios.length > 0 && !hasStrategy) {
    cards.push(
      <DashboardCard
        key="scenarios"
        title="Scenario Modeling"
        icon={<BarChart3 className="h-4 w-4" />}
        subtitle={`${scenarios.length} projected outcomes`}
        defaultExpanded={false}
      >
        <div className="flex gap-2">
          {scenarios.map((scenario) => (
            <div key={scenario.id} className="flex-1 rounded-lg border border-gray-200 bg-gray-50/60 p-3 text-center">
              <div className="text-[10px] font-medium text-gray-500">{scenario.name}</div>
              <div
                className="mt-1 text-lg font-bold"
                style={{
                  color: scenario.probability === "likely" ? "#34C759" : scenario.probability === "unlikely" ? "#FF3B30" : "#FF9500",
                }}
              >
                {scenario.outcome_value}
              </div>
              <div className="text-[10px] text-gray-400">{scenario.outcome_label}</div>
              <div className="mt-1 text-[10px] text-gray-400">{scenario.conditions}</div>
            </div>
          ))}
        </div>
      </DashboardCard>
    );
  }

  // ── Card 6: Action Plan (skip when strategy module replaces with micro tactics + temporal phases) ──
  if ((synthData?.action_plan?.paths?.length ?? actionItems.length) > 0 && !hasStrategy) {
    cards.push(
      <DashboardCard
        key="actions"
        title="What To Do Next"
        icon={<ListChecks className="h-4 w-4" />}
        subtitle="Choose the path that matches your situation"
        defaultExpanded
        fullscreenable
      >
        <ConditionalActionPlan
          actionItems={actionItems}
          richActionPlan={synthData?.action_plan}
          sequencingRationale={synthData?.sequencing_rationale}
          spaceId={space.id}
          onToggleActionDone={onToggleActionDone}
        />
      </DashboardCard>
    );
  }

  // ── Card 7: Open Questions ──
  if ((synthData?.open_questions?.length ?? openQuestions.length) > 0) {
    cards.push(
      <DashboardCard
        key="questions"
        title="Open Questions"
        icon={<HelpCircle className="h-4 w-4" />}
        subtitle="Unknowns that could change the strategy"
        defaultExpanded={false}
      >
        <div className="space-y-2">
          {synthData?.open_questions?.length ? (
            synthData.open_questions.map((q: RichOpenQuestion & { what_changes?: string }, qi: number) => (
              <div key={qi} className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                <p className="text-[13px] font-medium text-gray-700">{q.question}</p>
                {q.why_it_matters && (
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{q.why_it_matters}</p>
                )}
                {q.what_changes && (
                  <div className="mt-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-600">
                    If resolved: {q.what_changes}
                  </div>
                )}
              </div>
            ))
          ) : (
            openQuestions.map((q) => (
              <div key={q.id} className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                <p className="text-xs font-medium text-gray-700">{q.statement}</p>
              </div>
            ))
          )}
        </div>
      </DashboardCard>
    );
  }

  // ── Card 8: Discovered Connections ──
  if (novelConnections.length > 0) {
    cards.push(
      <DashboardCard
        key="connections"
        title="Discovered Connections"
        icon={<Link2 className="h-4 w-4" />}
        subtitle={`${novelConnections.length} novel links found`}
        defaultExpanded={false}
      >
        <div className="space-y-2">
          {novelConnections.map((nc) => (
            <div key={nc.id} className="rounded-lg border border-green-200 bg-green-50/40 p-3">
              <div className="flex items-center gap-2 text-xs">
                <StatusBadge variant={nc.strength}>{nc.strength}</StatusBadge>
                <span className="font-mono font-semibold text-gray-700">{nc.source_entity_id}</span>
                <span className="text-gray-400">→</span>
                <span className="font-mono font-semibold text-gray-700">{nc.target_entity_id}</span>
                <span className="text-gray-500">{nc.relationship_type}</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{nc.reasoning}</p>
            </div>
          ))}
        </div>
      </DashboardCard>
    );
  }

  // ── Card 9: Contradictions ──
  if (contradictions.length > 0) {
    cards.push(
      <DashboardCard
        key="contradictions"
        title="Contradictions"
        icon={<Zap className="h-4 w-4" />}
        subtitle={`${contradictions.length} tensions found`}
        defaultExpanded={false}
      >
        <div className="space-y-2">
          {contradictions.map((c) => (
            <div key={c.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <StatusBadge
                variant={c.severity === "critical" ? "blocked" : c.severity === "moderate" ? "waiting" : "theory"}
              >
                {c.severity}
              </StatusBadge>
              <div className="mt-2 space-y-1 text-xs leading-relaxed">
                <p className="text-gray-700">
                  <span className="font-medium text-gray-900">Assumes:</span> {c.assumption_text}
                </p>
                <p className="text-gray-700">
                  <span className="font-medium text-gray-900">But concludes:</span> {c.conclusion_text}
                </p>
              </div>
              {c.description && <p className="mt-1.5 text-xs text-gray-500">{c.description}</p>}
            </div>
          ))}
        </div>
      </DashboardCard>
    );
  }

  // ── Card 10: Domain Expertise ──
  const hasDomainExpertise =
    (synthData?.worth_considering && synthData.worth_considering.length > 0) ||
    externalEntities.length > 0 ||
    crossContextInsights.length > 0 ||
    bridges.length > 0;

  if (hasDomainExpertise) {
    cards.push(
      <DashboardCard
        key="domain"
        title="Domain Expertise"
        icon={<BookOpen className="h-4 w-4" />}
        subtitle="Frameworks, precedents, and cross-domain connections"
        defaultExpanded={false}
        fullscreenable
      >
        <div className="space-y-5">
          {synthData?.worth_considering && synthData.worth_considering.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-purple-600">
                <span>Frameworks & Precedents</span>
                <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-500">
                  {synthData.worth_considering.length}
                </span>
              </h4>
              <div className="space-y-2">
                {synthData.worth_considering.map((item: WorthConsidering, i: number) => {
                  const typeConfig: Record<string, { icon: React.ReactNode; label: string; border: string; bg: string }> = {
                    precedent: { icon: <Clipboard className="h-4 w-4" />, label: "Real-world precedent", border: "border-amber-200", bg: "bg-amber-50/40" },
                    framework: { icon: <Blocks className="h-4 w-4" />, label: "Analytical framework", border: "border-purple-200", bg: "bg-purple-50/40" },
                    blind_spot: { icon: <AlertTriangle className="h-4 w-4" />, label: "Blind spot", border: "border-red-200", bg: "bg-red-50/40" },
                    analogy: { icon: <Link className="h-4 w-4" />, label: "Cross-domain analogy", border: "border-blue-200", bg: "bg-blue-50/40" },
                    resource: { icon: <BookOpen className="h-4 w-4" />, label: "Resource", border: "border-teal-200", bg: "bg-teal-50/40" },
                  };
                  const tc = typeConfig[item.type] ?? typeConfig.analogy;
                  return (
                    <div key={i} className={cn("rounded-lg border p-4", tc.border, tc.bg)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {tc.icon}
                          <div>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{tc.label}</span>
                            <h4 className="text-sm font-semibold text-gray-900">{item.title}</h4>
                          </div>
                        </div>
                        <StatusBadge variant={item.confidence === "high" ? "active" : item.confidence === "moderate" ? "waiting" : "theory"}>
                          {item.confidence}
                        </StatusBadge>
                      </div>
                      <p className="mt-2 text-[13px] leading-relaxed text-gray-700">{item.description}</p>
                      {item.source_note && (
                        <div className="mt-2 text-[11px] text-gray-500 italic">Source: {item.source_note}</div>
                      )}
                      {/* Relevance score + ranking reason */}
                      {(item.relevance_score != null || item.ranking_reason) && (
                        <div className="mt-2 flex items-center gap-2">
                          {item.relevance_score != null && (
                            <div className="flex items-center gap-1">
                              <span className="text-[9px] text-gray-400">Relevance</span>
                              <span className={cn(
                                "rounded px-1.5 py-0.5 text-[9px] font-bold",
                                item.relevance_score >= 8 ? "bg-green-100 text-green-700" :
                                item.relevance_score >= 5 ? "bg-amber-100 text-amber-700" :
                                "bg-gray-100 text-gray-500"
                              )}>
                                {item.relevance_score}/10
                              </span>
                            </div>
                          )}
                          {item.ranking_reason && (
                            <span className="text-[10px] text-gray-500 italic">{item.ranking_reason}</span>
                          )}
                        </div>
                      )}
                      {item.connected_entities?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.connected_entities.map((eid, j) => {
                            const entity = entityMap.get(eid);
                            return (
                              <span key={j} className="rounded-full bg-white/80 border border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                                {eid}{entity ? `: ${entity.name}` : ""}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {externalEntities.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-purple-600">
                <span>External Context</span>
                <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-500">{externalEntities.length}</span>
              </h4>
              <ExternalContextSection externalEntities={externalEntities} />
            </div>
          )}

          {crossContextInsights.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600">
                <span>Cross-Context Bridges</span>
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">{crossContextInsights.length}</span>
              </h4>
              <CrossContextSection insights={crossContextInsights} />
            </div>
          )}

          {bridges.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600">
                <span>Cross-Area Connections</span>
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">{bridges.length}</span>
              </h4>
              <div className="space-y-2">
                {bridges.map((bridge) => {
                  const sourceEntity = entityByUuid.get(bridge.source_entity_id);
                  const targetEntity = entityByUuid.get(bridge.target_entity_id);
                  const otherSpaceId = bridge.source_space_id === space.id ? bridge.target_space_id : bridge.source_space_id;
                  const otherSpaceName = spaceNames.get(otherSpaceId) ?? "Other area";
                  const typeConfig: Record<string, { label: string; border: string; bg: string; badge: string }> = {
                    identity: { label: "Same concept", border: "border-blue-200", bg: "bg-blue-50/40", badge: "stated" },
                    influence: { label: "Influences", border: "border-amber-200", bg: "bg-amber-50/40", badge: "inferred" },
                    structural: { label: "Structural parallel", border: "border-green-200", bg: "bg-green-50/40", badge: "predicted" },
                  };
                  const tc = typeConfig[bridge.bridge_type] ?? typeConfig.influence;
                  return (
                    <div key={bridge.id} className={cn("rounded-lg border p-3", tc.border, tc.bg)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <StatusBadge variant={tc.badge as "stated" | "inferred" | "predicted"}>{tc.label}</StatusBadge>
                            <StatusBadge variant={bridge.coupling_strength === "strong" ? "fundamental" : bridge.coupling_strength === "moderate" ? "important" : "theory"}>
                              {bridge.coupling_strength}
                            </StatusBadge>
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-sm">
                            <span className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gray-600">{sourceEntity?.entity_id ?? "?"}</span>
                            <span className="text-xs text-gray-700 font-medium truncate max-w-[100px]">{sourceEntity?.name ?? "Unknown"}</span>
                            <svg className="h-3 w-4 flex-shrink-0 text-amber-400" viewBox="0 0 16 12" fill="none">
                              {bridge.coupling_direction === "bidirectional" ? (
                                <path d="M1 6h14M4 1L1 6l3 5M12 1l3 5-3 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              ) : (
                                <path d="M1 6h14M11 1l4 5-4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              )}
                            </svg>
                            <span className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gray-600">{targetEntity?.entity_id ?? "?"}</span>
                            <span className="text-xs text-gray-700 font-medium truncate max-w-[100px]">{targetEntity?.name ?? "Unknown"}</span>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">{otherSpaceName}</span>
                      </div>
                      <div className="mt-2 text-[11px] font-medium text-amber-700">Shared: {bridge.shared_variable_name}</div>
                      {bridge.description && (
                        <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">{bridge.description}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DashboardCard>
    );
  }

  // Filter cards based on insightsOnly / strategyOnly mode
  const insightKeys = new Set(["analysis-intel", "questions", "connections", "contradictions", "domain"]);
  const strategyKeys = new Set(["bottleneck", "leverage", "risks", "loops", "scenarios", "actions"]);

  const filteredCards = cards.filter((card) => {
    const key = (card as React.ReactElement)?.key as string | undefined;
    if (!key) return !insightsOnly && !strategyOnly && !sectionFilter;
    if (sectionFilter) return key === sectionFilter;
    if (insightsOnly) return insightKeys.has(key);
    if (strategyOnly) return strategyKeys.has(key);
    return true; // no filter — render all
  });

  if (filteredCards.length === 0) return null;

  // Map card keys to section IDs for dashboard navigation
  const sectionIdMap: Record<string, string> = {
    bottleneck: "section-bottleneck",
    leverage: "section-leverage",
    risks: "section-risks",
    loops: "section-loops",
    scenarios: "section-scenarios",
    actions: "section-actions",
    questions: "section-questions",
    connections: "section-worth",
    contradictions: "section-worth",
    domain: "section-external",
  };

  return (
    <>
      {filteredCards.map((card) => {
        const key = (card as React.ReactElement)?.key;
        const sectionId = key ? sectionIdMap[key as string] : undefined;
        if (sectionId) {
          return <div key={key} id={sectionId}>{card}</div>;
        }
        return card;
      })}
    </>
  );
}
