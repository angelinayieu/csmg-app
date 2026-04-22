// ── KG signature extractor (Phase 2H — cross-domain analogy) ──
//
// Pure function: (entities, edges, cycles) → KGSignature.
//
// Produces a 32-dim structural vector + 1536-dim semantic centroid
// + 1568-dim combined vector for HNSW-indexed ANN search. The
// structural half is domain-independent — a churn loop in B2B SaaS
// and a habit-formation cycle in behavioral science produce nearly
// identical structural signatures, which is the mechanism behind
// cross-domain analog retrieval.
//
// Feature list (30 signal + 2 zero-pad):
//   [0]  entity_count             (normalized by 50)
//   [1]  leverage_ratio
//   [2]  risk_ratio
//   [3]  bottleneck_ratio
//   [4-7]  importance_distribution  (fundamental/critical/important/moderate)
//   [8]  edge_density              (|E| / max possible edges)
//   [9-17]  dimension_distribution (structural/functional/temporal/causal/
//                                   correlational/logical/epistemic/
//                                   comparative/agentive)
//   [18-21] polarity_distribution  (positive/negative/neutral/conditional)
//   [22] cycle_count               (normalized by 10)
//   [23] reinforcing_cycle_ratio
//   [24] balancing_cycle_ratio
//   [25] mean_cycle_length         (normalized by 10)
//   [26] mean_degree               (normalized by 10)
//   [27] max_degree_ratio          (max_degree / entity_count)
//   [28] clustering_coefficient    (undirected, local avg)
//   [29] tradeoff_ratio            (is_tradeoff edges / |E|)
//   [30-31] zero pad
//
// All values are clamped to [0, 1] so cosine similarity in HNSW
// stays meaningful. The cosine of two structural vectors is the
// shape-match score.

import { embedTexts } from "@/lib/embeddings";
import type { Entity, Edge, Cycle } from "@/types";

export const STRUCTURAL_DIM = 32;
export const SEMANTIC_DIM = 1536;
export const COMBINED_DIM = STRUCTURAL_DIM + SEMANTIC_DIM;

export interface KGSignatureFeatures {
  entity_count: number;
  edge_count: number;
  cycle_count: number;
  leverage_ratio: number;
  risk_ratio: number;
  bottleneck_ratio: number;
  importance_distribution: [number, number, number, number];
  edge_density: number;
  dimension_distribution: [
    number, number, number, number, number, number, number, number, number
  ];
  polarity_distribution: [number, number, number, number];
  reinforcing_cycle_ratio: number;
  balancing_cycle_ratio: number;
  mean_cycle_length: number;
  mean_degree: number;
  max_degree: number;
  clustering_coefficient: number;
  tradeoff_ratio: number;
  has_master_bottleneck: boolean;
}

export interface KGSignature {
  features: KGSignatureFeatures;
  /** Raw 32-dim structural vector, [0, 1]-clamped. */
  structural_vector: number[];
  /** 1536-dim averaged entity embedding. Zero vector if no entities. */
  semantic_centroid: number[];
  /** 1568-dim concat [structural | semantic]. */
  combined_vector: number[];
  summary_text: string;
}

const EDGE_DIMENSIONS: Edge["dimension"][] = [
  "structural",
  "functional",
  "temporal",
  "causal",
  "correlational",
  "logical",
  "epistemic",
  "comparative",
  "agentive",
];

const EDGE_POLARITIES: Edge["polarity"][] = [
  "positive",
  "negative",
  "neutral",
  "conditional",
];

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function safeRatio(num: number, den: number): number {
  if (den <= 0) return 0;
  return clamp01(num / den);
}

