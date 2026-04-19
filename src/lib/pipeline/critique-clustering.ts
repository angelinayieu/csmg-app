// ── Critique clustering ──
// At small graph sizes (<50 entities) dumping the full graph into one critic
// call works fine. At 100+ entities the input balloons past 50k tokens and
// the critic can't reason deeply about any one area. This module plans how
// to split the graph into clusters the critic can handle, and provides
// helpers to build per-cluster prompts and merge per-cluster results.
//
// Strategy: group entities by their `layer` field (populated by Tier 2 of
// decomposition). Fall back to a single-call plan when the graph is small,
// layers are missing, or clustering would produce fewer than 2 meaningful
// clusters.

import type { Entity, Edge } from "@/types";

export interface ClusterPlan {
  strategy: "single" | "by_layer";
  clusters: Array<{ key: string; entities: Entity[] }>;
  // When strategy="by_layer", explains why chosen (for logging).
  reason: string;
}

interface ClusteringThresholds {
  /** Below this total, always single-call. Default 50. */
  minTotal: number;
  /** A cluster below this size gets absorbed into a catch-all or the next smallest. Default 8. */
  minPerCluster: number;
  /** A cluster above this size gets split by importance. Default 55. */
  maxPerCluster: number;
  /** Need at least this many non-trivial clusters to use cluster mode. Default 2. */
  minMeaningfulClusters: number;
}

const DEFAULTS: ClusteringThresholds = {
  minTotal: 50,
  minPerCluster: 8,
  maxPerCluster: 55,
  minMeaningfulClusters: 2,
};

const IMPORTANCE_RANK: Record<string, number> = {
  fundamental: 4,
  critical: 3,
  important: 2,
  moderate: 1,
};

function sortByImportance(entities: Entity[]): Entity[] {
  return [...entities].sort((a, b) => {
    const ra = IMPORTANCE_RANK[a.importance ?? "moderate"] ?? 0;
    const rb = IMPORTANCE_RANK[b.importance ?? "moderate"] ?? 0;
    return rb - ra;
  });
}

/**
 * Plan how to partition the graph for parallel critique. Falls back to a
 * single-call plan when clustering wouldn't help — this preserves today's
 * behavior for small graphs and degrades gracefully when layers are missing.
 */
export function planCritiqueClusters(
  entities: Entity[],
  overrides: Partial<ClusteringThresholds> = {},
): ClusterPlan {
  const t = { ...DEFAULTS, ...overrides };

  if (entities.length < t.minTotal) {
    return {
      strategy: "single",
      clusters: [{ key: "all", entities }],
      reason: `graph size ${entities.length} < ${t.minTotal} threshold`,
    };
  }

  // Group by layer. Null/empty layers go into "unassigned".
  const byLayer = new Map<string, Entity[]>();
  for (const e of entities) {
    const key = (typeof e.layer === "string" && e.layer.trim()) || "unassigned";
    const arr = byLayer.get(key) ?? [];
    arr.push(e);
    byLayer.set(key, arr);
  }

  // Split oversized layers by importance priority so the densest slice is
  // always in the first sub-cluster.
  const rawGroups: Array<{ key: string; entities: Entity[] }> = [];
  for (const [key, ents] of byLayer.entries()) {
    if (ents.length <= t.maxPerCluster) {
      rawGroups.push({ key, entities: ents });
      continue;
    }
    const sorted = sortByImportance(ents);
    for (let i = 0; i < sorted.length; i += t.maxPerCluster) {
      rawGroups.push({
        key: `${key}_${Math.floor(i / t.maxPerCluster) + 1}`,
        entities: sorted.slice(i, i + t.maxPerCluster),
      });
    }
  }

  // Partition into big (>= min) and tiny (< min).
  const big = rawGroups.filter((g) => g.entities.length >= t.minPerCluster);
  const tiny = rawGroups.filter((g) => g.entities.length < t.minPerCluster);

  // Roll tiny groups into a catch-all or absorb them into the smallest big group.
  if (tiny.length > 0) {
    const combined = tiny.flatMap((g) => g.entities);
    if (combined.length >= t.minPerCluster) {
      big.push({ key: "misc", entities: combined });
    } else if (combined.length > 0 && big.length > 0) {
      const smallest = big.reduce(
        (min, cur) => (cur.entities.length < min.entities.length ? cur : min),
        big[0],
      );
      smallest.entities.push(...combined);
    } else if (combined.length > 0) {
      // Edge case: no big groups to absorb into. Keep the combined as its own
      // cluster even if small — still better than a giant single call.
      big.push({ key: "misc", entities: combined });
    }
  }

  if (big.length < t.minMeaningfulClusters) {
    return {
      strategy: "single",
      clusters: [{ key: "all", entities }],
      reason: `only ${big.length} meaningful cluster(s) after grouping — not worth splitting`,
    };
  }

  return {
    strategy: "by_layer",
    clusters: big,
    reason: `split into ${big.length} clusters by layer (sizes: ${big.map((c) => c.entities.length).join(", ")})`,
  };
}

