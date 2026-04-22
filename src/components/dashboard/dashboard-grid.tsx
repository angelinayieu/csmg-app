"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type {
  Space,
  Entity,
  Edge,
  Cycle,
  Proposition,
  NovelConnection,
  Contradiction,
  Scenario,
  ActionItem,
  Bridge,
} from "@/types";
import type { ImprovementGoal, SuggestedObjective, GoalRecommendation } from "@/types/goals";
import type { ReasoningOp } from "@/lib/hooks/use-reasoning";
import type { SynthesisData } from "@/types/synthesis";
import type { StrategicRecommendation, StrategicRecommendationData, MicroTactic } from "@/types/strategy";
import { GraphModule } from "@/components/dashboard/modules/graph-module";
import { InventoryModule } from "@/components/dashboard/modules/inventory-module";
import { SynthesisModules } from "@/components/dashboard/modules/synthesis-modules";
import { TwinMacroModule } from "@/components/dashboard/modules/twin-macro-module";
import { GoalProgressCenter } from "@/components/dashboard/modules/goal-progress-center";
import { DigitalTwinFlowchart } from "@/components/dashboard/modules/digital-twin-flowchart";
import MechanismIntelligenceModule from "@/components/dashboard/modules/mechanism-intelligence-module";
import { MultiLayerGraph } from "@/components/graph/multi-layer-graph";
import { ProgressRecordingModal } from "@/components/dashboard/progress-recording-modal";
import type { GoalProgress, ObjectiveBenchmark } from "@/types/goals";
import { StrategyRecommendationModule } from "@/components/dashboard/modules/strategy-recommendation-module";
import { StrategyCompactCard } from "@/components/strategy/v2/compact/strategy-compact-card";
import ObjectivesDecompositionShell from "@/components/objectives/objectives-decomposition-shell";
import { IntelligenceRadarModule } from "@/components/dashboard/modules/intelligence-radar-module";
import { useStrategyAuto } from "@/lib/hooks/use-strategy-auto";
import { useObjectiveAuto } from "@/lib/hooks/use-objective-auto";
import type { DeepRefreshHandle } from "@/lib/hooks/use-deep-refresh";
import { cn } from "@/lib/utils";
import { Trophy, RefreshCw, Zap, Lock, Target, Radar, AlertTriangle, ArrowUpRight, BarChart3, ListChecks, HelpCircle, BookOpen, Network, Gauge, Layers, Loader2, Settings } from "lucide-react";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { DashboardNav, buildDashboardSections } from "@/components/dashboard/dashboard-nav";
import { ProbabilitySpaceModule } from "@/components/dashboard/modules/probability-space-module";
import { DecompositionQualityModule } from "@/components/dashboard/modules/decomposition-quality-module";
import type { DecompositionQualityData } from "@/components/dashboard/modules/decomposition-quality-module";
import { EpistemicClassificationModule } from "@/components/dashboard/modules/epistemic-classification-module";
import type { EpistemicClassification } from "@/types/epistemic";
import { ManifoldOverviewModule } from "@/components/dashboard/modules/manifold-overview-module";
import { ExpansionSummaryModule } from "@/components/dashboard/modules/expansion-summary-module";
import { TemporalHealthModule } from "@/components/dashboard/modules/temporal-health-module";
import { TrackingPulseModule } from "@/components/dashboard/modules/tracking-pulse-module";
import {
  FirstPrinciplesPulse,
  type FPPAxiom,
  type FPPConvergence,
  type FPPStrategyCoverage,
  type FPPStrategyProvenance,
} from "@/components/dashboard/modules/first-principles-pulse";
import { DashboardChangeProposalsBanner } from "@/components/dashboard/modules/dashboard-change-proposals-banner";
import type { InteractionMetadata } from "@/types/interactions";

/**
 * Locked module placeholder — renders when a module's data requirements aren't met.
 * Shows what the module does and what the user needs to do to unlock it.
 */
