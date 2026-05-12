// ── Mediator Proposal Engine — M1: cluster detector ──────────────────
//
// Pure function. Walks (entities, edges) for a space and returns a list
// of orphan clusters — patterns of structurally suspicious connectivity
// that suggest a missing intermediate entity (mediator / microvariable /
// hub) ought to bridge them.
//
// The user's complaint that motivated this engine: "MDA + 8-OHdG + Lipid
// Peroxidation are all on the canvas but they have no edges between
// them and no shared upstream — the graph has the entities but not the
// microvariable (Reactive Oxygen Species) that mechanistically connects
// them." This detector finds those patterns; downstream M2 (LLM
// proposer) figures out what bridge to suggest; M3 (literature
// validator) cites the proposal; M4 (proposal queue) stages it for
// user approval.
//
// The function is deliberately:
//   - Pure: takes entities + edges, returns clusters. No DB access, no
//     LLM calls, no side effects. Trivially testable.
//   - Deterministic: cluster_id is a SHA-256 prefix over (pattern_kind,
//     sorted member_ids), so re-running on unchanged data produces the
//     same cluster IDs. M4 uses this for idempotent persistence.
//   - Tunable: every threshold has an option override. Defaults are
//     calibrated to the cognitive-performance / mind-body-cognition
//     templates' density (~0.4 edges/node, layered ontology).
//   - Cost-bounded: capped at maxClustersToReturn so a malformed graph
//     can't produce thousands of clusters that would each cost an LLM
//     call downstream.
//
// Detection passes (in order; later passes dedupe against earlier):
//   1. isolated_singletons    — degree-0 entities clustered by layer
//   2. disconnected_component — small components disconnected from the
//                                main backbone of the graph
//   3. sibling_orphans        — ≥3 low-degree entities sharing a layer
//                                (and optionally a keyword)
//   4. missing_hub            — a layer with ≥4 entities but no node
//                                with degree ≥ 3 (no natural anchor)
//
// What detection does NOT do (deliberately):
//   - Propose the bridging entity. That's M2 (LLM call). We just surface
//     the structure.
//   - Search the literature. That's M3.
//   - Persist anything. That's M4.

import { createHash } from "node:crypto";
import type { Entity, Edge } from "@/types";

// ── Public types ────────────────────────────────────────────────────

export type OrphanClusterPattern =
  | "isolated_singletons"
  | "disconnected_component"
  | "sibling_orphans"
  | "missing_hub";

export interface OrphanCluster {
  /**
   * Deterministic ID — SHA-256(pattern_kind + sorted member_entity_ids).
   * Stable across re-runs on unchanged data. M4 persistence keys on this.
   */
  cluster_id: string;

  pattern_kind: OrphanClusterPattern;

  /** UUIDs (entities.id), sorted for determinism. ≥1 in singleton case,
   *  ≥3 in cluster cases. */
  member_entity_ids: string[];

  /** Names corresponding 1-1 to member_entity_ids — kept on the cluster
   *  for LLM input convenience without re-joining downstream. */
  member_entity_names: string[];

  /** What signals tied these members together. Provided to the LLM in
   *  M2 so it can propose a domain-appropriate bridge. */
  shared_signal: {
    layer: string | null;
    layer_total_size: number;
    /** Word stems (≥4 chars, lowercased) appearing in ≥2 member names.
     *  Empty when the cluster is bound by structure alone. */
    common_keywords: string[];
  };

  /**
   * Edge density INSIDE the cluster: actual_internal_edges /
   * max_possible_internal_edges (n × (n-1) for directed, or n*(n-1)/2
   * for undirected). 0 means total disconnection; 1 means complete
   * subgraph. Below 0.2 = sparse enough to suggest a missing hub.
   */
  current_edge_density: number;

  /**
   * BFS distance to the nearest entity OUTSIDE the cluster, treating
   * edges as undirected. Infinity = the cluster is in its own
   * connected component. 1 = directly adjacent to non-cluster nodes
   * (this is normal; it just means the cluster has external edges
   * but no internal cohesion).
   */
  spatial_isolation: number;

  /**
   * Detector's confidence that a real bridging mediator exists for this
   * cluster. Calibrated heuristically: more isolation + larger size +
   * stronger shared signal → higher confidence. M4 surfaces this on
   * the proposal queue so the user can prioritize review.
   */
  detection_confidence: number;

  /** Human-readable hint passed to the LLM proposer in M2. */
  recommended_action: string;
}

