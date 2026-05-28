// ── Feedback-loop classification ──────────────────────────────────
//
// Phase 12.A. Given the SCCs from Tarjan + the polarized edges, turn
// each multi-node component into a DetectedLoop with:
//   • a representative simple cycle (for narration / highlighting)
//   • R vs B classification by the CLD rule: a loop is REINFORCING when
//     it contains an EVEN number of negative links, BALANCING when ODD.
//     (Neutral / unknown-sign links are treated as positive.)
//
// Pure functions. No React, no I/O.

import type { DetectedLoop, EdgePolarity } from "./types";

interface ClassifyEdge {
  id: string;
  source: string;
  target: string;
  polarity: EdgePolarity;
  /** Tie-break when multiple edges connect the same pair — prefer the
   *  stronger one for the representative cycle. */
  strength?: number;
}

/** Stable id for a loop from its node-set (order-independent). */
function loopIdFor(nodeIds: string[]): string {
  return "loop:" + [...nodeIds].sort().join("|");
}

/**
 * Find one representative simple cycle within an SCC using DFS that
 * stops at the first back-edge to a node on the current path.
 * Returns the ordered node sequence (closing back to the start) and the
 * edge ids traversed, or null if no cycle is found (shouldn't happen
 * for a true SCC of size ≥ 2, but we stay defensive).
 */
function findRepresentativeCycle(
  scc: string[],
  edgeBySrc: Map<string, ClassifyEdge[]>,
): { cycle: string[]; edges: ClassifyEdge[] } | null {
  const inScc = new Set(scc);
  const onPath: string[] = [];
  const onPathSet = new Set<string>();
  const pathEdges: ClassifyEdge[] = [];
  const visited = new Set<string>();

  function dfs(node: string): { cycle: string[]; edges: ClassifyEdge[] } | null {
    onPath.push(node);
    onPathSet.add(node);

    const outgoing = (edgeBySrc.get(node) ?? [])
      .filter((e) => inScc.has(e.target))
      // Prefer stronger edges so the representative cycle reads as the
      // dominant feedback path.
      .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));

    for (const e of outgoing) {
      if (onPathSet.has(e.target)) {
        // Back-edge — close the cycle from e.target to the current node.
        const startIdx = onPath.indexOf(e.target);
        const cycleNodes = onPath.slice(startIdx);
        const cycleEdges = pathEdges.slice(startIdx);
        cycleEdges.push(e); // the closing edge
        return { cycle: [...cycleNodes, e.target], edges: cycleEdges };
      }
      if (!visited.has(e.target)) {
        pathEdges.push(e);
        const found = dfs(e.target);
        if (found) return found;
        pathEdges.pop();
      }
    }

    onPath.pop();
    onPathSet.delete(node);
    visited.add(node);
    return null;
  }

  for (const start of scc) {
    visited.clear();
    onPath.length = 0;
    onPathSet.clear();
    pathEdges.length = 0;
    const found = dfs(start);
    if (found) return found;
  }
  return null;
}

/**
 * Classify all multi-node SCCs into DetectedLoops.
 *
 * @param sccs    Output of tarjanScc (singletons are ignored here).
 * @param edges   Polarized edges of the graph.
 * @param labelOf Resolve a node id → display label for the loop name.
 */
export function classifyLoops(
  sccs: string[][],
  edges: ClassifyEdge[],
  labelOf: (nodeId: string) => string,
): DetectedLoop[] {
  // Index edges by source for cycle-finding.
  const edgeBySrc = new Map<string, ClassifyEdge[]>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    const arr = edgeBySrc.get(e.source) ?? [];
    arr.push(e);
    edgeBySrc.set(e.source, arr);
  }

  const loops: DetectedLoop[] = [];

  for (const scc of sccs) {
    if (scc.length < 2) continue;

    const rep = findRepresentativeCycle(scc, edgeBySrc);
    if (!rep) continue;

    const negativeCount = rep.edges.filter(
      (e) => e.polarity === "negative",
    ).length;
    const kind = negativeCount % 2 === 0 ? "reinforcing" : "balancing";

    // Label: first 2-3 distinct node labels joined with ⇌.
    const distinct = rep.cycle.filter((id, i, arr) => arr.indexOf(id) === i);
    const labelParts = distinct.slice(0, 3).map(labelOf);
    const label =
      labelParts.join(" ⇌ ") + (distinct.length > 3 ? " ⇌ …" : "");

    loops.push({
      id: loopIdFor(scc),
      nodeIds: [...scc],
      cycle: rep.cycle,
      edgeIds: rep.edges.map((e) => e.id),
      kind,
      negativeCount,
      label,
    });
  }

  // Reinforcing loops first (they tend to be the more urgent signal),
  // then by size descending.
  loops.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "reinforcing" ? -1 : 1;
    return b.nodeIds.length - a.nodeIds.length;
  });

  return loops;
}
