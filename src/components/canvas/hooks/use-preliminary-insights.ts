"use client";

// ── usePreliminaryInsights ──────────────────────────────────────────
//
// Memoized wrapper over computePreliminaryInsights — keeps recompute
// cost zero on identity-stable inputs and recomputes when entities or
// edges genuinely change. Returns null when there isn't enough data
// to produce any signal yet (avoids flashing an empty panel on a
// brand-new space).
//
// Why no server round-trip: the algorithms are O(n + m) for hubs +
// components and O(n²) for bridge candidates. With ~30 entities the
// total compute is a few ms — cheap enough to live in a useMemo.

import { useMemo } from "react";
import {
  computePreliminaryInsights,
  type PreliminaryInsights,
} from "@/lib/graph/preliminary-insights";
import type { Entity, Edge } from "@/types";

// Below this entity count there's not enough graph to produce
// meaningful topology signals — return null so the panel hides.
const MIN_ENTITIES_FOR_INSIGHTS = 5;

export function usePreliminaryInsights(
  entities: Entity[],
  edges: Edge[],
): PreliminaryInsights | null {
  return useMemo(() => {
    if (entities.length < MIN_ENTITIES_FOR_INSIGHTS) return null;
    if (edges.length === 0) return null;
    return computePreliminaryInsights(entities, edges);
    // Identity of arrays from useSpaceData stays stable until refresh,
    // so memoizing on length is sufficient and cheap. Length captures
    // the "decompose just landed N more entities" transition without
    // a deep equality scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities.length, edges.length]);
}