function LockedModuleCard({
  id,
  icon,
  title,
  description,
  unlockAction,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  unlockAction: string;
}) {
  return (
    <div id={id} className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-300 flex-shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-gray-400">{title}</h3>
            <Lock className="h-3 w-3 text-gray-300" />
          </div>
          <p className="mt-0.5 text-[11px] text-gray-400 leading-relaxed">{description}</p>
          <p className="mt-1.5 text-[10px] text-gray-500 font-medium">{unlockAction}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Inventory highlight filter — set by TwinMacroModule stat clicks,
 * consumed by InventoryModule to highlight/filter matching entities.
 */
export type InventoryHighlight =
  | { type: "role"; role: "risk" | "leverage" | "bottleneck" | "orphan" }
  | { type: "confidence"; level: "high" | "medium" | "low" }
  | null;

interface DashboardGridProps {
  space: Space;
  entities: Entity[];
  edges: Edge[];
  filteredEntities: Entity[];
  filteredEdges: Edge[];
  cycles: Cycle[];
  propositions: Proposition[];
  novelConnections: NovelConnection[];
  contradictions: Contradiction[];
  scenarios: Scenario[];
  actionItems: ActionItem[];
  bridges: Bridge[];
  domainMap: Record<string, { name: string; index: number }>;
  entityMap: Map<string, Entity>;
  leveragePoints: Entity[];
  // Graph interaction
  visibleDimensions: Set<string>;
  onToggleDimension: (dim: string) => void;
  showExternal: boolean;
  onToggleExternal?: () => void;
  showSiblings: boolean;
  onToggleSiblings: () => void;
  activeDomains: Set<string>;
  onToggleDomain: (spaceId: string) => void;
  hasSiblings: boolean;
  hasBridges: boolean;
  onNodeClick: (entity: Entity) => void;
  // Reasoning
  activeOp: ReasoningOp | null;
  reasoningLoading: boolean;
  onRunReasoning: (op: ReasoningOp, params?: Record<string, string>) => void;
  onClearResults: () => void;
  reasoningResult: unknown;
  reasoningError: string | null;
  selectedEntity: Entity | null;
  // Goals
  activeGoal: ImprovementGoal | null;
  goals: ImprovementGoal[];
  childGoals?: ImprovementGoal[];
  onAcceptObjective?: (objective: SuggestedObjective) => void | Promise<void>;
  onCreateSubSpace?: (goalId: string) => void;
  onNavigateToSpace?: (spaceId: string) => void;
  onBreakDownGoal?: (goalId: string) => void;
  onGoalClick?: (goal: ImprovementGoal) => void;
  // Refresh callback — triggers router.refresh() to reload server data
  onRefresh?: () => void;
  // Deep refresh handle — lifted from SpaceLayout so header + grid share state
  deepRefresh: DeepRefreshHandle;
  // Claims for evidence density in inventory
  claims?: Array<{ id: string; source_entity_id: string | null }>;
}

export function DashboardGrid({
  space,
  entities,
  edges,
  filteredEntities,
  filteredEdges,
  cycles,
  propositions,
  novelConnections,
  contradictions,
  scenarios,
  actionItems,
  bridges,
  domainMap,
  entityMap,
  leveragePoints,
  visibleDimensions,
  onToggleDimension,
  showExternal,
  onToggleExternal,
  showSiblings,
  onToggleSiblings,
  activeDomains,
  onToggleDomain,
  hasSiblings,
  hasBridges,
  onNodeClick,
  activeOp,
  reasoningLoading,
  onRunReasoning,
  onClearResults,
  reasoningResult,
  reasoningError,
  selectedEntity,
  activeGoal,
  goals,
  childGoals = [],
  onAcceptObjective,
  onCreateSubSpace,
  onNavigateToSpace,
  onBreakDownGoal,
  onGoalClick,
  onRefresh,
  deepRefresh,
  claims = [],
}: DashboardGridProps) {
  const hasSynthesis = !!space.synthesis_data;

  // Parse synthesis data and strategic recommendation
  const parsedSynthData = (() => {
    if (!space.synthesis_data) return null;
    try {
      return (typeof space.synthesis_data === "string"
        ? JSON.parse(space.synthesis_data)
        : space.synthesis_data) as SynthesisData;
    } catch {
      return null;
    }
  })();

  const strategicRecData = parsedSynthData?.strategic_recommendation as StrategicRecommendationData | undefined;
  const strategicRec = strategicRecData?.recommendation ?? null;

  // Extract decomposition quality data from synthesis_data
  const decompositionQuality = useMemo<DecompositionQualityData | null>(() => {
    if (!parsedSynthData) return null;
    const sd = parsedSynthData as unknown as Record<string, unknown>;
    return (sd.decomposition_quality as DecompositionQualityData) ?? null;
  }, [parsedSynthData]);

  // Extract epistemic classification from synthesis_data (Phase 8)
  const epistemicClassification = useMemo<EpistemicClassification | null>(() => {
    if (!parsedSynthData) return null;
    const sd = parsedSynthData as unknown as Record<string, unknown>;
    return (sd.epistemic_classification as EpistemicClassification) ?? null;
  }, [parsedSynthData]);

  // Extract interaction metadata from synthesis_data for graph overlays
  const interactionMetadata = useMemo<InteractionMetadata | null>(() => {
    if (!parsedSynthData) return null;
    const sd = parsedSynthData as unknown as Record<string, unknown>;
    const raw = sd.interaction_metadata;
    if (!raw || typeof raw !== "object") return null;
    return raw as InteractionMetadata;
  }, [parsedSynthData]);

  // Objective auto-detection: triggers when synthesis exists but objectives are missing
  const objectiveAuto = useObjectiveAuto(space);
  const suggestedObjectives = objectiveAuto.suggestedObjectives;

  // Build entity map for strategy module entity references
  const entityMapForStrategy = new Map<string, Entity>();
  for (const e of entities) {
    entityMapForStrategy.set(e.entity_id, e);
  }

  // Strategy lifecycle management
  const strategyAuto = useStrategyAuto(space);

  // Fetch goal recommendations when an active goal exists
  const [goalRecommendations, setGoalRecommendations] = useState<GoalRecommendation[]>([]);
  useEffect(() => {
    if (!activeGoal) { setGoalRecommendations([]); return; }
    let cancelled = false;
    fetch(`/api/goals/${activeGoal.id}/recommendations`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (!cancelled && data?.recommendations) setGoalRecommendations(data.recommendations); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeGoal]);

  // Fetch goal progress time-series for trajectory chart
  const [goalProgress, setGoalProgress] = useState<GoalProgress[]>([]);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [progressRefreshKey, setProgressRefreshKey] = useState(0);
  useEffect(() => {
    if (!activeGoal) { setGoalProgress([]); return; }
    let cancelled = false;
    fetch(`/api/goals/${activeGoal.id}/progress`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (!cancelled && data?.progress) setGoalProgress(data.progress); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeGoal, progressRefreshKey]);

  // Extract active goal's benchmark from synthesis_data (stored as dynamic JSONB field)
  const activeBenchmark = useMemo<ObjectiveBenchmark | null>(() => {
    if (!activeGoal || !parsedSynthData) return null;
    const sd = parsedSynthData as unknown as Record<string, unknown>;
    const benchmarks = sd.goal_benchmarks as Record<string, ObjectiveBenchmark> | undefined;
    if (!benchmarks) return null;
    return benchmarks[activeGoal.id] ?? null;
  }, [activeGoal, parsedSynthData]);

  // Outcome recording handler — PATCHes to backend, returns refinement signals
  const handleRecordOutcome = async (recId: string, goalId: string, outcome: "effective" | "partial" | "ineffective", notes: string) => {
    const res = await fetch(`/api/goals/${goalId}/recommendations/${recId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome, outcome_notes: notes }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Update local goalRecommendations state with the new outcome
    setGoalRecommendations((prev) =>
      prev.map((r) => r.id === recId ? { ...r, outcome: data.outcome, outcome_notes: data.outcome_notes, outcome_recorded_at: data.outcome_recorded_at } : r)
    );
    return data as { refinement_signals?: Array<{ entity_id: string; recommendation: string; reason: string }> };
  };

  // Re-synthesis trigger — calls the synthesize pipeline endpoint, then refreshes dashboard
  const [resynthesizing, setResynthesizing] = useState(false);
  const handleTriggerResynthesize = async () => {
    if (resynthesizing) return;
    setResynthesizing(true);
    try {
      const res = await fetch(`/api/pipeline/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceIds: [space.id] }),
      });
      if (res.ok) {
        onRefresh?.();
      }
    } catch {
      // Swallow — user can retry
    } finally {
      setResynthesizing(false);
    }
  };


  // Action item completion toggle — PATCHes to backend
  const handleToggleActionDone = (actionId: string, done: boolean) => {
    fetch(`/api/action-items/${actionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: done ? "completed" : "pending" }),
    }).catch(() => {});
  };

  // Bidirectional filter: TwinMacro stat clicks → Inventory highlight
  const [inventoryHighlight, setInventoryHighlight] = useState<InventoryHighlight>(null);

  // Build section definitions for navigation
  const dashboardSections = useMemo(
    () =>
      buildDashboardSections({
        hasSynthesis,
        hasStrategy: !!strategicRec,
        hasGoal: !!activeGoal,
        hasObjectives: suggestedObjectives.length > 0,
        entityCount: entities.length,
        hasDecompositionQuality: !!decompositionQuality,
      }),
    [hasSynthesis, strategicRec, activeGoal, suggestedObjectives.length, entities.length, decompositionQuality]
  );

  return (
    <>
    <div className="flex gap-3 overflow-y-auto p-4 relative">
      {/* Floating section navigator */}
      <DashboardNav sections={dashboardSections} className="flex-shrink-0 hidden xl:flex" />

      <div className="flex flex-col gap-4 flex-1 min-w-0">

      {/* Pipeline progress bar — always visible, shows what's been done */}
      {(() => {
        const coreEntities = entities.filter((e) => e.knowledge_layer !== "external");
        const externalEntities = entities.filter((e) => e.knowledge_layer === "external");
        const hasCoreEntities = coreEntities.length > 0;
        const hasExternalEntities = externalEntities.length > 0;

        const steps = [
          {
            label: "Decomposition",
            done: hasCoreEntities,
            count: hasCoreEntities ? coreEntities.length : undefined,
            warning: !hasCoreEntities && hasExternalEntities,
            warningText: "Not run — your analysis has no core entities",
          },
          { label: "Synthesis", done: hasSynthesis },
          { label: "Strategy", done: !!strategicRec },
          {
            label: "Research",
            done: hasExternalEntities,
            count: hasExternalEntities ? externalEntities.length : undefined,
          },
          {
            label: "Objectives",
            done: (parsedSynthData as Record<string, unknown> | null)?.suggested_objectives != null || activeGoal != null,
          },
        ];

        return (
          <div className="flex items-center gap-1 rounded-lg border border-gray-100 bg-white px-3 py-2">
            {steps.map((step, i, arr) => (
              <React.Fragment key={step.label}>
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold transition-colors",
                      step.done
                        ? "bg-green-100 text-green-700"
                        : step.warning
                          ? "bg-red-100 text-red-600"
                          : "bg-gray-100 text-gray-400"
                    )}
                  >
                    {step.done ? "✓" : step.warning ? "!" : i + 1}
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-medium",
                      step.done ? "text-gray-700" : step.warning ? "text-red-600" : "text-gray-400"
                    )}
                    title={step.warning ? step.warningText : undefined}
                  >
                    {step.label}
                    {step.count != null && step.done ? ` (${step.count})` : ""}
                  </span>
                </div>
                {i < arr.length - 1 && (
                  <div className={cn("h-px w-4 flex-shrink-0", step.done ? "bg-green-200" : step.warning ? "bg-red-200" : "bg-gray-200")} />
                )}
              </React.Fragment>
            ))}

            {/* Refresh actions */}
            <div className="ml-auto flex items-center gap-1.5">
              {hasCoreEntities && !deepRefresh.isRunning && (
                <>
                  <button
                    onClick={() => deepRefresh.runDeepRefresh("standard", 1)}
                    disabled={resynthesizing}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium bg-gray-50 text-gray-500 hover:bg-violet-50 hover:text-violet-600 transition-colors"
                    title="1 enrichment pass: critique → research → synthesize"
                  >
                    <Layers className="h-3 w-3" />
                    Refresh All
                  </button>
                  <button
                    onClick={() => deepRefresh.runDeepRefresh("deep", 3)}
                    disabled={resynthesizing}
                    className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-semibold bg-violet-50 text-violet-600 hover:bg-violet-100 hover:text-violet-700 border border-violet-200 transition-colors"
                    title="3 enrichment passes: (critique → research) x3 → synthesize"
                  >
                    <Zap className="h-3 w-3" />
                    Keep Building
                  </button>
                </>
              )}
              {hasCoreEntities && deepRefresh.isRunning && (
                <div className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-semibold bg-violet-100 text-violet-500">
                  <Layers className="h-3 w-3 animate-pulse" />
                  {deepRefresh.stage === "critiquing" ? `Enriching KG (pass ${deepRefresh.currentPass}/${deepRefresh.totalPasses})...`
                   : deepRefresh.stage === "researching" ? `Researching (pass ${deepRefresh.currentPass}/${deepRefresh.totalPasses})...`
                   : deepRefresh.stage === "synthesizing" ? "Synthesizing..."
                   : "Preparing..."}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Deep Refresh Progress Panel */}
      {(deepRefresh.isRunning || (deepRefresh.stage === "complete" && deepRefresh.stageResults.length > 0)) && (() => {
        const totalEdgesAdded = deepRefresh.stageResults
          .filter((r) => r.stage === "critique" && r.status === "success")
          .reduce((sum, r) => sum + ((r.details.edgesAdded as number) ?? 0), 0);
        const totalEntitiesAdded = deepRefresh.stageResults
          .filter((r) => r.stage === "research" && r.status === "success")
          .reduce((sum, r) => sum + ((r.details.externalEntities as number) ?? 0), 0);
        const synthResult = deepRefresh.stageResults.find((r) => r.stage === "synthesize");
        const completedPasses = deepRefresh.stageResults.filter((r) => r.stage === "research").length;

        return (
          <div className={cn(
            "rounded-lg border px-3 py-2 text-[11px]",
            deepRefresh.isRunning ? "border-violet-200 bg-violet-50/50" : "border-green-200 bg-green-50/50"
          )}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-gray-700">
                {deepRefresh.isRunning
                  ? `Building complexity (pass ${deepRefresh.currentPass}/${deepRefresh.totalPasses})...`
                  : `Build complete — ${deepRefresh.totalPasses} pass${deepRefresh.totalPasses > 1 ? "es" : ""}`}
              </span>
              <div className="flex items-center gap-2">
                {deepRefresh.totalDurationMs > 0 && (
                  <span className="text-gray-400">{(deepRefresh.totalDurationMs / 1000).toFixed(1)}s</span>
                )}
                {deepRefresh.stage === "complete" && (
                  <button onClick={deepRefresh.reset} className="text-gray-400 hover:text-gray-600">Dismiss</button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <div className={cn("h-4 w-4 rounded-full flex items-center justify-center text-[8px] font-bold", totalEdgesAdded > 0 ? "bg-green-200 text-green-700" : deepRefresh.stage === "critiquing" ? "bg-violet-200 text-violet-600 animate-pulse" : "bg-gray-200 text-gray-400")}>
                  {totalEdgesAdded > 0 ? "✓" : deepRefresh.stage === "critiquing" ? "..." : "1"}
                </div>
                <span className={cn("font-medium", totalEdgesAdded > 0 ? "text-green-700" : deepRefresh.stage === "critiquing" ? "text-violet-600" : "text-gray-400")}>Enrich KG</span>
                {totalEdgesAdded > 0 && <span className="text-gray-400">+{totalEdgesAdded} edges</span>}
              </div>
              <div className="h-px w-3 bg-gray-300" />
              <div className="flex items-center gap-1">
                <div className={cn("h-4 w-4 rounded-full flex items-center justify-center text-[8px] font-bold", totalEntitiesAdded > 0 ? "bg-green-200 text-green-700" : deepRefresh.stage === "researching" ? "bg-violet-200 text-violet-600 animate-pulse" : "bg-gray-200 text-gray-400")}>
                  {totalEntitiesAdded > 0 ? "✓" : deepRefresh.stage === "researching" ? "..." : "2"}
                </div>
                <span className={cn("font-medium", totalEntitiesAdded > 0 ? "text-green-700" : deepRefresh.stage === "researching" ? "text-violet-600" : "text-gray-400")}>Research</span>
                {totalEntitiesAdded > 0 && <span className="text-gray-400">+{totalEntitiesAdded} entities</span>}
              </div>
              <div className="h-px w-3 bg-gray-300" />
              <div className="flex items-center gap-1">
                <div className={cn("h-4 w-4 rounded-full flex items-center justify-center text-[8px] font-bold", synthResult?.status === "success" ? "bg-green-200 text-green-700" : deepRefresh.stage === "synthesizing" ? "bg-violet-200 text-violet-600 animate-pulse" : "bg-gray-200 text-gray-400")}>
                  {synthResult?.status === "success" ? "✓" : deepRefresh.stage === "synthesizing" ? "..." : "3"}
                </div>
                <span className={cn("font-medium", synthResult?.status === "success" ? "text-green-700" : deepRefresh.stage === "synthesizing" ? "text-violet-600" : "text-gray-400")}>Synthesize</span>
                {synthResult?.status === "success" && synthResult.details.qualityScore != null && (
                  <span className="text-gray-400">q:{String(synthResult.details.qualityScore)}</span>
                )}
              </div>
            </div>
            {deepRefresh.totalPasses > 1 && (
              <div className="mt-1.5 flex items-center gap-1">
                <span className="text-[9px] text-gray-400 mr-1">Passes:</span>
                {Array.from({ length: deepRefresh.totalPasses }).map((_, i) => (
                  <div key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i < completedPasses ? "bg-violet-400" : i === completedPasses && deepRefresh.isRunning ? "bg-violet-200 animate-pulse" : "bg-gray-200")} />
                ))}
              </div>
            )}
            {deepRefresh.error && <p className="mt-1 text-red-500 text-[10px]">{deepRefresh.error}</p>}
          </div>
        );
      })()}

      {/* Mobile section jump bar */}
      {hasSynthesis && (
        <div className="flex xl:hidden gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
          {dashboardSections
            .filter((s) => s.available)
            .map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  const el = document.getElementById(s.id);
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="flex items-center gap-1 whitespace-nowrap rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors flex-shrink-0"
              >
                {s.icon}
                {s.label}
              </button>
            ))}
        </div>
      )}


      {/* ═══════════════════════════════════════════════════════════════════
          Arc 5.5 — Visibility boosters (tracking pulse, first-principles
          strip, change proposals banner). Rendered above the rest of the
          dashboard so the user immediately sees:
            • what they're tracking (from strategy confirm)
            • the first-principles reasoning grounding their strategy
            • pending strategy updates that otherwise hide on /strategy
          Each module self-hides when its data is empty, so this whole
          block is a no-op on fresh / pre-synthesis dashboards.
          ═══════════════════════════════════════════════════════════════════ */}
      {hasSynthesis && (
        <div className="flex flex-col gap-3">
          {/* Arc 5C.2 / P0.2 — Intake review CTA. Shown only when a strategy
              has been generated but not yet confirmed. Navigates the user
              to the 4-step review wizard instead of the old "confirm inline"
              button, so they get agency over metrics, apps, and tactics
              before materialization. */}
          {strategicRec && strategicRecData?.status !== "confirmed" && (
            <Link
              href={`/app/space/${space.id}/intake-review`}
              className="group flex items-center gap-3 rounded-2xl bg-gradient-to-r from-indigo-50/70 via-white/80 to-indigo-50/50 backdrop-blur-xl ring-1 ring-indigo-200/70 hover:ring-indigo-300 shadow-[0_1px_3px_rgba(15,23,42,0.04)] px-4 py-3 transition-all duration-150"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 ring-1 ring-indigo-200 flex-shrink-0">
                <Target className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-indigo-700">
                  Intake review · 4 steps
                </div>
                <div className="text-[13px] font-semibold text-slate-900">
                  Strategy ready. Review metrics, apps, and tactics before committing.
                </div>
                <div className="mt-0.5 text-[10.5px] text-slate-500">
                  Toggle what gets created. Nothing materializes until you confirm.
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 text-indigo-700 ring-1 ring-indigo-200 px-3 py-1.5 text-[11px] font-semibold group-hover:bg-indigo-500 group-hover:text-white group-hover:ring-indigo-500 transition-colors duration-150 flex-shrink-0">
                Review →
              </span>
            </Link>
          )}
          <DashboardChangeProposalsBanner
            spaceId={space.id}
            proposals={strategicRecData?.change_proposals}
          />
          <FirstPrinciplesPulse
            spaceId={space.id}
            axioms={
              (parsedSynthData as unknown as { axioms?: FPPAxiom[] } | null)?.axioms ?? null
            }
            convergences={
              (parsedSynthData as unknown as { insight_convergences?: FPPConvergence[] } | null)?.insight_convergences ?? null
            }
            coverage={
              (parsedSynthData as unknown as { strategy_coverage?: FPPStrategyCoverage } | null)?.strategy_coverage ?? null
            }
            strategyProvenance={
              (strategicRec as unknown as { provenance?: FPPStrategyProvenance } | null)?.provenance ?? null
            }
          />
          <TrackingPulseModule
            spaceId={space.id}
            visible={!!strategicRec}
          />
        </div>
      )}

      {/* Pre-synthesis guide */}
      {!hasSynthesis && entities.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 flex-shrink-0">
              <Zap className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-amber-900">Ready to unlock your full dashboard</h3>
              <p className="mt-1 text-xs text-amber-700 leading-relaxed">
                You have {entities.length} entities mapped. Run synthesis to unlock <strong>12 additional sections</strong>: Objectives, Intelligence Radar, Strategy, Bottleneck Analysis, Leverage Points, Risk Assessment, Feedback Loops, Scenarios, Action Plans, and more.
              </p>
              <p className="mt-2 text-[10px] text-amber-600">
                Use the chat to continue adding context, or type <kbd className="rounded bg-amber-100 px-1 py-0.5 font-mono text-amber-800">/synthesize</kbd> when ready.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          ROW 1: Main Objective + Overview (full width)
          ═══════════════════════════════════════════════════════════════════ */}
      <div id="section-objectives">
        {hasSynthesis ? (
          <ObjectivesDecompositionShell
            primaryGoal={activeGoal}
            allGoals={goals}
            suggestedObjectives={suggestedObjectives}
            onAccept={onAcceptObjective ?? (() => {})}
            onDecompose={onBreakDownGoal ?? (() => {})}
            onCreateSubSpace={onCreateSubSpace ?? (() => {})}
            onNavigateToSpace={onNavigateToSpace ?? (() => {})}
            onGoalClick={onGoalClick ?? (() => {})}
            variant="full"
            initiallyExpanded={false}
          />
        ) : (
          <LockedModuleCard
            id=""
            icon={<Target className="h-4 w-4" />}
            title="Detected Objectives"
            description="AI-detected objectives organized as a decomposition tree."
            unlockAction="Run synthesis to auto-detect objectives"
          />
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ROW 2: KG Multiview | Probability Spaces | Digital Twin  (3 cols)
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Col 1: Knowledge Graph + Layers */}
        <div className="flex flex-col gap-4" id="section-graph">
          <GraphModule
            space={space}
            filteredEntities={filteredEntities}
            filteredEdges={filteredEdges}
            cycles={cycles}
            visibleDimensions={visibleDimensions}
            onToggleDimension={onToggleDimension}
            showExternal={showExternal}
            onToggleExternal={onToggleExternal}
            showSiblings={showSiblings}
            onToggleSiblings={onToggleSiblings}
            activeDomains={activeDomains}
            onToggleDomain={onToggleDomain}
            hasSiblings={hasSiblings}
            hasBridges={hasBridges}
            domainMap={domainMap}
            bridges={bridges}
            onNodeClick={onNodeClick}
            activeOp={activeOp}
            reasoningLoading={reasoningLoading}
            onRunReasoning={onRunReasoning}
            onClearResults={onClearResults}
            selectedEntity={selectedEntity}
            entities={entities}
            leveragePoints={leveragePoints}
            entityMap={entityMap}
            reasoningResult={reasoningResult}
            reasoningError={reasoningError}
            interactionMetadata={interactionMetadata}
          />
          {/* Multi-Layer Knowledge Graph — inline below graph */}
          {hasSynthesis && entities.length >= 5 && (
            <div id="section-layers">
              <MultiLayerGraph
                entities={entities}
                edges={edges}
                cycles={cycles}
                synthesisData={parsedSynthData}
                onEntityClick={onNodeClick}
              />
            </div>
          )}
        </div>

        {/* Col 2: Probability Spaces + Metrics */}
        <div className="flex flex-col gap-4">
          <div id="section-probability">
            {hasSynthesis ? (
              <ProbabilitySpaceModule
                space={space}
                entities={entities}
                edges={edges}
                onRefresh={onRefresh}
                dashboardContext={{
                  goals: goals.map((g) => ({
                    id: g.id,
                    title: g.title,
                    status: g.status,
                    metric_name: g.metric_name,
                    current_value: g.current_value,
                    target_value: g.target_value,
                  })),
                  leveragePoints: leveragePoints.map((lp) => ({
                    name: lp.name,
                    entity_id: lp.entity_id,
                  })),
                  actionItems: actionItems.map((ai) => ({
                    title: ai.action_text,
                    status: ai.status,
                  })),
                  synthesisText: typeof space.synthesis_text === "string" ? space.synthesis_text?.slice(0, 500) : undefined,
                }}
              />
            ) : (
              <LockedModuleCard
                id=""
                icon={<Network className="h-4 w-4" />}
                title="Probability Space Intelligence"
                description="System-wide failure analysis, critical path weaknesses, and cross-domain intersections."
                unlockAction="Run synthesis and expansion to populate"
              />
            )}
          </div>
          {/* Manifold + Temporal Health — compact metrics in this column */}
          {hasSynthesis && (
            <div id="section-manifold">
              <ManifoldOverviewModule entities={entities} />
            </div>
          )}
          <div id="section-temporal">
            <TemporalHealthModule edges={edges} entities={entities} />
          </div>
          <div id="section-expansion">
            <ExpansionSummaryModule entities={entities} space={space} />
          </div>
        </div>

        {/* Col 3: Digital Twin + Dashboard Settings (collapsed) */}
        <div className="flex flex-col gap-4">
          {entities.length >= 3 && (
            <div id="section-mechanism-map">
              <DigitalTwinFlowchart
                entities={entities}
                edges={edges}
                cycles={cycles}
                synthesisData={parsedSynthData}
                activeGoal={activeGoal}
                onEntityClick={onNodeClick}
              />
            </div>
          )}
          {/* Dashboard Settings — collapsed card combining Goal, Quality, Mechanisms */}
          <div id="section-twin">
            <DashboardCard
              title="Dashboard Settings"
              icon={<Settings className="h-4 w-4" />}
              subtitle="Goal tracking, analysis quality, system mechanisms"
              defaultExpanded={false}
            >
              <div className="space-y-4">
                <GoalProgressCenter
                  space={space}
                  entities={entities}
                  edges={edges}
                  cycles={cycles}
                  activeGoal={activeGoal}
                  goalProgress={goalProgress}
                  recommendations={goalRecommendations}
                  benchmark={activeBenchmark}
                  onDetectObjectives={objectiveAuto.detectObjectives}
                  onRecordProgress={() => setShowProgressModal(true)}
                  objectiveAutoLoading={objectiveAuto.loading}
                />
                {hasSynthesis && (
                  <div id="section-mechanisms">
                    <MechanismIntelligenceModule
                      space={space}
                      entities={entities}
                      edges={edges}
                      synthesisData={parsedSynthData}
                      onEntityClick={onNodeClick}
                    />
                  </div>
                )}
              </div>
            </DashboardCard>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ROW 3: Entity Inventory | #1 Recommendation  (2 cols)
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div id="section-inventory">
          <InventoryModule
            entities={entities}
            edges={edges}
            cycles={cycles}
            space={space}
            claims={claims}
            onEntityClick={onNodeClick}
            highlight={inventoryHighlight}
            onClearHighlight={() => setInventoryHighlight(null)}
          />
        </div>

        <div id="section-strategy">
          {process.env.NEXT_PUBLIC_STRATEGY_V1_FALLBACK === "1" && strategicRec ? (
            <StrategyRecommendationModule
              recommendation={strategicRec}
              entityMap={entityMapForStrategy}
              onTacticClick={(tactic: MicroTactic) => {
                const entity = entities.find((e) => e.entity_id === tactic.entity_id);
                if (entity) onNodeClick(entity);
              }}
              synthData={parsedSynthData}
              entities={entities}
              cycles={cycles}
              scenarios={scenarios}
              rankedStrategies={strategyAuto.rankedStrategies}
              strategyStatus={strategyAuto.status}
              changeProposals={strategicRecData?.change_proposals}
              suggestedObjectives={suggestedObjectives}
              activeGoal={activeGoal}
              goalRecommendations={goalRecommendations}
              onConfirm={strategyAuto.confirmStrategy}
              onSelectAlternative={strategyAuto.selectAlternative}
              onGenerateStrategy={strategyAuto.generateStrategy}
              strategyLoading={strategyAuto.loading}
              onRecordOutcome={handleRecordOutcome}
              onTriggerResynthesize={handleTriggerResynthesize}
              reasoningTrace={strategicRecData?.reasoning_trace}
              probabilitySpaceSummary={strategicRecData?.probability_space_summary}
              spaceId={space.id}
            />
          ) : strategicRec ? (
            <StrategyCompactCard />
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
              {strategyAuto.needsGeneration ? (
                <div className="space-y-3">
                  <Trophy className="h-8 w-8 text-amber-400 mx-auto" />
                  <p className="text-sm font-medium text-gray-700">Synthesis complete — ready to generate strategy</p>
                  <p className="text-xs text-gray-500">Generate ranked strategic recommendations with infrastructure proposals</p>
                  <button
                    onClick={() => { void strategyAuto.generateStrategy(); }}
                    disabled={strategyAuto.loading}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-interaxis-600 px-4 py-2 text-sm font-semibold text-white hover:bg-interaxis-700 transition-colors disabled:opacity-50"
                  >
                    {strategyAuto.loading ? (
                      <><RefreshCw className="h-4 w-4 animate-spin" /> Generating...</>
                    ) : (
                      <><Zap className="h-4 w-4" /> Generate Strategy</>
                    )}
                  </button>
                  {strategyAuto.error && <p className="text-xs text-red-500">{strategyAuto.error}</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  <Trophy className="h-8 w-8 text-gray-300 mx-auto" />
                  <p className="text-sm text-gray-500">Strategic recommendation will appear after synthesis</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ROW 4: Intelligence Radar | Insights  (2 cols, full width)
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div id="section-radar">
          {hasSynthesis ? (
            <IntelligenceRadarModule
              space={space}
              entities={entities}
              edges={edges}
            />
          ) : (
            <LockedModuleCard
              id=""
              icon={<Radar className="h-4 w-4" />}
              title="Intelligence Radar"
              description="External landscape mapping — competitors, frameworks, precedents, and market signals."
              unlockAction="Run synthesis, then research to populate"
            />
          )}
        </div>

        {/* Insights — unified: Analysis Intelligence, Open Questions, Discovered Connections, Domain Expertise */}
        <div id="section-insights">
          {hasSynthesis ? (
            <SynthesisModules
              space={space}
              entities={entities}
              cycles={cycles}
              novelConnections={novelConnections}
              contradictions={contradictions}
              scenarios={scenarios}
              actionItems={actionItems}
              propositions={propositions}
              bridges={bridges}
              domainMap={domainMap}
              hasStrategy={!!strategicRec}
              onToggleActionDone={handleToggleActionDone}
              insightsOnly
            />
          ) : (
            <LockedModuleCard
              id=""
              icon={<BookOpen className="h-4 w-4" />}
              title="Insights"
              description="Analysis intelligence, open questions, discovered connections, and domain expertise."
              unlockAction="Run synthesis to unlock"
            />
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ROW 5: Strategy Analysis sections (full width, scrollable)
          Bottleneck, Leverage, Risks, Feedback Loops, Scenarios, Actions
          ═══════════════════════════════════════════════════════════════════ */}
      {hasSynthesis ? (
        <SynthesisModules
          space={space}
          entities={entities}
          cycles={cycles}
          novelConnections={novelConnections}
          contradictions={contradictions}
          scenarios={scenarios}
          actionItems={actionItems}
          propositions={propositions}
          bridges={bridges}
          domainMap={domainMap}
          hasStrategy={!!strategicRec}
          onToggleActionDone={handleToggleActionDone}
          strategyOnly
        />
      ) : entities.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <LockedModuleCard
            id="section-bottleneck"
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Bottleneck Analysis"
            description="Identifies the single highest-impact constraint blocking your system"
            unlockAction="Run synthesis to unlock"
          />
          <LockedModuleCard
            id="section-leverage"
            icon={<ArrowUpRight className="h-4 w-4" />}
            title="Leverage Points"
            description="Top 3 points where small changes produce outsized results"
            unlockAction="Run synthesis to unlock"
          />
          <LockedModuleCard
            id="section-risks"
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Risk Assessment"
            description="Critical risks with blast radius analysis and mitigation paths"
            unlockAction="Run synthesis to unlock"
          />
          <LockedModuleCard
            id="section-loops"
            icon={<RefreshCw className="h-4 w-4" />}
            title="Feedback Loops"
            description="Reinforcing and balancing loops driving system dynamics"
            unlockAction="Run synthesis to unlock"
          />
          <LockedModuleCard
            id="section-scenarios"
            icon={<BarChart3 className="h-4 w-4" />}
            title="Scenarios"
            description="2-3 projected outcomes with probabilities and conditions"
            unlockAction="Run synthesis to unlock"
          />
          <LockedModuleCard
            id="section-actions"
            icon={<ListChecks className="h-4 w-4" />}
            title="Action Plan"
            description="Role-adapted action paths across 4 timeframes with cost-of-delay"
            unlockAction="Run synthesis to unlock"
          />
        </div>
      ) : null}

      {/* Decomposition Quality + Epistemic (collapsible, at bottom) */}
      {(decompositionQuality || epistemicClassification) && (
        <div className="flex flex-col gap-4">
          {decompositionQuality && (
            <div id="section-decomp-quality">
              <DecompositionQualityModule qualityData={decompositionQuality} />
            </div>
          )}
          {epistemicClassification && (
            <div id="section-epistemic-classification">
              <EpistemicClassificationModule classification={epistemicClassification} />
            </div>
          )}
        </div>
      )}

      </div>
    </div>

    {/* Progress Recording Modal */}
    {showProgressModal && activeGoal && (
      <ProgressRecordingModal
        goal={activeGoal}
        onClose={() => setShowProgressModal(false)}
        onSuccess={() => {
          setProgressRefreshKey((k) => k + 1);
          setShowProgressModal(false);
        }}
      />
    )}
    </>
  );
}
