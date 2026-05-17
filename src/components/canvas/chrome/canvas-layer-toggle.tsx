"use client";

// ── Canvas layer toggle ──
//
// Chip cluster that flips the canvas between layer views, dimming all
// non-matching kg-node shapes so the user can look through one lens at
// a time. URL-param backed (`?layer=<slug>`) so the view survives
// reload and is deep-linkable.
//
// Adaptive (E1):
//   • When the space has a configured `layer_ontology`, chips render
//     for each ontology layer with its own label + accent color
//     (e.g. "All / Molecular / Circuit / Cognitive / Behavioral").
//   • Otherwise the historical 3-chip default ("All / Internal /
//     External") renders so spaces without an ontology look unchanged.
//
// Sits top-right of canvas, hides when no kg-node entities exist.

import { useMemo } from "react";
import { Layers, Sparkles, Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useLayerFilterState,
  type LayerFilter,
} from "../drawers/use-layer-filter-state";
import { useResolvedLayers } from "@/lib/hooks/use-resolved-layers";

export interface CanvasLayerToggleProps {
  /** Hide the toggle when there are no kg-node shapes to filter. */
  hasAnyEntity: boolean;
  /** When provided, the toggle reads the space's resolved layer ontology
   *  and renders chips for each layer. Without it, falls back to the
   *  historical "All / Internal / External" default. Optional + back-
   *  compatible — existing callers that don't pass it see no change. */
  spaceId?: string;
}

// Default chip set — used when no ontology is configured for the space.
// Order matters: "All" sits first, the other two follow.
const DEFAULT_OPTIONS: Array<{
  id: LayerFilter;
  label: string;
  icon: typeof Layers;
  tone: string;
  title: string;
}> = [
  { id: "all", label: "All", icon: Layers, tone: "text-gray-700", title: "Show everything" },
  { id: "internal", label: "Internal", icon: Sparkles, tone: "text-blue-700", title: "Show only your own decomposition layer" },
  { id: "external", label: "External", icon: Globe2, tone: "text-purple-700", title: "Show only research-discovered entities + bridges" },
];

interface OntologyChip {
  id: LayerFilter;
  label: string;
  /** Hex color from the ontology layer. Used for the chip's icon dot. */
  accent: string;
  title: string;
  ordinal: number;
}

export function CanvasLayerToggle({
  hasAnyEntity,
  spaceId,
}: CanvasLayerToggleProps) {
  const { filter, setFilter } = useLayerFilterState();
  const resolved = useResolvedLayers(spaceId ?? null);

  // Build the chip set adaptively. When ontology is present, replace the
  // 3-chip default with one chip per ontology layer (preceded by "All").
  // When absent, render the historical 3-chip default unchanged.
  const ontologyChips = useMemo<OntologyChip[] | null>(() => {
    if (!resolved.ontologyPresent || resolved.layers.length === 0) return null;
    return resolved.layers.map((l) => ({
      id: l.id,
      label: l.label,
      accent: l.color,
      title: l.description || `Show only the ${l.label} layer`,
      ordinal: l.ordinal,
    }));
  }, [resolved.ontologyPresent, resolved.layers]);

  if (!hasAnyEntity) return null;

  // ── Ontology-driven rendering ──────────────────────────────────────
  if (ontologyChips) {
    return (
      <div
        className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-gray-200/80 bg-white/95 p-0.5 shadow-sm backdrop-blur"
        aria-label="Canvas layer filter"
      >
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
            filter === "all"
              ? "bg-gray-100 text-gray-900 shadow-sm"
              : "text-gray-500 hover:bg-gray-50 hover:text-gray-800",
          )}
          title="Show everything"
        >
          <Layers className={cn("h-3 w-3", filter === "all" && "text-gray-700")} />
          All
        </button>
        {ontologyChips.map((chip) => {
          const active = filter === chip.id;
          return (
            <button
              key={chip.id}
              onClick={() => setFilter(chip.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
                active
                  ? "bg-gray-100 text-gray-900 shadow-sm"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-800",
              )}
              title={chip.title}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: chip.accent }}
                aria-hidden
              />
              {chip.label}
            </button>
          );
        })}
      </div>
    );
  }

  // ── Default (no-ontology) rendering ────────────────────────────────
  return (
    <div
      className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-gray-200/80 bg-white/95 p-0.5 shadow-sm backdrop-blur"
      aria-label="Canvas layer filter"
    >
      {DEFAULT_OPTIONS.map((opt) => {
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
            title={opt.title}
          >
            <Icon className={cn("h-3 w-3", active && opt.tone)} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