// ── Cluster summary construction ──

export interface ClusterSummary {
  key: string;
  entities: Entity[];
  // Edges with both endpoints inside this cluster.
  intraEdges: Edge[];
  // Edges with exactly one endpoint inside this cluster. Summarized as
  // boundary context so the critic knows the cluster's "outside connections"
  // without trying to reason about the rest of the graph.
  crossEdges: Edge[];
}

/**
 * For each cluster, separate edges into intra- vs cross-cluster. Cross-cluster
 * edges become context ("this cluster connects to N external entities") rather
 * than something the critic is asked to evaluate — keeps the critic's scope
 * bounded to entities it can reason about fully.
 */
export function buildClusterSummaries(
  clusters: Array<{ key: string; entities: Entity[] }>,
  edges: Edge[],
): ClusterSummary[] {
  // Build membership map: entity UUID → cluster key.
  const uuidToCluster = new Map<string, string>();
  for (const c of clusters) {
    for (const e of c.entities) uuidToCluster.set(e.id, c.key);
  }

  return clusters.map((c) => {
    const inCluster = new Set(c.entities.map((e) => e.id));
    const intraEdges: Edge[] = [];
    const crossEdges: Edge[] = [];
    for (const edge of edges) {
      const srcIn = inCluster.has(edge.source_entity_id);
      const tgtIn = inCluster.has(edge.target_entity_id);
      if (srcIn && tgtIn) intraEdges.push(edge);
      else if (srcIn || tgtIn) crossEdges.push(edge);
    }
    return { key: c.key, entities: c.entities, intraEdges, crossEdges };
  });
}

// ── Cluster-aware result merging ──
//
// A per-cluster critique produces partial results. We merge them into a
// single aggregate that the downstream route can apply exactly as it does
// today. Some fields (centrality corrections, objective coverage) need global
// context — the clustered pass intentionally skips those and the route falls
// back to a light global pass if needed.

export interface MergeableCritiqueResult {
  orphans?: Array<{
    entity_id: string;
    current_edge_count: number;
    importance: string;
    missing_edges: Array<{
      target_entity_id: string;
      relationship_type: string;
      reasoning: string;
    }>;
  }>;
  missed_cycles?: Array<{
    name: string;
    chain: string[];
    classification: string;
    intervention_point: string;
    reasoning: string;
  }>;
  predicted_edges?: Array<{
    source: string;
    target: string;
    relationship_type: string;
    confidence: string;
    reasoning: string;
  }>;
  density_assessment?: {
    current_density: number;
    sufficient: boolean;
    estimated_missing_edges: number;
    sparse_areas: string[];
  };
  relationship_violations?: Array<{
    edge: string;
    rule_violated: string;
    explanation: string;
    suggested_correction: string;
  }>;
  overall_quality?: {
    score: string;
    summary: string;
  };
  centrality_corrections?: {
    agrees_with_decomposition: boolean;
    corrected_ranking: Array<{
      entity_id: string;
      rank: number;
      degree: number;
      reasoning: string;
    }>;
    explanation: string;
  };
}