export interface DetectOrphanClustersOptions {
  /** Minimum members for sibling_orphans / disconnected_component /
   *  missing_hub clusters. Singletons handled separately. Default 3. */
  minClusterSize: number;
  /** Members whose degree is at-or-below this count as "low-degree"
   *  for sibling_orphans detection. Default 1. */
  lowDegreeThreshold: number;
  /** Edge density below which a cluster is "sparse enough to need a
   *  hub". 0-1. Default 0.2. */
  edgeDensityThreshold: number;
  /** A layer with this many entities but no node above hubDegreeThreshold
   *  triggers missing_hub. Default minLayerSize=4. */
  hubMinLayerSize: number;
  /** Degree threshold for "this could be a hub". Default 3. */
  hubDegreeThreshold: number;
  /** Minimum keyword length (lowercase substring). Words shorter are
   *  ignored as too generic to indicate shared meaning. Default 4. */
  minKeywordLength: number;
  /** Words filtered from keyword overlap regardless of length —
   *  too generic in this domain to count as a shared signal. */
  keywordStopwords: ReadonlySet<string>;
  /** Cost bound — at most N clusters returned per call. Sorted by
   *  detection_confidence desc, so the most promising survive. */
  maxClustersToReturn: number;
}

const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "with", "from", "into", "this", "that", "these", "those",
  "system", "systems", "factor", "factors", "level", "levels", "score", "scores",
  "mechanism", "mechanisms", "process", "processes", "function", "functions",
  "value", "values", "rate", "rates", "type", "types", "entity", "entities",
  "data", "model", "models", "analysis", "context", "general", "specific",
]);

const DEFAULT_OPTIONS: DetectOrphanClustersOptions = {
  minClusterSize: 3,
  lowDegreeThreshold: 1,
  edgeDensityThreshold: 0.2,
  hubMinLayerSize: 4,
  hubDegreeThreshold: 3,
  minKeywordLength: 4,
  keywordStopwords: DEFAULT_STOPWORDS,
  maxClustersToReturn: 8,
};

// ── Public function ─────────────────────────────────────────────────

export function detectOrphanClusters(
  entities: Entity[],
  edges: Edge[],
  options: Partial<DetectOrphanClustersOptions> = {},
): OrphanCluster[] {
  const opts: DetectOrphanClustersOptions = { ...DEFAULT_OPTIONS, ...options };

  if (entities.length < opts.minClusterSize) return [];

  // Build core data structures once. All passes share these.
  const entityById = new Map<string, Entity>();
  for (const e of entities) entityById.set(e.id, e);

  const adjacency = buildUndirectedAdjacency(entities, edges);
  const degree = computeDegrees(adjacency);
  const componentByEntity = computeConnectedComponents(entities, adjacency);
  const layerByEntity = new Map<string, string | null>();
  for (const e of entities) layerByEntity.set(e.id, e.layer ?? null);

  // Group entities by layer for the layer-aware passes.
  const entitiesByLayer = new Map<string | null, Entity[]>();
  for (const e of entities) {
    const layer = e.layer ?? null;
    const arr = entitiesByLayer.get(layer);
    if (arr) arr.push(e);
    else entitiesByLayer.set(layer, [e]);
  }

  // Run the detection passes. Each pass returns a list of clusters; we
  // dedupe at the end using cluster_id.
  const allClusters: OrphanCluster[] = [];
  const seenClusterIds = new Set<string>();
  const pushIfNew = (c: OrphanCluster) => {
    if (seenClusterIds.has(c.cluster_id)) return;
    seenClusterIds.add(c.cluster_id);
    allClusters.push(c);
  };

  // Pass 1 — isolated singletons clustered by layer.
  for (const c of detectIsolatedSingletons({
    entitiesByLayer,
    degree,
    opts,
  })) {
    pushIfNew(c);
  }

  // Pass 2 — disconnected components.
  for (const c of detectDisconnectedComponents({
    entities,
    componentByEntity,
    layerByEntity,
    edges,
    opts,
  })) {
    pushIfNew(c);
  }

  // Pass 3 — sibling orphans (≥3 low-degree in same layer).
  for (const c of detectSiblingOrphans({
    entitiesByLayer,
    degree,
    edges,
    adjacency,
    opts,
  })) {
    pushIfNew(c);
  }

  // Pass 4 — missing hubs.
  for (const c of detectMissingHubs({
    entitiesByLayer,
    degree,
    edges,
    opts,
  })) {
    pushIfNew(c);
  }

  // Sort by detection_confidence desc, then by isolation desc, then by
  // size desc — most-likely-real clusters first.
  allClusters.sort((a, b) => {
    if (b.detection_confidence !== a.detection_confidence) {
      return b.detection_confidence - a.detection_confidence;
    }
    if (b.spatial_isolation !== a.spatial_isolation) {
      // Infinity is fine to subtract because it always wins.
      return b.spatial_isolation - a.spatial_isolation;
    }
    return b.member_entity_ids.length - a.member_entity_ids.length;
  });

  return allClusters.slice(0, opts.maxClustersToReturn);
}

