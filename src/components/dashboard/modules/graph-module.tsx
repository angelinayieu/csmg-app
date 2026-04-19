"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Network } from "lucide-react";
import type { Space, Entity, Edge, Cycle, Bridge } from "@/types";
import type { InteractionMetadata } from "@/types/interactions";
import type { ReasoningOp } from "@/lib/hooks/use-reasoning";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { SpaceGraph } from "@/components/graph/space-graph";
import { CanvasGraph } from "@/components/graph/canvas-graph";
import { GraphControls } from "@/components/graph/graph-controls";
import { GraphRightPanel } from "@/components/graph/graph-right-panel";
import { ReasoningToolbar } from "@/components/reasoning/reasoning-toolbar";
import { OrphanAlert } from "@/components/graph/orphan-alert";
import { CentralityResults } from "@/components/reasoning/centrality-results";
import { CascadeResults } from "@/components/reasoning/cascade-results";
import { PredictionCards } from "@/components/reasoning/prediction-card";
import { PathResults } from "@/components/reasoning/path-results";
import { LoopDetailCards } from "@/components/reasoning/loop-detail-card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { domainColors } from "@/lib/design-tokens";
import type { LayoutType } from "@/lib/graph/layout-engine";
import { inferVisualizationType } from "@/lib/graph/layout-engine";

interface GraphModuleProps {
  space: Space;
  filteredEntities: Entity[];
  filteredEdges: Edge[];
  cycles: Cycle[];
  entities: Entity[];
  leveragePoints: Entity[];
  entityMap: Map<string, Entity>;
  // Graph controls
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
  domainMap: Record<string, { name: string; index: number }>;
  bridges: Bridge[];
  onNodeClick: (entity: Entity) => void;
  // Reasoning
  activeOp: ReasoningOp | null;
  reasoningLoading: boolean;
  onRunReasoning: (op: ReasoningOp, params?: Record<string, string>) => void;
  onClearResults: () => void;
  reasoningResult: unknown;
  reasoningError: string | null;
  selectedEntity: Entity | null;
  /** Interaction metadata from synthesis — powers field/tension/corridor overlays */
  interactionMetadata?: InteractionMetadata | null;
}

