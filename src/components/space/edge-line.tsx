import { cn } from "@/lib/utils";
import type { Edge, Entity } from "@/types";
import { ArrowRight } from "lucide-react";

const polarityColors: Record<string, string> = {
  positive: "text-green-600",
  negative: "text-red-600",
  neutral: "text-gray-500",
  conditional: "text-amber-600",
};

const dimensionLabels: Record<string, string> = {
  structural: "STR",
  functional: "FUN",
  temporal: "TMP",
  causal: "CAU",
  correlational: "COR",
  logical: "LOG",
  epistemic: "EPI",
  comparative: "CMP",
  agentive: "AGT",
};

export function EdgeLine({
  edge,
  entityMap,
}: {
  edge: Edge;
  entityMap: Map<string, Entity>;
}) {
  const source = entityMap.get(edge.source_entity_id);
  const target = entityMap.get(edge.target_entity_id);
  const polarityColor = polarityColors[edge.polarity] ?? "text-gray-500";

  return (
    <div className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-gray-50">
      <span className="font-medium text-gray-700 truncate max-w-[140px]">
        {source?.name ?? edge.source_entity_id}
      </span>
      <ArrowRight className={cn("h-3.5 w-3.5 flex-shrink-0", polarityColor)} />
      <span className="font-medium text-gray-700 truncate max-w-[140px]">
        {target?.name ?? edge.target_entity_id}
      </span>
      <span className={cn("text-xs", polarityColor)}>
        {edge.relationship_type}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
          {dimensionLabels[edge.dimension] ?? edge.dimension}
        </span>
        <span
          className="h-1.5 w-8 rounded-full bg-gray-200 overflow-hidden"
          title={`Strength: ${edge.strength}`}
        >
          <span
            className="block h-full rounded-full bg-interaxis-400"
            style={{ width: `${(edge.strength ?? 0.5) * 100}%` }}
          />
        </span>
      </span>
    </div>
  );
}
