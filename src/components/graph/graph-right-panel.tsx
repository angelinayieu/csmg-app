import { GraphLegend } from "./graph-legend";
import { SectionHeader } from "@/components/ui/section-header";
import type { Entity, Cycle } from "@/types";

interface GraphRightPanelProps {
  leveragePoints: Entity[];
  cycles: Cycle[];
  entityMap: Map<string, Entity>;
}

export function GraphRightPanel({
  leveragePoints,
  cycles,
  entityMap,
}: GraphRightPanelProps) {
  return (
    <div className="space-y-5 overflow-y-auto">
      {/* Leverage Points */}
      {leveragePoints.length > 0 && (
        <div>
          <SectionHeader label="Leverage Points" color="blue" />
          <div className="mt-2 space-y-2">
            {leveragePoints.slice(0, 3).map((entity) => (
              <div
                key={entity.id}
                className="rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold tracking-wider text-amber-600">
                    {entity.entity_id}
                  </span>
                  <span className="text-[12px] font-medium text-gray-800 truncate">
                    {entity.name}
                  </span>
                </div>
                {entity.description && (
                  <p className="mt-1 text-[10px] leading-snug text-gray-500 line-clamp-2">
                    {entity.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cycles */}
      {cycles.length > 0 && (
        <div>
          <SectionHeader label="Detected Cycles" color="amber" />
          <div className="mt-2 space-y-2">
            {cycles.map((cycle) => (
              <div
                key={cycle.id}
                className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor:
                        cycle.classification === "reinforcing_positive"
                          ? "#34C759"
                          : cycle.classification === "reinforcing_negative"
                            ? "#FF3B30"
                            : "#FF9500",
                    }}
                  />
                  <span className="text-[12px] font-medium text-gray-800 truncate">
                    {cycle.name ?? cycle.cycle_id}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[9px] text-gray-400">
                  {cycle.entity_ids.join(" → ")} → {cycle.entity_ids[0]}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div>
        <SectionHeader label="Legend" color="gray" />
        <div className="mt-2">
          <GraphLegend />
        </div>
      </div>
    </div>
  );
}
