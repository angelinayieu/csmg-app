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
}

export function NodeDetail({
  entity,
  edges,
  entityMap,
  onClose,
  onDecompose,
}: NodeDetailProps) {
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
