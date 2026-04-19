import { GraphLegend } from "./graph-legend";
import { SectionHeader } from "@/components/ui/section-header";
import type { Entity, Cycle, Bridge } from "@/types";

interface GraphRightPanelProps {
  leveragePoints: Entity[];
  cycles: Cycle[];
  entityMap: Map<string, Entity>;
  bridges?: Bridge[];
  showBridges?: boolean;
  spaceNames?: Map<string, string>;
  currentSpaceId?: string;
}

export function GraphRightPanel({
  leveragePoints,
  cycles,
  entityMap,
  bridges = [],
  showBridges = false,
  spaceNames = new Map(),
  currentSpaceId,
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

      {/* Cross-Area Bridges */}
      {showBridges && bridges.length > 0 && (
        <div>
          <SectionHeader label="Cross-Area Bridges" color="amber" />
          <div className="mt-2 space-y-1.5">
            {bridges.slice(0, 6).map((bridge) => {
              const otherSpaceId = bridge.source_space_id === currentSpaceId
                ? bridge.target_space_id
                : bridge.source_space_id;
              const otherName = spaceNames.get(otherSpaceId) ?? "Other area";
              return (
                <div
                  key={bridge.id}
                  className="rounded-lg border border-amber-100 bg-amber-50/30 px-3 py-2"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    <span className="text-[11px] font-medium text-gray-700 truncate">
                      {bridge.shared_variable_name}
                    </span>
                  </div>
                  <div className="mt-0.5 pl-[14px] text-[9px] text-gray-400">
                    <span className="font-medium text-amber-600">{bridge.coupling_strength}</span>
                    {" · "}
                    {bridge.bridge_type}
                    {" · "}
                    <span className="text-gray-500">{otherName}</span>
                  </div>
                </div>
              );
            })}
            {bridges.length > 6 && (
              <p className="text-[10px] text-gray-400 text-center">
                +{bridges.length - 6} more
              </p>
            )}
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
