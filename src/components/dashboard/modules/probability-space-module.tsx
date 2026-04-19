"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Network,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Link2,
  Layers,
  BrainCircuit,
} from "lucide-react";
import type { Space, Entity, Edge } from "@/types";
import type {
  ProbabilitySpace,
  SpaceIntersection,
  FailurePoint,
} from "@/types/probability-space";
import type {
  DiscoveredEdge,
  RiskFlag,
  IntelligenceSummary,
} from "@/lib/pipeline/intelligence-feedback";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import {
  ProbabilitySpacePanel,
  IntersectionCard,
  ProbabilitySpacesSection,
} from "@/components/intelligence/probability-space-panel";
import { buildProbabilitySpacesForGraph } from "@/lib/pipeline/probability-space-engine";
import { detectIntersections } from "@/lib/pipeline/intersection-detector";
import { analyzePathways, type PathwayAnalysis } from "@/lib/pipeline/pathway-analyzer";
import { enrichTopIntersectionInsights } from "@/lib/pipeline/intersection-insights";
import { createClient } from "@/lib/supabase/client";

// ── Types ──

interface DashboardContext {
  goals?: Array<{ id: string; title: string; status: string; metric_name: string; current_value: number; target_value: number }>;
  leveragePoints?: Array<{ name: string; entity_id: string }>;
  actionItems?: Array<{ title: string; status: string }>;
  synthesisText?: string;
}

interface ProbabilitySpaceModuleProps {
  space: Space;
  entities: Entity[];
  edges: Edge[];
  onRefresh?: () => void;
  /** Dashboard context for strategic interpretation */
  dashboardContext?: DashboardContext;
  /** Pre-computed probability spaces from strategy-refresh (avoids re-running the pipeline) */
  persistedSpaces?: ProbabilitySpace[];
  /** Pre-computed space intersections from strategy-refresh */
  persistedIntersections?: SpaceIntersection[];
}

interface SystemMetrics {
  totalSpaces: number;
  avgPathwayProbability: number;
  totalFailurePoints: number;
  totalIntersections: number;
  highPotentialIntersections: number;
  richSpaces: number; // spaces with >3 nodes (not shallow synthetic)
}

interface IntelligenceFeedbackState {
  discovered_edges: DiscoveredEdge[];
  risk_flags: RiskFlag[];
  summary: IntelligenceSummary;
  edges_materialized: number;
  novel_connections_stored: number;
}

type PipelineStep =
  | "idle"
  | "expanding"
  | "materializing"
  | "computing_spaces"
  | "detecting_intersections"
  | "analyzing_pathways"
  | "materializing_discoveries"
  | "complete";

interface PipelineProgress {
  step: PipelineStep;
  detail: string;
  entitiesExpanded: number;
  entitiesTotal: number;
  expansionsMaterialized: number;
  spacesComputed: number;
  intersectionsFound: number;
  discoveryEdgesCreated: number;
}

// BlastRadius / RiskBucket removed — risk info integrated into pathway cards

// ── Helpers ──

function computeMetrics(
  spaces: ProbabilitySpace[],
  intersections: SpaceIntersection[]
): SystemMetrics {
  const totalSpaces = spaces.length;
  const avgPathwayProbability =
    totalSpaces > 0
      ? spaces.reduce((sum, s) => sum + s.total_pathway_probability, 0) / totalSpaces
      : 0;
  const totalFailurePoints = spaces.reduce(
    (sum, s) => sum + s.failure_points.length,
    0
  );
  const highPotentialIntersections = intersections.filter(
    (i) => i.innovation_potential === "high"
  ).length;
  const richSpaces = spaces.filter((s) => s.nodes.length > 3).length;

  return {
    totalSpaces,
    avgPathwayProbability,
    totalFailurePoints,
    totalIntersections: intersections.length,
    highPotentialIntersections,
    richSpaces,
  };
}

// groupFailurePoints and getWeakestEdges removed — no longer needed

function isTrivialSyntheticSpace(space: ProbabilitySpace): boolean {
  return space.id.startsWith("synth_") && space.nodes.length <= 3;
}

function isWeakIntersection(intersection: SpaceIntersection): boolean {
  const bestSimilarity = intersection.shared_nodes.reduce(
    (max, sn) => Math.max(max, sn.similarity ?? 0),
    0
  );
  return bestSimilarity < 0.7;
}

// hasLowGroundingCriticalPath removed — no longer needed

// RADIUS_CONFIG and probBg removed — no longer needed

const STEP_LABELS: Record<PipelineStep, string> = {
  idle: "",
  expanding: "Expanding entities — building internal sub-components...",
  materializing: "Materializing expansions into graph...",
  computing_spaces: "Computing probability spaces across connections...",
  detecting_intersections: "Detecting cross-space intersections...",
  analyzing_pathways: "Analyzing pathways — generating insights...",
  materializing_discoveries: "Materializing discovered connections...",
  complete: "Pipeline complete",
};

// ── Strategic Insight Generation ──

interface SystemInsight {
  headline: string;
  body: string;
  severity: "critical" | "warning" | "info";
}

