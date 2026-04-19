"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSpaceData } from "@/contexts/space-data-context";
import { SpaceGraph } from "@/components/graph/space-graph";
import { GraphControls } from "@/components/graph/graph-controls";
import { GraphRightPanel } from "@/components/graph/graph-right-panel";
import { ReasoningToolbar } from "@/components/reasoning/reasoning-toolbar";
import { OrphanAlert } from "@/components/graph/orphan-alert";
import { useReasoning } from "@/lib/hooks/use-reasoning";
import { edgeDimensionStyles } from "@/lib/design-tokens";
import type { LayoutType } from "@/lib/graph/layout-engine";

export default function GraphPage() {
  const ctx = useSpaceData();
  const router = useRouter();

  const [visibleDimensions, setVisibleDimensions] = useState<Set<string>>(
    () => new Set(Object.keys(edgeDimensionStyles))
  );
  const [showExternal, setShowExternal] = useState(
    () => !ctx.entities.some((e) => e.knowledge_layer !== "external")
  );
  const [showSiblings, setShowSiblings] = useState(false);
  const [layoutType, setLayoutType] = useState<LayoutType>("force");
  const [activeDomains] = useState<Set<string>>(
    () => new Set([ctx.space.id])
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    () => new Set(["concrete", "abstract", "process", "relational", "epistemic"])
  );
  const [activeImportances, setActiveImportances] = useState<Set<string>>(
    () => new Set(["fundamental", "critical", "important", "moderate"])
  );

  function toggleDimension(dim: string) {
    setVisibleDimensions((prev) => {
      const next = new Set(prev);
      if (next.has(dim)) next.delete(dim);
      else next.add(dim);
      return next;
    });
  }
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

  const hasExternalEntities = ctx.entities.some((e) => e.knowledge_layer === "external");

  const allEntities = useMemo(() => {
    let base = ctx.entities;
    if (showSiblings) base = [...base, ...ctx.siblingEntities];
    return base;
  }, [ctx.entities, ctx.siblingEntities, showSiblings]);

  const externalFiltered = useMemo(() => {
    if (showExternal) return allEntities;
    return allEntities.filter((e) => e.knowledge_layer !== "external");
  }, [allEntities, showExternal]);

  const filteredEntities = useMemo(() => {
    return externalFiltered.filter((e) => {
      if (!activeCategories.has(e.entity_category ?? "concrete")) return false;
      if (!activeImportances.has(e.importance ?? "moderate")) return false;
      if (showSiblings && !activeDomains.has(e.space_id)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!e.name.toLowerCase().includes(q) && !(e.description ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [externalFiltered, activeCategories, activeImportances, showSiblings, activeDomains, searchQuery]);

  const filteredEdges = useMemo(() => {
    const entityIds = new Set(filteredEntities.map((e) => e.entity_id));
    const allEdges = showSiblings ? [...ctx.edges, ...ctx.siblingEdges] : ctx.edges;
    return allEdges.filter(
      (e) =>
        entityIds.has(e.source_entity_id) &&
        entityIds.has(e.target_entity_id) &&
        visibleDimensions.has(e.dimension)
    );
  }, [filteredEntities, ctx.edges, ctx.siblingEdges, showSiblings, visibleDimensions]);

  const { activeOp, loading: reasoningLoading, result: reasoningResult, error: reasoningError, runReasoning, clearResults } = useReasoning();

  const entityMap = useMemo(() => new Map(ctx.entities.map((e) => [e.entity_id, e])), [ctx.entities]);
  const leveragePoints = useMemo(() => ctx.entities.filter((e) => e.is_leverage_point), [ctx.entities]);

  return (
    <div className="flex h-full gap-3 p-4">
      <div className="flex-1 flex flex-col gap-3 min-w-0">
        <div className="flex flex-wrap items-center gap-4">
          <GraphControls
            visibleDimensions={visibleDimensions}
            onToggleDimension={toggleDimension}
            onResetZoom={() => {}}
            showExternal={showExternal}
            onToggleExternal={hasExternalEntities ? () => setShowExternal(!showExternal) : undefined}
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
          />
          <ReasoningToolbar
            activeOp={activeOp}
            loading={reasoningLoading}
            onRun={(op, params) => runReasoning(ctx.space.id, op, params)}
            onClear={clearResults}
            selectedEntity={ctx.selectedEntity}
            entities={ctx.entities}
            disabled={false}
          />
        </div>
        {ctx.space.orphan_count > 0 && (
          <OrphanAlert orphanCount={ctx.space.orphan_count} />
        )}
        <div className="relative flex-1 min-h-[400px] rounded-xl border border-gray-200 bg-white">
          <SpaceGraph
            entities={filteredEntities}
            edges={filteredEdges}
            cycles={ctx.cycles}
            onNodeClick={(entity) => {
              ctx.setSelectedEntity(entity);
              if (entity && ctx.chatApiRef.current) {
                ctx.chatApiRef.current.pushFocus({
                  type: "entity",
                  entityId: entity.entity_id,
                  name: entity.name,
                });
                if (!ctx.chatOpen) ctx.setChatOpen(true);
              }
            }}
            onNodeDoubleClick={(entity) => {
              router.push(`/app/space/${ctx.space.id}/entity/${entity.id}`);
            }}
            visibleDimensions={visibleDimensions}
            spaceDescription={ctx.space.description ?? ctx.space.name}
            domainMap={showSiblings ? ctx.domainMap : undefined}
            layoutType={layoutType}
            selectedEntityId={ctx.selectedEntity?.id ?? null}
          />
        </div>
      </div>
      <div className="w-[260px] flex-shrink-0 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4">
        {reasoningError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {reasoningError}
          </div>
        )}
        <GraphRightPanel
          leveragePoints={leveragePoints}
          cycles={ctx.cycles}
          entityMap={entityMap}
          bridges={ctx.bridges}
          showBridges={showSiblings && ctx.bridges.length > 0}
          spaceNames={new Map(Object.entries(ctx.domainMap).map(([id, d]) => [id, d.name]))}
          currentSpaceId={ctx.space.id}
        />
      </div>
    </div>
  );
}
