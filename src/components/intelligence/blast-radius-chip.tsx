"use client";

import { cn } from "@/lib/utils";
import { Zap, AlertTriangle } from "lucide-react";
import type { Entity } from "@/types";
import { cleanEntityName } from "@/components/intelligence/orbital-graph";

export function BlastRadiusChip({
  entityId,
  entities,
  onSelect,
}: {
  entityId: string;
  entities: Entity[];
  onSelect?: (id: string) => void;
}) {
  const entity = entities.find((e) => e.entity_id === entityId);
  if (!entity) return null;

  const chipColor = entity.is_leverage_point
    ? "bg-green-50 text-green-700 border-green-200"
    : entity.is_risk_point
    ? "bg-red-50 text-red-700 border-red-200"
    : "bg-gray-50 text-gray-600 border-gray-200";

  return (
    <button
      onClick={() => onSelect?.(entityId)}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[8px] font-medium transition-colors hover:opacity-80",
        chipColor
      )}
      title={`${cleanEntityName(entity)}${entity.is_leverage_point ? " (leverage)" : entity.is_risk_point ? " (risk)" : ""}`}
    >
      <span className="truncate max-w-[80px]">{cleanEntityName(entity)}</span>
      {entity.is_leverage_point && <Zap className="h-2 w-2 flex-shrink-0" />}
      {entity.is_risk_point && <AlertTriangle className="h-2 w-2 flex-shrink-0" />}
    </button>
  );
}
