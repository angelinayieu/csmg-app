"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Ring } from "@/components/ui/ring";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { getNodeColor } from "@/lib/design-tokens";
import type { Entity, Edge } from "@/types";

interface NodeDetailProps {
  entity: Entity;
  edges: Edge[];
  entityMap: Map<string, Entity>;
  onClose: () => void;
  onDecompose?: (entity: Entity) => void;
  onAcceptExternal?: (entity: Entity) => void;
  onRemoveExternal?: (entity: Entity) => void;
}

export function NodeDetail({
  entity,
  edges,
  entityMap,
  onClose,
  onDecompose,
  onAcceptExternal,
  onRemoveExternal,
}: NodeDetailProps) {
  const isExternal = entity.knowledge_layer === "external";
  const colors = getNodeColor(entity.entity_category);

  // Get edges connected to this entity
  const connectedEdges = edges.filter(
    (e) =>
      e.source_entity_id === entity.id || e.target_entity_id === entity.id
  );

  const importanceMap: Record<string, "fundamental" | "critical" | "important"> = {
    fundamental: "fundamental",
    critical: "critical",
    important: "important",
  };

  const sourceTagMap: Record<string, "stated" | "inferred" | "predicted"> = {
    explicit: "stated",
    implicit: "inferred",
    assumed: "predicted",
  };

  return (
    <div className="fixed right-0 top-0 z-50 flex h-full w-[320px] flex-col border-l border-gray-200 bg-white shadow-lg"
      style={{
        animation: "slideInRight 300ms ease forwards",
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-gray-200 px-5 py-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: colors.fill,
                color: colors.stroke,
                letterSpacing: "0.03em",
              }}
            >
              {entity.entity_id}
            </span>
            <h2 className="text-[15px] font-semibold text-gray-900">
              {entity.name}
            </h2>
          </div>
          {/* External indicator */}
          {isExternal && (
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-purple-600">
              <span className="h-2 w-2 rounded-full border border-current" style={{ borderStyle: "dashed" }} />
              External knowledge
            </div>
          )}

          {/* Badges */}
          <div className="mt-2 flex flex-wrap gap-1">
            <StatusBadge variant={entity.entity_category === "concrete" ? "stated" : entity.entity_category === "abstract" ? "theory" : "active"}>
              {entity.entity_category}
            </StatusBadge>
            {entity.importance && importanceMap[entity.importance] && (
              <StatusBadge variant={importanceMap[entity.importance]}>
                {entity.importance}
              </StatusBadge>
            )}
            <StatusBadge variant={sourceTagMap[entity.source_tag] ?? "stated"}>
              {entity.source_tag}
            </StatusBadge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Ring value={entity.confidence} size={42} />
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Description */}
        {entity.description && (
          <div>
            <p className="text-[13px] leading-[1.6] text-gray-600">
              {entity.description}
            </p>
          </div>
        )}

        {/* Properties */}
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Properties
          </h3>
          <div className="space-y-1.5 text-[12px]">
            {entity.layer && (
              <div className="flex justify-between">
                <span className="text-gray-500">Layer</span>
                <span className="text-gray-700">{entity.layer}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Type</span>
              <span className="text-gray-700">{entity.entity_type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Blast radius</span>
              <span className="text-gray-700">{entity.blast_radius}</span>
            </div>
            {entity.centrality_rank && (
              <div className="flex justify-between">
                <span className="text-gray-500">Centrality rank</span>
                <span className="text-gray-700">#{entity.centrality_rank}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Leverage point</span>
              <span className={entity.is_leverage_point ? "text-amber-600 font-medium" : "text-gray-400"}>
                {entity.is_leverage_point ? "Yes" : "No"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Risk point</span>
              <span className={entity.is_risk_point ? "text-red-600 font-medium" : "text-gray-400"}>
                {entity.is_risk_point ? "Yes" : "No"}
              </span>
            </div>
          </div>
        </div>

        {/* Connected edges */}
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Connections ({connectedEdges.length})
          </h3>
          <div className="space-y-1">
            {connectedEdges.map((edge) => {
              const isSource = edge.source_entity_id === entity.id;
              const otherId = isSource
                ? edge.target_entity_id
                : edge.source_entity_id;
              const other = entityMap.get(otherId);
              return (
                <div
                  key={edge.id}
                  className="rounded-md bg-gray-50 px-2.5 py-1.5 text-[11px]"
                >
                  <span className="text-gray-500">
                    {isSource ? "→" : "←"}
                  </span>{" "}
                  <span className="font-medium text-gray-700">
                    {other?.name ?? otherId}
                  </span>{" "}
                  <span className="text-gray-400">
                    ({edge.relationship_type})
                  </span>
                </div>
              );
            })}
            {connectedEdges.length === 0 && (
              <p className="text-[11px] text-gray-400">No connections</p>
            )}
          </div>
        </div>
      </div>

      {/* Provenance (for external entities) */}
      {isExternal && entity.provenance && (
        <div className="border-t border-gray-200 px-5 py-3">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Source
          </h3>
          <div className="space-y-1.5 text-[12px]">
            <div className="flex justify-between">
              <span className="text-gray-500">Type</span>
              <span className="text-gray-700">
                {(entity.provenance as Record<string, string>)?.source_type ?? "Training knowledge"}
              </span>
            </div>
            {(entity.provenance as Record<string, string>)?.relevance && (
              <div className="mt-2 rounded-md bg-purple-50 px-2.5 py-2 text-[11px] text-purple-700">
                {(entity.provenance as Record<string, string>).relevance}
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Authority</span>
              <span className={cn(
                "text-gray-700",
                entity.authority_level === "high" && "text-green-600",
                entity.authority_level === "moderate" && "text-blue-600",
                entity.authority_level === "low" && "text-gray-500",
              )}>
                {entity.authority_level}
              </span>
            </div>
          </div>

          {/* Bridge connections */}
          {connectedEdges.filter((e) => e.knowledge_layer === "bridge").length > 0 && (
            <div className="mt-3">
              <h4 className="mb-1 text-[10px] font-semibold text-amber-600">
                Connected to your analysis
              </h4>
              {connectedEdges
                .filter((e) => e.knowledge_layer === "bridge")
                .map((edge) => {
                  const otherId =
                    edge.source_entity_id === entity.id
                      ? edge.target_entity_id
                      : edge.source_entity_id;
                  const other = entityMap.get(otherId);
                  return (
                    <div key={edge.id} className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] mb-1">
                      <span className="font-medium text-amber-700">
                        {edge.relationship_type}
                      </span>{" "}
                      <span className="text-gray-600">
                        {other?.name ?? otherId}
                      </span>
                      {edge.conditions && (
                        <div className="mt-0.5 text-[10px] text-gray-500">{edge.conditions}</div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-gray-200 px-5 py-3 space-y-2">
        {entity.is_decomposable && onDecompose && (
          <Button
            onClick={() => onDecompose(entity)}
            className="w-full"
            size="sm"
          >
            Analyze this entity
          </Button>
        )}
        {isExternal && onAcceptExternal && (
          <Button
            onClick={() => onAcceptExternal(entity)}
            className="w-full"
            size="sm"
            variant="secondary"
          >
            Accept into analysis
          </Button>
        )}
        {isExternal && onRemoveExternal && (
          <Button
            onClick={() => onRemoveExternal(entity)}
            className="w-full"
            size="sm"
            variant="ghost"
          >
            Remove from graph
          </Button>
        )}
      </div>

      <style jsx>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}
