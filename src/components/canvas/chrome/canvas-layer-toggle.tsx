"use client";

// ── Canvas layer toggle ──
//
// Small three-way chip cluster that flips the canvas between:
//   • All      — default; every kg-node visible
//   • Internal — fade out external + bridge entities; see ONLY your
//                own decomposition layer
//   • External — fade out internal entities; see ONLY the research-
//                discovered layer + the bridges that anchor it
//
// The filter is URL-param backed (`?layer=internal|external`) so the
// view survives reload and is deep-linkable. Opacity is applied by
// the layer-filter effect in InteraxisCanvas; this component only
// surfaces the toggle.
//
// Sits top-right of canvas, unobtrusive, hides when there are no
// entities yet (nothing to filter).

import { Layers, Sparkles, Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLayerFilterState, type LayerFilter } from "../drawers/use-layer-filter-state";

export interface CanvasLayerToggleProps {
  /** Hide the toggle when there are no kg-node shapes to filter. */
  hasAnyEntity: boolean;
}

const OPTIONS: Array<{
  id: LayerFilter;
  label: string;
  icon: typeof Layers;
  tone: string;
}> = [
  { id: "all", label: "All", icon: Layers, tone: "text-gray-700" },
  { id: "internal", label: "Internal", icon: Sparkles, tone: "text-blue-700" },
  { id: "external", label: "External", icon: Globe2, tone: "text-purple-700" },
];

export function CanvasLayerToggle({ hasAnyEntity }: CanvasLayerToggleProps) {
  const { filter, setFilter } = useLayerFilterState();

  if (!hasAnyEntity) return null;

  return (
    <div
      className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-gray-200/80 bg-white/95 p-0.5 shadow-sm backdrop-blur"
      aria-label="Canvas layer filter"
    >
      {OPTIONS.map((opt) => {
        const active = filter === opt.id;
        const Icon = opt.icon;
        return (
          <button
            key={opt.id}
            onClick={() => setFilter(opt.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
              active
                ? "bg-gray-100 text-gray-900 shadow-sm"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-800",
            )}
            title={
              opt.id === "all"
                ? "Show everything"
                : opt.id === "internal"
                  ? "Show only your own decomposition layer"
                  : "Show only research-discovered entities + bridges"
            }
          >
            <Icon className={cn("h-3 w-3", active && opt.tone)} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