// ── Structural feature computation ──
export function extractStructuralFeatures(
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
): KGSignatureFeatures {
  const n = entities.length;
  const e = edges.length;

  // Leverage / risk / bottleneck counts
  let leverage = 0;
  let risk = 0;
  let bottleneck = 0;
  const importance = { fundamental: 0, critical: 0, important: 0, moderate: 0 };
  for (const ent of entities) {
    if (ent.is_leverage_point) leverage += 1;
    if (ent.is_risk_point) risk += 1;
    if (ent.is_master_bottleneck) bottleneck += 1;
    const imp = ent.importance ?? "moderate";
    if (imp === "fundamental") importance.fundamental += 1;
    else if (imp === "critical") importance.critical += 1;
    else if (imp === "important") importance.important += 1;
    else importance.moderate += 1;
  }

  // Edge distributions
  const dimCounts: Record<string, number> = {};
  const polCounts: Record<string, number> = {};
  let tradeoffCount = 0;
  for (const ed of edges) {
    dimCounts[ed.dimension] = (dimCounts[ed.dimension] ?? 0) + 1;
    polCounts[ed.polarity] = (polCounts[ed.polarity] ?? 0) + 1;
    if (ed.is_tradeoff) tradeoffCount += 1;
  }

  // Degree distribution (undirected for clustering/degree calc —
  // analogy is about topology, not direction)
  const adj = new Map<string, Set<string>>();
  for (const ent of entities) adj.set(ent.id, new Set());
  for (const ed of edges) {
    if (ed.source_entity_id === ed.target_entity_id) continue;
    adj.get(ed.source_entity_id)?.add(ed.target_entity_id);
    adj.get(ed.target_entity_id)?.add(ed.source_entity_id);
  }
  let totalDegree = 0;
  let maxDegree = 0;
  for (const neighbors of adj.values()) {
    totalDegree += neighbors.size;
    if (neighbors.size > maxDegree) maxDegree = neighbors.size;
  }
  const meanDegree = n > 0 ? totalDegree / n : 0;

  // Local clustering coefficient, averaged over nodes with degree ≥ 2.
  // C_i = (# of edges among neighbors) / (k_i * (k_i - 1) / 2)
  let clusteringSum = 0;
  let clusteringCount = 0;
  for (const [, neighbors] of adj) {
    const k = neighbors.size;
    if (k < 2) continue;
    const neighborList = Array.from(neighbors);
    let links = 0;
    for (let i = 0; i < neighborList.length; i++) {
      for (let j = i + 1; j < neighborList.length; j++) {
        if (adj.get(neighborList[i])?.has(neighborList[j])) links += 1;
      }
    }
    const possible = (k * (k - 1)) / 2;
    clusteringSum += links / possible;
    clusteringCount += 1;
  }
  const clustering = clusteringCount > 0 ? clusteringSum / clusteringCount : 0;

  // Cycle features
  let reinforcing = 0;
  let balancing = 0;
  let cycleLengthSum = 0;
  for (const c of cycles) {
    const cls = c.classification;
    if (cls === "reinforcing_positive" || cls === "reinforcing_negative") {
      reinforcing += 1;
    } else if (cls === "balancing") {
      balancing += 1;
    }
    cycleLengthSum += (c.entity_ids?.length ?? 0);
  }
  const meanCycleLength = cycles.length > 0 ? cycleLengthSum / cycles.length : 0;

  // Max possible undirected edges = n * (n - 1) / 2
  const maxEdges = n > 1 ? (n * (n - 1)) / 2 : 0;

  const dimensionDistribution: [
    number, number, number, number, number, number, number, number, number
  ] = EDGE_DIMENSIONS.map((d) => safeRatio(dimCounts[d] ?? 0, e)) as [
    number, number, number, number, number, number, number, number, number
  ];

  const polarityDistribution: [number, number, number, number] =
    EDGE_POLARITIES.map((p) => safeRatio(polCounts[p] ?? 0, e)) as [
      number, number, number, number
    ];

  const importance_distribution: [number, number, number, number] = [
    safeRatio(importance.fundamental, n),
    safeRatio(importance.critical, n),
    safeRatio(importance.important, n),
    safeRatio(importance.moderate, n),
  ];

  return {
    entity_count: n,
    edge_count: e,
    cycle_count: cycles.length,
    leverage_ratio: safeRatio(leverage, n),
    risk_ratio: safeRatio(risk, n),
    bottleneck_ratio: safeRatio(bottleneck, n),
    importance_distribution,
    edge_density: safeRatio(e, maxEdges),
    dimension_distribution: dimensionDistribution,
    polarity_distribution: polarityDistribution,
    reinforcing_cycle_ratio: safeRatio(reinforcing, cycles.length),
    balancing_cycle_ratio: safeRatio(balancing, cycles.length),
    mean_cycle_length: clamp01(meanCycleLength / 10),
    mean_degree: clamp01(meanDegree / 10),
    max_degree: n > 0 ? clamp01(maxDegree / n) : 0,
    clustering_coefficient: clamp01(clustering),
    tradeoff_ratio: safeRatio(tradeoffCount, e),
    has_master_bottleneck: bottleneck > 0,
  };
}