// ── Detection passes ────────────────────────────────────────────────

function detectIsolatedSingletons(args: {
  entitiesByLayer: Map<string | null, Entity[]>;
  degree: Map<string, number>;
  opts: DetectOrphanClustersOptions;
}): OrphanCluster[] {
  const { entitiesByLayer, degree, opts } = args;
  const out: OrphanCluster[] = [];

  for (const [layer, layerEntities] of entitiesByLayer) {
    if (!layer) continue; // null-layer entities skipped — typically meta/system rows
    const isolated = layerEntities.filter((e) => (degree.get(e.id) ?? 0) === 0);
    if (isolated.length < opts.minClusterSize) continue;

    const memberIds = isolated.map((e) => e.id).sort();
    const memberNames = isolated.map((e) => e.name);
    const keywords = sharedKeywords(memberNames, opts);

    out.push({
      cluster_id: hashClusterId("isolated_singletons", memberIds),
      pattern_kind: "isolated_singletons",
      member_entity_ids: memberIds,
      member_entity_names: memberNames,
      shared_signal: {
        layer,
        layer_total_size: layerEntities.length,
        common_keywords: keywords,
      },
      current_edge_density: 0,
      spatial_isolation: Infinity,
      detection_confidence: clamp01(
        0.6 + 0.05 * Math.min(isolated.length, 6) + (keywords.length > 0 ? 0.15 : 0),
      ),
      recommended_action:
        `Layer "${layer}" has ${isolated.length} entities with zero edges` +
        (keywords.length > 0
          ? `. Shared terms (${keywords.slice(0, 3).join(", ")}) suggest a common upstream cause that may not be in the graph yet.`
          : `. They share no edges or keywords; check whether a category-level parent (e.g. a class or pathway) is missing.`),
    });
  }

  return out;
}

function detectDisconnectedComponents(args: {
  entities: Entity[];
  componentByEntity: Map<string, number>;
  layerByEntity: Map<string, string | null>;
  edges: Edge[];
  opts: DetectOrphanClustersOptions;
}): OrphanCluster[] {
  const { entities, componentByEntity, layerByEntity, edges, opts } = args;

  // Group entities by component id.
  const entitiesByComponent = new Map<number, Entity[]>();
  for (const e of entities) {
    const cid = componentByEntity.get(e.id);
    if (cid === undefined) continue;
    const arr = entitiesByComponent.get(cid);
    if (arr) arr.push(e);
    else entitiesByComponent.set(cid, [e]);
  }
  if (entitiesByComponent.size <= 1) return []; // graph is one connected piece

  // Identify the largest component as the "main backbone" — clusters
  // ≠ this component are the disconnected ones.
  let mainComponentId = -1;
  let mainComponentSize = 0;
  for (const [cid, arr] of entitiesByComponent) {
    if (arr.length > mainComponentSize) {
      mainComponentSize = arr.length;
      mainComponentId = cid;
    }
  }

  const out: OrphanCluster[] = [];

  for (const [cid, comp] of entitiesByComponent) {
    if (cid === mainComponentId) continue;
    if (comp.length < opts.minClusterSize) continue;
    // Singletons handled by Pass 1.

    const memberIds = comp.map((e) => e.id).sort();
    const memberNames = comp.map((e) => e.name);
    const layers = new Set<string | null>();
    for (const e of comp) layers.add(layerByEntity.get(e.id) ?? null);
    const dominantLayer = pickMode<string | null>(
      [...layers.values()].filter((l): l is string => l !== null),
      null,
    );
    const keywords = sharedKeywords(memberNames, opts);
    const density = subgraphEdgeDensity(new Set(memberIds), edges);

    out.push({
      cluster_id: hashClusterId("disconnected_component", memberIds),
      pattern_kind: "disconnected_component",
      member_entity_ids: memberIds,
      member_entity_names: memberNames,
      shared_signal: {
        layer: dominantLayer,
        layer_total_size: dominantLayer
          ? entities.filter((e) => e.layer === dominantLayer).length
          : 0,
        common_keywords: keywords,
      },
      current_edge_density: density,
      spatial_isolation: Infinity,
      detection_confidence: clamp01(
        0.7 + 0.04 * Math.min(comp.length, 6) + (keywords.length > 0 ? 0.1 : 0),
      ),
      recommended_action:
        `${comp.length}-entity component disconnected from the main graph` +
        (dominantLayer ? ` (mostly in layer "${dominantLayer}")` : "") +
        `. A bridging entity that connects this island to the backbone would close the structural gap.`,
    });
  }

  return out;
}

