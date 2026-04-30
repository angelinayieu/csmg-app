// ── Preliminary topology insights ───────────────────────────────────
//
// Pure graph algorithms over the entities + edges that Decompose has
// already persisted. Surfaces structural patterns the user can act on
// IMMEDIATELY (~30s after intake completes) while heavier LLM stages
// — research, depth, synthesis — continue running for minutes.
//
// Why client-side: the inputs (Entity[], Edge[]) are already in
// memory via useSpaceData; the algorithms are O(n + m) for hubs +
// components and O(n²) for bridge candidates. With ~30 entities the
// total compute is ~10ms — small enough to run inside a useMemo
// without a server round-trip.
//
// Why "preliminary": these are topology-only signals. The synthesis
// stage produces semantically richer leverage / risk / loop callouts
// later. The preliminary insights stay until synthesis_data populates,
// at which point the synthesized cards take over.

import type { Entity, Edge } from "@/types";

// ── Public types ────────────────────────────────────────────────────

export interface HubEntity {
  entityId: string;
  name: string;
  degree: number;
  /** Edges where this entity is the source. */
  outDegree: number;
  /** Edges where this entity is the target. */
  inDegree: number;
}

export interface BridgeCandidate {
  /** Entity A. */
  aId: string;
  aName: string;
  /** Entity B. */
  bId: string;
  bName: string;
  /** Jaccard similarity of their neighbor sets (0-1). */
  jaccard: number;
  /** Count of neighbors they have in common. */
  sharedNeighbors: number;
}

export interface IsolatedCluster {
  /** Member entity ids. */
  entityIds: string[];
  /** First-listed entity name (for display). */
  representativeName: string;
  size: number;
}

export interface FeedbackLoop {
  /** Entity ids forming the cycle, in order. */
  entityIds: string[];
  /** Display labels for each step. */
  names: string[];
  /** Length of the loop (2-4). */
  length: number;
}

export interface PreliminaryInsights {
  hubs: HubEntity[];
  bridgeCandidates: BridgeCandidate[];
  isolatedClusters: IsolatedCluster[];
  feedbackLoops: FeedbackLoop[];
  /** Total entity count — useful for "X of Y" displays. */
  totalEntities: number;
  /** Total edge count. */
  totalEdges: number;
}

// ── Public API ──────────────────────────────────────────────────────

const TOP_HUBS = 5;
const MAX_BRIDGE_CANDIDATES = 5;
const MIN_BRIDGE_SHARED_NEIGHBORS = 2;
const MIN_BRIDGE_JACCARD = 0.25;
const MAX_ISOLATED_CLUSTERS = 4;
const MIN_ISOLATED_CLUSTER_SIZE = 2;
const MAX_LOOPS = 5;
const MAX_LOOP_LENGTH = 4;

export function computePreliminaryInsights(
  entities: Entity[],
  edges: Edge[],
): PreliminaryInsights {
  // Build a name lookup for display.
  const nameById = new Map<string, string>();
  for (const e of entities) nameById.set(e.id, e.name);

  return {
    hubs: computeHubs(entities, edges, nameById),
    bridgeCandidates: computeBridgeCandidates(entities, edges, nameById),
    isolatedClusters: computeIsolatedClusters(entities, edges, nameById),
    feedbackLoops: computeFeedbackLoops(edges, nameById),
    totalEntities: entities.length,
    totalEdges: edges.length,
  };
}

// ── Hubs (degree centrality) ────────────────────────────────────────

function computeHubs(
  entities: Entity[],
  edges: Edge[],
  nameById: Map<string, string>,
): HubEntity[] {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const e of edges) {
    outDeg.set(e.source_entity_id, (outDeg.get(e.source_entity_id) ?? 0) + 1);
    inDeg.set(e.target_entity_id, (inDeg.get(e.target_entity_id) ?? 0) + 1);
  }
  const hubs: HubEntity[] = entities.map((ent) => ({
    entityId: ent.id,
    name: ent.name,
    outDegree: outDeg.get(ent.id) ?? 0,
    inDegree: inDeg.get(ent.id) ?? 0,
    degree: (outDeg.get(ent.id) ?? 0) + (inDeg.get(ent.id) ?? 0),
  }));
  // Sort by degree desc, drop zero-degree (those are isolated, not hubs).
  return hubs
    .filter((h) => h.degree > 0)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, TOP_HUBS)
    .map((h) => ({ ...h, name: nameById.get(h.entityId) ?? h.name }));
}

// ── Bridge candidates (high Jaccard, no direct edge) ────────────────

