"use client";

import { useMemo, useState } from "react";
import {
  Grid3X3,
  Star,
  AlertTriangle,
  ChevronDown,
  Link2,
  RefreshCw,
  Target,
  Shield,
  Eye,
  Globe,
  Lightbulb,
  AlertOctagon,
  HelpCircle,
  GitBranch,
  Brain,
  X,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity, Edge, Cycle, Space } from "@/types";
import type {
  SynthesisData,
  RichLeveragePoint,
  RichRiskPoint,
  RichBottleneck,
  RichFeedbackLoop,
  RichOpenQuestion,
  WorthConsidering,
  CrossContextInsight,
} from "@/types/synthesis";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { computeEntityHealthContributions } from "@/lib/twin/compute-twin-state";
import type { EntityHealthContribution } from "@/lib/twin/compute-twin-state";
import type { InventoryHighlight } from "@/components/dashboard/dashboard-grid";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const categoryConfig: Record<
  string,
  { label: string; bg: string; text: string; dot: string; border: string }
> = {
  concrete: { label: "Concrete", bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-400", border: "border-blue-200" },
  abstract: { label: "Abstract", bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-400", border: "border-purple-200" },
  process: { label: "Process", bg: "bg-teal-50", text: "text-teal-700", dot: "bg-teal-400", border: "border-teal-200" },
  relational: { label: "Relational", bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-400", border: "border-orange-200" },
  epistemic: { label: "Epistemic", bg: "bg-pink-50", text: "text-pink-700", dot: "bg-pink-400", border: "border-pink-200" },
};

/* ------------------------------------------------------------------ */
/*  Per-entity micro metrics                                           */
/* ------------------------------------------------------------------ */

interface EntityMicro {
  connectionCount: number;
  inbound: number;
  outbound: number;
  cycleCount: number;
}

type HealthStatus = "critical" | "warning" | "healthy";

function getHealthStatus(contribution: number | null | undefined): HealthStatus {
  if ((contribution ?? 0) <= -1) return "critical";
  if ((contribution ?? 0) < 0) return "warning";
  return "healthy";
}

function computeEntityMicros(
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[]
): Map<string, EntityMicro> {
  const map = new Map<string, EntityMicro>();
  for (const entity of entities) {
    const inbound = edges.filter((e) => e.target_entity_id === entity.id).length;
    const outbound = edges.filter((e) => e.source_entity_id === entity.id).length;
    const cycleCount = cycles.filter((c) => c.entity_ids?.includes(entity.id)).length;
    map.set(entity.id, { connectionCount: inbound + outbound, inbound, outbound, cycleCount });
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  Per-entity synthesis context                                       */
/* ------------------------------------------------------------------ */

interface EntitySynthCtx {
  leveragePoint: RichLeveragePoint | null;
  riskPoint: RichRiskPoint | null;
  bottleneck: RichBottleneck | null;
  feedbackLoops: RichFeedbackLoop[];
  openQuestions: RichOpenQuestion[];
  worthConsidering: WorthConsidering[];
  crossContextInsights: CrossContextInsight[];
}

function buildSynthMap(entities: Entity[], synthData: SynthesisData | null): Map<string, EntitySynthCtx> {
  const map = new Map<string, EntitySynthCtx>();
  if (!synthData) return map;

  for (const entity of entities) {
    const eid = entity.entity_id;
    const ctx: EntitySynthCtx = {
      leveragePoint: synthData.leverage_points?.find((lp) => lp.entity_id === eid) ?? null,
      riskPoint: synthData.risk_points?.find((rp) => rp.entity_id === eid) ?? null,
      bottleneck: synthData.master_bottleneck?.entity_id === eid ? synthData.master_bottleneck : null,
      feedbackLoops: (synthData.feedback_loops ?? []).filter((loop) =>
        loop.steps?.some((step) => step.toLowerCase().includes(entity.name.toLowerCase()))
      ),
      openQuestions: (synthData.open_questions ?? []).filter((q) => q.related_entity_ids?.includes(eid)),
      worthConsidering: (synthData.worth_considering ?? []).filter((w) => w.connected_entities?.includes(eid)),
      crossContextInsights: (synthData.cross_context_insights ?? []).filter(
        (c) => c.internal_entities?.includes(eid) || c.external_entities?.includes(eid)
      ),
    };
    const hasContent = ctx.leveragePoint || ctx.riskPoint || ctx.bottleneck ||
      ctx.feedbackLoops.length > 0 || ctx.openQuestions.length > 0 ||
      ctx.worthConsidering.length > 0 || ctx.crossContextInsights.length > 0;
    if (hasContent) map.set(entity.id, ctx);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  Highlight matching                                                 */
/* ------------------------------------------------------------------ */

function entityMatchesHighlight(
  entity: Entity,
  micro: EntityMicro | undefined,
  highlight: InventoryHighlight
): boolean {
  if (!highlight) return true;
  if (highlight.type === "role") {
    switch (highlight.role) {
      case "risk": return entity.is_risk_point;
      case "leverage": return entity.is_leverage_point;
      case "bottleneck": return entity.is_master_bottleneck;
      case "orphan": return (micro?.connectionCount ?? 0) === 0;
    }
  }
  if (highlight.type === "confidence") {
    switch (highlight.level) {
      case "high": return entity.confidence >= 0.7;
      case "medium": return entity.confidence >= 0.4 && entity.confidence < 0.7;
      case "low": return entity.confidence < 0.4;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

interface InventoryModuleProps {
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  space: Space;
  claims?: Array<{ id: string; source_entity_id: string | null }>;
  onEntityClick?: (entity: Entity) => void;
  highlight?: InventoryHighlight;
  onClearHighlight?: () => void;
}

export function InventoryModule({
  entities,
  edges,
  cycles,
  space,
  claims = [],
  onEntityClick,
  highlight,
  onClearHighlight,
}: InventoryModuleProps) {
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | HealthStatus>("all");

  // Parse synthesis once
  const synthData = useMemo<SynthesisData | null>(() => {
    if (!space.synthesis_data) return null;
    try {
      return (typeof space.synthesis_data === "string"
        ? JSON.parse(space.synthesis_data)
        : space.synthesis_data) as SynthesisData;
    } catch { return null; }
  }, [space.synthesis_data]);

  const entityMicros = useMemo(() => computeEntityMicros(entities, edges, cycles), [entities, edges, cycles]);
  const synthMap = useMemo(() => buildSynthMap(entities, synthData), [entities, synthData]);
  const healthMap = useMemo(() => computeEntityHealthContributions(entities, cycles), [entities, cycles]);

  // Claims count per entity (for evidence density indicator)
  const claimsCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of claims) {
      if (c.source_entity_id) {
        map.set(c.source_entity_id, (map.get(c.source_entity_id) ?? 0) + 1);
      }
    }
    return map;
  }, [claims]);

  // Apply highlight + search + status filter
  const displayEntities = useMemo(() => {
    const q = search.trim().toLowerCase();

    return entities.filter((entity) => {
      if (highlight && !entityMatchesHighlight(entity, entityMicros.get(entity.id), highlight)) return false;

      if (statusFilter !== "all") {
        const h = healthMap.get(entity.id);
        if (getHealthStatus(h?.contribution) !== statusFilter) return false;
      }

      if (!q) return true;
      return (
        entity.name.toLowerCase().includes(q) ||
        entity.entity_id.toLowerCase().includes(q) ||
        entity.entity_category.toLowerCase().includes(q)
      );
    });
  }, [entities, highlight, entityMicros, search, statusFilter, healthMap]);

  // Sort: prioritize critical roles, then by centrality
  const sortedEntities = useMemo(() => {
    return [...displayEntities].sort((a, b) => {
      // Bottleneck first
      if (a.is_master_bottleneck && !b.is_master_bottleneck) return -1;
      if (b.is_master_bottleneck && !a.is_master_bottleneck) return 1;
      // Then leverage+risk
      const aScore = (a.is_leverage_point ? 2 : 0) + (a.is_risk_point ? 2 : 0);
      const bScore = (b.is_leverage_point ? 2 : 0) + (b.is_risk_point ? 2 : 0);
      if (aScore !== bScore) return bScore - aScore;
      // Then health severity
      const aHealth = healthMap.get(a.id)?.contribution ?? 0;
      const bHealth = healthMap.get(b.id)?.contribution ?? 0;
      if (aHealth !== bHealth) return aHealth - bHealth;

      // Then centrality
      return (a.centrality_rank ?? 99) - (b.centrality_rank ?? 99);
    });
  }, [displayEntities, healthMap]);

  const groupedEntities = useMemo(() => {
    const groups: Record<HealthStatus, Entity[]> = {
      critical: [],
      warning: [],
      healthy: [],
    };

    for (const entity of sortedEntities) {
      const contribution = healthMap.get(entity.id)?.contribution;
      groups[getHealthStatus(contribution)].push(entity);
    }

    return groups;
  }, [sortedEntities, healthMap]);

  // Stats
  const leverageCount = entities.filter((e) => e.is_leverage_point).length;
  const riskCount = entities.filter((e) => e.is_risk_point).length;

  // Highlight label
  const highlightLabel = useMemo(() => {
    if (!highlight) return null;
    if (highlight.type === "role") {
      const labels = { risk: "Risk Points", leverage: "Leverage Points", bottleneck: "Bottleneck", orphan: "Orphans" };
      return labels[highlight.role];
    }
    if (highlight.type === "confidence") {
      const labels = { high: "High Confidence", medium: "Medium Confidence", low: "Low Confidence" };
      return labels[highlight.level];
    }
    return null;
  }, [highlight]);

  if (entities.length === 0) return null;

  return (
    <DashboardCard
      title="Entity Storage"
      icon={<Grid3X3 className="h-4 w-4" />}
      subtitle={highlight
        ? `${displayEntities.length} of ${entities.length} — ${highlightLabel}`
        : `${entities.length} entities`}
      badge={
        <div className="flex items-center gap-1">
          {leverageCount > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
              <Star className="h-2.5 w-2.5 fill-amber-500" />{leverageCount}
            </span>
          )}
          {riskCount > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
              <AlertTriangle className="h-2.5 w-2.5" />{riskCount}
            </span>
          )}
        </div>
      }
      fullscreenable
    >
      {/* Active highlight banner */}
      {highlight && (
        <div className="flex items-center gap-2 rounded-md bg-indigo-50 px-2.5 py-1.5 mb-2">
          <span className="text-[10px] font-medium text-indigo-700">
            Showing: {highlightLabel} ({displayEntities.length})
          </span>
          <button
            onClick={onClearHighlight}
            className="ml-auto rounded p-0.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="mb-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entities, IDs, or categories"
            className="h-8 w-full rounded-md border border-gray-200 bg-white pl-7 pr-2 text-xs text-gray-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div className="flex items-center gap-1">
          {(["all", "critical", "warning", "healthy"] as const).map((status) => {
            const count = status === "all"
              ? displayEntities.length
              : groupedEntities[status].length;

            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "rounded-full border px-2 py-1 text-[10px] font-medium transition",
                  statusFilter === status
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                )}
              >
                {status} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Entity list grouped by severity */}
      <div className="space-y-3">
        {(["critical", "warning", "healthy"] as const).map((groupKey) => {
          const groupItems = groupedEntities[groupKey];
          if (groupItems.length === 0) return null;

          return (
            <div key={groupKey}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide",
                  groupKey === "critical" ? "text-red-600" :
                  groupKey === "warning" ? "text-amber-600" :
                  "text-green-600"
                )}>
                  {groupKey}
                </span>
                <span className="text-[10px] text-gray-400">{groupItems.length}</span>
              </div>

              <div className="space-y-1.5">
                {groupItems.map((entity) => {
                  const micro = entityMicros.get(entity.id);
                  const synthCtx = synthMap.get(entity.id);
                  const health = healthMap.get(entity.id);
                  const isExpanded = expandedEntity === entity.id;
                  const config = categoryConfig[entity.entity_category] ?? categoryConfig.concrete;

                  return (
                    <EntityCard
                      key={entity.id}
                      entity={entity}
                      micro={micro}
                      synthCtx={synthCtx ?? null}
                      health={health ?? null}
                      config={config}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedEntity(isExpanded ? null : entity.id)}
                      onOpenDetail={onEntityClick}
                      edges={edges}
                      cycles={cycles}
                      entities={entities}
                      claimCount={claimsCountMap.get(entity.id) ?? 0}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </DashboardCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Entity Card — compact at-a-glance + smart expansion                */
/* ------------------------------------------------------------------ */

function EntityCard({
  entity,
  micro,
  synthCtx,
  health,
  config,
  isExpanded,
  onToggle,
  onOpenDetail,
  edges,
  cycles,
  entities,
  claimCount,
}: {
  entity: Entity;
  micro: EntityMicro | undefined;
  synthCtx: EntitySynthCtx | null;
  health: EntityHealthContribution | null;
  config: { label: string; bg: string; text: string; dot: string; border: string };
  isExpanded: boolean;
  onToggle: () => void;
  onOpenDetail?: (entity: Entity) => void;
  edges: Edge[];
  cycles: Cycle[];
  entities: Entity[];
  claimCount?: number;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-white transition-all",
        isExpanded ? cn(config.border, "shadow-sm") : "border-gray-200 hover:border-gray-300"
      )}
    >
      {/* Compact row face */}
      <button
        onClick={onToggle}
        className={cn(
          "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors rounded-md",
          isExpanded ? config.bg : "hover:bg-gray-50"
        )}
      >
        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <span className="text-[12px] font-semibold text-gray-800 leading-tight block truncate">
                {entity.name}
              </span>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-gray-500 truncate">{entity.entity_id}</span>
                <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-medium", config.text, config.bg)}>
                  {config.label}
                </span>
              </div>
            </div>

            <HealthStatusChip contribution={health?.contribution} />
          </div>

          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {entity.is_master_bottleneck && (
              <span className="flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold text-red-700">
                <Target className="h-2.5 w-2.5" />Bottleneck
              </span>
            )}
            {entity.is_leverage_point && (
              <span className="flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                <Star className="h-2.5 w-2.5 fill-amber-500" />Leverage
              </span>
            )}
            {entity.is_risk_point && (
              <span className="flex items-center gap-0.5 rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold text-red-600">
                <Shield className="h-2.5 w-2.5" />Risk
              </span>
            )}
            {synthCtx && (
              <Brain className="h-3 w-3 text-indigo-400" />
            )}
            {/* Evidence density indicator */}
            {(claimCount ?? 0) >= 3 && (
              <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-700">{claimCount}</span>
            )}
            {(claimCount ?? 0) >= 1 && (claimCount ?? 0) < 3 && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">{claimCount}</span>
            )}
            <span className="ml-auto flex items-center gap-0.5 text-[10px] text-gray-500">
              <Link2 className="h-2.5 w-2.5" />{micro?.connectionCount ?? 0}
            </span>
            {(micro?.cycleCount ?? 0) > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-indigo-500">
                <RefreshCw className="h-2.5 w-2.5" />{micro?.cycleCount}
              </span>
            )}
          </div>
        </div>

        {/* Right: expand chevron */}
        <ChevronDown className={cn(
          "h-3.5 w-3.5 text-gray-300 flex-shrink-0 mt-1 transition-transform",
          isExpanded && "rotate-180"
        )} />
      </button>

      {/* Smart expansion */}
      {isExpanded && (
        <SmartExpansion
          entity={entity}
          micro={micro}
          synthCtx={synthCtx}
          health={health}
          edges={edges}
          cycles={cycles}
          entities={entities}
          config={config}
          onOpenDetail={onOpenDetail}
        />
      )}
    </div>
  );
}

function HealthStatusChip({ contribution }: { contribution: number | null | undefined }) {
  const status = getHealthStatus(contribution);
  const value = contribution ?? 0;

  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[9px] font-semibold",
        status === "critical" && "bg-red-100 text-red-700",
        status === "warning" && "bg-amber-100 text-amber-700",
        status === "healthy" && "bg-green-100 text-green-700"
      )}
    >
      {status === "critical" ? "Critical" : status === "warning" ? "Warning" : "Healthy"}
      {value !== 0 ? ` (${value > 0 ? "+" : ""}${value})` : ""}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Smart Expansion — adapts to what's most interesting about entity    */
/* ------------------------------------------------------------------ */

function SmartExpansion({
  entity,
  micro,
  synthCtx,
  health,
  edges,
  cycles,
  entities,
  config,
  onOpenDetail,
}: {
  entity: Entity;
  micro: EntityMicro | undefined;
  synthCtx: EntitySynthCtx | null;
  health: EntityHealthContribution | null;
  edges: Edge[];
  cycles: Cycle[];
  entities: Entity[];
  config: { bg: string; text: string; border: string };
  onOpenDetail?: (entity: Entity) => void;
}) {
  const entityNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entities) m.set(e.id, e.name);
    return m;
  }, [entities]);

  const connectedEdges = useMemo(
    () => edges.filter((e) => e.source_entity_id === entity.id || e.target_entity_id === entity.id),
    [edges, entity.id]
  );

  const entityCycles = useMemo(
    () => cycles.filter((c) => c.entity_ids?.includes(entity.id)),
    [cycles, entity.id]
  );

  const totalEntities = entities.length || 1;

  return (
    <div className="px-2.5 pb-2.5 space-y-2 border-t border-gray-100">
      {/* Description */}
      {entity.description && (
        <p className="text-[11px] leading-[1.5] text-gray-600 pt-2">
          {entity.description}
        </p>
      )}

      {/* ── SMART SECTION: Lead with what matters most ── */}

      {/* Bottleneck analysis (highest priority) */}
      {synthCtx?.bottleneck && (
        <SynthBlock
          icon={<AlertOctagon className="h-3 w-3 text-red-500" />}
          title="System Bottleneck"
          borderColor="border-red-200"
          bg="bg-red-50"
        >
          <p className="text-[10px] text-red-600 leading-[1.4]">{synthCtx.bottleneck.summary}</p>
          {synthCtx.bottleneck.reasoning?.[0] && (
            <p className="text-[10px] text-red-500 leading-[1.4] mt-1 opacity-80">{synthCtx.bottleneck.reasoning[0]}</p>
          )}
        </SynthBlock>
      )}

      {/* Leverage analysis */}
      {synthCtx?.leveragePoint && (
        <SynthBlock
          icon={<Lightbulb className="h-3 w-3 text-amber-600" />}
          title="Leverage Analysis"
          borderColor="border-amber-200"
          bg="bg-amber-50"
        >
          <p className="text-[10px] text-amber-700 leading-[1.4]">{synthCtx.leveragePoint.summary}</p>
          {synthCtx.leveragePoint.how_it_works?.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {synthCtx.leveragePoint.how_it_works.slice(0, 2).map((step, i) => (
                <div key={i} className="flex items-start gap-1 text-[10px] text-amber-600">
                  <span className="font-mono text-amber-400 flex-shrink-0">{i + 1}.</span>
                  <span className="leading-[1.3]">{step}</span>
                </div>
              ))}
            </div>
          )}
          {synthCtx.leveragePoint.action?.primary && (
            <div className="mt-1 rounded bg-amber-100/60 px-1.5 py-1 text-[10px] text-amber-800">
              <span className="font-semibold">Action:</span> {synthCtx.leveragePoint.action.primary}
            </div>
          )}
        </SynthBlock>
      )}

      {/* Risk analysis */}
      {synthCtx?.riskPoint && (
        <SynthBlock
          icon={<Shield className="h-3 w-3 text-red-500" />}
          title={`Risk — ${Math.round(((synthCtx.riskPoint.blast_radius ?? 0) / totalEntities) * 100)}% blast radius`}
          borderColor="border-red-200"
          bg="bg-red-50"
        >
          <p className="text-[10px] text-red-600 leading-[1.4]">{synthCtx.riskPoint.summary}</p>
          {synthCtx.riskPoint.how_it_fails?.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {synthCtx.riskPoint.how_it_fails.slice(0, 2).map((step, i) => (
                <div key={i} className="flex items-start gap-1 text-[10px] text-red-500">
                  <span className="font-mono text-red-300 flex-shrink-0">{i + 1}.</span>
                  <span className="leading-[1.3]">{step}</span>
                </div>
              ))}
            </div>
          )}
          {synthCtx.riskPoint.mitigation?.primary && (
            <div className="mt-1 rounded bg-red-100/60 px-1.5 py-1 text-[10px] text-red-700">
              <span className="font-semibold">Mitigation:</span> {synthCtx.riskPoint.mitigation.primary}
            </div>
          )}
        </SynthBlock>
      )}

      {/* Feedback loops */}
      {entityCycles.length > 0 && (
        <div className="space-y-1">
          {entityCycles.slice(0, 2).map((cycle) => {
            const path = cycle.entity_ids?.map((id) => entityNameMap.get(id) ?? "?").join(" → ");
            return (
              <div key={cycle.id} className={cn(
                "rounded-md px-2 py-1 text-[10px]",
                cycle.classification === "reinforcing_positive" ? "bg-green-50 text-green-700" :
                cycle.classification === "reinforcing_negative" ? "bg-red-50 text-red-600" :
                "bg-blue-50 text-blue-600"
              )}>
                <div className="flex items-center gap-1">
                  <RefreshCw className="h-2.5 w-2.5" />
                  <span className="font-semibold">{cycle.classification?.replace(/_/g, " ")}</span>
                </div>
                <span className="text-[9px] leading-[1.3] block opacity-80">{path} → ...</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Open questions about this entity */}
      {synthCtx?.openQuestions && synthCtx.openQuestions.length > 0 && (
        <div className="space-y-0.5">
          {synthCtx.openQuestions.slice(0, 2).map((q, i) => (
            <div key={i} className="flex items-start gap-1 rounded-md bg-yellow-50 px-2 py-1 text-[10px]">
              <HelpCircle className="h-3 w-3 text-yellow-500 flex-shrink-0 mt-0.5" />
              <span className="text-yellow-800">{q.question}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── CONNECTIONS: Always show top 3 ── */}
      {connectedEdges.length > 0 && (
        <div>
          <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">
            Top Connections ({connectedEdges.length})
          </span>
          <div className="mt-0.5 space-y-0.5">
            {connectedEdges.slice(0, 3).map((edge) => {
              const isSource = edge.source_entity_id === entity.id;
              const otherId = isSource ? edge.target_entity_id : edge.source_entity_id;
              const otherName = entityNameMap.get(otherId) ?? "Unknown";
              return (
                <div key={edge.id} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] bg-gray-50">
                  <span className={cn(
                    "flex-shrink-0",
                    edge.polarity === "positive" ? "text-green-500" :
                    edge.polarity === "negative" ? "text-red-400" : "text-gray-400"
                  )}>
                    {isSource ? "→" : "←"}
                  </span>
                  <span className="font-medium text-gray-600 truncate flex-1">{otherName}</span>
                  <span className="text-gray-400 truncate max-w-[90px]">{edge.relationship_type}</span>
                  <div className="w-6 h-1 rounded-full bg-gray-200 flex-shrink-0">
                    <div className={cn(
                      "h-full rounded-full",
                      edge.polarity === "positive" ? "bg-green-400" :
                      edge.polarity === "negative" ? "bg-red-300" : "bg-gray-400"
                    )} style={{ width: `${(edge.strength ?? 0.5) * 100}%` }} />
                  </div>
                </div>
              );
            })}
            {connectedEdges.length > 3 && (
              <span className="text-[9px] text-gray-400 px-1.5">+{connectedEdges.length - 3} more</span>
            )}
          </div>
        </div>
      )}

      {/* Orphan notice */}
      {connectedEdges.length === 0 && (
        <div className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1.5 text-[10px] text-gray-500">
          <Eye className="h-3 w-3" />
          No connections mapped — orphan entity
        </div>
      )}

      {/* ── PROPERTIES: Compact grid ── */}
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <PropChip label="Source" value={entity.source_tag} />
        <PropChip label="Layer" value={entity.knowledge_layer} />
        <PropChip label="Blast" value={String(entity.blast_radius ?? 0)} />
        {entity.centrality_rank && <PropChip label="Centrality" value={`#${entity.centrality_rank}`} />}
        <PropChip label="Category" value={entity.entity_category} />
        {entity.importance && <PropChip label="Importance" value={entity.importance} />}
      </div>

      {/* External provenance */}
      {entity.knowledge_layer === "external" && entity.provenance && (
        <div className="rounded-md bg-purple-50 px-2 py-1.5 text-[10px] text-purple-700">
          <Globe className="h-3 w-3 inline mr-1" />
          <span className="font-semibold">External:</span>{" "}
          {(entity.provenance as Record<string, string>)?.source_type === "web_search" ? "Web search" : "Knowledge base"}
          {" · Authority: "}{entity.authority_level}
        </div>
      )}

      {/* Decomposable */}
      {entity.is_decomposable && (
        <div className="flex items-center gap-1 text-[10px] text-blue-600">
          <GitBranch className="h-3 w-3" />
          {entity.has_sub_space ? "Has sub-space analysis" : "Can be decomposed"}
        </div>
      )}

      {/* Cross-context insights */}
      {synthCtx?.worthConsidering && synthCtx.worthConsidering.length > 0 && (
        <div className="space-y-0.5">
          {synthCtx.worthConsidering.slice(0, 2).map((w, i) => (
            <div key={i} className="rounded bg-purple-50 px-1.5 py-1 text-[10px]">
              <span className="font-semibold text-purple-700">{w.title}</span>
              <span className="text-purple-600"> — {w.description.slice(0, 100)}{w.description.length > 100 ? "..." : ""}</span>
            </div>
          ))}
        </div>
      )}

      {/* Open full detail */}
      {onOpenDetail && (
        <button
          onClick={() => onOpenDetail(entity)}
          className="w-full rounded-md bg-gray-100 py-1.5 text-[10px] font-medium text-gray-600 hover:bg-gray-200 transition-colors"
        >
          Open full detail →
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Synthesis block — reusable styled container                        */
/* ------------------------------------------------------------------ */

function SynthBlock({
  icon,
  title,
  borderColor,
  bg,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  borderColor: string;
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-md border px-2 py-1.5", borderColor, bg)}>
      <div className="flex items-center gap-1 mb-0.5">
        {icon}
        <span className="text-[10px] font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Compact property chip                                              */
/* ------------------------------------------------------------------ */

function PropChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-gray-50 px-1.5 py-0.5">
      <span className="text-gray-400 text-[9px]">{label}</span>
      <span className="block text-gray-700 font-medium text-[10px] truncate">{value}</span>
    </div>
  );
}
