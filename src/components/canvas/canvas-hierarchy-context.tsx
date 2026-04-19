"use client";

// Phase 32 — ambient probability context.
//
// Surfaces each entity's decomposition depth (how many direct subunits
// it has) to tldraw shape components via React context, without a shape
// schema change. KGNodeShape reads this to render a small "depth glyph"
// next to the layer badge, so every card advertises passively that it's
// an opening into a probability space — not only when the user clicks
// to summon the rings.
//
// Closes review items C1 + K3: "the probability-space claim is only
// true on click, not at rest."

import { createContext, useContext, useMemo } from "react";
import type { Entity } from "@/types";

export interface EntityHierarchyInfo {
  /** How many entities list this one as their parent (direct children). */
  subunitCount: number;
  /** Whether this entity itself has a parent (is a child of another). */
  hasParent: boolean;
}

export interface CanvasHierarchyContextValue {
  byEntity: Map<string, EntityHierarchyInfo>;
  /**
   * Phase 35: O(1) entity lookup by id. Used by components that render
   * inside the tldraw tree (shapes) and need to resolve entity metadata
   * without re-fetching. Populated from the same entities list that
   * drives the hierarchy index — no extra network cost.
   */
  entityLookup: Map<string, Entity>;
}

const EMPTY_VALUE: CanvasHierarchyContextValue = {
  byEntity: new Map(),
  entityLookup: new Map(),
};

export const CanvasHierarchyContext =
  createContext<CanvasHierarchyContextValue>(EMPTY_VALUE);

export function useCanvasHierarchy(): CanvasHierarchyContextValue {
  return useContext(CanvasHierarchyContext);
}

/**
 * Build a per-entity hierarchy index from a flat entity list. Reads
 * `provenance.parent_entity_id` — the same field NodeLab uses to resolve
 * subunits. No server round-trip; works off data already in memory.
 */
export function buildHierarchyIndex(
  entities: Entity[],
): CanvasHierarchyContextValue {
  const childCount = new Map<string, number>();
  const hasParentSet = new Set<string>();
  for (const e of entities) {
    const prov = e.provenance as
      | { parent_entity_id?: string | null }
      | null
      | undefined;
    const parentId =
      prov && typeof prov === "object" ? prov.parent_entity_id ?? null : null;
    if (parentId) {
      childCount.set(parentId, (childCount.get(parentId) ?? 0) + 1);
      hasParentSet.add(e.id);
    }
  }
  const byEntity = new Map<string, EntityHierarchyInfo>();
  const allIds = new Set<string>([
    ...childCount.keys(),
    ...hasParentSet,
  ]);
  for (const id of allIds) {
    byEntity.set(id, {
      subunitCount: childCount.get(id) ?? 0,
      hasParent: hasParentSet.has(id),
    });
  }
  const entityLookup = new Map<string, Entity>();
  for (const e of entities) entityLookup.set(e.id, e);
  return { byEntity, entityLookup };
}

/** Memoized hook for consumers that already have the entity list. */
export function useBuildHierarchyIndex(
  entities: Entity[],
): CanvasHierarchyContextValue {
  return useMemo(() => buildHierarchyIndex(entities), [entities]);
}
