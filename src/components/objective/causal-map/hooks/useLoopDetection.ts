// ── useLoopDetection ──────────────────────────────────────────────
//
// Phase 12.A (N8). Client-side feedback-loop detection: Tarjan's SCC →
// polarity classification → DetectedLoop[]. Memoized on the edge set so
// loops recompute live as the graph changes, with no server round-trip.

import { useMemo } from "react";
import { tarjanScc } from "../lib/tarjan-scc";
import { classifyLoops } from "../lib/loop-classify";
import type { CausalMapNode, CausalMapEdge, DetectedLoop } from "../lib/types";

export function useLoopDetection(
  nodes: CausalMapNode[],
  edges: CausalMapEdge[],
): DetectedLoop[] {
  return useMemo(() => {
    if (nodes.length === 0 || edges.length === 0) return [];

    const nodeIds = nodes.map((n) => n.id);
    const labelById = new Map(nodes.map((n) => [n.id, n.data.title]));

    const sccs = tarjanScc({
      nodeIds,
      edges: edges.map((e) => ({ source: e.source, target: e.target })),
    });

    const classifyEdges = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      polarity: e.data?.polarity ?? "neutral",
      strength: e.data?.strength ?? 0,
    }));

    return classifyLoops(sccs, classifyEdges, (id) => labelById.get(id) ?? id);
  }, [nodes, edges]);
}
