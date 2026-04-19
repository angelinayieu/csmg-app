"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { SpaceChat } from "@/components/chat/space-chat";
import { AnalysisAccordion } from "@/components/space/analysis-accordion";
import { SpaceGraph } from "@/components/graph/space-graph";
import { SynthesisView } from "@/components/synthesis/synthesis-view";
import { GraphControls } from "@/components/graph/graph-controls";
import { GraphRightPanel } from "@/components/graph/graph-right-panel";
import { NodeDetail } from "@/components/graph/node-detail";
import { OrphanAlert } from "@/components/graph/orphan-alert";
import { ReasoningToolbar } from "@/components/reasoning/reasoning-toolbar";
import { CentralityResults } from "@/components/reasoning/centrality-results";
import { CascadeResults } from "@/components/reasoning/cascade-results";
import { PredictionCards } from "@/components/reasoning/prediction-card";
import { PathResults } from "@/components/reasoning/path-results";
import { LoopDetailCards } from "@/components/reasoning/loop-detail-card";
import { useReasoning } from "@/lib/hooks/use-reasoning";
import { useIterativeReasoning } from "@/lib/hooks/use-iterative-reasoning";
import { DeepenButton } from "@/components/reasoning/deepen-button";
import { IterationResultsCard } from "@/components/reasoning/iteration-results-card";
import { edgeDimensionStyles, domainColors } from "@/lib/design-tokens";
import { FindingsTab } from "@/components/workspace/findings-tab";
import { FindingDetailPanel } from "@/components/workspace/finding-detail-panel";
import { ConvergenceExpanded } from "@/components/workspace/convergence-expanded";
import { GoalStrip } from "@/components/workspace/goal-strip";
import { rankFindings } from "@/lib/findings/rank-findings";
import type { LayoutType } from "@/lib/graph/layout-engine";
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
import type { InteractionField, InteractionMetadata } from "@/types/interactions";
import type { SynthesisData } from "@/types/synthesis";
import type { Finding } from "@/types/finding";
import type { ImprovementGoal } from "@/types/goals";

interface SpaceDetailTabsProps {
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
  activeGoal?: ImprovementGoal | null;
}

