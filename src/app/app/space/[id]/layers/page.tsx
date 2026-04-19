"use client";

import { useMemo } from "react";
import { useSpaceData } from "@/contexts/space-data-context";
import { MultiLayerGraph } from "@/components/graph/multi-layer-graph";
import type { SynthesisData } from "@/types/synthesis";

export default function LayersPage() {
  const ctx = useSpaceData();

  const synthData = useMemo<SynthesisData | null>(() => {
    if (!ctx.space.synthesis_data) return null;
    try {
      return (typeof ctx.space.synthesis_data === "string"
        ? JSON.parse(ctx.space.synthesis_data)
        : ctx.space.synthesis_data) as SynthesisData;
    } catch {
      return null;
    }
  }, [ctx.space.synthesis_data]);

  if (!ctx.hasSynthesis || ctx.entities.length < 5) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Need synthesis data and 5+ entities for multi-layer view
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <MultiLayerGraph
        entities={ctx.entities}
        edges={ctx.edges}
        cycles={ctx.cycles}
        synthesisData={synthData}
        onEntityClick={(entity) => ctx.setSelectedEntity(entity)}
      />
    </div>
  );
}
