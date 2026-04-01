"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
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
import { edgeDimensionStyles } from "@/lib/design-tokens";
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
}: SpaceDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("graph");
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [visibleDimensions, setVisibleDimensions] = useState<Set<string>>(
    () => new Set(Object.keys(edgeDimensionStyles))
  );
  const {
    loading: reasoningLoading,
    activeOp,
    result: reasoningResult,
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
                />
                <ReasoningToolbar
                  activeOp={activeOp}
                  loading={reasoningLoading}
                  onRun={(op) => runReasoning(space.id, op)}
                  onClear={clearResults}
                />
              </div>
              {space.orphan_count > 0 && (
                <OrphanAlert orphanCount={space.orphan_count} />
              )}
              <div className="relative flex-1 min-h-[400px] rounded-xl border border-gray-200 bg-white">
                <SpaceGraph
                  entities={entities}
                  edges={edges}
                  cycles={cycles}
                  onNodeClick={setSelectedEntity}
                  visibleDimensions={visibleDimensions}
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
                  <PredictionCards result={reasoningResult} />
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