// Order-preserving dedup by a string key function.
function dedupBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyFn(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

/**
 * Merge per-cluster critique results into a single aggregate. Cross-cluster
 * concerns (global centrality ranking, density) are handled conservatively:
 * centrality_corrections defaults to "agrees with decomposition" because no
 * single cluster has the context to re-rank globally; density is reported as
 * insufficient if ANY cluster was insufficient.
 */
export function mergeCritiqueResults(
  perCluster: Array<{ key: string; result: MergeableCritiqueResult }>,
): MergeableCritiqueResult {
  const merged: MergeableCritiqueResult = {
    orphans: [],
    missed_cycles: [],
    predicted_edges: [],
    relationship_violations: [],
  };

  for (const { result } of perCluster) {
    if (result.orphans) merged.orphans!.push(...result.orphans);
    if (result.missed_cycles) merged.missed_cycles!.push(...result.missed_cycles);
    if (result.predicted_edges) merged.predicted_edges!.push(...result.predicted_edges);
    if (result.relationship_violations) {
      merged.relationship_violations!.push(...result.relationship_violations);
    }
  }

  // Dedup. Orphans by entity_id (keep the first cluster's suggestions).
  merged.orphans = dedupBy(merged.orphans!, (o) => o.entity_id);

  // Predicted edges by source→target→type (directed, so A→B ≠ B→A).
  merged.predicted_edges = dedupBy(
    merged.predicted_edges!,
    (p) => `${p.source}→${p.target}→${p.relationship_type}`,
  );

  // Missed cycles by normalized chain (sort + join so "A,B,C" == "B,C,A").
  merged.missed_cycles = dedupBy(merged.missed_cycles!, (c) =>
    [...(c.chain ?? [])].sort().join(","),
  );

  // Violations by edge string + rule.
  merged.relationship_violations = dedupBy(
    merged.relationship_violations!,
    (v) => `${v.edge}::${v.rule_violated}`,
  );

  // Density: take worst-case.
  const densities = perCluster
    .map((c) => c.result.density_assessment)
    .filter((d): d is NonNullable<typeof d> => !!d);
  if (densities.length > 0) {
    merged.density_assessment = {
      current_density:
        densities.reduce((a, b) => a + (b.current_density ?? 0), 0) / densities.length,
      sufficient: densities.every((d) => d.sufficient),
      estimated_missing_edges: densities.reduce(
        (a, b) => a + (b.estimated_missing_edges ?? 0),
        0,
      ),
      sparse_areas: Array.from(new Set(densities.flatMap((d) => d.sparse_areas ?? []))),
    };
  }

  // Overall quality: concatenate summaries, take the lowest declared score.
  const qualities = perCluster
    .map((c) => c.result.overall_quality)
    .filter((q): q is NonNullable<typeof q> => !!q);
  if (qualities.length > 0) {
    const scoreRank: Record<string, number> = { poor: 1, fair: 2, good: 3, excellent: 4 };
    const lowest = qualities.reduce((worst, cur) => {
      const wr = scoreRank[worst.score?.toLowerCase() ?? ""] ?? 99;
      const cr = scoreRank[cur.score?.toLowerCase() ?? ""] ?? 99;
      return cr < wr ? cur : worst;
    });
    merged.overall_quality = {
      score: lowest.score,
      summary: qualities
        .map((q, i) => `[cluster ${perCluster[i].key}] ${q.summary}`)
        .join(" | "),
    };
  }

  // Centrality: no single cluster has global view. Default to "agrees" unless
  // all clusters declared agreement — if any disagreed, leave corrections
  // empty and let the route skip the rerank step.
  merged.centrality_corrections = {
    agrees_with_decomposition: true,
    corrected_ranking: [],
    explanation:
      "Cluster-bounded critique — centrality rerank skipped; no single cluster has the global graph view required for meaningful re-ranking.",
  };

  return merged;
}
