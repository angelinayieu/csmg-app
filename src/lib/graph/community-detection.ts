/**
 * Community Detection — Label Propagation Algorithm
 *
 * Detects communities in the knowledge graph for visual clustering.
 * Uses Label Propagation which is O(iterations × edges) — fast enough
 * for graphs up to ~5000 nodes.
 */

export interface CommunityResult {
  /** Map from entity_id → community index (0-based) */
  communities: Map<string, number>;
  /** Number of communities found */
  communityCount: number;
  /** Per-community metadata */
  summaries: Array<{
    id: number;
    size: number;
    hubEntityId: string;
    hubDegree: number;
    memberIds: string[];
  }>;
  /** Modularity score [0, 1] — higher = stronger community structure */
  modularity: number;
}

export function detectCommunities(
  entityIds: string[],
  edges: Array<{
    source_entity_id: string;
    target_entity_id: string;
    confidence?: number;
  }>
): CommunityResult {
  const n = entityIds.length;
  if (n === 0)
    return {
      communities: new Map(),
      communityCount: 0,
      summaries: [],
      modularity: 0,
    };

  // ── Build adjacency ──
  const adj = new Map<string, Map<string, number>>();
  const degree = new Map<string, number>();

  for (const id of entityIds) {
    adj.set(id, new Map());
    degree.set(id, 0);
  }

  let totalWeight = 0;
  for (const e of edges) {
    const w = e.confidence ?? 1;
    const srcAdj = adj.get(e.source_entity_id);
    const tgtAdj = adj.get(e.target_entity_id);
    if (srcAdj && tgtAdj) {
      srcAdj.set(
        e.target_entity_id,
        (srcAdj.get(e.target_entity_id) ?? 0) + w
      );
      tgtAdj.set(
        e.source_entity_id,
        (tgtAdj.get(e.source_entity_id) ?? 0) + w
      );
      degree.set(
        e.source_entity_id,
        (degree.get(e.source_entity_id) ?? 0) + w
      );
      degree.set(
        e.target_entity_id,
        (degree.get(e.target_entity_id) ?? 0) + w
      );
      totalWeight += w;
    }
  }

  // ── Label Propagation ──
  const labels = new Map<string, number>();
  entityIds.forEach((id, i) => labels.set(id, i));

  const MAX_ITER = 25;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let changed = false;
    // Shuffle traversal order for stability
    const order = [...entityIds].sort(() => Math.random() - 0.5);

    for (const nodeId of order) {
      const neighbors = adj.get(nodeId);
      if (!neighbors || neighbors.size === 0) continue;

      // Weighted vote for each neighboring label
      const votes = new Map<number, number>();
      for (const [nId, w] of neighbors) {
        const nLabel = labels.get(nId)!;
        votes.set(nLabel, (votes.get(nLabel) ?? 0) + w);
      }

      // Pick label with highest weight (random tie-break)
      let bestLabel = labels.get(nodeId)!;
      let bestWeight = 0;
      for (const [label, weight] of votes) {
        if (
          weight > bestWeight ||
          (weight === bestWeight && Math.random() > 0.5)
        ) {
          bestLabel = label;
          bestWeight = weight;
        }
      }

      if (bestLabel !== labels.get(nodeId)) {
        labels.set(nodeId, bestLabel);
        changed = true;
      }
    }

    if (!changed) break;
  }

  // ── Renumber communities 0..k-1 ──
  const uniqueLabels = [...new Set(labels.values())];
  const remap = new Map<number, number>();
  uniqueLabels.forEach((l, i) => remap.set(l, i));

  const communities = new Map<string, number>();
  for (const [id, label] of labels) {
    communities.set(id, remap.get(label)!);
  }

  // ── Build summaries ──
  const groups = new Map<number, string[]>();
  for (const [id, comm] of communities) {
    if (!groups.has(comm)) groups.set(comm, []);
    groups.get(comm)!.push(id);
  }

  const summaries = [...groups.entries()]
    .map(([id, members]) => {
      let hubId = members[0];
      let hubDeg = 0;
      for (const m of members) {
        const d = degree.get(m) ?? 0;
        if (d > hubDeg) {
          hubId = m;
          hubDeg = d;
        }
      }
      return {
        id,
        size: members.length,
        hubEntityId: hubId,
        hubDegree: hubDeg,
        memberIds: members,
      };
    })
    .sort((a, b) => b.size - a.size);

  // ── Modularity Q ──
  let Q = 0;
  if (totalWeight > 0) {
    for (const e of edges) {
      const ci = communities.get(e.source_entity_id);
      const cj = communities.get(e.target_entity_id);
      if (ci === undefined || cj === undefined) continue;
      if (ci !== cj) continue;
      const ki = degree.get(e.source_entity_id) ?? 0;
      const kj = degree.get(e.target_entity_id) ?? 0;
      Q += (e.confidence ?? 1) - (ki * kj) / (2 * totalWeight);
    }
    Q /= 2 * totalWeight;
  }

  return {
    communities,
    communityCount: summaries.length,
    summaries,
    modularity: Math.max(0, Math.min(1, Q)),
  };
}
