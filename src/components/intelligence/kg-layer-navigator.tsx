"use client";

import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Layers,
  ChevronDown,
  ChevronRight,
  Search,
  AlertTriangle,
  Star,
  Zap,
  Database,
  Microscope,
  Link2,
  Box,
} from "lucide-react";
import type { Entity, Edge } from "@/types";
import type { KnowledgeLayer } from "@/types/layer";

// ── Layer configuration ──

interface LayerConfig {
  label: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  icon: React.ElementType;
}

const LAYER_CONFIGS: Record<string, LayerConfig> = {
  internal: {
    label: "User Assets",
    description: "Your decomposed entities from chat input and analysis",
    color: "#3B82F6",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    textColor: "text-blue-700",
    icon: Box,
  },
  conceptual: {
    label: "Concept Model",
    description: "Expansion-derived mechanisms and sub-components",
    color: "#14B8A6",
    bgColor: "bg-teal-50",
    borderColor: "border-teal-200",
    textColor: "text-teal-700",
    icon: Database,
  },
  external: {
    label: "Deep Research",
    description: "Externally discovered entities from research",
    color: "#8B5CF6",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
    textColor: "text-purple-700",
    icon: Microscope,
  },
  bridge: {
    label: "Bridge",
    description: "Cross-layer connectors linking knowledge graphs",
    color: "#F59E0B",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    textColor: "text-amber-700",
    icon: Link2,
  },
};

const LAYER_ORDER: KnowledgeLayer[] = ["internal", "conceptual", "external", "bridge"];

// ── Props ──

export interface KGLayerNavigatorProps {
  entities: Entity[];
  edges: Edge[];
  onEntityClick?: (entityId: string) => void;
  className?: string;
  compact?: boolean;
}

// ── Entity Card ──