// Pack features into the 32-dim vector in the exact order the comment
// at the top of this file lists. Order matters — it must match what
// the retriever and any stored signatures expect.
export function featuresToStructuralVector(f: KGSignatureFeatures): number[] {
  const v: number[] = [
    clamp01(f.entity_count / 50),
    f.leverage_ratio,
    f.risk_ratio,
    f.bottleneck_ratio,
    ...f.importance_distribution,
    f.edge_density,
    ...f.dimension_distribution,
    ...f.polarity_distribution,
    clamp01(f.cycle_count / 10),
    f.reinforcing_cycle_ratio,
    f.balancing_cycle_ratio,
    f.mean_cycle_length,
    f.mean_degree,
    f.max_degree,
    f.clustering_coefficient,
    f.tradeoff_ratio,
  ];
  // Zero-pad to STRUCTURAL_DIM
  while (v.length < STRUCTURAL_DIM) v.push(0);
  return v.slice(0, STRUCTURAL_DIM);
}

function buildSummaryText(
  entities: Entity[],
  f: KGSignatureFeatures,
): string {
  // Pick the top-importance anchor entity names for readability.
  const anchors = [...entities]
    .sort((a, b) => {
      const scoreA =
        (a.is_master_bottleneck ? 3 : 0) +
        (a.is_leverage_point ? 2 : 0) +
        (a.importance === "fundamental" ? 2 : a.importance === "critical" ? 1 : 0);
      const scoreB =
        (b.is_master_bottleneck ? 3 : 0) +
        (b.is_leverage_point ? 2 : 0) +
        (b.importance === "fundamental" ? 2 : b.importance === "critical" ? 1 : 0);
      return scoreB - scoreA;
    })
    .slice(0, 3)
    .map((e) => e.name)
    .join(" → ");

  const shape =
    f.reinforcing_cycle_ratio > 0.5
      ? "reinforcing-cycle"
      : f.balancing_cycle_ratio > 0.5
      ? "balancing-cycle"
      : f.has_master_bottleneck
      ? "bottleneck-constrained"
      : f.cycle_count > 0
      ? "mixed-cycle"
      : "acyclic";

  return `${shape} / ${f.entity_count}n ${f.edge_count}e ${f.cycle_count}c — ${anchors}`.slice(
    0,
    200,
  );
}

// ── Semantic centroid ──
// Average of entity embeddings (name + description). Uses the shared
// text-embedding-3-small (1536-dim) to match every other embedding
// column in the schema.
async function computeSemanticCentroid(entities: Entity[]): Promise<number[]> {
  const zero = new Array<number>(SEMANTIC_DIM).fill(0);
  if (entities.length === 0) return zero;

  const texts = entities.map((e) => {
    const desc = e.description ? ` — ${e.description}` : "";
    return `${e.name}${desc}`.slice(0, 500);
  });

  let vectors: number[][];
  try {
    vectors = await embedTexts(texts);
  } catch (err) {
    console.warn("[signature-extractor] embedTexts failed:", err);
    return zero;
  }
  if (vectors.length === 0) return zero;

  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;

  // Pad or truncate to exactly SEMANTIC_DIM
  if (sum.length === SEMANTIC_DIM) return sum;
  if (sum.length > SEMANTIC_DIM) return sum.slice(0, SEMANTIC_DIM);
  while (sum.length < SEMANTIC_DIM) sum.push(0);
  return sum;
}

// ── Public entrypoint ──
export async function extractKGSignature(
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
): Promise<KGSignature> {
  const features = extractStructuralFeatures(entities, edges, cycles);
  const structural_vector = featuresToStructuralVector(features);
  const semantic_centroid = await computeSemanticCentroid(entities);
  const combined_vector = [...structural_vector, ...semantic_centroid];
  const summary_text = buildSummaryText(entities, features);

  return {
    features,
    structural_vector,
    semantic_centroid,
    combined_vector,
    summary_text,
  };
}
