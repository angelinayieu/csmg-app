"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
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
import { edgeDimensionStyles, domainColors } from "@/lib/design-tokens";
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
} from "@/types";

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
}

const tabs = [
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
}: SpaceDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("graph");
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [visibleDimensions, setVisibleDimensions] = useState<Set<string>>(
    () => new Set(Object.keys(edgeDimensionStyles))
  );
  const [showExternal, setShowExternal] = useState(true);
  const [showSiblings, setShowSiblings] = useState(false);
  const [activeDomains, setActiveDomains] = useState<Set<string>>(() => new Set([space.id]));

  // Check if space has external entities
  const hasExternalEntities = entities.some((e) => e.knowledge_layer === "external");
  const hasSiblings = siblingEntities.length > 0;

  // Build unified entity/edge lists when showing siblings
  const unifiedEntities = useMemo(() => {
    if (!showSiblings) return entities;
    return [...entities, ...siblingEntities.filter((e) => activeDomains.has(e.space_id))];
  }, [entities, siblingEntities, showSiblings, activeDomains]);

  const unifiedEdges = useMemo(() => {
    if (!showSiblings) return edges;
    const activeEntityIds = new Set(unifiedEntities.map((e) => e.id));
    return [...edges, ...siblingEdges.filter((e) =>
      activeDomains.has(e.space_id) &&
      activeEntityIds.has(e.source_entity_id) &&
      activeEntityIds.has(e.target_entity_id)
    )];
  }, [edges, siblingEdges, showSiblings, activeDomains, unifiedEntities]);

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
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
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

      {/* Tab content with optional right panel */}
      <div className="mt-4 flex flex-1 gap-4 overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 overflow-y-auto">
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
                />
                <ReasoningToolbar
                  activeOp={activeOp}
                  loading={reasoningLoading}
                  onRun={(op, params) => runReasoning(space.id, op, params)}
                  onClear={clearResults}
                  selectedEntity={selectedEntity}
                  entities={entities}
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
                  visibleDimensions={visibleDimensions}
                  spaceDescription={space.description ?? space.name}
                  domainMap={showSiblings ? domainMap : undefined}
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
            />
          )}
        </div>

        {/* Right panel (contextual per tab) */}
        {activeTab === "graph" && (
          <div className="w-[260px] flex-shrink-0 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4">
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
          onClose={() => setSelectedEntity(null)}
        />
      )}
    </div>
  );
}
