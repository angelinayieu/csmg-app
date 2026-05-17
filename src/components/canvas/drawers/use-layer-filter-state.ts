"use client";

// ── URL-param state for the canvas layer filter ──
//
// Layer toggle backed by `?layer=<slug>` URL param so the filter
// survives reloads and can be deep-linked. Originally a 3-way enum
// (all / internal / external); widened post-E1 to accept any layer
// slug (an ontology slug like "molecular" or a knowledge_layer enum
// value like "internal") so the toggle can render adaptively from
// the resolved layer list.
//
// The filter is consumed by the layer-filter effect in
// InteraxisCanvas, which uses the resolved layer assignment (via
// useResolvedLayers' entityLayerMap) when the filter is an ontology
// slug, and falls back to the historical knowledge_layer enum
// comparison when the filter is "internal" or "external".

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Layer filter value. `"all"` shows everything; any other string is
 * treated as a layer id — could be a knowledge_layer enum value
 * ("internal", "external", "conceptual", "bridge") for backward
 * compatibility, OR an ontology layer slug (e.g., "molecular",
 * "circuit", "behavioral") for spaces with a configured layer_ontology.
 */
export type LayerFilter = string;

// Legacy values kept as a constant so type narrowing helpers can still
// distinguish "all" from any other slug without losing the widened type.
export const ALL_LAYERS: LayerFilter = "all";

export function useLayerFilterState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Any non-empty slug is accepted. Empty / missing → "all".
  const raw = searchParams.get("layer");
  const filter: LayerFilter = raw && raw.length > 0 ? raw : ALL_LAYERS;

  const setFilter = useCallback(
    (next: LayerFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === ALL_LAYERS) {
        params.delete("layer");
      } else {
        params.set("layer", next);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return { filter, setFilter };
}
