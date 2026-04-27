// ── Community detection (D8 — docs/KG_DEPTH_CRITIQUE.md §9) ──────────
//
// Self-contained TS implementation of hierarchical graph clustering.
// Partitions an entity/edge graph into communities at multiple levels;
// caller then runs the bottom-up summary pass over the hierarchy.
//
// Why self-contained vs adding `graphology-communities-louvain`:
//   1. Keeps the change atomic — no npm install / lockfile churn
//   2. For our scale (15–50 entities typical), Louvain's full machinery
//      is overkill. Newman's modularity-greedy (one of Louvain's two
//      phases) yields equivalent partitions at O(n²) which is fine
//      at this scale
//   3. Source-level review-ability — the algorithm is ~120 LOC of
//      readable code with explicit modularity math, vs an opaque
//      dependency that would also need its own peer dep (graphology core)
//
// Pattern source: GraphRAG paper §3.1.4–3.1.5. They use Leiden via
// graspologic (Python); we use modularity-greedy (TS) because the
// summary substrate (§E.2 prompt) is what creates downstream value,
// not the precise clustering algorithm. Leiden's marginal advantages
// (guaranteed connected sub-communities, slightly better modularity)
// don't change the LLM rollup output materially.
//
// Hierarchy: detect at level 0 (full graph → root partitions), then
// recurse — each community of size ≥ MIN_COMMUNITY_SIZE_FOR_SUBSPLIT
// is re-clustered as its own subgraph. Recursion bottoms out at
// MAX_LEVEL or when no community is large enough to split further.
//
// Pure function. No DB I/O. Caller (community-summarize.ts) handles
// persistence + SSE events.

// ── Tunables ────────────────────────────────────────────────────────

/**
 * Communities below this size don't get further sub-clustered. With 3
 * or fewer nodes there's no meaningful structure to extract — the LLM
 * summary at this level captures everything anyway.
 */
const MIN_COMMUNITY_SIZE_FOR_SUBSPLIT = 4;

/**
 * Hard ceiling on hierarchy depth. Matches the migration's check
 * constraint. With 4 levels and ~3-way fan-out per level we cover
 * 80+ entities without needing more depth than is interpretable.
 */
const MAX_LEVEL = 4;

/**
 * Modularity gain below this threshold stops the merge process at any
 * level. Keeps detection from making merges that don't materially
 * improve the partition.
 */
const MIN_MODULARITY_GAIN = 0.001;

// ── I/O shapes ──────────────────────────────────────────────────────

export interface DetectionEntity {
  id: string;
}

export interface DetectionEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  /** Edge weight 0..1; missing/null treated as 1 (uniform). */
  strength?: number | null;
  confidence?: number | null;
}

/**
 * One node in the detection result hierarchy. The orchestrator walks
 * this tree to persist + summarize bottom-up.
 */
export interface DetectedCommunity {
  level: number;
  entity_ids: string[];
  edge_ids: string[];
  /** Modularity contribution at the level this community was detected. */
  modularity: number;
  /** Recursively-detected sub-communities. Empty when this community
   *  is below MIN_COMMUNITY_SIZE_FOR_SUBSPLIT or at MAX_LEVEL. */
  children: DetectedCommunity[];
}

export interface DetectCommunitiesInput {
  entities: ReadonlyArray<DetectionEntity>;
  edges: ReadonlyArray<DetectionEdge>;
}

export interface DetectCommunitiesResult {
  /** Root-level partitions (level 0). */
  communities: DetectedCommunity[];
  /** Total community count across all levels. Useful for caller logging. */
  total_count: number;
  /** Aggregate modularity at level 0 (weighted by community size). 0..1
   *  range typical; below 0.3 means the graph isn't well-clustered. */
  level_0_modularity: number;
}

// ── Public entry ────────────────────────────────────────────────────

export function detectCommunities(
  input: DetectCommunitiesInput,
): DetectCommunitiesResult {
  const { entities, edges } = input;
  if (entities.length === 0) {
    return { communities: [], total_count: 0, level_0_modularity: 0 };
  }

  const ids = entities.map((e) => e.id);
  const validIds = new Set(ids);

  // Filter edges to valid endpoints. Defensive — incoming dedupe may
  // leave dangling references when an entity gets dropped.
  const cleanEdges = edges.filter(
    (e) =>
      validIds.has(e.source_entity_id) &&
      validIds.has(e.target_entity_id) &&
      e.source_entity_id !== e.target_entity_id,
  );

  const level0 = clusterByModularity(ids, cleanEdges, 0);
  let total = 0;
  let weightedModularity = 0;
  for (const c of level0) {
    total += countAll(c);
    weightedModularity += c.modularity * c.entity_ids.length;
  }
  const denom = entities.length;

  return {
    communities: level0,
    total_count: total,
    level_0_modularity: denom > 0 ? weightedModularity / denom : 0,
  };
}