function generateSystemInsights(
  spaces: ProbabilitySpace[],
  intersections: SpaceIntersection[],
  metrics: SystemMetrics,
  ctx?: DashboardContext
): SystemInsight[] {
  const insights: SystemInsight[] = [];

  // Insight 1: Novel multi-hop pathways discovered
  const richSpaces = spaces.filter((s) => s.nodes.length > 3 && s.total_pathway_probability > 0);
  if (richSpaces.length > 0) {
    const deepest = richSpaces.sort((a, b) => b.nodes.length - a.nodes.length)[0];
    insights.push({
      headline: `${richSpaces.length} multi-step influence pathway${richSpaces.length > 1 ? "s" : ""} mapped`,
      body: `Your system's deepest pathway connects ${deepest.source_entity_name} to ${deepest.target_entity_name} through ${deepest.nodes.length} intermediate factors. These hidden influence chains reveal how changes propagate through your landscape.`,
      severity: "info",
    });
  }

  // Insight 2: Intersection opportunities — the highest-value discoveries
  const highPotential = intersections.filter((i) => i.innovation_potential === "high");
  if (highPotential.length > 0) {
    const topInt = highPotential[0];
    const sharedNames = topInt.shared_nodes.slice(0, 2).map((n) => n.name).join(", ");
    insights.push({
      headline: `${highPotential.length} compounding opportunity${highPotential.length > 1 ? "ies" : "y"} — shared leverage across pathways`,
      body: `Shared factors bridge separate parts of your system. The strongest: "${sharedNames}" connects ${topInt.space_a_label} with ${topInt.space_b_label}. A single intervention here could influence multiple outcomes simultaneously.`,
      severity: "info",
    });
  }

  // Insight 3: Systemic risk concentration (keep — this is a genuine strategic insight)
  if (metrics.totalFailurePoints > 0) {
    const systemicFPs = spaces.flatMap((s) => s.failure_points.filter((fp) => fp.blast_radius === "systemic"));
    if (systemicFPs.length > 0) {
      insights.push({
        headline: `${systemicFPs.length} cascading risk${systemicFPs.length > 1 ? "s" : ""} — ${systemicFPs.slice(0, 2).map((fp) => fp.node_name).join(", ")}`,
        body: `These factors can cascade across multiple pathways if disrupted. They represent structural vulnerabilities in your system that should inform contingency planning.`,
        severity: "warning",
      });
    }
  }

  // Insight 4: Leverage point pathway quality
  if (ctx?.leveragePoints && ctx.leveragePoints.length > 0) {
    const leverageInSpaces = spaces.filter((s) =>
      ctx.leveragePoints!.some(
        (lp) =>
          lp.name.toLowerCase() === s.source_entity_name.toLowerCase() ||
          lp.name.toLowerCase() === s.target_entity_name.toLowerCase()
      )
    );
    if (leverageInSpaces.length > 0) {
      const richLeverage = leverageInSpaces.filter((s) => s.nodes.length > 2);
      if (richLeverage.length > 0) {
        insights.push({
          headline: `${richLeverage.length} leverage point${richLeverage.length > 1 ? "s" : ""} with mapped influence chains`,
          body: `These leverage points have detailed pathway structure showing exactly how interventions propagate through your system. Use these to prioritize where to focus effort.`,
          severity: "info",
        });
      }
    }
  }

  // Insight 5: Goal-connected pathways
  if (ctx?.goals && ctx.goals.filter((g) => g.status === "active").length > 0) {
    const activeGoals = ctx.goals.filter((g) => g.status === "active");
    const goalConnected = spaces.filter((s) =>
      activeGoals.some(
        (g) =>
          g.title.toLowerCase().includes(s.source_entity_name.toLowerCase().split(" ")[0]) ||
          g.title.toLowerCase().includes(s.target_entity_name.toLowerCase().split(" ")[0])
      )
    );
    if (goalConnected.length > 0) {
      insights.push({
        headline: `${goalConnected.length} pathway${goalConnected.length > 1 ? "s" : ""} directly connected to active goals`,
        body: `These pathways map the structural connections between your goals and the factors that influence them. Monitor the intermediate factors as leading indicators.`,
        severity: "info",
      });
    }
  }

  return insights;
}

// ── Component ──

