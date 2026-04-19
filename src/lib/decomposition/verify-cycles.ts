// ── Cycle verification against filtered edge set ──
// The LLM traces cycles in prose (Tier 5). Cycle metadata is stored as sequences of
// entity_ids. After edge filtering (e.g. filterLowConfidenceEdges) some edges that
// comprised the cycle may be removed, leaving "phantom cycles" — structures that
// claim A→B→C→A but where one of those edges no longer exists.
//
// This module re-verifies each cycle against the final edge set and drops cycles
// that are too incomplete to be meaningful.

interface EdgeLike {
  source_entity_id: string;
  target_entity_id: string;
}

interface CycleLike {
  cycle_id?: string;
  entity_ids: string[];
  [key: string]: unknown;
}

export interface CycleVerificationResult<T extends CycleLike> {
  verified: T[];
  dropped: Array<{ cycle_id: string; missing_edges: Array<[string, string]>; reason: string }>;
  downgraded: Array<{ cycle_id: string; missing_edges: Array<[string, string]> }>;
}

/**
 * Build a Set of "source|target" pairs for O(1) edge lookup. Edges are directional;
 * if a cycle step needs A→B, the edge A→B must exist (B→A doesn't satisfy it).
 */
function buildEdgeIndex(edges: EdgeLike[]): Set<string> {
  const index = new Set<string>();
  for (const e of edges) {
    if (e.source_entity_id && e.target_entity_id) {
      index.add(`${e.source_entity_id}|${e.target_entity_id}`);
    }
  }
  return index;
}

/**
 * Walk the entity sequence of a cycle and check each consecutive pair has a matching
 * edge. Returns the list of missing edge pairs (empty array = fully verified).
 *
 * Note: the sequence A→B→C→A is implicit in cycle semantics — the last→first edge
 * must also exist for it to actually be a cycle. We check both interior and closing
 * edges.
 */
function findMissingEdges(
  entityIds: string[],
  edgeIndex: Set<string>,
): Array<[string, string]> {
  const missing: Array<[string, string]> = [];
  const n = entityIds.length;
  if (n < 2) return missing;
  for (let i = 0; i < n; i++) {
    const src = entityIds[i];
    const tgt = entityIds[(i + 1) % n]; // wraps back to start for closing edge
    if (!edgeIndex.has(`${src}|${tgt}`)) missing.push([src, tgt]);
  }
  return missing;
}

/**
 * Verify each cycle against the final edge set.
 *
 * Policy:
 * - 0 missing edges → kept as-is (verified)
 * - 1 missing edge in a cycle of length ≥ 4 → kept but flagged (downgraded). Small
 *   number of missing links in a long chain may indicate a filter artifact rather
 *   than a phantom cycle. Caller can decide to downgrade confidence.
 * - Otherwise → dropped. A cycle of length 3 needs all 3 edges. Cycles with many
 *   missing edges are phantom structures.
 */
export function verifyCyclesAgainstEdges<T extends CycleLike>(
  cycles: T[],
  edges: EdgeLike[],
): CycleVerificationResult<T> {
  const edgeIndex = buildEdgeIndex(edges);
  const verified: T[] = [];
  const dropped: CycleVerificationResult<T>["dropped"] = [];
  const downgraded: CycleVerificationResult<T>["downgraded"] = [];

  for (const cycle of cycles) {
    const missing = findMissingEdges(cycle.entity_ids, edgeIndex);
    const cycleId = cycle.cycle_id ?? `cy_${cycle.entity_ids.join("_")}`;

    if (missing.length === 0) {
      verified.push(cycle);
    } else if (missing.length === 1 && cycle.entity_ids.length >= 4) {
      verified.push(cycle);
      downgraded.push({ cycle_id: cycleId, missing_edges: missing });
    } else {
      dropped.push({
        cycle_id: cycleId,
        missing_edges: missing,
        reason: `${missing.length} of ${cycle.entity_ids.length} cycle edges missing from filtered graph — likely phantom cycle`,
      });
    }
  }

  return { verified, dropped, downgraded };
}