// ── Algorithm: modularity-greedy clustering ─────────────────────────
//
// 1. Initialize every node as its own community
// 2. Compute modularity gain for every (community A, community B)
//    pair connected by ≥ 1 edge
// 3. Pick the merge with the highest gain; merge if gain ≥ EPS
// 4. Repeat until no merge improves modularity
// 5. Recurse on each resulting community of size ≥ MIN_SIZE
//
// Modularity (Newman 2004):
//   Q = (1 / 2m) Σ_ij [ A_ij - (k_i × k_j) / 2m ] δ(c_i, c_j)
//
// where m = total edge weight, A_ij = edge weight, k_i = node degree,
// c_i = community assignment, δ = Kronecker delta. We compute the
// gain of merging communities A and B as:
//   ΔQ = (Σ_{i∈A,j∈B} A_ij) / m - (Σ_{i∈A} k_i × Σ_{j∈B} k_j) / (2m²)

function clusterByModularity(
  ids: string[],
  edges: ReadonlyArray<DetectionEdge>,
  level: number,
): DetectedCommunity[] {
  if (level >= MAX_LEVEL) {
    // Reached depth cap — return one community holding everything.
    return [
      {
        level,
        entity_ids: ids,
        edge_ids: edges.map((e) => e.id),
        modularity: 0,
        children: [],
      },
    ];
  }

  // Edge weights — default 1 when both strength and confidence are
  // missing. When strength exists, prefer it; fall back to confidence;
  // fall back to 1.
  const weights = edges.map((e) => {
    if (typeof e.strength === "number" && e.strength > 0) return e.strength;
    if (typeof e.confidence === "number" && e.confidence > 0) return e.confidence;
    return 1;
  });

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0 || ids.length < 2) {
    // No edges at this level — single community holding everything.
    return [
      {
        level,
        entity_ids: ids,
        edge_ids: edges.map((e) => e.id),
        modularity: 0,
        children: [],
      },
    ];
  }

  const m = totalWeight;
  const twoM = 2 * m;

  // Per-node weighted degree
  const degree = new Map<string, number>();
  for (const id of ids) degree.set(id, 0);
  for (let i = 0; i < edges.length; i++) {
    const w = weights[i];
    degree.set(edges[i].source_entity_id, (degree.get(edges[i].source_entity_id) ?? 0) + w);
    degree.set(edges[i].target_entity_id, (degree.get(edges[i].target_entity_id) ?? 0) + w);
  }

  // Community membership: each node starts in its own community,
  // identified by a synthetic community id (string).
  const communityOfNode = new Map<string, string>();
  for (const id of ids) communityOfNode.set(id, `c_${id}`);

  // Per-community: sum of degrees, member ids, member edge ids
  const communityDegree = new Map<string, number>();
  const communityMembers = new Map<string, Set<string>>();
  const communityInternalEdges = new Map<string, Set<string>>();
  for (const id of ids) {
    const c = `c_${id}`;
    communityDegree.set(c, degree.get(id) ?? 0);
    communityMembers.set(c, new Set([id]));
    communityInternalEdges.set(c, new Set());
  }

  // Edge weight sum between every pair of communities (and within each).
  // Updated incrementally during merges.
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const interCommunityWeight = new Map<string, number>();
  // Map community → set of neighbor community ids
  const neighborCommunities = new Map<string, Set<string>>();
  for (const id of ids) neighborCommunities.set(`c_${id}`, new Set());

  for (let i = 0; i < edges.length; i++) {
    const ca = communityOfNode.get(edges[i].source_entity_id)!;
    const cb = communityOfNode.get(edges[i].target_entity_id)!;
    const w = weights[i];
    if (ca === cb) {
      const set = communityInternalEdges.get(ca)!;
      set.add(edges[i].id);
      continue;
    }
    const key = pairKey(ca, cb);
    interCommunityWeight.set(key, (interCommunityWeight.get(key) ?? 0) + w);
    neighborCommunities.get(ca)!.add(cb);
    neighborCommunities.get(cb)!.add(ca);
  }

  // Greedy merge loop
  let merged = true;
  let safetyCounter = 0;
  const maxIterations = ids.length * 2;

  while (merged && safetyCounter++ < maxIterations) {
    merged = false;
    let bestGain = MIN_MODULARITY_GAIN;
    let bestPair: [string, string] | null = null;

    for (const [key, w_AB] of interCommunityWeight.entries()) {
      const [ca, cb] = key.split("|");
      const k_A = communityDegree.get(ca) ?? 0;
      const k_B = communityDegree.get(cb) ?? 0;
      // ΔQ for merging A and B
      const gain = w_AB / m - (k_A * k_B) / (twoM * m);
      if (gain > bestGain) {
        bestGain = gain;
        bestPair = [ca, cb];
      }
    }

    if (!bestPair) break;
    merged = true;

    const [ca, cb] = bestPair;
    // Merge cb into ca: move all members, fold neighbor weights
    const membersB = communityMembers.get(cb)!;
    const internalB = communityInternalEdges.get(cb)!;
    for (const member of membersB) {
      communityOfNode.set(member, ca);
      communityMembers.get(ca)!.add(member);
    }
    for (const eid of internalB) communityInternalEdges.get(ca)!.add(eid);
    // Internal edges include the AB edges that are now intra-community
    const abKey = pairKey(ca, cb);
    const abEdgeIds = edges
      .filter(
        (e) => {
          const sa = communityOfNode.get(e.source_entity_id);
          const sb = communityOfNode.get(e.target_entity_id);
          return (
            (sa === ca && sb === ca) ||
            // Edges that were AB before merge; both ends now in ca
            ((e.source_entity_id !== "" && e.target_entity_id !== "") &&
              false)
          );
        },
      )
      .map((e) => e.id);
    for (const eid of abEdgeIds) communityInternalEdges.get(ca)!.add(eid);

    communityDegree.set(ca, (communityDegree.get(ca) ?? 0) + (communityDegree.get(cb) ?? 0));
    communityDegree.delete(cb);
    communityMembers.delete(cb);
    communityInternalEdges.delete(cb);
    interCommunityWeight.delete(abKey);

    // Fold cb's neighbor weights into ca
    const cbNeighbors = neighborCommunities.get(cb) ?? new Set();
    for (const cn of cbNeighbors) {
      if (cn === ca) continue;
      const cbKey = pairKey(cb, cn);
      const cnKey = pairKey(ca, cn);
      const wCb = interCommunityWeight.get(cbKey) ?? 0;
      const wCn = interCommunityWeight.get(cnKey) ?? 0;
      if (wCb > 0) {
        interCommunityWeight.set(cnKey, wCn + wCb);
        interCommunityWeight.delete(cbKey);
      }
      neighborCommunities.get(cn)?.delete(cb);
      neighborCommunities.get(cn)?.add(ca);
      neighborCommunities.get(ca)?.add(cn);
    }
    neighborCommunities.delete(cb);
  }

  // Build the level-N communities from the final partition
  const result: DetectedCommunity[] = [];
  for (const [cid, members] of communityMembers.entries()) {
    const memberIds = Array.from(members);
    const internalEdgeIds = Array.from(communityInternalEdges.get(cid) ?? []);
    // Per-community modularity contribution
    const cDegree = communityDegree.get(cid) ?? 0;
    let internalWeight = 0;
    for (let i = 0; i < edges.length; i++) {
      if (
        members.has(edges[i].source_entity_id) &&
        members.has(edges[i].target_entity_id)
      ) {
        internalWeight += weights[i];
      }
    }
    const modularity =
      twoM > 0 ? internalWeight / m - (cDegree * cDegree) / (twoM * m) : 0;

    // Recurse — split this community's subgraph if it's big enough
    let children: DetectedCommunity[] = [];
    if (memberIds.length >= MIN_COMMUNITY_SIZE_FOR_SUBSPLIT) {
      const subEdges = edges.filter(
        (e) =>
          members.has(e.source_entity_id) && members.has(e.target_entity_id),
      );
      // Only recurse if the subgraph has internal structure (more than
      // 1 sub-cluster possible). If sub-clustering returns 1 community
      // matching the parent, drop it (no useful sub-split).
      const subCommunities = clusterByModularity(memberIds, subEdges, level + 1);
      if (subCommunities.length > 1) {
        children = subCommunities;
      }
    }

    result.push({
      level,
      entity_ids: memberIds,
      edge_ids: internalEdgeIds,
      modularity,
      children,
    });
  }

  // Sort by size descending — prettier hierarchy traversal + the
  // summary orchestrator can prioritize larger communities first.
  result.sort((a, b) => b.entity_ids.length - a.entity_ids.length);

  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────

function countAll(c: DetectedCommunity): number {
  let n = 1;
  for (const ch of c.children) n += countAll(ch);
  return n;
}