function EntityRow({
  entity,
  edges,
  onClick,
}: {
  entity: Entity;
  edges: Edge[];
  onClick?: () => void;
}) {
  const connectionCount = edges.filter(
    (e) =>
      e.source_entity_id === entity.entity_id ||
      e.target_entity_id === entity.entity_id ||
      e.source_entity_id === entity.id ||
      e.target_entity_id === entity.id
  ).length;

  const crossLayerCount = edges.filter((e) => {
    const isConnected =
      e.source_entity_id === entity.entity_id ||
      e.target_entity_id === entity.entity_id ||
      e.source_entity_id === entity.id ||
      e.target_entity_id === entity.id;
    return isConnected && (e.knowledge_layer === "bridge" || entity.knowledge_layer !== e.knowledge_layer);
  }).length;

  const isLeverage = !!(entity as Record<string, unknown>).is_leverage_point;
  const isRisk = !!(entity as Record<string, unknown>).is_risk_point;
  const isBottleneck = !!(entity as Record<string, unknown>).is_master_bottleneck;
  const confidence = entity.confidence ?? 0;

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-md border border-gray-100 bg-white px-2.5 py-1.5 transition-colors hover:border-gray-300 hover:bg-gray-50 group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-medium text-gray-800 truncate group-hover:text-gray-900">
              {entity.name ?? entity.entity_id}
            </span>
            {isBottleneck && <AlertTriangle className="h-2.5 w-2.5 text-red-500 flex-shrink-0" />}
            {isLeverage && <Star className="h-2.5 w-2.5 text-amber-500 flex-shrink-0" />}
            {isRisk && <Zap className="h-2.5 w-2.5 text-orange-500 flex-shrink-0" />}
          </div>
          {entity.description && (
            <p className="text-[9px] text-gray-500 truncate mt-0.5">{entity.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {crossLayerCount > 0 && (
            <span className="rounded-full bg-teal-50 px-1 py-0.5 text-[7px] font-medium text-teal-600">
              {crossLayerCount}×
            </span>
          )}
          <div className="flex items-center gap-0.5">
            <div className="h-1 w-6 rounded-full bg-gray-200">
              <div
                className="h-1 rounded-full bg-blue-400"
                style={{ width: `${Math.round(confidence * 100)}%` }}
              />
            </div>
            <span className="text-[7px] text-gray-400 tabular-nums">{connectionCount}</span>
          </div>
          <ChevronRight className="h-3 w-3 text-gray-300 group-hover:text-gray-500" />
        </div>
      </div>
    </button>
  );
}

// ── Layer Section ──

function LayerSection({
  layer,
  entities,
  edges,
  searchQuery,
  onEntityClick,
  defaultExpanded,
}: {
  layer: string;
  entities: Entity[];
  edges: Edge[];
  searchQuery: string;
  onEntityClick?: (entityId: string) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const config = LAYER_CONFIGS[layer];
  if (!config) return null;

  const Icon = config.icon;

  const filtered = useMemo(() => {
    if (!searchQuery) return entities;
    const q = searchQuery.toLowerCase();
    return entities.filter(
      (e) =>
        (e.name ?? e.entity_id).toLowerCase().includes(q) ||
        (e.description ?? "").toLowerCase().includes(q)
    );
  }, [entities, searchQuery]);

  const crossLayerEdgeCount = useMemo(() => {
    const entityIds = new Set(entities.flatMap((e) => [e.entity_id, e.id]));
    return edges.filter(
      (e) =>
        (entityIds.has(e.source_entity_id) || entityIds.has(e.target_entity_id)) &&
        e.knowledge_layer === "bridge"
    ).length;
  }, [entities, edges]);

  if (entities.length === 0) return null;

  return (
    <div className={cn("rounded-lg border", config.borderColor)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 transition-colors rounded-t-lg",
          expanded ? config.bgColor : "bg-white hover:bg-gray-50",
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
          <span className={cn("text-[11px] font-bold", config.textColor)}>
            {config.label}
          </span>
          <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[9px] font-medium text-gray-600 shadow-sm">
            {entities.length}
          </span>
          {crossLayerEdgeCount > 0 && (
            <span className="text-[8px] text-teal-500 font-medium">
              {crossLayerEdgeCount} cross-layer
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            expanded ? "rotate-180" : "",
          )}
          style={{ color: config.color }}
        />
      </button>

      {expanded && (
        <div className="border-t border-gray-100 bg-white rounded-b-lg">
          <p className="px-3 pt-1.5 pb-1 text-[8px] text-gray-400 italic">
            {config.description}
          </p>
          <div className="px-2 pb-2 space-y-1 max-h-[280px] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="py-2 text-center text-[9px] text-gray-400">
                No entities match search
              </p>
            ) : (
              filtered.map((e) => (
                <EntityRow
                  key={e.id}
                  entity={e}
                  edges={edges}
                  onClick={() => onEntityClick?.(e.entity_id)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Navigator ──

export function KGLayerNavigator({
  entities,
  edges,
  onEntityClick,
  className,
  compact = false,
}: KGLayerNavigatorProps) {
  const [expanded, setExpanded] = useState(!compact);
  const [searchQuery, setSearchQuery] = useState("");

  // Partition entities by layer
  const byLayer = useMemo(() => {
    const map: Record<string, Entity[]> = {
      internal: [],
      conceptual: [],
      external: [],
      bridge: [],
    };
    for (const e of entities) {
      const layer = e.knowledge_layer ?? "internal";
      if (map[layer]) {
        map[layer].push(e);
      } else {
        map.internal.push(e);
      }
    }
    // Sort each group by confidence descending
    for (const arr of Object.values(map)) {
      arr.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    }
    return map;
  }, [entities]);

  // Cross-layer edge summary
  const crossLayerSummary = useMemo(() => {
    let crossCount = 0;
    const entityLayerMap = new Map<string, string>();
    for (const e of entities) {
      entityLayerMap.set(e.entity_id, e.knowledge_layer ?? "internal");
      entityLayerMap.set(e.id, e.knowledge_layer ?? "internal");
    }
    for (const edge of edges) {
      const srcLayer = entityLayerMap.get(edge.source_entity_id);
      const tgtLayer = entityLayerMap.get(edge.target_entity_id);
      if (srcLayer && tgtLayer && srcLayer !== tgtLayer) crossCount++;
    }
    return { crossCount, totalEdges: edges.length };
  }, [entities, edges]);

  const totalEntities = entities.length;
  const populatedLayers = LAYER_ORDER.filter((l) => (byLayer[l]?.length ?? 0) > 0);

  if (totalEntities === 0) return null;

  return (
    <div className={className}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-teal-500" />
          <span className="text-[11px] font-bold text-gray-800 group-hover:text-gray-900">
            Knowledge Layers
          </span>
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-600">
            {totalEntities}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Mini density bars */}
          <div className="flex items-center gap-0.5">
            {populatedLayers.map((layer) => {
              const config = LAYER_CONFIGS[layer];
              const count = byLayer[layer]?.length ?? 0;
              const pct = Math.max(4, Math.round((count / totalEntities) * 40));
              return (
                <div
                  key={layer}
                  className="rounded-sm"
                  style={{
                    width: `${pct}px`,
                    height: "6px",
                    backgroundColor: config?.color ?? "#999",
                    opacity: 0.7,
                  }}
                  title={`${config?.label}: ${count}`}
                />
              );
            })}
          </div>
          <ChevronDown
            className={cn(
              "h-3 w-3 text-gray-300 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </div>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {/* Search */}
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1">
            <Search className="h-3 w-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search across layers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-[10px] text-gray-700 placeholder-gray-400 outline-none"
            />
          </div>

          {/* Cross-layer summary stat */}
          {crossLayerSummary.crossCount > 0 && (
            <div className="flex items-center gap-1.5 px-1">
              <Link2 className="h-3 w-3 text-teal-500" />
              <span className="text-[9px] text-gray-500">
                <span className="font-semibold text-teal-600">{crossLayerSummary.crossCount}</span> cross-layer connections across {populatedLayers.length} active layers
              </span>
            </div>
          )}

          {/* Layer sections */}
          {LAYER_ORDER.map((layer, idx) => (
            <LayerSection
              key={layer}
              layer={layer}
              entities={byLayer[layer] ?? []}
              edges={edges}
              searchQuery={searchQuery}
              onEntityClick={onEntityClick}
              defaultExpanded={idx < 2} // First two layers expanded by default
            />
          ))}
        </div>
      )}
    </div>
  );
}
