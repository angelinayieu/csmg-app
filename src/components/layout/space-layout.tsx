"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, X, Maximize2, Minimize2 } from "lucide-react";
import type { ImprovementGoal } from "@/types/goals";
import type { ShellLevel } from "@/lib/hooks/use-space-chat";
import type { SuggestedObjective } from "@/types/goals";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useDeepRefresh } from "@/lib/hooks/use-deep-refresh";
import { SpaceHeader } from "@/components/space/space-header";
import { ObjectiveReviewFlow } from "@/components/objectives/objective-review-flow";
import { SpaceChat } from "@/components/chat/space-chat";
import { AnalysisAccordion } from "@/components/space/analysis-accordion";
import { SpaceGraph } from "@/components/graph/space-graph";
import { SynthesisView } from "@/components/synthesis/synthesis-view";
import { GraphControls } from "@/components/graph/graph-controls";
import { GraphRightPanel } from "@/components/graph/graph-right-panel";
import type { LayoutType } from "@/lib/graph/layout-engine";
import { NodeDetail } from "@/components/graph/node-detail";
import { ExpansionShell } from "@/components/graph/expansion-shell";
import { useExpansion } from "@/lib/hooks/use-expansion";
import { OrphanAlert } from "@/components/graph/orphan-alert";
import { ReasoningToolbar } from "@/components/reasoning/reasoning-toolbar";
import { CentralityResults } from "@/components/reasoning/centrality-results";
import { CascadeResults } from "@/components/reasoning/cascade-results";
import { PredictionCards } from "@/components/reasoning/prediction-card";
import { PathResults } from "@/components/reasoning/path-results";
import { LoopDetailCards } from "@/components/reasoning/loop-detail-card";
import { DashboardTopBar, type ViewMode } from "@/components/dashboard/dashboard-top-bar";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { GoalSetter } from "@/components/dashboard/goal-setter";
import { useToolboxEvents } from "@/lib/toolbox-events";
import { useReasoning } from "@/lib/hooks/use-reasoning";
import { useIterativeReasoning } from "@/lib/hooks/use-iterative-reasoning";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import { usePersistedState } from "@/lib/hooks/use-persisted-state";
import { CoverageHud } from "@/components/graph/coverage-hud";
import { DeepenButton } from "@/components/reasoning/deepen-button";
import { IterationResultsCard } from "@/components/reasoning/iteration-results-card";
import { edgeDimensionStyles, domainColors } from "@/lib/design-tokens";
import { FindingsTab } from "@/components/workspace/findings-tab";
import { FindingDetailPanel } from "@/components/workspace/finding-detail-panel";
import { ConvergenceExpanded } from "@/components/workspace/convergence-expanded";
import { GoalStrip } from "@/components/workspace/goal-strip";
import { rankFindings } from "@/lib/findings/rank-findings";
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
  Claim,
} from "@/types";
import type { InteractionField, InteractionMetadata } from "@/types/interactions";
import type { SynthesisData } from "@/types/synthesis";
import type { Finding } from "@/types/finding";

export interface SpaceLayoutProps {
  space: Space;
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  propositions: Proposition[];
  novelConnections: NovelConnection[];
  contradictions: Contradiction[];
  scenarios: Scenario[];
  actionItems: ActionItem[];
  siblingEntities?: Entity[];
  siblingEdges?: Edge[];
  domainMap?: Record<string, { name: string; index: number }>;
  bridges?: Bridge[];
  goals?: ImprovementGoal[];
  claims?: Claim[];
  liveCounts?: { entities: number; edges: number; cycles: number };
}

const contentTabs = [
  { id: "convergence", label: "Convergence" },
  { id: "graph", label: "Graph" },
  { id: "analysis", label: "Analysis" },
  { id: "synthesis", label: "Synthesis" },
] as const;

type ContentTab = (typeof contentTabs)[number]["id"];

