// ── Degree-based centrality ──
//
// Computes a reliable `centrality_rank` for every entity in a space using
// undirected edge degree as the primary signal, with incoming-edge count as
// a tiebreaker (nodes that many others point to are more central than nodes
// that point at many others).
//
// Rank semantics match the rest of the codebase: 1 = most central, N = least.
// Ties are broken deterministically by entity id so re-runs produce stable
// output.
//
// This is the baseline signal the tier classifier relies on. Without it the
// classifier's 0.28-weight centrality term collapses to 0.5 for every entity,
// which caps the achievable tier at "peripheral" for the whole graph.
//
// Intentionally simple — no PageRank, no betweenness. A weighted degree with
// in-edge tiebreak is close enough for visual weighting and cheap enough to
// run every decompose + re-evaluate.

export interface CentralityInput {
  id: string;
}

export interface CentralityEdgeInput {
  source_entity_id: string;
  target_entity_id: string;
}

export interface CentralityRanking {
  id: string;
  rank: number;
  degree: number;
}

export function computeDegreeCentrality(
  entities: CentralityInput[],
  edges: CentralityEdgeInput[],
): CentralityRanking[] {
  const degree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  for (const e of entities) {
    degree.set(e.id, 0);
    inDegree.set(e.id, 0);
  }
  for (const edge of edges) {
    if (degree.has(edge.source_entity_id)) {
      degree.set(edge.source_entity_id, (degree.get(edge.source_entity_id) ?? 0) + 1);
    }
    if (degree.has(edge.target_entity_id)) {
      degree.set(edge.target_entity_id, (degree.get(edge.target_entity_id) ?? 0) + 1);
      inDegree.set(edge.target_entity_id, (inDegree.get(edge.target_entity_id) ?? 0) + 1);
    }
  }

  const sorted = entities
    .map((e) => ({
      id: e.id,
      degree: degree.get(e.id) ?? 0,
      inDegree: inDegree.get(e.id) ?? 0,
    }))
    .sort((a, b) => {
      if (b.degree !== a.degree) return b.degree - a.degree;
      if (b.inDegree !== a.inDegree) return b.inDegree - a.inDegree;
      return a.id.localeCompare(b.id);
    });

  return sorted.map((row, idx) => ({
    id: row.id,
    rank: idx + 1,
    degree: row.degree,
  }));
}