const tabs = [
  { id: "convergence", label: "Convergence" },
  { id: "graph", label: "Graph View" },
  { id: "analysis", label: "Analysis View" },
  { id: "synthesis", label: "Synthesis View" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function SpaceDetailTabs({
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
  activeGoal,
}: SpaceDetailTabsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("convergence");
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [expandedFinding, setExpandedFinding] = useState<Finding | null>(null);

  // Compute findings from synthesis data
  const findings = useMemo(() => {
    const synthRaw = space.synthesis_data;
    if (!synthRaw) return [];
    const synthData = (typeof synthRaw === "string" ? JSON.parse(synthRaw) : synthRaw) as SynthesisData;
    const interactionMeta = (synthData as unknown as Record<string, unknown>).interaction_metadata as InteractionMetadata | undefined;
    return rankFindings({
      synthesisData: synthData,
      entities,
      interactionMetadata: interactionMeta ?? null,
      activeGoal: activeGoal ?? null,
    });
  }, [space.synthesis_data, entities, activeGoal]);

  // Called after chat changes are accepted + incremental analysis completes
  const handleGraphChanged = useCallback(() => {
    router.refresh();
  }, [router]);
  const [visibleDimensions, setVisibleDimensions] = useState<Set<string>>(
    () => new Set(Object.keys(edgeDimensionStyles))
  );
  const [showExternal, setShowExternal] = useState(
    () => !entities.some((e) => e.knowledge_layer !== "external")
  );
  const [showSiblings, setShowSiblings] = useState(false);
  const [activeDomains, setActiveDomains] = useState<Set<string>>(() => new Set([space.id]));
  const [layoutType, setLayoutType] = useState<LayoutType>("force");

  // Check if space has external entities
  const hasExternalEntities = entities.some((e) => e.knowledge_layer === "external");
  const hasSiblings = siblingEntities.length > 0;
  const hasBridges = bridges.length > 0;

  // Convert bridges to synthetic Edge objects for graph rendering
  // These appear as gold dashed lines when sibling mode is active
  const bridgeEdges = useMemo<Edge[]>(() => {
    if (!showSiblings || bridges.length === 0) return [];
    return bridges.map((b) => ({
      id: `bridge-${b.id}`,
      space_id: b.source_space_id,
      source_entity_id: b.source_entity_id,
      target_entity_id: b.target_entity_id,
      relationship_type: b.shared_variable_name,
      dimension: "comparative",
      source_tag: "predicted",
      strength: b.coupling_strength === "strong" ? 0.9 : b.coupling_strength === "moderate" ? 0.7 : 0.5,
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
    } as unknown as Edge));
  }, [bridges, showSiblings]);

  // Build unified entity/edge lists when showing siblings
  const unifiedEntities = useMemo(() => {
    if (!showSiblings) return entities;
    return [...entities, ...siblingEntities.filter((e) => activeDomains.has(e.space_id))];
  }, [entities, siblingEntities, showSiblings, activeDomains]);

  const unifiedEdges = useMemo(() => {
    if (!showSiblings) return edges;
    const activeEntityIds = new Set(unifiedEntities.map((e) => e.id));
    const sibEdges = siblingEdges.filter((e) =>
      activeDomains.has(e.space_id) &&
      activeEntityIds.has(e.source_entity_id) &&
      activeEntityIds.has(e.target_entity_id)
    );
    // Include bridge edges — cross-space connections rendered as gold dashed lines
    const validBridgeEdges = bridgeEdges.filter((e) =>
      activeEntityIds.has(e.source_entity_id) &&
      activeEntityIds.has(e.target_entity_id)
    );
    return [...edges, ...sibEdges, ...validBridgeEdges];
  }, [edges, siblingEdges, showSiblings, activeDomains, unifiedEntities, bridgeEdges]);

  // Filter entities/edges based on external toggle
  const filteredEntities = showExternal
    ? unifiedEntities
    : unifiedEntities.filter((e) => e.knowledge_layer !== "external");
  const filteredEdges = showExternal
    ? unifiedEdges
    : unifiedEdges.filter((e) => e.knowledge_layer !== "external");

  function toggleDomain(spaceId: string) {
    setActiveDomains((prev) => {
      const next = new Set(prev);
      if (next.has(spaceId)) {
        if (next.size > 1) next.delete(spaceId); // Don't allow deselecting all
      } else {
        next.add(spaceId);
      }
      return next;
    });
  }
  const {
    loading: reasoningLoading,
    activeOp,
    result: reasoningResult,
    error: reasoningError,
    runReasoning,
    clearResults,
  } = useReasoning();

  const iterativeReasoning = useIterativeReasoning(space.id);

  // Build entity UUID → Entity lookup for NodeDetail
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

  return (
    <div className="flex h-full flex-col">
      {/* Tab navigation */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1 rounded-lg bg-gray-100 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSelectedEntity(null);
              }}
              className={cn(
                "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowChat(!showChat)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
            showChat
              ? "border-interaxis-300 bg-interaxis-50 text-interaxis-700"
              : "border-gray-200 bg-white text-gray-600 hover:text-gray-900 hover:border-gray-300"
          )}
        >
          <MessageCircle className="h-4 w-4" />
          Chat
        </button>
      </div>

      {/* Goal strip (visible on convergence tab) */}
      {activeTab === "convergence" && activeGoal && (
        <div className="mt-3">
          <GoalStrip goal={activeGoal} />
        </div>
      )}

      {/* Tab content with optional right panel */}
      <div className="mt-4 flex flex-1 gap-4 overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 overflow-hidden flex flex-col">
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
                onSelectFinding={(f) => {
                  setSelectedFinding(f);
                  // If convergence type, double-click could expand
                }}
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
                  onResetZoom={() => {
                    /* handled by graph double-click */
                  }}
                  showExternal={showExternal}
                  onToggleExternal={hasExternalEntities ? () => setShowExternal(!showExternal) : undefined}
                  layoutType={layoutType}
                  onLayoutChange={setLayoutType}
                />
                <ReasoningToolbar
                  activeOp={activeOp}
                  loading={reasoningLoading}
                  onRun={(op, params) => runReasoning(space.id, op, params)}
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
                        {bridges.length} bridge{bridges.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </button>
                  {showSiblings && Object.entries(domainMap).map(([spaceId, { name, index }]) => {
                    const isActive = activeDomains.has(spaceId);
                    const domainColor = domainColors[index % domainColors.length];
                    return (
                      <button
                        key={spaceId}
                        onClick={() => toggleDomain(spaceId)}
                        className={cn(
                          "flex items-center gap-1 rounded-md px-2 py-1 transition-colors",
                          isActive ? "bg-white shadow-sm" : "opacity-40 hover:opacity-70"
                        )}
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: domainColor.stroke }}
                        />
                        <span className="truncate max-w-[80px]">{name}</span>
                      </button>
                    );
                  })}
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
                  onNodeClick={setSelectedEntity}
                  onNodeDoubleClick={(entity) => {
                    router.push(`/app/space/${space.id}/entity/${entity.id}`);
                  }}
                  visibleDimensions={visibleDimensions}
                  spaceDescription={space.description ?? space.name}
                  domainMap={showSiblings ? domainMap : undefined}
                  layoutType={layoutType}
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

            {/* Reasoning error display */}
            {reasoningError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {reasoningError}
              </div>
            )}

            {/* Reasoning results (contextual) */}
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
                      // Find entity UUIDs
                      const srcEntity = entities.find(
                        (e) => e.entity_id === prediction.source_id
                      );
                      const tgtEntity = entities.find(
                        (e) => e.entity_id === prediction.target_id
                      );
                      if (!srcEntity || !tgtEntity) return;

                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const supabase = createClient() as any;
                      await supabase
                        .from("edges")
                        .insert({
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
                      // Refresh the page to show new edge
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
              spaceNames={new Map(Object.entries(domainMap).map(([id, d]) => [id, d.name]))}
              currentSpaceId={space.id}
            />
          </div>
        )}
      </div>

      {/* Node detail slide-out */}
      {selectedEntity && (
        <NodeDetail
          entity={selectedEntity}
          edges={edges}
          entityMap={entityMap}
          spaceId={space.id}
          interactionField={(() => {
            const meta = (space.synthesis_data as Record<string, any>)?.interaction_metadata;
            if (!meta?.fields) return null;
            return (meta.fields as InteractionField[]).find(
              (f) => f.entity_id === selectedEntity.entity_id
            ) ?? null;
          })()}
          onClose={() => setSelectedEntity(null)}
        />
      )}

      {/* Chat panel */}
      {showChat && (
        <SpaceChat
          spaceId={space.id}
          entities={entities}
          onClose={() => setShowChat(false)}
          onGraphChanged={handleGraphChanged}
        />
      )}
    </div>
  );
}
