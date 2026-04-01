"use client";

import { cn } from "@/lib/utils";
import { edgeDimensionStyles } from "@/lib/design-tokens";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

interface GraphControlsProps {
  visibleDimensions: Set<string>;
  onToggleDimension: (dim: string) => void;
  onResetZoom: () => void;
}

const dimensionLabels: Record<string, string> = {
  structural: "Structural",
  functional: "Functional",
  temporal: "Temporal",
  causal: "Causal",
  correlational: "Correlational",
  logical: "Logical",
  epistemic: "Epistemic",
  comparative: "Comparative",
  agentive: "Agentive",
};

export function GraphControls({
  visibleDimensions,
  onToggleDimension,
  onResetZoom,
}: GraphControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white/80 px-3 py-2 backdrop-blur-sm">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Filter
      </span>
      {Object.entries(dimensionLabels).map(([dim, label]) => {
        const style = edgeDimensionStyles[dim];
        const isActive = visibleDimensions.has(dim);
        return (
          <button
            key={dim}
            onClick={() => onToggleDimension(dim)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium transition-all",
              isActive
                ? "bg-gray-100 text-gray-700"
                : "text-gray-400 opacity-50"
            )}
          >
            <span
              className="h-2 w-4 rounded-sm"
              style={{
                backgroundColor: style?.color ?? "#888",
                opacity: isActive ? 1 : 0.3,
              }}
            />
            {label}
          </button>
        );
      })}
      <div className="ml-auto flex gap-1">
        <button
          onClick={onResetZoom}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="Reset zoom"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