function detectSiblingOrphans(args: {
  entitiesByLayer: Map<string | null, Entity[]>;
  degree: Map<string, number>;
  edges: Edge[];
  adjacency: Map<string, Set<string>>;
  opts: DetectOrphanClustersOptions;
}): OrphanCluster[] {
  const { entitiesByLayer, degree, edges, adjacency, opts } = args;
  const out: OrphanCluster[] = [];

  for (const [layer, layerEntities] of entitiesByLayer) {
    if (!layer) continue;
    if (layerEntities.length < opts.minClusterSize) continue;

    // Low-degree entities in this layer.
    const lowDeg = layerEntities.filter(
      (e) => (degree.get(e.id) ?? 0) <= opts.lowDegreeThreshold,
    );
    if (lowDeg.length < opts.minClusterSize) continue;

    // Skip pure-zero-degree clusters — those went through Pass 1 already.
    // Sibling orphans are about ≤lowDegreeThreshold (1 by default) which
    // includes singleton-edge entities sharing a layer.
    const memberIds = lowDeg.map((e) => e.id).sort();
    const memberNames = lowDeg.map((e) => e.name);
    const memberSet = new Set(memberIds);
    const keywords = sharedKeywords(memberNames, opts);
    const density = subgraphEdgeDensity(memberSet, edges);

    if (density >= opts.edgeDensityThreshold) continue; // not sparse enough

    const isolation = bfsDistanceToOutsideMember(memberSet, adjacency);

    out.push({
      cluster_id: hashClusterId("sibling_orphans", memberIds),
      pattern_kind: "sibling_orphans",
      member_entity_ids: memberIds,
      member_entity_names: memberNames,
      shared_signal: {
        layer,
        layer_total_size: layerEntities.length,
        common_keywords: keywords,
      },
      current_edge_density: density,
      spatial_isolation: isolation,
      detection_confidence: clamp01(
        0.55 +
          0.04 * Math.min(lowDeg.length, 6) +
          (keywords.length > 0 ? 0.18 : 0) +
          (density === 0 ? 0.1 : 0),
      ),
      recommended_action:
        `Layer "${layer}" has ${lowDeg.length} sibling entities with degree ≤ ${opts.lowDegreeThreshold} and density ${density.toFixed(2)}` +
        (keywords.length > 0
          ? ` sharing terms (${keywords.slice(0, 3).join(", ")}). A shared parent or hub likely exists in the literature.`
          : `. They might cluster around a hub that's not yet extracted.`),
    });
  }

  return out;
}

function detectMissingHubs(args: {
  entitiesByLayer: Map<string | null, Entity[]>;
  degree: Map<string, number>;
  edges: Edge[];
  opts: DetectOrphanClustersOptions;
}): OrphanCluster[] {
  const { entitiesByLayer, degree, edges, opts } = args;
  const out: OrphanCluster[] = [];

  for (const [layer, layerEntities] of entitiesByLayer) {
    if (!layer) continue;
    if (layerEntities.length < opts.hubMinLayerSize) continue;

    // Max degree within layer.
    let maxDegree = 0;
    for (const e of layerEntities) {
      const d = degree.get(e.id) ?? 0;
      if (d > maxDegree) maxDegree = d;
    }
    if (maxDegree >= opts.hubDegreeThreshold) continue; // already has a hub

    const memberIds = layerEntities.map((e) => e.id).sort();
    const memberNames = layerEntities.map((e) => e.name);
    const keywords = sharedKeywords(memberNames, opts);
    const density = subgraphEdgeDensity(new Set(memberIds), edges);

    out.push({
      cluster_id: hashClusterId("missing_hub", memberIds),
      pattern_kind: "missing_hub",
      member_entity_ids: memberIds,
      member_entity_names: memberNames,
      shared_signal: {
        layer,
        layer_total_size: layerEntities.length,
        common_keywords: keywords,
      },
      current_edge_density: density,
      spatial_isolation: 0, // by definition has external edges; just no internal hub
      detection_confidence: clamp01(
        0.5 +
          0.04 * Math.min(layerEntities.length, 8) +
          (keywords.length > 0 ? 0.15 : 0) +
          (maxDegree === 0 ? 0.15 : 0),
      ),
      recommended_action:
        `Layer "${layer}" has ${layerEntities.length} entities but no node with degree ≥ ${opts.hubDegreeThreshold}` +
        ` (max observed: ${maxDegree}). The layer likely needs a hub entity that connects siblings.`,
    });
  }

  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildUndirectedAdjacency(
  entities: Entity[],
  edges: Edge[],
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of entities) adj.set(e.id, new Set());
  for (const edge of edges) {
    if (!edge.source_entity_id || !edge.target_entity_id) continue;
    if (edge.source_entity_id === edge.target_entity_id) continue;
    const s = adj.get(edge.source_entity_id);
    const t = adj.get(edge.target_entity_id);
    if (s) s.add(edge.target_entity_id);
    if (t) t.add(edge.source_entity_id);
  }
  return adj;
}