function computeBridgeCandidates(
  entities: Entity[],
  edges: Edge[],
  nameById: Map<string, string>,
): BridgeCandidate[] {
  // Treat edges as undirected for "structural similarity" purposes —
  // the direction of a future bridge is the user's call.
  const neighbors = new Map<string, Set<string>>();
  const ensure = (id: string) => {
    let s = neighbors.get(id);
    if (!s) {
      s = new Set();
      neighbors.set(id, s);
    }
    return s;
  };
  for (const e of edges) {
    ensure(e.source_entity_id).add(e.target_entity_id);
    ensure(e.target_entity_id).add(e.source_entity_id);
  }
  // Track which pairs already have a direct edge so we don't propose
  // bridges that already exist.
  const directlyConnected = new Set<string>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const e of edges) {
    directlyConnected.add(pairKey(e.source_entity_id, e.target_entity_id));
  }

  const candidates: BridgeCandidate[] = [];
  const ids = entities.map((e) => e.id);
  for (let i = 0; i < ids.length; i++) {
    const ai = ids[i];
    const aSet = neighbors.get(ai);
    if (!aSet || aSet.size === 0) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const bi = ids[j];
      if (directlyConnected.has(pairKey(ai, bi))) continue;
      const bSet = neighbors.get(bi);
      if (!bSet || bSet.size === 0) continue;
      // Intersection.
      let shared = 0;
      // Iterate the smaller set for efficiency.
      const [small, large] = aSet.size <= bSet.size ? [aSet, bSet] : [bSet, aSet];
      for (const n of small) if (large.has(n)) shared++;
      if (shared < MIN_BRIDGE_SHARED_NEIGHBORS) continue;
      // Union size = |A| + |B| - intersection.
      const unionSize = aSet.size + bSet.size - shared;
      const jaccard = shared / unionSize;
      if (jaccard < MIN_BRIDGE_JACCARD) continue;
      candidates.push({
        aId: ai,
        aName: nameById.get(ai) ?? ai,
        bId: bi,
        bName: nameById.get(bi) ?? bi,
        jaccard,
        sharedNeighbors: shared,
      });
    }
  }
  return candidates
    .sort((a, b) => b.jaccard - a.jaccard || b.sharedNeighbors - a.sharedNeighbors)
    .slice(0, MAX_BRIDGE_CANDIDATES);
}

// ── Isolated clusters (connected components, undirected) ─────────────

function computeIsolatedClusters(
  entities: Entity[],
  edges: Edge[],
  nameById: Map<string, string>,
): IsolatedCluster[] {
  // Union-find over entity ids.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur)!;
      parent.set(cur, parent.get(p) ?? p);
      cur = parent.get(cur)!;
    }
    return cur;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const e of entities) parent.set(e.id, e.id);
  for (const e of edges) {
    if (parent.has(e.source_entity_id) && parent.has(e.target_entity_id)) {
      union(e.source_entity_id, e.target_entity_id);
    }
  }
  const groups = new Map<string, string[]>();
  for (const ent of entities) {
    const root = find(ent.id);
    const list = groups.get(root) ?? [];
    list.push(ent.id);
    groups.set(root, list);
  }
  // The largest component is the "main" graph; smaller ones are
  // isolated clusters worth surfacing.
  const sortedGroups = [...groups.values()].sort((a, b) => b.length - a.length);
  if (sortedGroups.length <= 1) return [];
  const isolated = sortedGroups.slice(1);
  return isolated
    .filter((group) => group.length >= MIN_ISOLATED_CLUSTER_SIZE)
    .slice(0, MAX_ISOLATED_CLUSTERS)
    .map((group) => ({
      entityIds: group,
      representativeName: nameById.get(group[0]) ?? group[0],
      size: group.length,
    }));
}

// ── Feedback loops (directed cycles, length 2-4) ────────────────────

function computeFeedbackLoops(
  edges: Edge[],
  nameById: Map<string, string>,
): FeedbackLoop[] {
  // Adjacency list for directed graph.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source_entity_id) ?? [];
    list.push(e.target_entity_id);
    adj.set(e.source_entity_id, list);
  }
  // Set for O(1) edge-existence checks (length-2 cycle detection).
  const edgeSet = new Set<string>();
  for (const e of edges) edgeSet.add(`${e.source_entity_id}|${e.target_entity_id}`);

  const loops: FeedbackLoop[] = [];
  const seen = new Set<string>();

  // Length-2 (mutual edges A↔B) — fastest, do first.
  for (const e of edges) {
    if (loops.length >= MAX_LOOPS) break;
    const reverse = `${e.target_entity_id}|${e.source_entity_id}`;
    if (!edgeSet.has(reverse)) continue;
    // De-dupe — A→B + B→A is one loop, not two.
    const key = [e.source_entity_id, e.target_entity_id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    loops.push({
      entityIds: [e.source_entity_id, e.target_entity_id],
      names: [
        nameById.get(e.source_entity_id) ?? e.source_entity_id,
        nameById.get(e.target_entity_id) ?? e.target_entity_id,
      ],
      length: 2,
    });
  }

  // Length 3+ — DFS, bounded depth. Skip if we already have enough.
  if (loops.length < MAX_LOOPS) {
    const nodes = [...adj.keys()];
    for (const start of nodes) {
      if (loops.length >= MAX_LOOPS) break;
      const stack: { node: string; path: string[] }[] = [{ node: start, path: [start] }];
      while (stack.length > 0) {
        if (loops.length >= MAX_LOOPS) break;
        const { node, path } = stack.pop()!;
        if (path.length > MAX_LOOP_LENGTH) continue;
        for (const next of adj.get(node) ?? []) {
          if (next === start && path.length >= 3) {
            // Found a cycle. De-dupe by canonicalizing the rotation.
            const canonical = canonicalizeRotation(path);
            const key = canonical.join("|");
            if (seen.has(key)) continue;
            seen.add(key);
            loops.push({
              entityIds: path,
              names: path.map((id) => nameById.get(id) ?? id),
              length: path.length,
            });
            if (loops.length >= MAX_LOOPS) break;
            continue;
          }
          if (path.includes(next)) continue;
          stack.push({ node: next, path: [...path, next] });
        }
      }
    }
  }

  return loops;
}

// Canonicalize a cycle by rotating it to start at the lexicographically
// smallest id. So [B, C, A] and [A, B, C] become the same key.
function canonicalizeRotation(path: string[]): string[] {
  let minIdx = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i] < path[minIdx]) minIdx = i;
  }
  return [...path.slice(minIdx), ...path.slice(0, minIdx)];
}