export function ProbabilitySpaceModule({
  space,
  entities,
  edges,
  onRefresh,
  dashboardContext,
  persistedSpaces,
  persistedIntersections,
}: ProbabilitySpaceModuleProps) {
  // Core state
  const [computed, setComputed] = useState(false);
  const [spaces, setSpaces] = useState<ProbabilitySpace[]>([]);
  const [intersections, setIntersections] = useState<SpaceIntersection[]>([]);
  const [pathwayAnalyses, setPathwayAnalyses] = useState<PathwayAnalysis[]>([]);
  const [expandedSpaceEdgeId, setExpandedSpaceEdgeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const expandedPanelRef = useRef<HTMLDivElement>(null);

  // Pipeline progress state
  const [progress, setProgress] = useState<PipelineProgress>({
    step: "idle",
    detail: "",
    entitiesExpanded: 0,
    entitiesTotal: 0,
    expansionsMaterialized: 0,
    spacesComputed: 0,
    intersectionsFound: 0,
    discoveryEdgesCreated: 0,
  });
  const runningRef = useRef(false);

  // Section toggle state
  // riskExpanded and weakPathsExpanded removed — sections collapsed into pathway cards
  const [intersectionsExpanded, setIntersectionsExpanded] = useState(true);
  const [allSpacesExpanded, setAllSpacesExpanded] = useState(false);
  const [discoveredExpanded, setDiscoveredExpanded] = useState(false);
  const [riskFlagsExpanded, setRiskFlagsExpanded] = useState(true);
  const [showSpeculative, setShowSpeculative] = useState(false);
  const [morePathwaysExpanded, setMorePathwaysExpanded] = useState(false);

  // Intelligence feedback state
  const [feedbackResult, setFeedbackResult] = useState<IntelligenceFeedbackState | null>(null);

  // Hydrate from persisted spaces (computed during strategy-refresh) on mount
  // Falls back to manual "Run Deep Analysis" button if no persisted data exists
  useEffect(() => {
    if (!computed && persistedSpaces && persistedSpaces.length > 0) {
      setSpaces(persistedSpaces);
      setIntersections(persistedIntersections ?? []);
      setComputed(true);
    }
  }, [persistedSpaces, persistedIntersections, computed]);

  const isRunning = progress.step !== "idle" && progress.step !== "complete";

  // ── Full Pipeline: Expand → Materialize → Compute → Discover ──

  const runFullPipeline = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);
    setFeedbackResult(null);

    const updateProgress = (partial: Partial<PipelineProgress>) =>
      setProgress((prev) => ({ ...prev, ...partial }));

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase = createClient() as any;

      // ── Step 1: Expand entities that lack internal structure ──
      updateProgress({ step: "expanding", detail: "Checking entity expansions..." });

      const entityIds = entities.map((e) => e.id);
      const { data: existingExpansions } = await supabase
        .from("expansions")
        .select("entity_id")
        .in("entity_id", entityIds)
        .eq("stale", false);

      const expandedSet = new Set(
        (existingExpansions ?? []).map((e: { entity_id: string }) => e.entity_id)
      );

      // Entities that need expansion — all non-external entities without expansions
      const needsExpansion = entities.filter(
        (e) => !expandedSet.has(e.id) && e.knowledge_layer !== "external"
      );

      const toExpand = needsExpansion
        .sort((a, b) => (a.centrality_rank ?? 999) - (b.centrality_rank ?? 999))
        .slice(0, 50); // Expand all accessible entities for deep micro-structure

      updateProgress({
        entitiesTotal: toExpand.length,
        detail: `Expanding ${toExpand.length} entities to build internal structure...`,
      });

      let expandedCount = 0;
      for (const entity of toExpand) {
        try {
          updateProgress({
            detail: `Expanding "${entity.name}" (${expandedCount + 1}/${toExpand.length})...`,
          });

          const res = await fetch("/api/pipeline/expand", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entity_id: entity.id, space_id: space.id }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.expansion || data.cached) {
              expandedCount++;
              updateProgress({ entitiesExpanded: expandedCount });
            }
          }
        } catch {
          // Skip individual failures — continue pipeline
        }
      }

      // ── Step 2: Materialize expansions into graph entities + edges ──
      if (expandedCount > 0) {
        updateProgress({
          step: "materializing",
          detail: "Converting internal structures into graph entities and edges...",
        });

        try {
          const matRes = await fetch("/api/pipeline/materialize-expansions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ spaceId: space.id }),
          });

          if (matRes.ok) {
            const matData = await matRes.json();
            updateProgress({
              expansionsMaterialized:
                (matData.entities_created ?? 0) + (matData.edges_created ?? 0),
              detail: `Materialized ${matData.entities_created ?? 0} entities + ${matData.edges_created ?? 0} edges`,
            });
          }
        } catch {
          // Non-critical — continue with what we have
        }
      }

      // ── Step 3: Compute probability spaces with rich data ──
      updateProgress({
        step: "computing_spaces",
        detail: "Building probability spaces from expanded entity data...",
      });

      // Re-fetch expansions (now including newly expanded ones)
      const { data: allExpansions } = await supabase
        .from("expansions")
        .select("entity_id, sub_components, internal_pathways, internal_dynamics")
        .eq("space_id", space.id)
        .eq("stale", false);

      const expansionsMap = new Map<
        string,
        { sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }
      >();
      for (const exp of allExpansions ?? []) {
        expansionsMap.set(exp.entity_id, {
          sub_components: exp.sub_components,
          internal_pathways: exp.internal_pathways,
          internal_dynamics: exp.internal_dynamics,
        });
      }

      // Also re-fetch entities and edges in case materialization added new ones
      const [freshEntRes, freshEdgRes] = await Promise.all([
        supabase.from("entities").select("*").eq("space_id", space.id),
        supabase.from("edges").select("*").eq("space_id", space.id),
      ]);
      const freshEntities = (freshEntRes.data ?? entities) as Entity[];
      const freshEdges = (freshEdgRes.data ?? edges) as Edge[];

      const computedSpaces = buildProbabilitySpacesForGraph(
        freshEdges,
        freshEntities,
        expansionsMap
      );

      updateProgress({
        spacesComputed: computedSpaces.length,
        detail: `Computed ${computedSpaces.length} probability spaces (${computedSpaces.filter((s) => s.nodes.length > 3).length} rich)`,
      });

      // ── Step 4: Detect intersections ──
      updateProgress({
        step: "detecting_intersections",
        detail: "Finding shared variables across probability spaces...",
      });

      const detected = detectIntersections(computedSpaces, freshEntities, freshEdges, 25);

      updateProgress({
        intersectionsFound: detected.length,
        detail: `Found ${detected.length} intersections (${detected.filter((d) => d.innovation_potential === "high").length} high-potential)`,
      });

      setSpaces(computedSpaces);

      // ── Step 4.5: Enrich intersection insights with LLM ──
      let enrichedIntersections = detected;
      try {
        const enrichment = await enrichTopIntersectionInsights({
          intersections: detected,
          spaces: computedSpaces,
          topN: 25,
        });
        enrichedIntersections = enrichment.intersections;
        updateProgress({
          detail: `Enriched ${enrichment.enriched_count} intersection insights`,
        });
      } catch {
        // Non-critical — keep un-enriched intersections
      }
      setIntersections(enrichedIntersections);

      // ── Step 4.5b: Analyze pathways with LLM ──
      updateProgress({
        step: "analyzing_pathways",
        detail: "Generating specific insights for top pathways...",
      });

      try {
        const analyses = await analyzePathways({
          spaces: computedSpaces,
          ctx: dashboardContext ? {
            goals: dashboardContext.goals,
            leveragePoints: dashboardContext.leveragePoints,
          } : undefined,
          maxLLMCalls: 10,
        });
        setPathwayAnalyses(analyses);
        updateProgress({
          detail: `Analyzed ${analyses.filter((a) => a.quality !== "low").length} pathways with specific insights`,
        });
      } catch {
        // Non-critical — fall back to honest labels
        setPathwayAnalyses([]);
      }

      // ── Step 5: Materialize discoveries via intelligence feedback ──
      if (detected.length > 0) {
        updateProgress({
          step: "materializing_discoveries",
          detail: "Materializing hidden connections into graph...",
        });

        try {
          const fbRes = await fetch("/api/pipeline/intelligence-feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ spaceId: space.id }),
          });

          if (fbRes.ok) {
            const fbData = await fbRes.json();

            setFeedbackResult({
              discovered_edges: fbData.feedback?.discovered_edges ?? [],
              risk_flags: fbData.feedback?.risk_flags ?? [],
              summary: fbData.feedback?.summary ?? {
                intersections_analyzed: 0,
                high_potential_intersections: 0,
                edges_discovered: 0,
                risk_flags_raised: 0,
                key_discoveries: [],
                density_impact: { current_edges: 0, new_edges: 0, density_increase_pct: 0 },
              },
              edges_materialized: fbData.edges_materialized ?? 0,
              novel_connections_stored: fbData.novel_connections_stored ?? 0,
            });

            updateProgress({
              discoveryEdgesCreated: fbData.edges_materialized ?? 0,
              detail: `Materialized ${fbData.edges_materialized ?? 0} discovered connections`,
            });
          }
        } catch {
          // Non-critical — spaces + intersections still valid
        }
      }

      // ── Done ──
      setComputed(true);
      updateProgress({ step: "complete", detail: "Pipeline complete" });

      // Trigger refresh so graph picks up new entities/edges
      if (onRefresh && (expandedCount > 0 || detected.length > 0)) {
        onRefresh();
      }
    } catch (err) {
      console.error("[ProbabilitySpaceModule] Pipeline failed:", err);
      setError(err instanceof Error ? err.message : "Pipeline failed");
      updateProgress({ step: "idle", detail: "" });
    } finally {
      runningRef.current = false;
    }
  }, [entities, edges, space.id, onRefresh, dashboardContext]);

  // ── Derived data ──

  const filteredSpaces = useMemo(
    () => showSpeculative
      ? spaces
      : spaces.filter((s) =>
          s.quality_tier !== "speculative" &&
          !isTrivialSyntheticSpace(s) &&
          s.total_pathway_probability > 0 &&
          s.nodes.length >= 3 // Must have at least one real intermediate factor
        ),
    [spaces, showSpeculative]
  );

  const filteredIntersections = useMemo(
    () => showSpeculative
      ? intersections
      : intersections.filter((i) => !isWeakIntersection(i)),
    [intersections, showSpeculative]
  );

  const hiddenSpaceCount = spaces.length - filteredSpaces.length;
  const hiddenIntersectionCount = intersections.length - filteredIntersections.length;

  const metrics = useMemo(
    () => (computed ? computeMetrics(filteredSpaces, filteredIntersections) : null),
    [computed, filteredSpaces, filteredIntersections]
  );

  // riskBuckets and weakestEdges removed — risk/weak pathway info integrated into pathway cards

  const highIntersections = useMemo(
    () => filteredIntersections.filter((i) => i.innovation_potential === "high"),
    [filteredIntersections]
  );

  // Search ALL spaces (not just filtered) so intersection "Expand space" always finds its target
  const expandedSpace = useMemo(
    () =>
      expandedSpaceEdgeId
        ? spaces.find((s) => s.edge_id === expandedSpaceEdgeId) ?? null
        : null,
    [expandedSpaceEdgeId, spaces]
  );

  // Auto-scroll to expanded space panel when it appears
  useEffect(() => {
    if (expandedSpace && expandedPanelRef.current) {
      // Small delay to let the DOM update
      setTimeout(() => {
        expandedPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    }
  }, [expandedSpace]);

  // ── Strategic insights ──
  const systemInsights = useMemo(
    () =>
      computed && metrics
        ? generateSystemInsights(filteredSpaces, filteredIntersections, metrics, dashboardContext)
        : [],
    [computed, metrics, filteredSpaces, filteredIntersections, dashboardContext]
  );

  // Use LLM-analyzed pathways; filter to only quality content
  const qualityPathways = useMemo(
    () => pathwayAnalyses.filter((a) => a.quality !== "low"),
    [pathwayAnalyses]
  );
  const heroPathway = qualityPathways.length > 0 ? qualityPathways[0] : null;
  const secondaryPathways = qualityPathways.slice(1, 6);

  // ── Empty state ──

  if (entities.length === 0 || edges.length === 0) {
    return (
      <DashboardCard
        title="Probability Space Intelligence"
        icon={<Network className="h-4 w-4" />}
        defaultExpanded
        fullscreenable
      >
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Network className="h-8 w-8 text-gray-300 mb-2" />
          <p className="text-[11px] text-gray-400">
            Add entities and connections to your knowledge graph to compute probability spaces.
          </p>
        </div>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard
      title="Probability Space Intelligence"
      icon={<Network className="h-4 w-4" />}
      defaultExpanded
      fullscreenable
      badge={
        computed && metrics ? (
          <div className="flex items-center gap-1.5">
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[9px] font-semibold text-indigo-700">
              {metrics.totalSpaces} spaces
            </span>
            {metrics.richSpaces > 0 && (
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-semibold text-purple-700">
                {metrics.richSpaces} rich
              </span>
            )}
          </div>
        ) : undefined
      }
      headerRight={
        computed ? (
          <div className="flex items-center gap-1.5">
            {feedbackResult && feedbackResult.edges_materialized > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
                +{feedbackResult.edges_materialized} edges
              </span>
            )}
            <button
              onClick={runFullPipeline}
              disabled={isRunning}
              className="rounded-md bg-indigo-50 px-2 py-1 text-[9px] font-medium text-indigo-600 hover:bg-indigo-100 transition-colors disabled:opacity-50"
            >
              {isRunning ? "Running..." : "Recompute"}
            </button>
          </div>
        ) : undefined
      }
    >
      {/* ── Pre-compute state ── */}
      {!computed && !isRunning && (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 p-4 mb-4">
            <BrainCircuit className="h-8 w-8 text-indigo-600" />
          </div>
          <h4 className="text-[13px] font-semibold text-gray-800 mb-1">
            Deep Probability Analysis
          </h4>
          <p className="text-[11px] text-gray-500 mb-1 text-center max-w-sm leading-relaxed">
            This runs a full intelligence pipeline: expands each entity into internal
            sub-components, materializes them into the graph, computes probability spaces
            across all connections, detects cross-domain intersections, and materializes
            hidden connections back into your knowledge graph.
          </p>
          <p className="text-[10px] text-gray-400 mb-5">
            {entities.length} entities &middot; {edges.length} edges &middot; ~{Math.ceil(entities.length * 1.5)}s
          </p>
          <button
            onClick={runFullPipeline}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-[12px] font-semibold text-white shadow-sm hover:bg-indigo-700 transition-all hover:shadow-md"
          >
            <span className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Run Deep Analysis
            </span>
          </button>
          {error && (
            <p className="mt-3 text-[10px] text-red-500 text-center max-w-xs">
              {error}
            </p>
          )}
        </div>
      )}

      {/* ── Pipeline Progress ── */}
      {isRunning && (
        <div className="py-6 px-2">
          <div className="flex items-center gap-3 mb-4">
            <Loader2 className="h-5 w-5 text-indigo-500 animate-spin flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-gray-700">
                {STEP_LABELS[progress.step]}
              </p>
              <p className="text-[10px] text-gray-400 truncate">
                {progress.detail}
              </p>
            </div>
          </div>

          {/* Step indicators */}
          <div className="grid grid-cols-6 gap-1.5">
            <StepPill
              label="Expand"
              active={progress.step === "expanding"}
              done={["materializing", "computing_spaces", "detecting_intersections", "materializing_discoveries", "complete"].includes(progress.step)}
              stat={progress.entitiesExpanded > 0 ? `${progress.entitiesExpanded}/${progress.entitiesTotal}` : undefined}
            />
            <StepPill
              label="Materialize"
              active={progress.step === "materializing"}
              done={["computing_spaces", "detecting_intersections", "materializing_discoveries", "complete"].includes(progress.step)}
              stat={progress.expansionsMaterialized > 0 ? `+${progress.expansionsMaterialized}` : undefined}
            />
            <StepPill
              label="Spaces"
              active={progress.step === "computing_spaces"}
              done={["detecting_intersections", "materializing_discoveries", "complete"].includes(progress.step)}
              stat={progress.spacesComputed > 0 ? `${progress.spacesComputed}` : undefined}
            />
            <StepPill
              label="Intersect"
              active={progress.step === "detecting_intersections"}
              done={["analyzing_pathways", "materializing_discoveries", "complete"].includes(progress.step)}
              stat={progress.intersectionsFound > 0 ? `${progress.intersectionsFound}` : undefined}
            />
            <StepPill
              label="Analyze"
              active={progress.step === "analyzing_pathways"}
              done={["materializing_discoveries", "complete"].includes(progress.step)}
            />
            <StepPill
              label="Discover"
              active={progress.step === "materializing_discoveries"}
              done={progress.step === "complete"}
              stat={progress.discoveryEdgesCreated > 0 ? `+${progress.discoveryEdgesCreated}` : undefined}
            />
          </div>

          {/* Entity expansion progress bar */}
          {progress.step === "expanding" && progress.entitiesTotal > 0 && (
            <div className="mt-3">
              <div className="h-1.5 w-full rounded-full bg-gray-100">
                <div
                  className="h-1.5 rounded-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${(progress.entitiesExpanded / progress.entitiesTotal) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Computed results ── */}
      {computed && metrics && !isRunning && (
        <div className="space-y-4">
          {(hiddenSpaceCount > 0 || hiddenIntersectionCount > 0) && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-gray-600">
                  Hidden by validation gate: {hiddenSpaceCount} speculative/trivial spaces, {hiddenIntersectionCount} weak intersections.
                </p>
                <button
                  onClick={() => setShowSpeculative((v) => !v)}
                  className={cn(
                    "rounded px-2 py-1 text-[9px] font-medium transition-colors",
                    showSpeculative
                      ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  )}
                >
                  {showSpeculative ? "Hide speculative" : "Show speculative"}
                </button>
              </div>
            </div>
          )}

          {filteredSpaces.length === 0 && (hiddenSpaceCount > 0 || hiddenIntersectionCount > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-700">
              All probability outputs are currently hidden by validation gates. Toggle <span className="font-semibold">Show speculative</span> to inspect low-grounding results.
            </div>
          )}

          {/* ── Compact Header Stats ── */}
          <div className="flex flex-wrap items-center gap-2">
            <MetricPill
              label="Pathways"
              value={qualityPathways.length}
              color="bg-indigo-50 text-indigo-700 border-indigo-200"
              icon={<BrainCircuit className="h-2.5 w-2.5" />}
            />
            {metrics.highPotentialIntersections > 0 && (
              <MetricPill
                label="Intersections"
                value={metrics.highPotentialIntersections}
                color="bg-violet-50 text-violet-700 border-violet-200"
                icon={<Sparkles className="h-2.5 w-2.5" />}
              />
            )}
            {metrics.totalFailurePoints > 0 && (
              <MetricPill
                label="Risks"
                value={metrics.totalFailurePoints}
                color="bg-red-50 text-red-700 border-red-200"
                icon={<AlertTriangle className="h-2.5 w-2.5" />}
              />
            )}
            <span className="text-[9px] text-gray-400">
              {metrics.totalSpaces} spaces analyzed
            </span>
          </div>

          {/* ── Strategic Insights ── */}
          {systemInsights.length > 0 && (
            <div className="space-y-2">
              {systemInsights.map((insight, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg border px-3 py-2.5",
                    insight.severity === "critical" && "border-red-200 bg-red-50/60",
                    insight.severity === "warning" && "border-amber-200 bg-amber-50/60",
                    insight.severity === "info" && "border-blue-200 bg-blue-50/60"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {insight.severity === "critical" && <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />}
                    {insight.severity === "warning" && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />}
                    {insight.severity === "info" && <Sparkles className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                      <p className={cn(
                        "text-[11px] font-semibold leading-snug",
                        insight.severity === "critical" && "text-red-800",
                        insight.severity === "warning" && "text-amber-800",
                        insight.severity === "info" && "text-blue-800"
                      )}>
                        {insight.headline}
                      </p>
                      <p className="text-[10px] text-gray-600 leading-relaxed mt-0.5">
                        {insight.body}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Hero Card: Top Finding ── */}
          {heroPathway ? (() => {
            const heroSpace = spaces.find((s) => s.id === heroPathway.spaceId);
            const heroFailures = heroSpace?.failure_points.filter(
              (fp) => fp.blast_radius === "systemic" || fp.blast_radius === "cascading"
            ).slice(0, 2) ?? [];
            return (
              <div className="rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-purple-50/40 p-4">
                <div className="flex items-start gap-2 mb-2">
                  <div className="rounded-lg bg-indigo-100 p-1.5 flex-shrink-0">
                    <BrainCircuit className="h-4 w-4 text-indigo-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-indigo-500">
                        Top Finding
                      </span>
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[8px] font-medium",
                        heroPathway.quality === "high" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      )}>
                        {heroPathway.quality === "high" ? "Well-researched" : "Partially researched"}
                      </span>
                      {heroPathway.goal_relevance && (
                        <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[8px] font-medium text-blue-700">
                          {heroPathway.goal_relevance}
                        </span>
                      )}
                    </div>
                    <h4 className="text-[12px] font-semibold text-gray-900 leading-snug">
                      {heroPathway.headline}
                    </h4>
                  </div>
                </div>

                <p className="text-[10px] text-gray-700 leading-relaxed mt-2">
                  {heroPathway.mechanism}
                </p>

                {heroPathway.strategic_implication && (
                  <div className="mt-2.5 rounded-lg bg-white/70 border border-indigo-100 px-3 py-2">
                    <p className="text-[10px] text-indigo-800 font-medium leading-relaxed">
                      {heroPathway.strategic_implication}
                    </p>
                  </div>
                )}

                {heroFailures.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {heroFailures.map((fp, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[8px] text-red-700">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {fp.node_name}: {fp.failure_mode.slice(0, 60)}
                      </span>
                    ))}
                  </div>
                )}

                {heroSpace && (
                  <button
                    onClick={() => setExpandedSpaceEdgeId(expandedSpaceEdgeId === heroSpace.edge_id ? null : heroSpace.edge_id)}
                    className="mt-2.5 text-[9px] text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                  >
                    View full pathway details →
                  </button>
                )}
              </div>
            );
          })() : (
            filteredSpaces.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-center">
                <p className="text-[11px] text-gray-500">
                  No pathways passed quality gates yet. Run deeper research to build richer connections.
                </p>
              </div>
            ) : null
          )}

          {/* ── Secondary Pathways ── */}
          {secondaryPathways.length > 0 && (
            <div className="space-y-1.5">
              {secondaryPathways.map((analysis) => {
                const s = spaces.find((sp) => sp.id === analysis.spaceId);
                const topRisk = s?.failure_points.find((fp) => fp.blast_radius === "systemic" || fp.blast_radius === "cascading");
                return (
                  <div
                    key={analysis.spaceId}
                    className={cn(
                      "rounded-lg border p-3 transition-colors",
                      analysis.quality === "high" ? "border-indigo-100 bg-indigo-50/20 hover:bg-indigo-50/40" : "border-gray-200 bg-white hover:bg-gray-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={cn(
                            "rounded-full px-1.5 py-0.5 text-[8px] font-medium",
                            analysis.quality === "high" ? "bg-emerald-100 text-emerald-700" :
                            analysis.quality === "medium" ? "bg-amber-100 text-amber-700" :
                            "bg-gray-100 text-gray-500"
                          )}>
                            {analysis.quality === "high" ? "Well-researched" : analysis.quality === "medium" ? "Partial" : "Early stage"}
                          </span>
                          {analysis.goal_relevance && (
                            <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[8px] text-blue-600">
                              {analysis.goal_relevance.slice(0, 40)}
                            </span>
                          )}
                          {topRisk && (
                            <span className="inline-flex items-center gap-0.5 text-[8px] text-red-500">
                              <AlertTriangle className="h-2 w-2" />
                              {topRisk.node_name}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] font-semibold text-gray-800 leading-snug">
                          {analysis.headline}
                        </p>
                        <p className="text-[9px] text-gray-600 leading-relaxed mt-0.5 line-clamp-2">
                          {analysis.mechanism}
                        </p>
                      </div>
                      {s && (
                        <button
                          onClick={() => setExpandedSpaceEdgeId(expandedSpaceEdgeId === s.edge_id ? null : s.edge_id)}
                          className="flex-shrink-0 rounded-md bg-gray-100 px-2 py-1 text-[8px] text-gray-600 hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
                        >
                          Details
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── More Pathways (collapsed) ── */}
          {qualityPathways.length > 6 && (
            <CollapsibleSection
              title="More Pathways"
              icon={<Network className="h-3 w-3 text-indigo-400" />}
              count={qualityPathways.length - 6}
              expanded={morePathwaysExpanded}
              onToggle={() => setMorePathwaysExpanded(!morePathwaysExpanded)}
            >
              <div className="space-y-1.5">
                {qualityPathways.slice(6).map((analysis) => (
                  <div key={analysis.spaceId} className="rounded-lg border border-gray-200 px-3 py-2">
                    <p className="text-[10px] font-medium text-gray-700">{analysis.headline}</p>
                    <p className="text-[9px] text-gray-500 mt-0.5 line-clamp-1">{analysis.mechanism}</p>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* ── Pipeline Summary (one sentence) ── */}
          {feedbackResult && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
              <p className="text-[10px] text-emerald-800">
                Found {qualityPathways.length} pathway{qualityPathways.length !== 1 ? "s" : ""} and {filteredIntersections.length} intersection{filteredIntersections.length !== 1 ? "s" : ""}.
                {feedbackResult.edges_materialized > 0 && (
                  <> <span className="font-semibold">{feedbackResult.edges_materialized} new connection{feedbackResult.edges_materialized !== 1 ? "s" : ""}</span> added to graph.</>
                )}
              </p>
            </div>
          )}

          {/* ── Discovered Connections (collapsed) ── */}
          {feedbackResult && feedbackResult.discovered_edges.length > 0 && (
            <CollapsibleSection
              title="Discovered Connections"
              icon={<Link2 className="h-3 w-3 text-purple-500" />}
              count={feedbackResult.discovered_edges.length}
              expanded={discoveredExpanded}
              onToggle={() => setDiscoveredExpanded(!discoveredExpanded)}
            >
              <div className="space-y-1.5">
                {feedbackResult.discovered_edges.slice(0, 10).map((de, i) => (
                  <DiscoveredEdgeCard key={i} edge={de} />
                ))}
                {feedbackResult.discovered_edges.length > 10 && (
                  <p className="text-[9px] text-gray-400 text-center pt-1">
                    +{feedbackResult.discovered_edges.length - 10} more
                  </p>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* ── Risk Flags (collapsed) ── */}
          {feedbackResult && feedbackResult.risk_flags.length > 0 && (
            <CollapsibleSection
              title="Risk Flags"
              icon={<AlertTriangle className="h-3 w-3 text-red-500" />}
              count={feedbackResult.risk_flags.length}
              expanded={false}
              onToggle={() => setRiskFlagsExpanded(!riskFlagsExpanded)}
            >
              <div className="space-y-1.5">
                {feedbackResult.risk_flags.map((rf, i) => (
                  <RiskFlagCard key={i} flag={rf} />
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Risk Distribution removed — risk info integrated into pathway cards */}

          {/* Pathways Under Investigation removed — replaced by ranked pathway analysis */}

          {/* ── High-Potential Intersections ── */}
          {highIntersections.length > 0 && (
            <CollapsibleSection
              title="High-Potential Intersections"
              icon={<Sparkles className="h-3 w-3 text-green-500" />}
              count={highIntersections.length}
              expanded={intersectionsExpanded}
              onToggle={() => setIntersectionsExpanded(!intersectionsExpanded)}
            >
              <div className="space-y-2">
                {highIntersections.slice(0, 6).map((int) => (
                  <IntersectionCard
                    key={int.id}
                    intersection={int}
                    onExpand={(edgeId) =>
                      setExpandedSpaceEdgeId(
                        expandedSpaceEdgeId === edgeId ? null : edgeId
                      )
                    }
                  />
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* ── All Spaces ── */}
          <CollapsibleSection
            title="All Probability Spaces"
            icon={<Network className="h-3 w-3 text-indigo-500" />}
            count={filteredSpaces.length}
            expanded={allSpacesExpanded}
            onToggle={() => setAllSpacesExpanded(!allSpacesExpanded)}
          >
            <ProbabilitySpacesSection
              spaces={filteredSpaces}
              intersections={filteredIntersections}
              onExpandSpace={(edgeId) =>
                setExpandedSpaceEdgeId(
                  expandedSpaceEdgeId === edgeId ? null : edgeId
                )
              }
              expandedEdgeId={expandedSpaceEdgeId}
            />
          </CollapsibleSection>

          {/* ── Expanded Space Detail ── */}
          {expandedSpace && (
            <div className="mt-2" ref={expandedPanelRef}>
              <ProbabilitySpacePanel
                space={expandedSpace}
                onClose={() => setExpandedSpaceEdgeId(null)}
              />
            </div>
          )}

          {error && (
            <p className="text-[10px] text-red-500 text-center">{error}</p>
          )}
        </div>
      )}
    </DashboardCard>
  );
}

// ── Sub-components ──

function StepPill({
  label,
  active,
  done,
  stat,
}: {
  label: string;
  active: boolean;
  done: boolean;
  stat?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-2 py-1.5 text-center transition-all",
        active && "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200",
        done && !active && "border-emerald-200 bg-emerald-50",
        !active && !done && "border-gray-200 bg-gray-50"
      )}
    >
      <div
        className={cn(
          "text-[9px] font-semibold",
          active && "text-indigo-700",
          done && !active && "text-emerald-700",
          !active && !done && "text-gray-400"
        )}
      >
        {done && !active ? <CheckCircle2 className="inline h-2.5 w-2.5 mr-0.5" /> : null}
        {active ? <Loader2 className="inline h-2.5 w-2.5 mr-0.5 animate-spin" /> : null}
        {label}
      </div>
      {stat && (
        <div className={cn(
          "text-[10px] font-bold mt-0.5",
          active ? "text-indigo-600" : done ? "text-emerald-600" : "text-gray-400"
        )}>
          {stat}
        </div>
      )}
    </div>
  );
}

function MetricPill({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  color: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        color
      )}
    >
      {icon}
      <span className="text-[9px] font-medium opacity-70">{label}</span>
      <span className="text-[10px] font-bold">{value}</span>
    </div>
  );
}

// FeedbackStat removed — replaced by inline summary sentence

function DiscoveredEdgeCard({ edge }: { edge: DiscoveredEdge }) {
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link2 className="h-3 w-3 text-purple-500 flex-shrink-0" />
          <span className="text-[10px] font-medium text-gray-800 truncate">
            {edge.source_entity_name}
          </span>
          <ArrowRight className="h-2.5 w-2.5 text-gray-300 flex-shrink-0" />
          <span className="text-[10px] font-medium text-gray-800 truncate">
            {edge.target_entity_name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[8px] font-medium text-purple-600">
            {edge.relationship_type.replace(/_/g, " ")}
          </span>
          <span className={cn(
            "rounded-full px-1.5 py-0.5 text-[8px] font-bold",
            edge.novelty_score > 0.7 ? "bg-green-100 text-green-700" :
            edge.novelty_score > 0.4 ? "bg-amber-100 text-amber-700" :
            "bg-gray-100 text-gray-600"
          )}>
            {edge.novelty_score > 0.7 ? "high novelty" : edge.novelty_score > 0.4 ? "novel" : "known pattern"}
          </span>
        </div>
      </div>

      {edge.shared_variables.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="text-[8px] text-gray-400 uppercase tracking-wider mr-0.5">via:</span>
          {edge.shared_variables.slice(0, 3).map((sv, i) => (
            <span key={i} className="rounded bg-indigo-100 px-1 py-0.5 text-[8px] text-indigo-700">
              {sv}
            </span>
          ))}
        </div>
      )}

      <p className="mt-1 text-[9px] text-gray-500 leading-relaxed line-clamp-2">
        {edge.reasoning}
      </p>
    </div>
  );
}

function RiskFlagCard({ flag }: { flag: RiskFlag }) {
  const typeConfig: Record<string, { bg: string; text: string; label: string }> = {
    systemic_failure: { bg: "bg-red-100", text: "text-red-700", label: "Systemic" },
    cascading_failure: { bg: "bg-amber-100", text: "text-amber-700", label: "Cascading" },
    bottleneck_exposure: { bg: "bg-orange-100", text: "text-orange-700", label: "Bottleneck" },
  };
  const cfg = typeConfig[flag.risk_type] ?? typeConfig.cascading_failure;

  return (
    <div className="rounded-lg border border-red-200 bg-red-50/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 text-red-500" />
          <span className="text-[10px] font-medium text-gray-800">{flag.entity_name}</span>
        </div>
        <span className={cn("rounded-full px-1.5 py-0.5 text-[8px] font-medium", cfg.bg, cfg.text)}>
          {cfg.label}
        </span>
      </div>
      <p className="mt-1 text-[9px] text-gray-600">{flag.description}</p>
      <p className="mt-1 text-[9px] text-emerald-600 font-medium">
        Mitigation: {flag.mitigation_hint}
      </p>
    </div>
  );
}

function CollapsibleSection({
  title,
  icon,
  count,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 mb-2 group"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-gray-400" />
        ) : (
          <ChevronRight className="h-3 w-3 text-gray-400" />
        )}
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 group-hover:text-gray-800 transition-colors">
          {title}
        </span>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[8px] font-medium text-gray-500">
          {count}
        </span>
      </button>
      {expanded && children}
    </div>
  );
}
