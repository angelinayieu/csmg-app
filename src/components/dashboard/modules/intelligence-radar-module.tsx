"use client";

import React, { useState, useMemo, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { Radar, RefreshCw, TrendingUp, Shield, Zap } from "lucide-react";
import type { Space, Entity, Edge } from "@/types";
import type { ExternalCategory, EpistemicNodeType } from "@/types/intelligence";
import { useIntelligenceRadar } from "@/lib/hooks/use-intelligence-radar";
import { Ring } from "@/components/ui/ring";

// ── New Knowledge Stack components ──
import { KnowledgeStackBar } from "@/components/intelligence/knowledge-stack-bar";
import { GraphFilterRail, type GraphLayoutMode } from "@/components/intelligence/graph-filter-rail";
import { KnowledgeGraph, type SemanticZoomLevel } from "@/components/intelligence/knowledge-graph";
import { EntityInspector } from "@/components/intelligence/entity-inspector";
import { GraphToolbar } from "@/components/intelligence/graph-toolbar";
import { InsightsEvidencePanel } from "@/components/intelligence/insights-evidence-panel";
import { StackHealthPanel } from "@/components/intelligence/stack-health-panel";
import { OperationsPanel } from "@/components/intelligence/operations-panel";
import { RadarCollapsedView, computeWeakStage } from "@/components/intelligence/radar-collapsed-view";

// ── Preserved sub-components for deep drawer ──
import { DeepIntelligenceDrawer } from "@/components/intelligence/deep-intelligence-drawer";

// ── Props ──

interface IntelligenceRadarModuleProps {
  space: Space;
  entities: Entity[];
  edges: Edge[];
}

type BottomTab = "insights" | "health" | "operations";

export function IntelligenceRadarModule({
  space,
  entities,
  edges,
}: IntelligenceRadarModuleProps) {
  const radar = useIntelligenceRadar(space, entities, edges);

  // ── Knowledge Stack UI state ──
  const [graphLayout, setGraphLayout] = useState<GraphLayoutMode>("force");
  const [semanticZoom, setSemanticZoom] = useState<SemanticZoomLevel>(3);
  const [taxonomyMode, setTaxonomyMode] = useState<"epistemic" | "domain">("domain");
  const [filterRailCollapsed, setFilterRailCollapsed] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>("insights");
  const [graphView, setGraphView] = useState<"graph" | "matrix" | "timeline" | "tree">("graph");
  const [showDeepDrawer, setShowDeepDrawer] = useState(false);

  // ── Graph filter state ──
  const [activeEpistemicTypes, setActiveEpistemicTypes] = useState<Set<EpistemicNodeType>>(
    () => new Set(["claim", "evidence", "hypothesis", "pattern", "question", "actor"] as EpistemicNodeType[])
  );
  const [activeDomainCategories, setActiveDomainCategories] = useState<Set<ExternalCategory>>(
    () => new Set(["competitor", "framework", "pattern", "data_point", "analogy", "risk_pattern", "resource"] as ExternalCategory[])
  );
  const [activeEdgeTypes, setActiveEdgeTypes] = useState<Set<string>>(() => new Set());
  const [minCredibility, setMinCredibility] = useState(0);
  const [minConnectionStrength, setMinConnectionStrength] = useState(0);
  const [clusterThreshold, setClusterThreshold] = useState(2);

  // ── Derived data for filter rail ──

  const epistemicTypeCounts = useMemo(() => {
    const m = new Map<EpistemicNodeType, number>();
    for (const [, type] of radar.epistemicTypeMap) {
      m.set(type, (m.get(type) ?? 0) + 1);
    }
    return m;
  }, [radar.epistemicTypeMap]);

  const domainCategoryCounts = useMemo(() => {
    const m = new Map<ExternalCategory, number>();
    for (const e of radar.externalEntities) {
      const prov = e.provenance as Record<string, unknown> | null;
      const cat = (prov?.category as ExternalCategory) ?? "pattern";
      m.set(cat, (m.get(cat) ?? 0) + 1);
    }
    return m;
  }, [radar.externalEntities]);

  const edgeTypeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) {
      const rel = e.relationship_type ?? "unknown";
      m.set(rel, (m.get(rel) ?? 0) + 1);
    }
    return m;
  }, [edges]);

  // ── Visible entity IDs (filtered) ──

  const visibleEntityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entities) {
      const eid = e.entity_id;
      const epistemic = radar.epistemicTypeMap.get(eid) ?? "claim";
      const prov = e.provenance as Record<string, unknown> | null;
      const cat = (prov?.category as ExternalCategory) ?? undefined;

      // Filter by taxonomy mode
      if (taxonomyMode === "epistemic") {
        if (!activeEpistemicTypes.has(epistemic)) continue;
      } else {
        if (cat && !activeDomainCategories.has(cat)) continue;
      }

      // Filter by credibility
      const cred = radar.credibilityMap.get(eid);
      if (cred && cred.effective_confidence < minCredibility) continue;

      ids.add(eid);
    }
    return ids;
  }, [entities, radar.epistemicTypeMap, radar.credibilityMap, taxonomyMode,
      activeEpistemicTypes, activeDomainCategories, minCredibility]);

  // ── Toggle helpers ──

  const toggleEpistemicType = useCallback((type: EpistemicNodeType) => {
    setActiveEpistemicTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  const toggleDomainCategory = useCallback((cat: ExternalCategory) => {
    setActiveDomainCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  const toggleEdgeType = useCallback((type: string) => {
    setActiveEdgeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  // ── Focused entity (for toolbar pill) ──

  const focusedEntity = useMemo(() => {
    if (!radar.selectedEntityId) return null;
    const e = entities.find((e) => e.entity_id === radar.selectedEntityId);
    if (!e) return null;
    return { id: e.entity_id, name: e.name };
  }, [radar.selectedEntityId, entities]);

  // ── Computed data ──

  const { summary } = radar;
  const weakStage = computeWeakStage(radar.stackHealth);
  const fullscreenTriggerRef = useRef<(() => void) | null>(null);

  // ── Empty state ──

  if (!radar.hasExternalData && radar.internalEntities.length === 0) {
    return (
      <DashboardCard
        title="Intelligence Radar"
        icon={<Radar className="h-4 w-4 text-blue-500" />}
        subtitle="No data yet"
        className="border-blue-200/50"
      >
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Radar className="h-10 w-10 text-gray-200 mb-3" />
          <p className="text-[13px] text-gray-400">No intelligence data available yet.</p>
          <p className="text-[11px] text-gray-300 mt-1">
            Add entities and run research to build the knowledge stack.
          </p>
        </div>
      </DashboardCard>
    );
  }

  // ── Collapsed view (dashboard card mode) ──

  const collapsedContent = (
    <RadarCollapsedView
      stackCounts={radar.stackCounts}
      stackHealth={radar.stackHealth}
      weakStage={weakStage}
      summary={summary}
      coverageScore={summary.coverage_score}
      attentionItems={radar.radarV2?.narrative?.attention_items?.map((a) => ({
        title: a.title,
        reason: a.reason,
        source: a.source,
      })) ?? []}
      v2Decisions={radar.radarV2?.priority_decisions_v2 ?? []}
      researchLoading={radar.researchLoading}
      onTriggerResearch={() => radar.triggerResearch()}
      onExpandFullscreen={() => fullscreenTriggerRef.current?.()}
      signalCount={radar.signals.length}
      agentCount={radar.agentFleet.length}
      runningAgentCount={radar.agentFleet.filter((a) => a.status === "running").length}
      signals={radar.signals}
      agentFleet={radar.agentFleet}
      goalName={radar.radarV2?.narrative?.executive_summary?.split(".")[0] ?? undefined}
    />
  );

  // ── Fullscreen view (3-column + bottom panels) ──

  const fullscreenContent = (
    <div className="flex flex-col h-full">
      {/* Research result/error banner */}
      {radar.researchResult && (
        <div className="flex items-center gap-3 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl mx-3 mt-2 mb-1 shadow-sm">
          <div className="h-6 w-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <Zap className="h-3 w-3 text-emerald-600" />
          </div>
          <span className="text-[11px] font-medium text-emerald-700 flex-1">
            Research complete: <span className="font-bold">{radar.researchResult.entitiesCreated}</span> entities, <span className="font-bold">{radar.researchResult.edgesCreated}</span> edges
            {(radar.researchResult.searchesPerformed ?? 0) > 0 && (<>, <span className="font-bold">{radar.researchResult.searchesPerformed}</span> web searches</>)}
          </span>
          <button onClick={() => radar.dismissResearchResult()} className="rounded-full p-0.5 text-emerald-400 hover:text-emerald-600 hover:bg-emerald-100 transition-colors">&times;</button>
        </div>
      )}
      {radar.researchError && (
        <div className="flex items-center gap-3 px-4 py-2 bg-red-50 border border-red-200 rounded-xl mx-3 mt-2 mb-1 shadow-sm">
          <span className="text-[11px] font-medium text-red-700 flex-1">Research failed: {radar.researchError}</span>
        </div>
      )}
      {/* Knowledge Stack Bar */}
      <KnowledgeStackBar
        counts={radar.stackCounts}
        health={radar.stackHealth}
        researchLoading={radar.researchLoading}
        researchQueueCount={radar.continuationSignals.length}
        weakStage={weakStage}
        className="flex-shrink-0"
        signalCount={radar.signals.length}
        agentRunningCount={radar.agentFleet.filter((a) => a.status === "running").length}
      />

      {/* 3-Column Graph Layout */}
      <div className="flex flex-1 min-h-0 gap-2 mt-2">
        {/* Left Rail */}
        <GraphFilterRail
          graphLayout={graphLayout}
          onLayoutChange={setGraphLayout}
          epistemicTypes={epistemicTypeCounts}
          domainCategories={domainCategoryCounts}
          activeEpistemicTypes={activeEpistemicTypes}
          activeDomainCategories={activeDomainCategories}
          onToggleEpistemicType={toggleEpistemicType}
          onToggleDomainCategory={toggleDomainCategory}
          taxonomyMode={taxonomyMode}
          onTaxonomyModeChange={setTaxonomyMode}
          edgeTypes={edgeTypeCounts}
          activeEdgeTypes={activeEdgeTypes}
          onToggleEdgeType={toggleEdgeType}
          minCredibility={minCredibility}
          onMinCredibilityChange={setMinCredibility}
          minConnectionStrength={minConnectionStrength}
          onMinConnectionStrengthChange={setMinConnectionStrength}
          clusterThreshold={clusterThreshold}
          onClusterThresholdChange={setClusterThreshold}
          collapsed={filterRailCollapsed}
          onCollapsedChange={setFilterRailCollapsed}
        />

        {/* Center: Toolbar + Graph Canvas */}
        <div className="flex-1 flex flex-col min-w-0">
          <GraphToolbar
            activeView={graphView}
            onViewChange={(v) => setGraphView(v)}
            focusedEntity={focusedEntity}
            onClearFocus={() => radar.setSelectedEntityId(null)}
            onExport={() => {
              // Export the graph SVG
              const svgEl = document.querySelector('.kg-canvas')?.closest('svg');
              if (!svgEl) return;
              const clone = svgEl.cloneNode(true) as SVGSVGElement;
              clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
              const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `knowledge-graph-${new Date().toISOString().slice(0, 10)}.svg`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            onFilterToggle={() => setFilterRailCollapsed(!filterRailCollapsed)}
            layout={graphLayout}
            semanticZoom={semanticZoom}
            onSemanticZoomChange={setSemanticZoom}
          />
          <KnowledgeGraph
            entities={entities}
            edges={edges}
            entityRingMap={radar.entityRingMap}
            epistemicTypeMap={radar.epistemicTypeMap}
            credibilityMap={radar.credibilityMap}
            clusters={radar.graphClusters}
            floatingEntities={radar.floatingEntities}
            signals={radar.signals}
            layout={graphLayout}
            semanticZoom={semanticZoom}
            taxonomyMode={taxonomyMode}
            visibleEntityIds={visibleEntityIds}
            visibleEdgeTypes={activeEdgeTypes}
            minCredibility={minCredibility}
            selectedEntityId={radar.selectedEntityId}
            focusedEntityId={radar.selectedEntityId}
            onNodeClick={(e) => radar.setSelectedEntityId(e.entity_id)}
            onBackgroundClick={() => radar.setSelectedEntityId(null)}
          />
        </div>

        {/* Right Inspector */}
        <EntityInspector
          entityId={radar.selectedEntityId}
          entities={entities}
          edges={edges}
          credibilityMap={radar.credibilityMap}
          epistemicTypeMap={radar.epistemicTypeMap}
          connectionAnalysis={radar.connectionAnalysis}
          crossContextInsights={radar.crossContextInsights}
          signals={radar.signals}
          axioms={radar.axioms}
          insightConvergences={radar.insightConvergences}
          assumptionInversions={radar.assumptionInversions}
          expansionAxioms={radar.expansionAxioms}
          onClose={() => radar.setSelectedEntityId(null)}
          onNavigate={(eid) => radar.setSelectedEntityId(eid)}
          onAuthorityChange={radar.updateEntityAuthority}
          onSignalAction={(signalId, status) => radar.updateSignalStatus(signalId, status)}
        />
      </div>

      {/* Bottom Panels (tabbed) */}
      <div className="flex-shrink-0 border-t border-gray-200/80 mt-2">
        <div className="flex gap-0.5 px-4 pt-2 bg-gray-50/50">
          {([
            { key: "insights" as const, label: "Insights" },
            { key: "health" as const, label: "Stack Health" },
            { key: "operations" as const, label: "Operations" },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setBottomTab(tab.key)}
              className={cn(
                "px-3.5 py-1.5 rounded-t-lg text-[11px] font-medium transition-all border-b-2 -mb-px",
                bottomTab === tab.key
                  ? "text-interaxis-700 border-interaxis-500 bg-white shadow-sm"
                  : "text-gray-400 border-transparent hover:text-gray-600 hover:bg-white/50"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="max-h-52 overflow-y-auto bg-white">
          {bottomTab === "insights" && (
            <InsightsEvidencePanel
              crossContextInsights={radar.crossContextInsights}
              hiddenSignals={radar.hiddenSignals}
              priorityDecisions={radar.radarV2?.priority_decisions_v2 ?? []}
              contradictions={radar.radarV2?.contradictions ?? []}
              entities={entities}
              credibilityMap={radar.credibilityMap}
              onEntityClick={(eid) => radar.setSelectedEntityId(eid)}
            />
          )}
          {bottomTab === "health" && (
            <StackHealthPanel
              health={radar.stackHealth}
              counts={radar.stackCounts}
              coverageBreakdown={radar.coverageBreakdown}
            />
          )}
          {bottomTab === "operations" && (
            <OperationsPanel
              spaceId={space.id}
              signals={radar.signals}
              onSignalAction={radar.updateSignalStatus}
              priorityDecisionsV2={radar.radarV2?.priority_decisions_v2 ?? []}
              entities={entities}
              schedule={radar.schedule}
              onUpdateSchedule={radar.updateSchedule}
              researchLoading={radar.researchLoading}
              onTriggerResearch={radar.triggerResearch}
              agentFleet={radar.agentFleet}
              onTriggerStrategyRefresh={radar.triggerStrategyRefresh}
              strategyRefreshLoading={radar.strategyRefreshLoading}
              strategyRefreshResult={radar.strategyRefreshResult}
              strategyRefreshRecommended={radar.strategyRefreshRecommended}
              strategyRefreshReason={radar.strategyRefreshReason}
              escalatedSignalCount={radar.escalatedSignalCount}
              suggestedBridges={radar.suggestedBridges}
              onCreateBridge={radar.createBridgeEdge}
              coverageBreakdown={radar.coverageBreakdown}
              coverageImprovements={radar.coverageImprovements}
            />
          )}
        </div>
      </div>
    </div>
  );

  const integrityPct = Math.round(radar.stackHealth.avg_credibility * 100);

  return (
    <DashboardCard
      title="Intelligence Radar"
      icon={<Radar className="h-4 w-4 text-blue-500" />}
      subtitle={`${summary.total_external} signals · ${Object.keys(summary.by_category).length} categories`}
      fullscreenable
      fullscreenTriggerRef={fullscreenTriggerRef}
      className="border-blue-200/50"
      headerRight={
        <div className="flex items-center gap-1.5">
          {radar.strategyRefreshRecommended && (
            <span className="flex items-center gap-0.5 rounded-full bg-amber-100 border border-amber-200 px-1.5 py-0.5 text-[8px] font-semibold text-amber-700 animate-pulse" title="Intelligence signals suggest strategy review">
              <TrendingUp className="h-2.5 w-2.5" />
              Review
            </span>
          )}
          <span className={cn(
            "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-semibold border",
            integrityPct >= 70 ? "bg-green-50 text-green-600 border-green-200" :
            integrityPct >= 40 ? "bg-amber-50 text-amber-600 border-amber-200" :
            "bg-red-50 text-red-500 border-red-200"
          )} title="Integrity score">
            <Shield className="h-2.5 w-2.5" />
            {integrityPct}%
          </span>
          {summary.coverage_score > 0 && (
            <Ring value={summary.coverage_score / 100} size={24} showValue />
          )}
          <button
            onClick={() => radar.triggerResearch()}
            disabled={radar.researchLoading}
            className="flex items-center gap-1 rounded-lg border border-blue-200 px-2.5 py-1 text-[9px] font-medium text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50 active:scale-[0.97]"
          >
            <RefreshCw className={cn("h-2.5 w-2.5", radar.researchLoading && "animate-spin")} />
            {radar.researchLoading ? "..." : "Research"}
          </button>
        </div>
      }
      renderContent={(isFullscreen) => isFullscreen ? fullscreenContent : collapsedContent}
    >
      {null}
    </DashboardCard>
  );
}
