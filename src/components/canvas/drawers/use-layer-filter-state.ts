"use client";

// ── URL-param state for the canvas layer filter ──
//
// Three-way toggle: "all" (default) / "internal" / "external".
// Backed by `?layer=internal|external` URL param so the filter
// survives reloads and can be deep-linked ("show me the external
// knowledge perspective of this space").
//
// The filter drives opacity on kg-node shapes so the user can
// toggle between the landscape layers without losing the graph
// structure. Internal entities (decomposition layer) and external
// entities (research layer) already carry the right metadata via
// `knowledge_layer`; this hook just exposes the filter state.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type LayerFilter = "all" | "internal" | "external";

export function useLayerFilterState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get("layer");
  const filter: LayerFilter =
    raw === "internal" || raw === "external" ? raw : "all";

  const setFilter = useCallback(
    (next: LayerFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "all") {
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