export function GraphModule({
  space,
  filteredEntities,
  filteredEdges,
  cycles,
  entities,
  leveragePoints,
  entityMap,
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
  domainMap,
  bridges,
  onNodeClick,
  activeOp,
  reasoningLoading,
  onRunReasoning,
  onClearResults,
  reasoningResult,
  reasoningError,
  selectedEntity,
  interactionMetadata,
}: GraphModuleProps) {
  const router = useRouter();
  const [layoutType, setLayoutType] = useState<LayoutType>("force");

  // Infer best layout from graph topology
  const inferredLayout = useMemo(
    () => inferVisualizationType(filteredEntities, filteredEdges),
    [filteredEntities, filteredEdges]
  );

  return (
    <DashboardCard
      title="Knowledge Map"
      icon={<Network className="h-4 w-4" />}
      subtitle={(() => {
        const core = filteredEntities.filter(e => e.knowledge_layer !== "external").length;
        const ext = filteredEntities.filter(e => e.knowledge_layer === "external").length;
        const parts = [];
        if (core > 0) parts.push(`${core} core`);
        if (ext > 0) parts.push(`${ext} external`);
        if (parts.length === 0) parts.push("0 entities");
        return `${parts.join(" + ")} entities, ${filteredEdges.length} edges`;
      })()}
      fullscreenable
      contentClassName="p-0"
    >
      <div className="flex flex-col gap-2 p-3">
        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-3">
          <GraphControls
            visibleDimensions={visibleDimensions}
            onToggleDimension={onToggleDimension}
            onResetZoom={() => {}}
            showExternal={showExternal}
            onToggleExternal={onToggleExternal}
            layoutType={layoutType}
            onLayoutChange={setLayoutType}
            inferredLayout={inferredLayout}
          />
          <ReasoningToolbar
            activeOp={activeOp}
            loading={reasoningLoading}
            onRun={onRunReasoning}
            onClear={onClearResults}
            selectedEntity={selectedEntity}
            entities={entities}
          />
        </div>

        {/* Domain filter row */}
        {hasSiblings && (
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={onToggleSiblings}
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
            {showSiblings &&
              Object.entries(domainMap).map(([spaceId, { name, index }]) => {
                const isActive = activeDomains.has(spaceId);
                const domainColor = domainColors[index % domainColors.length];
                return (
                  <button
                    key={spaceId}
                    onClick={() => onToggleDomain(spaceId)}
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
                    <span className="truncate max-w-[80px]">{name}</span>
                  </button>
                );
              })}
          </div>
        )}

        {space.orphan_count > 0 && (
          <OrphanAlert orphanCount={space.orphan_count} />
        )}
      </div>

      {/* Graph legend — compact visual decoder */}
      <div className="flex flex-wrap items-center gap-3 px-3 pb-2 text-[9px] text-gray-400">
        <span className="font-semibold text-gray-500 uppercase tracking-wider">Legend:</span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#E6F1FB" stroke="#378ADD" strokeWidth="1"/></svg>
          Concrete
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#EEEDFE" stroke="#7F77DD" strokeWidth="1"/></svg>
          Abstract
        </span>
        <span className="flex items-center gap-1">
          <svg width="16" height="12"><rect x="1" y="2" width="14" height="8" rx="3" fill="#E1F5EE" stroke="#1D9E75" strokeWidth="1"/></svg>
          Process
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12"><rect x="2" y="2" width="8" height="8" rx="1" fill="#FAECE7" stroke="#D85A30" strokeWidth="1" transform="rotate(45 6 6)"/></svg>
          Relational
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#FBEAF0" stroke="#D4537E" strokeWidth="1" strokeDasharray="2 1"/></svg>
          Epistemic
        </span>
        <span className="mx-1 text-gray-300">|</span>
        <span className="flex items-center gap-1">
          <svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="#EF9F27" strokeWidth="1.5" strokeDasharray="2 1"/></svg>
          Leverage
        </span>
        <span className="flex items-center gap-1">
          <svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="#E24B4A" strokeWidth="1.5" strokeDasharray="2 1"/></svg>
          Risk
        </span>
        <span className="flex items-center gap-1">
          <svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="#E24B4A" strokeWidth="2"/></svg>
          Bottleneck
        </span>
        <span className="mx-1 text-gray-300">|</span>
        <span className="text-gray-400">Size = importance</span>
        <span className="flex items-center gap-1">
          <svg width="14" height="14"><circle cx="7" cy="7" r="4" fill="#E6F1FB30" stroke="#86868B" strokeWidth="0.5" strokeDasharray="2 2"/></svg>
          External
        </span>
      </div>

      {/* Graph — explicit height so SVG h-full resolves correctly */}
      <div className="relative h-[600px] border-t border-gray-100">
        {layoutType === "dense" ? (
          <CanvasGraph
            entities={filteredEntities}
            edges={filteredEdges}
            onNodeClick={onNodeClick}
          />
        ) : (
          <SpaceGraph
            entities={filteredEntities}
            edges={filteredEdges}
            cycles={cycles}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={(entity) => {
              router.push(`/app/space/${space.id}/entity/${entity.id}`);
            }}
            visibleDimensions={visibleDimensions}
            spaceDescription={space.description ?? space.name}
            domainMap={showSiblings ? domainMap : undefined}
            layoutType={layoutType}
            interactionMetadata={interactionMetadata}
          />
        )}
      </div>

      {/* Reasoning results + Right panel summary */}
      {(activeOp || leveragePoints.length > 0 || cycles.length > 0) && (
        <div className="border-t border-gray-100 p-3">
          {reasoningError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {reasoningError}
            </div>
          )}
          {activeOp && reasoningResult != null && (
            <div className="mb-3 border-b border-gray-100 pb-3">
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
                Object.entries(domainMap).map(([sid, d]) => [sid, d.name])
              )
            }
            currentSpaceId={space.id}
          />
        </div>
      )}
    </DashboardCard>
  );
}
