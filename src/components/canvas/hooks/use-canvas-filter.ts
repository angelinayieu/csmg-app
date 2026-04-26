"use client";

// ── Canvas filter state (Phase 3) ──
//
// Zustand store driving the canvas's "highlight by kind / layer /
// axis" filter. Consumed by:
//   - canvas-legend-sidebar (writes via toggle handlers)
//   - probability-space-shell-shape (reads to dim non-matching shells)
//   - synthesis-intersection-card-shape (reads to dim rows whose axes
//     are not in the selected set)
//   - entity-library page (reads to apply additional filtering on top
//     of its own search/kind chip state)
//
// Multi-select is union semantics: a shape passes the filter if ANY
// of its axes/kinds/layers is in the selected set. Empty set = no
// filter active for that dimension (i.e., everything passes).
//
// Hook follows the project's existing zustand convention but uses the
// browser-friendly `zustand` import (provider-less, hook-based) since
// this state is canvas-local and doesn't need cross-tree sharing.

import { create } from "zustand";
import type { EntityKind } from "@/lib/entities/kind-classifier";
import type { LayerId } from "@/lib/whiteboard/layer-config";

/** Phase 7 — shell render layout. `side` is the original peer layout
 *  (shells in a row); `stack` makes non-soloed shells visually recede
 *  (dim + scale-down) so the user reads the canvas as "this lens is
 *  the focus, others are background context." */
export type ShellLayoutMode = "side" | "stack";

export interface CanvasFilterState {
  /** When non-empty, only shapes whose `kind ∈ selectedKinds` pass. */
  selectedKinds: Set<EntityKind>;
  /** When non-empty, only shapes whose `layer ∈ selectedLayers` pass. */
  selectedLayers: Set<LayerId>;
  /** When non-empty, only shapes whose axis appears in this set pass.
   *  Empty = all axes shown. (Per the user's "solo this lens" intent
   *  the legend will typically hold one axis at a time, but the type
   *  permits multi-select for future range-filtering.) */
  selectedAxes: Set<string>;
  /** Phase 7 — shell layout mode. */
  shellLayoutMode: ShellLayoutMode;
}

export interface CanvasFilterActions {
  toggleKind: (k: EntityKind) => void;
  toggleLayer: (l: LayerId) => void;
  toggleAxis: (axis: string) => void;
  /** Clear every filter dimension. */
  clearAll: () => void;
  /** Replace the entire kind set (used by the entity-library page
   *  when its own kind filter is active and we want to mirror it). */
  setKinds: (kinds: Set<EntityKind>) => void;
  /** Phase 7 — switch shell render layout (side-by-side vs stack). */
  setShellLayoutMode: (mode: ShellLayoutMode) => void;
}

export const useCanvasFilter = create<CanvasFilterState & CanvasFilterActions>(
  (set) => ({
    selectedKinds: new Set(),
    selectedLayers: new Set(),
    selectedAxes: new Set(),
    shellLayoutMode: "side" as const,
    toggleKind: (k) =>
      set((state) => {
        const next = new Set(state.selectedKinds);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return { selectedKinds: next };
      }),
    toggleLayer: (l) =>
      set((state) => {
        const next = new Set(state.selectedLayers);
        if (next.has(l)) next.delete(l);
        else next.add(l);
        return { selectedLayers: next };
      }),
    toggleAxis: (axis) =>
      set((state) => {
        const next = new Set(state.selectedAxes);
        if (next.has(axis)) next.delete(axis);
        else next.add(axis);
        return { selectedAxes: next };
      }),
    clearAll: () =>
      set({
        selectedKinds: new Set(),
        selectedLayers: new Set(),
        selectedAxes: new Set(),
      }),
    setKinds: (kinds) => set({ selectedKinds: kinds }),
    setShellLayoutMode: (mode) => set({ shellLayoutMode: mode }),
  }),
);

/** Selector hook: is this kind active in the filter (or is the
 *  filter empty, in which case "active" defaults to true)? */
export function useKindActive(kind: EntityKind | null | undefined): boolean {
  return useCanvasFilter((s) => {
    if (s.selectedKinds.size === 0) return true;
    return kind ? s.selectedKinds.has(kind) : false;
  });
}

/** Selector hook: is this layer active in the filter? */
export function useLayerActive(layer: LayerId | null | undefined): boolean {
  return useCanvasFilter((s) => {
    if (s.selectedLayers.size === 0) return true;
    return layer ? s.selectedLayers.has(layer) : false;
  });
}

/** Selector hook: is this axis active? */
export function useAxisActive(axis: string | null | undefined): boolean {
  return useCanvasFilter((s) => {
    if (s.selectedAxes.size === 0) return true;
    return axis ? s.selectedAxes.has(axis) : false;
  });
}

/** Selector: whether ANY filter dimension is currently constraining
 *  the view. UI uses this to show a "clear filters" button. */
export function useAnyFilterActive(): boolean {
  return useCanvasFilter(
    (s) =>
      s.selectedKinds.size > 0 ||
      s.selectedLayers.size > 0 ||
      s.selectedAxes.size > 0,
  );
}