export function SpaceLayout({
  space,
  entities,
  edges,
  cycles,
  propositions,
  novelConnections,
  contradictions,
  scenarios,
  actionItems,
  siblingEntities = [],
  siblingEdges = [],
  domainMap = {},
  bridges = [],
  goals = [],
  claims = [],
  liveCounts,
}: SpaceLayoutProps) {
  const router = useRouter();

  // Deep refresh — shared between SpaceHeader and DashboardGrid
  const deepRefresh = useDeepRefresh(space.id);

  // Progressive disclosure stage
  const stage = useMemo(() => {
    if (entities.length === 0) return 1;
    if (!space.synthesis_data) return 2;
    return 3;
  }, [entities.length, space.synthesis_data]);

  // View mode: dashboard (new) or tabs (classic)
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [activeGoal, setActiveGoal] = useState<ImprovementGoal | null>(
    () => {
      // Prefer top-level active goals (no parent) over sub-objectives
      const topLevel = goals.find((g) => g.status === "active" && !g.parent_goal_id);
      if (topLevel) return topLevel;
      return goals.find((g) => g.status === "active") ?? null;
    }
  );
  const [goalList, setGoalList] = useState<ImprovementGoal[]>(goals);
  const [showGoalSetter, setShowGoalSetter] = useState(false);
  const [goalPrefill, setGoalPrefill] = useState<import("@/types/goals").SuggestedObjective | null>(null);

  // Allow cross-module one-click goal creation (e.g., Intelligence Radar decisions)
  useEffect(() => {
    const handler = (ev: Event) => {
      const custom = ev as CustomEvent<{ prefill?: SuggestedObjective }>;
      const prefill = custom.detail?.prefill;
      if (!prefill) return;
      setGoalPrefill(prefill);
      setShowGoalSetter(true);
    };

    window.addEventListener("interaxis:create-goal-from-intel", handler as EventListener);
    return () => {
      window.removeEventListener("interaxis:create-goal-from-intel", handler as EventListener);
    };
  }, []);

  // Child goals for the active goal (sub-objectives)
  const childGoals = useMemo(
    () => activeGoal
      ? goalList.filter((g) => g.parent_goal_id === activeGoal.id)
      : [],
    [goalList, activeGoal]
  );

  // Objective review flow — check if objectives are pending review
  // BUG FIX: useState initializer only runs once on mount. When synthesis_data
  // updates (e.g. after objective detection + router.refresh()), we need to
  // re-read the flag. Use useEffect to sync with the prop.
  const [objectivesReviewed, setObjectivesReviewed] = useState(() => {
    if (!space.synthesis_data) return true;
    const sd = typeof space.synthesis_data === "string"
      ? JSON.parse(space.synthesis_data)
      : space.synthesis_data;
    return sd?.objectives_pending_review !== true;
  });

  // Sync objectivesReviewed with prop changes (after router.refresh or space navigation)
  useEffect(() => {
    if (!space.synthesis_data) {
      setObjectivesReviewed(true);
      return;
    }
    const sd = typeof space.synthesis_data === "string"
      ? JSON.parse(space.synthesis_data)
      : space.synthesis_data;
    if (sd?.objectives_pending_review === true) {
      setObjectivesReviewed(false);
    }
  }, [space.synthesis_data]);

  const pendingObjectives = useMemo<SuggestedObjective[]>(() => {
    if (objectivesReviewed) return [];
    if (!space.synthesis_data) return [];
    const sd = typeof space.synthesis_data === "string"
      ? JSON.parse(space.synthesis_data)
      : space.synthesis_data;
    return Array.isArray(sd?.suggested_objectives) ? sd.suggested_objectives : [];
  }, [space.synthesis_data, objectivesReviewed]);

  // Chat panel — top-right expandable
  const [chatOpen, setChatOpen] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  // Legacy alias for code that references chatCollapsed
  const chatCollapsed = !chatOpen;

  // Chat API ref for external drill triggers
  const chatApiRef = useRef<{ pushFocus: (level: ShellLevel) => void; clearFocus: () => void } | null>(null);

  const handleChatReady = useCallback((api: { pushFocus: (level: ShellLevel) => void; clearFocus: () => void }) => {
    chatApiRef.current = api;
  }, []);

  // Content tabs (for center panel — temporary during migration)
  const [activeTab, setActiveTab] = useState<ContentTab>("convergence");
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);

  // Convergence workspace state
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [expandedFinding, setExpandedFinding] = useState<Finding | null>(null);

  // Compute ranked findings from synthesis data
  const findings = useMemo(() => {
    const synthRaw = space.synthesis_data;
    if (!synthRaw) return [];
    try {
      const synthData = (typeof synthRaw === "string" ? JSON.parse(synthRaw) : synthRaw) as SynthesisData;
      const interactionMeta = (synthData as unknown as Record<string, unknown>).interaction_metadata as InteractionMetadata | undefined;
      return rankFindings({
        synthesisData: synthData,
        entities,
        interactionMetadata: interactionMeta ?? null,
        activeGoal: activeGoal ?? null,
      });
    } catch {
      return [];
    }
  }, [space.synthesis_data, entities, activeGoal]);

  // Shell expansion — drill into entity internals
  const expansion = useExpansion({ spaceId: space.id });

  // Graph state
  const [visibleDimensions, setVisibleDimensions] = useState<Set<string>>(
    () => new Set(Object.keys(edgeDimensionStyles))
  );
  const [showExternal, setShowExternal] = useState(
    () => !entities.some((e) => e.knowledge_layer !== "external")
  );
  const [showSiblings, setShowSiblings] = useState(false);
  // Persist layout choice per space so refresh/navigation doesn't reset to "force"
  const isValidLayout = (v: unknown): v is LayoutType =>
    typeof v === "string" &&
    ["force", "flowchart", "hierarchy", "causal", "dense", "map", "layered", "sphere", "dimensional"].includes(v);
  const [layoutType, setLayoutType] = usePersistedState<LayoutType>(
    `interaxis:layout:${space.id}`,
    "force",
    isValidLayout,
  );
  const [activeDomains, setActiveDomains] = useState<Set<string>>(
    () => new Set([space.id])
  );

  // Search + entity filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    () => new Set(["concrete", "abstract", "process", "relational", "epistemic"])
  );
  const [activeImportances, setActiveImportances] = useState<Set<string>>(
    () => new Set(["fundamental", "critical", "important", "moderate"])
  );

  function toggleCategory(cat: string) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) { if (next.size > 1) next.delete(cat); }
      else next.add(cat);
      return next;
    });
  }
  function toggleImportance(imp: string) {
    setActiveImportances((prev) => {
      const next = new Set(prev);
      if (next.has(imp)) { if (next.size > 1) next.delete(imp); }
      else next.add(imp);
      return next;
    });
  }

  const hasExternalEntities = entities.some(
    (e) => e.knowledge_layer === "external"
  );
  const hasSiblings = siblingEntities.length > 0;
  const hasBridges = bridges.length > 0;

  // Bridge edges for graph rendering
  const bridgeEdges = useMemo<Edge[]>(() => {
    if (!showSiblings || bridges.length === 0) return [];
    return bridges.map(
      (b) =>
        ({
          id: `bridge-${b.id}`,
          space_id: b.source_space_id,
          source_entity_id: b.source_entity_id,
          target_entity_id: b.target_entity_id,
          relationship_type: b.shared_variable_name,
          dimension: "comparative",
          source_tag: "predicted",
          strength:
            b.coupling_strength === "strong"
              ? 0.9
              : b.coupling_strength === "moderate"
                ? 0.7
                : 0.5,
          polarity: "positive",
          confidence: b.confidence ?? 0.8,
          knowledge_layer: "bridge",
          description: b.description,
          conditions: null,
          dynamics: null,
          is_tradeoff: false,
          is_low_confidence: false,
          requires_user_approval: false,
          approved_at: null,
          utility: null,
          provenance: null,
          resolved_by_entity_id: null,
          is_part_of_cycle: false,
          cycle_id: null,
          dynamics_properties: null,
          created_at: "",
          updated_at: "",
        }) as unknown as Edge
    );
  }, [bridges, showSiblings]);

  // Unified entities/edges for sibling mode
  const unifiedEntities = useMemo(() => {
    if (!showSiblings) return entities;
    return [
      ...entities,
      ...siblingEntities.filter((e) => activeDomains.has(e.space_id)),
    ];
  }, [entities, siblingEntities, showSiblings, activeDomains]);

  const unifiedEdges = useMemo(() => {
    if (!showSiblings) return edges;
    const activeEntityIds = new Set(unifiedEntities.map((e) => e.id));
    const sibEdges = siblingEdges.filter(
      (e) =>
        activeDomains.has(e.space_id) &&
        activeEntityIds.has(e.source_entity_id) &&
        activeEntityIds.has(e.target_entity_id)
    );
    const validBridgeEdges = bridgeEdges.filter(
      (e) =>
        activeEntityIds.has(e.source_entity_id) &&
        activeEntityIds.has(e.target_entity_id)
    );
    return [...edges, ...sibEdges, ...validBridgeEdges];
  }, [
    edges,
    siblingEdges,
    showSiblings,
    activeDomains,
    unifiedEntities,
    bridgeEdges,
  ]);

  // External knowledge filter
  const externalFiltered = showExternal
    ? unifiedEntities
    : unifiedEntities.filter((e) => e.knowledge_layer !== "external");
  const filteredEdgesBase = showExternal
    ? unifiedEdges
    : unifiedEdges.filter((e) => e.knowledge_layer !== "external");

  // Search + category + importance filter (for graph views)
  const allCatsActive = activeCategories.size >= 5;
  const allImpsActive = activeImportances.size >= 4;
  const queryLower = searchQuery.toLowerCase().trim();

  const filteredEntities = useMemo(() => {
    if (!queryLower && allCatsActive && allImpsActive) return externalFiltered;
    return externalFiltered.filter((e) => {
      if (queryLower && !e.name.toLowerCase().includes(queryLower) &&
          !(e.entity_id ?? "").toLowerCase().includes(queryLower)) return false;
      if (!allCatsActive && !activeCategories.has(e.entity_category)) return false;
      if (!allImpsActive && e.importance && !activeImportances.has(e.importance)) return false;
      return true;
    });
  }, [externalFiltered, queryLower, activeCategories, activeImportances, allCatsActive, allImpsActive]);

  // Only show edges where both endpoints are in filtered set
  const filteredEdges = useMemo(() => {
    if (filteredEntities === externalFiltered) return filteredEdgesBase;
    const visibleIds = new Set(filteredEntities.map((e) => e.id));
    return filteredEdgesBase.filter(
      (e) => visibleIds.has(e.source_entity_id) && visibleIds.has(e.target_entity_id)
    );
  }, [filteredEntities, filteredEdgesBase, externalFiltered]);

  function toggleDomain(spaceId: string) {
    setActiveDomains((prev) => {
      const next = new Set(prev);
      if (next.has(spaceId)) {
        if (next.size > 1) next.delete(spaceId);
      } else {
        next.add(spaceId);
      }
      return next;
    });
  }

  function toggleDimension(dim: string) {
    setVisibleDimensions((prev) => {
      const next = new Set(prev);
      if (next.has(dim)) {
        next.delete(dim);
      } else {
        next.add(dim);
      }
      return next;
    });
  }

  // Reasoning
  const {
    loading: reasoningLoading,
    activeOp,
    result: reasoningResult,
    error: reasoningError,
    runReasoning,
    clearResults,
  } = useReasoning();

  const iterativeReasoning = useIterativeReasoning(space.id);

  // User-configurable auto-refresh schedule (client-side interval)
  // Coverage HUD state: pairwise checks count + manual scan state
  const [pairChecksCount, setPairChecksCount] = useState(0);
  const [manualScanRunning, setManualScanRunning] = useState(false);
  const [quickChecking, setQuickChecking] = useState(false);
  const [quickDecomposing, setQuickDecomposing] = useState(false);

  // Quick Connect — lightweight /api/reevaluate call that adds missing edges + cycles
  // without running the full deep-refresh pipeline (no research, no critique passes).
  const runQuickCheck = useCallback(async () => {
    if (quickChecking) return;
    setQuickChecking(true);
    try {
      await fetch("/api/reevaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: space.id }),
      });
      router.refresh();
    } catch {
      // silent — header button doesn't have a toast surface
    } finally {
      setQuickChecking(false);
    }
  }, [quickChecking, router, space.id]);

  // Quick Decompose — single LLM pass that breaks 2-3 under-specified entities
  // into 2-4 children each. No research. Adds new entities + part_of edges.
  const runQuickDecompose = useCallback(async () => {
    if (quickDecomposing) return;
    setQuickDecomposing(true);
    try {
      await fetch("/api/quick-decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: space.id }),
      });
      router.refresh();
    } catch {
      // silent
    } finally {
      setQuickDecomposing(false);
    }
  }, [quickDecomposing, router, space.id]);

  // Fetch pair-checks count once on mount (and when space changes)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { count } = await supabase
          .from("pairwise_connection_checks")
          .select("*", { count: "exact", head: true })
          .eq("space_id", space.id);
        if (!cancelled && typeof count === "number") setPairChecksCount(count);
      } catch {
        // non-fatal
      }
    })();
    return () => { cancelled = true; };
  }, [space.id]);

  const handleScanNow = useCallback(async () => {
    if (manualScanRunning) return;
    setManualScanRunning(true);
    try {
      const resp = await fetch("/api/pipeline/prospect-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: space.id, entitiesToExamine: 8, pairsPerRun: 20 }),
      });
      if (resp.ok) {
        const data = await resp.json() as { summary?: { pairs_examined?: number; edges_proposed?: number } };
        if (data.summary?.pairs_examined) {
          setPairChecksCount(c => c + (data.summary?.pairs_examined ?? 0));
        }
        // Refresh router so new edges appear
        router.refresh();
      }
    } catch (err) {
      console.warn("[scan-now] failed:", err);
    } finally {
      setManualScanRunning(false);
    }
  }, [space.id, manualScanRunning, router]);

  // Auto-refresh tick: prospect new connections FIRST (cheap pairwise scan),
  // then run iterative reasoning on the augmented graph. Prospector is best-effort
  // — its failure never blocks the deepen step.
  const runAutoRefreshTick = useCallback(async () => {
    try {
      const resp = await fetch("/api/pipeline/prospect-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: space.id, entitiesToExamine: 5, pairsPerRun: 12 }),
      });
      if (resp.ok) {
        const data = await resp.json() as { summary?: { edges_proposed?: number; pairs_examined?: number } };
        if (data.summary?.pairs_examined) {
          console.log(
            `[auto-refresh] prospector: examined ${data.summary.pairs_examined} pairs, proposed ${data.summary.edges_proposed ?? 0} edges`,
          );
        }
      }
    } catch (err) {
      console.warn("[auto-refresh] prospector failed:", err);
    }
    iterativeReasoning.run(1);
  }, [space.id, iterativeReasoning]);

  const autoRefresh = useAutoRefresh(
    space.id,
    runAutoRefreshTick,
    {
      enabled: !!space.synthesis_data && entities.length >= 10,
      canRun: () => !iterativeReasoning.isRunning,
    },
  );

  // Auto-trigger Deepen when graph has many disconnected nodes
  const hasAutoDeepened = useRef(false);
  useEffect(() => {
    if (hasAutoDeepened.current) return;
    if (iterativeReasoning.isRunning) return;
    if (iterativeReasoning.stage !== "idle") return;
    if (entities.length < 10) return;
    if (!space.synthesis_data) return; // analysis must be complete

    const density = edges.length / entities.length;
    const orphanRatio = (space.orphan_count ?? 0) / entities.length;
    const shouldDeepen = density < 1.0 || orphanRatio > 0.3;

    if (shouldDeepen) {
      hasAutoDeepened.current = true;
      console.log(
        `[auto-deepen] density=${density.toFixed(2)}, orphans=${space.orphan_count}/${entities.length} (${(orphanRatio * 100).toFixed(0)}%). Auto-triggering 1 Deepen iteration.`
      );
      iterativeReasoning.run(1);
    }
  }, [entities.length, edges.length, space.orphan_count, space.synthesis_data, iterativeReasoning]);

  // Entity map for NodeDetail
  const entityMap = useMemo(() => {
    const map = new Map<string, Entity>();
    for (const e of entities) {
      map.set(e.id, e);
    }
    return map;
  }, [entities]);

  // Leverage points for right panel
  const leveragePoints = useMemo(
    () => entities.filter((e) => e.is_leverage_point),
    [entities]
  );

  // Graph changed callback
  const handleGraphChanged = useCallback(() => {
    router.refresh();
  }, [router]);

  // Handle toolbox actions dispatched from the global sphere
  useToolboxEvents(
    useCallback(
      (evt) => {
        switch (evt.type) {
          case "open-chat":
            setChatOpen(true);
            break;
          case "reevaluate":
            deepRefresh.runDeepRefresh(evt.depth, evt.depth === "deep" ? 3 : 1);
            break;
          case "refresh-strategy":
            fetch("/api/pipeline/strategy-refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ spaceId: space.id }),
            })
              .then(() => router.refresh())
              .catch(() => {});
            break;
          case "quick-check":
            runQuickCheck();
            break;
          case "quick-decompose":
            runQuickDecompose();
            break;
          case "research":
            fetch("/api/pipeline/research-deep", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ spaceId: space.id }),
            })
              .then(() => router.refresh())
              .catch(() => {});
            break;
          // "open-comment" is handled by the global toolbox itself
        }
      },
      [deepRefresh, router, space.id, runQuickCheck, runQuickDecompose]
    )
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* HEADER — shared deep refresh state */}
      <div className="flex-shrink-0 px-6 pt-4 pb-2">
        <SpaceHeader
          space={space}
          liveCounts={liveCounts}
          deepRefresh={deepRefresh}
          onQuickCheck={runQuickCheck}
          quickChecking={quickChecking}
          onQuickDecompose={runQuickDecompose}
          quickDecomposing={quickDecomposing}
        />
      </div>

      <div className="relative flex flex-1 overflow-hidden">
      {/* TOP-RIGHT: Chat Panel — expandable overlay */}
      {chatOpen && (
        <div
          className={cn(
            "absolute top-2 right-3 z-30 flex flex-col rounded-xl border border-gray-200 bg-white shadow-lg transition-all duration-300 overflow-hidden",
            chatExpanded
              ? "w-[480px] h-[calc(100%-16px)]"
              : "w-[360px] h-[420px]"
          )}
        >
          {/* Overlay controls — positioned over the chat header */}
          <div className="absolute top-2.5 right-2 z-10 flex items-center gap-0.5">
            <button
              onClick={() => setChatExpanded(!chatExpanded)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title={chatExpanded ? "Shrink" : "Expand"}
            >
              {chatExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </button>
            <button
              onClick={() => setChatOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Close chat"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <SpaceChat
            spaceId={space.id}
            entities={entities}
            onGraphChanged={handleGraphChanged}
            mode="inline"
            onChatReady={handleChatReady}
          />
        </div>
      )}

      {/* Chat toggle button — shown when chat is closed */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="absolute top-3 right-4 z-30 flex h-9 w-9 items-center justify-center rounded-lg bg-interaxis-50 text-interaxis-600 hover:bg-interaxis-100 shadow-sm border border-interaxis-100 transition-colors"
          title="Open chat"
        >
          <MessageCircle className="h-4 w-4" />
        </button>
      )}

      {/* Toolbox sphere is mounted globally in app-layout; we subscribe to its events here */}

      {/* CENTER: Dashboard or Classic Tabs */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Top bar: View mode toggle + Goal dropdown */}
          <DashboardTopBar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            activeGoal={activeGoal}
            goals={goalList}
            onSelectGoal={setActiveGoal}
            onCreateGoal={() => {
              setGoalPrefill(null);
              setShowGoalSetter(true);
            }}
          />

          {/* DASHBOARD VIEW */}
          {viewMode === "dashboard" && (
            <DashboardGrid
              space={space}
              entities={entities}
              edges={edges}
              filteredEntities={filteredEntities}
              filteredEdges={filteredEdges}
              cycles={cycles}
              propositions={propositions}
              novelConnections={novelConnections}
              contradictions={contradictions}
              scenarios={scenarios}
              actionItems={actionItems}
              bridges={bridges}
              domainMap={domainMap}
              entityMap={entityMap}
              leveragePoints={leveragePoints}
              visibleDimensions={visibleDimensions}
              onToggleDimension={toggleDimension}
              showExternal={showExternal}
              onToggleExternal={
                hasExternalEntities
                  ? () => setShowExternal(!showExternal)
                  : undefined
              }
              showSiblings={showSiblings}
              onToggleSiblings={() => setShowSiblings(!showSiblings)}
              activeDomains={activeDomains}
              onToggleDomain={toggleDomain}
              hasSiblings={hasSiblings}
              hasBridges={hasBridges}
              onNodeClick={(entity) => {
                setSelectedEntity(entity);
                if (entity && chatApiRef.current) {
                  chatApiRef.current.pushFocus({
                    type: "entity",
                    entityId: entity.entity_id,
                    name: entity.name,
                  });
                  if (chatCollapsed) setChatOpen(true);
                }
              }}
              activeOp={activeOp}
              reasoningLoading={reasoningLoading}
              onRunReasoning={(op, params) =>
                runReasoning(space.id, op, params)
              }
              onClearResults={clearResults}
              reasoningResult={reasoningResult}
              reasoningError={reasoningError}
              selectedEntity={selectedEntity}
              claims={claims}
              activeGoal={activeGoal}
              goals={goalList}
              childGoals={childGoals}
              onAcceptObjective={async (obj) => {
                // One-click creation — AI already structured the objective
                try {
                  let desc = obj.description;
                  if (obj.rationale) desc += `\n\nRationale: ${obj.rationale}`;

                  const res = await fetch("/api/goals", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      space_id: space.id,
                      title: obj.title,
                      description: desc,
                      metric_name: obj.metric_name,
                      metric_unit: obj.metric_unit ?? null,
                      target_value: obj.target_estimate ?? 100,
                      baseline_value: obj.baseline_estimate ?? 0,
                      deadline: null,
                      parent_goal_id: obj.parent_goal_id ?? null,
                      objective_type: obj.objective_type ?? "maximize",
                      source: "auto_detected",
                      benchmark: obj.benchmark ?? null,
                    }),
                  });

                  if (res.ok) {
                    const data = await res.json();
                    const newGoal = data.goal as ImprovementGoal;
                    setGoalList((prev) => [newGoal, ...prev]);
                    setActiveGoal(newGoal);
                    router.refresh();
                  } else {
                    const errData = await res.json().catch(() => ({}));
                    console.error(`Failed to accept objective "${obj.title}":`, res.status, errData);
                  }
                } catch (err) {
                  console.error("Failed to create goal from suggestion:", err);
                }
              }}
              onCreateSubSpace={async (goalId) => {
                try {
                  const res = await fetch(`/api/goals/${goalId}/sub-space`, { method: "POST" });
                  if (res.ok) {
                    const data = await res.json();
                    router.push(`/app/space/${data.spaceId}`);
                  }
                } catch (err) {
                  console.error("Failed to create sub-space:", err);
                }
              }}
              onNavigateToSpace={(spaceId) => {
                router.push(`/app/space/${spaceId}`);
              }}
              onBreakDownGoal={async (goalId) => {
                try {
                  const res = await fetch(`/api/goals/${goalId}/sub-objectives`, { method: "POST" });
                  if (res.ok) {
                    // Reload to pick up new suggested objectives
                    router.refresh();
                  }
                } catch (err) {
                  console.error("Failed to generate sub-objectives:", err);
                }
              }}
              onGoalClick={(goal) => {
                setActiveGoal(goal);
              }}
              onRefresh={handleGraphChanged}
              deepRefresh={deepRefresh}
            />
          )}

          {/* CLASSIC TAB VIEW */}
          {viewMode === "tabs" && (
            <>
              {/* Tab navigation */}
              <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 mx-4 mt-2">
                {contentTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setSelectedEntity(null);
                    }}
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      activeTab === tab.id
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Goal strip (convergence tab only) */}
              {activeTab === "convergence" && activeGoal && (
                <div className="mx-4 mt-2">
                  <GoalStrip goal={activeGoal} />
                </div>
              )}

              {/* Tab content with optional right panel */}
              <div className="mt-3 flex flex-1 gap-3 overflow-hidden px-4 pb-4">
                {/* Main content */}
                <div className="flex-1 overflow-hidden min-w-0 flex flex-col">
                  {/* Convergence View */}
                  {activeTab === "convergence" && (
                    expandedFinding ? (
                      <ConvergenceExpanded
                        finding={expandedFinding}
                        entities={entities}
                        onBack={() => setExpandedFinding(null)}
                      />
                    ) : (
                      <FindingsTab
                        findings={findings}
                        selectedFindingId={selectedFinding?.id ?? null}
                        onSelectFinding={(f) => setSelectedFinding(f)}
                      />
                    )
                  )}

                  {/* Graph View */}
                  {activeTab === "graph" && (
                    <div className="flex h-full flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-4">
                        <GraphControls
                          visibleDimensions={visibleDimensions}
                          onToggleDimension={toggleDimension}
                          onResetZoom={() => {}}
                          showExternal={showExternal}
                          onToggleExternal={
                            hasExternalEntities
                              ? () => setShowExternal(!showExternal)
                              : undefined
                          }
                          layoutType={layoutType}
                          onLayoutChange={setLayoutType}
                          searchQuery={searchQuery}
                          onSearchChange={setSearchQuery}
                          activeCategories={activeCategories}
                          onToggleCategory={toggleCategory}
                          activeImportances={activeImportances}
                          onToggleImportance={toggleImportance}
                          totalCount={externalFiltered.length}
                          filteredCount={filteredEntities.length}
                          autoRefreshInterval={autoRefresh.interval}
                          onAutoRefreshChange={autoRefresh.setInterval}
                          autoRefreshRunning={iterativeReasoning.isRunning}
                        />
                        <CoverageHud
                          entities={entities}
                          pairChecksCount={pairChecksCount}
                          onRunNow={handleScanNow}
                          running={manualScanRunning}
                          spaceId={space.id}
                        />
                        <ReasoningToolbar
                          activeOp={activeOp}
                          loading={reasoningLoading}
                          onRun={(op, params) =>
                            runReasoning(space.id, op, params)
                          }
                          onClear={clearResults}
                          selectedEntity={selectedEntity}
                          entities={entities}
                          disabled={iterativeReasoning.isRunning}
                        />
                        <DeepenButton
                          stage={iterativeReasoning.stage}
                          currentIteration={iterativeReasoning.currentIteration}
                          maxIterations={iterativeReasoning.maxIterations}
                          isRunning={iterativeReasoning.isRunning}
                          onRun={(n) => iterativeReasoning.run(n)}
                          onStop={iterativeReasoning.stop}
                        />
                      </div>
                      {/* Domain filter row */}
                      {hasSiblings && (
                        <div className="flex items-center gap-2 text-xs">
                          <button
                            onClick={() => setShowSiblings(!showSiblings)}
                            className={cn(
                              "rounded-md px-2.5 py-1 font-medium transition-colors",
                              showSiblings
                                ? "bg-interaxis-100 text-interaxis-700"
                                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                            )}
                          >
                            {showSiblings ? "Showing all areas" : "Show all areas"}
                            {hasBridges && !showSiblings && (
                              <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                                {bridges.length} bridge
                                {bridges.length !== 1 ? "s" : ""}
                              </span>
                            )}
                          </button>
                          {showSiblings &&
                            Object.entries(domainMap).map(
                              ([spaceId, { name, index }]) => {
                                const isActive = activeDomains.has(spaceId);
                                const domainColor =
                                  domainColors[index % domainColors.length];
                                return (
                                  <button
                                    key={spaceId}
                                    onClick={() => toggleDomain(spaceId)}
                                    className={cn(
                                      "flex items-center gap-1 rounded-md px-2 py-1 transition-colors",
                                      isActive
                                        ? "bg-white shadow-sm"
                                        : "opacity-40 hover:opacity-70"
                                    )}
                                  >
                                    <span
                                      className="inline-block h-2 w-2 rounded-full"
                                      style={{ background: domainColor.stroke }}
                                    />
                                    <span className="truncate max-w-[80px]">
                                      {name}
                                    </span>
                                  </button>
                                );
                              }
                            )}
                        </div>
                      )}
                      {space.orphan_count > 0 && (
                        <OrphanAlert orphanCount={space.orphan_count} />
                      )}
                      <div className="relative flex-1 min-h-[400px] rounded-xl border border-gray-200 bg-white">
                        <SpaceGraph
                          entities={filteredEntities}
                          edges={filteredEdges}
                          cycles={cycles}
                          onNodeClick={(entity) => {
                            setSelectedEntity(entity);
                            if (entity && chatApiRef.current) {
                              chatApiRef.current.pushFocus({
                                type: "entity",
                                entityId: entity.entity_id,
                                name: entity.name,
                              });
                              if (chatCollapsed) setChatOpen(true);
                            }
                          }}
                          onNodeDoubleClick={(entity) => {
                            // Double-click drills into the entity's tier-3 detail page
                            router.push(`/app/space/${space.id}/entity/${entity.id}`);
                          }}
                          visibleDimensions={visibleDimensions}
                          spaceDescription={space.description ?? space.name}
                          domainMap={showSiblings ? domainMap : undefined}
                          layoutType={layoutType}
                          selectedEntityId={selectedEntity?.id ?? null}
                        />
                      </div>
                    </div>
                  )}

                  {/* Analysis View */}
                  {activeTab === "analysis" && (
                    <AnalysisAccordion
                      entities={entities}
                      edges={edges}
                      cycles={cycles}
                      propositions={propositions}
                    />
                  )}

                  {/* Synthesis View */}
                  {activeTab === "synthesis" && (
                    <SynthesisView
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
                      onToggleActionDone={(actionId, done) => {
                        fetch(`/api/action-items/${actionId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ status: done ? "completed" : "pending" }),
                        }).catch(() => {});
                      }}
                    />
                  )}
                </div>

                {/* Right panel (contextual per tab) */}
                {activeTab === "convergence" && selectedFinding && !expandedFinding && (
                  <FindingDetailPanel
                    finding={selectedFinding}
                    entities={entities}
                    edges={edges}
                    onClose={() => setSelectedFinding(null)}
                  />
                )}
                {activeTab === "graph" && (
                  <div className="w-[260px] flex-shrink-0 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4">
                    {/* Iterative reasoning results */}
                    {(iterativeReasoning.deltas.length > 0 || iterativeReasoning.isRunning) && (
                      <div className="mb-4 border-b border-gray-100 pb-4">
                        <IterationResultsCard
                          deltas={iterativeReasoning.deltas}
                          isRunning={iterativeReasoning.isRunning}
                          stage={iterativeReasoning.stage}
                          currentIteration={iterativeReasoning.currentIteration}
                          totalAddedEdges={iterativeReasoning.totalAddedEdges}
                          totalAddedCycles={iterativeReasoning.totalAddedCycles}
                          onReset={iterativeReasoning.reset}
                        />
                      </div>
                    )}

                    {reasoningError && (
                      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                        {reasoningError}
                      </div>
                    )}
                    {activeOp && reasoningResult && (
                      <div className="mb-4 border-b border-gray-100 pb-4">
                        {activeOp === "centrality" && (
                          <CentralityResults result={reasoningResult} />
                        )}
                        {activeOp === "cycles" && (
                          <LoopDetailCards result={reasoningResult} />
                        )}
                        {activeOp === "cascade" && (
                          <CascadeResults result={reasoningResult} />
                        )}
                        {activeOp === "link_prediction" && (
                          <PredictionCards
                            result={reasoningResult}
                            onAccept={async (prediction) => {
                              const srcEntity = entities.find(
                                (e) => e.entity_id === prediction.source_id
                              );
                              const tgtEntity = entities.find(
                                (e) => e.entity_id === prediction.target_id
                              );
                              if (!srcEntity || !tgtEntity) return;

                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              const supabase = createClient() as any;
                              await supabase.from("edges").insert({
                                space_id: space.id,
                                source_entity_id: srcEntity.id,
                                target_entity_id: tgtEntity.id,
                                relationship_type: prediction.relationship_type,
                                dimension: prediction.dimension ?? "functional",
                                source_tag: "predicted" as const,
                                strength: 0.6,
                                polarity: "positive" as const,
                                confidence: prediction.confidence,
                                conditions: prediction.reasoning,
                              });
                              window.location.reload();
                            }}
                          />
                        )}
                        {activeOp === "path" && (
                          <PathResults result={reasoningResult} />
                        )}
                      </div>
                    )}
                    <GraphRightPanel
                      leveragePoints={leveragePoints}
                      cycles={cycles}
                      entityMap={entityMap}
                      bridges={bridges}
                      showBridges={showSiblings && bridges.length > 0}
                      spaceNames={
                        new Map(
                          Object.entries(domainMap).map(([id, d]) => [id, d.name])
                        )
                      }
                      currentSpaceId={space.id}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

      {/* Node detail slide-out */}
      {selectedEntity && (
        <NodeDetail
          entity={selectedEntity}
          edges={edges}
          entityMap={entityMap}
          spaceId={space.id}
          cycles={cycles}
          claims={claims}
          interactionField={(() => {
            const meta = (space.synthesis_data as Record<string, any>)?.interaction_metadata;
            if (!meta?.fields) return null;
            return (meta.fields as InteractionField[]).find(
              (f) => f.entity_id === selectedEntity.entity_id
            ) ?? null;
          })()}
          onClose={() => setSelectedEntity(null)}
          onExpand={(entity) => {
            expansion.expand(entity);
            setSelectedEntity(null);
          }}
          onNavigateToSection={(sectionIdSpec) => {
            // Switch to dashboard view and scroll to section
            // sectionIdSpec supports pipe-delimited fallbacks: "section-leverage|section-strategy"
            setViewMode("dashboard");
            const candidates = sectionIdSpec.split("|");
            const tryScroll = (attempts: number) => {
              for (const id of candidates) {
                const el = document.getElementById(id);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                  return;
                }
              }
              if (attempts > 0) {
                requestAnimationFrame(() => setTimeout(() => tryScroll(attempts - 1), 80));
              }
            };
            requestAnimationFrame(() => setTimeout(() => tryScroll(10), 50));
          }}
          onRunReasoning={(op: "cascade" | "path" | "centrality" | "cycles" | "link_prediction") => {
            // Switch to classic graph view, then trigger reasoning
            if (viewMode !== "tabs") {
              setViewMode("tabs");
              setActiveTab("graph");
            }
            // Run the reasoning operation with the selected entity
            runReasoning(space.id, op, {
              entityId: selectedEntity.entity_id,
            });
          }}
        />
      )}

      {/* Shell expansion overlay */}
      {expansion.isOpen && expansion.activeExpansion && (
        <ExpansionShell
          expansion={expansion.activeExpansion}
          breadcrumbs={expansion.breadcrumbs}
          budget={expansion.budget}
          loading={expansion.loading}
          error={expansion.error}
          onDrillInto={(sc) => {
            if (expansion.activeExpansion) {
              expansion.drillInto(sc, expansion.activeExpansion);
            }
          }}
          onGoBack={expansion.goBack}
          onGoToLevel={expansion.goToLevel}
          onClose={expansion.close}
        />
      )}
      </div>

      {/* Objective review flow — gates dashboard on first visit when objectives detected */}
      {!objectivesReviewed && pendingObjectives.length > 0 && (
        <ObjectiveReviewFlow
          objectives={pendingObjectives}
          spaceId={space.id}
          spaceName={space.name}
          onComplete={async (approved, ultimate) => {
            setObjectivesReviewed(true);
            // Create ultimate (parent) goal first
            let ultimateGoal: ImprovementGoal | null = null;
            try {
              const res = await fetch("/api/goals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  space_id: space.id,
                  title: ultimate.title,
                  description: ultimate.description,
                  metric_name: ultimate.metric_name,
                  metric_unit: ultimate.metric_unit ?? null,
                  target_value: ultimate.target_value,
                  baseline_value: ultimate.baseline_value,
                  objective_type: ultimate.objective_type,
                  source: "auto_detected",
                  parent_goal_id: null,
                }),
              });
              if (res.ok) {
                const data = await res.json();
                ultimateGoal = (data.goal ?? data) as ImprovementGoal;
                setGoalList((prev) => [ultimateGoal as ImprovementGoal, ...prev]);
                setActiveGoal(ultimateGoal);
              }
            } catch (err) {
              console.error("Failed to create ultimate goal:", err);
            }
            // Create each approved sub-objective as child of ultimate
            for (const obj of approved) {
              try {
                const res = await fetch("/api/goals", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    space_id: space.id,
                    title: obj.title,
                    description: obj.description,
                    metric_name: obj.metric_name,
                    metric_unit: obj.metric_unit ?? null,
                    target_value: obj.target_estimate ?? 100,
                    baseline_value: obj.baseline_estimate ?? 0,
                    objective_type: obj.objective_type,
                    source: "auto_detected",
                    parent_goal_id: ultimateGoal?.id ?? obj.parent_goal_id ?? null,
                    benchmark: obj.benchmark ?? null,
                  }),
                });
                if (res.ok) {
                  const data = await res.json();
                  const newGoal = (data.goal ?? data) as ImprovementGoal;
                  setGoalList((prev) => [newGoal, ...prev]);
                } else {
                  const errData = await res.json().catch(() => ({}));
                  console.error(`Failed to create goal "${obj.title}":`, res.status, errData);
                }
              } catch (err) {
                console.error("Failed to create goal from objective:", err);
              }
            }
            // Clear the pending review flag
            try {
              const supabase = createClient() as any;
              const { data: freshSpace } = await supabase
                .from("spaces")
                .select("synthesis_data")
                .eq("id", space.id)
                .single();
              if (freshSpace?.synthesis_data) {
                const sd = typeof freshSpace.synthesis_data === "string"
                  ? JSON.parse(freshSpace.synthesis_data)
                  : freshSpace.synthesis_data;
                await supabase
                  .from("spaces")
                  .update({
                    synthesis_data: { ...sd, objectives_pending_review: false },
                  })
                  .eq("id", space.id);
              }
            } catch (err) {
              console.error("Failed to clear objectives_pending_review:", err);
            }
            // Notify the Operating Twin to re-evaluate build state now that objectives are approved
            window.dispatchEvent(
              new CustomEvent("interaxis:objectives-confirmed", {
                detail: { spaceId: space.id, goalCount: approved.length },
              }),
            );
            // Refresh to get fresh server data for the dashboard
            router.refresh();
          }}
          onSkip={async () => {
            setObjectivesReviewed(true);
            // Clear the pending review flag
            try {
              const supabase = createClient() as any;
              const { data: freshSpace } = await supabase
                .from("spaces")
                .select("synthesis_data")
                .eq("id", space.id)
                .single();
              if (freshSpace?.synthesis_data) {
                const sd = typeof freshSpace.synthesis_data === "string"
                  ? JSON.parse(freshSpace.synthesis_data)
                  : freshSpace.synthesis_data;
                await supabase
                  .from("spaces")
                  .update({
                    synthesis_data: { ...sd, objectives_pending_review: false },
                  })
                  .eq("id", space.id);
              }
            } catch (err) {
              console.error("Failed to clear objectives_pending_review on skip:", err);
            }
            // Refresh so dashboard sees suggested_objectives (they persist after skip)
            router.refresh();
          }}
        />
      )}

      {/* Goal setter modal */}
      {showGoalSetter && (
        <GoalSetter
          spaceId={space.id}
          prefill={goalPrefill}
          onCreated={(goal) => {
            const newGoal = goal as ImprovementGoal;
            setGoalList((prev) => [newGoal, ...prev]);
            setActiveGoal(newGoal);
            setShowGoalSetter(false);
            setGoalPrefill(null);
          }}
          onClose={() => {
            setShowGoalSetter(false);
            setGoalPrefill(null);
          }}
        />
      )}
    </div>
  );
}