function computeDegrees(adj: Map<string, Set<string>>): Map<string, number> {
  const deg = new Map<string, number>();
  for (const [id, neighbors] of adj) deg.set(id, neighbors.size);
  return deg;
}

function computeConnectedComponents(
  entities: Entity[],
  adj: Map<string, Set<string>>,
): Map<string, number> {
  const componentByEntity = new Map<string, number>();
  let nextComponentId = 0;
  for (const e of entities) {
    if (componentByEntity.has(e.id)) continue;
    // BFS from this entity.
    const queue: string[] = [e.id];
    componentByEntity.set(e.id, nextComponentId);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const neighbors = adj.get(cur);
      if (!neighbors) continue;
      for (const n of neighbors) {
        if (!componentByEntity.has(n)) {
          componentByEntity.set(n, nextComponentId);
          queue.push(n);
        }
      }
    }
    nextComponentId++;
  }
  return componentByEntity;
}

function subgraphEdgeDensity(
  memberSet: Set<string>,
  edges: Edge[],
): number {
  const n = memberSet.size;
  if (n < 2) return 0;
  let internalEdges = 0;
  // Track unique unordered pairs so a bidirectional pair doesn't count twice.
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!edge.source_entity_id || !edge.target_entity_id) continue;
    if (!memberSet.has(edge.source_entity_id)) continue;
    if (!memberSet.has(edge.target_entity_id)) continue;
    if (edge.source_entity_id === edge.target_entity_id) continue;
    const key =
      edge.source_entity_id < edge.target_entity_id
        ? `${edge.source_entity_id}|${edge.target_entity_id}`
        : `${edge.target_entity_id}|${edge.source_entity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    internalEdges++;
  }
  // Undirected max edges = n*(n-1)/2.
  const maxEdges = (n * (n - 1)) / 2;
  return maxEdges === 0 ? 0 : internalEdges / maxEdges;
}

function bfsDistanceToOutsideMember(
  memberSet: Set<string>,
  adj: Map<string, Set<string>>,
): number {
  // Multi-source BFS: start from all members at distance 0; any node
  // reached that's NOT a member tells us the distance from the member
  // border to the outside. Returns Infinity if no path leaves.
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const m of memberSet) {
    dist.set(m, 0);
    queue.push(m);
  }
  let minOutside = Infinity;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curDist = dist.get(cur) ?? 0;
    if (!memberSet.has(cur)) {
      if (curDist < minOutside) minOutside = curDist;
      // Don't traverse past the boundary; we only care about the
      // closest outside reachable node.
      continue;
    }
    const neighbors = adj.get(cur);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (dist.has(n)) continue;
      dist.set(n, curDist + 1);
      queue.push(n);
    }
  }
  return minOutside;
}

function sharedKeywords(
  names: string[],
  opts: DetectOrphanClustersOptions,
): string[] {
  if (names.length < 2) return [];
  // Tokenize each name into lowercased word stems of length ≥ minKeywordLength.
  const wordSetsPerName = names.map((name) =>
    new Set(
      name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/[\s-]+/)
        .filter(
          (w) =>
            w.length >= opts.minKeywordLength &&
            !opts.keywordStopwords.has(w),
        ),
    ),
  );
  // Count how many names contain each word.
  const wordCount = new Map<string, number>();
  for (const set of wordSetsPerName) {
    for (const w of set) {
      wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
    }
  }
  // Return words present in ≥2 names, sorted by frequency desc.
  return [...wordCount.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);
}

function pickMode<T>(values: T[], fallback: T): T {
  if (values.length === 0) return fallback;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T = fallback;
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function hashClusterId(pattern: OrphanClusterPattern, memberIds: string[]): string {
  const sortedIds = [...memberIds].sort();
  const hash = createHash("sha256");
  hash.update(pattern);
  hash.update("|");
  for (const id of sortedIds) {
    hash.update(id);
    hash.update(",");
  }
  // 12 chars of hex = 48 bits — collision-safe for the ~1000 clusters
  // a single space could plausibly contain.
  return hash.digest("hex").slice(0, 12);
}
