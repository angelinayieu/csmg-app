/**
 * Entity scoring: abstraction level (tier) + signal strength (noise vs structure)
 *
 * Replaces the brittle `importance`/BFS-depth tier assignment in the layered view.
 * Combines multiple entity properties into two scalar scores:
 *
 * - `abstractionLevel` (0-1): 0 = atomic/concrete, 1 = strategic/conceptual
 *   → mapped to L1-L4 tiers
 *
 * - `signalStrength` (0-1): 0 = noise, 1 = strong signal
 *   → used to fade/shrink noise nodes visually
 *
 * Pure function module — no LLM calls, no side effects.
 */

import type { Entity, Edge } from "@/types";

// ── Types ──

export type Tier = "L1" | "L2" | "L3" | "L4";

export interface EntityScores {
  /** 0-1 continuous score. 0 = atomic, 1 = strategic. */
  abstractionLevel: number;
  /** Discrete tier from abstractionLevel. */
  tier: Tier;
  /** 0-1 continuous. 0 = noise, 1 = strong signal. */
  signalStrength: number;
}

export interface ScoreContext {
  inDegree: number;
  outDegree: number;
  maxInDegree: number;
  maxOutDegree: number;
  /** Median centrality_rank across ranked entities; null if <3 ranked. */
  centralityMedian: number | null;
}

// ── Constants ──

const ENTITY_TYPE_CONCEPTUAL = new Set([
  "THEORY",
  "STRATEGY",
  "FRAMEWORK",
  "PRINCIPLE",
  "CONCEPT",
  "MODEL",
]);

const ENTITY_TYPE_ATOMIC = new Set([
  "RULE",
  "INVARIANT",
  "METRIC",
  "FACT",
  "PROOF",
  "ATOM",
  "DATUM",
  "MEASUREMENT",
]);

const IMPORTANCE_BOOST: Record<string, number> = {
  fundamental: 0.3,
  critical: 0.15,
  important: 0,
  moderate: -0.2,
};

const AUTHORITY_BOOST: Record<string, number> = {
  high: 0.15,
  moderate: 0.05,
  low: -0.1,
  unverified: -0.15,
};

const SOURCE_TAG_BOOST: Record<string, number> = {
  explicit: 0.1,
  implicit: 0,
  assumed: -0.15,
};

// ── Helpers ──

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0.5;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function tierFromAbstractionLevel(level: number): Tier {
  if (level > 0.7) return "L1";
  if (level > 0.45) return "L2";
  if (level > 0.2) return "L3";
  return "L4";
}

// ── Core scoring ──

export function computeEntityScores(entity: Entity, ctx: ScoreContext): EntityScores {
  // ── Abstraction level ──
  let abstraction = 0.35; // neutral anchor (lands in L3)

  const e = entity as Entity & {
    is_decomposable?: boolean;
    has_sub_space?: boolean;
    entity_type?: string | null;
    entity_category?: string;
    importance?: string | null;
  };

  if (e.is_decomposable) abstraction += 0.3;
  if (e.has_sub_space) abstraction += 0.2;

  if (e.importance && IMPORTANCE_BOOST[e.importance] !== undefined) {
    abstraction += IMPORTANCE_BOOST[e.importance];
  }

  const safeMaxOut = Math.max(ctx.maxOutDegree, 1);
  const safeMaxIn = Math.max(ctx.maxInDegree, 1);
  abstraction += 0.2 * (ctx.outDegree / safeMaxOut);
  abstraction += 0.1 * (1 - ctx.inDegree / safeMaxIn);

  const typeUpper = (e.entity_type ?? "").toUpperCase();
  if (ENTITY_TYPE_CONCEPTUAL.has(typeUpper)) abstraction += 0.2;
  else if (ENTITY_TYPE_ATOMIC.has(typeUpper)) abstraction -= 0.25;

  if (e.entity_category === "abstract") abstraction += 0.1;
  else if (e.entity_category === "concrete") abstraction -= 0.1;

  const abstractionLevel = clamp01(abstraction);
  const tier = tierFromAbstractionLevel(abstractionLevel);

  // ── Signal strength ──
  const eSignal = entity as Entity & {
    confidence?: number | null;
    centrality_rank?: number | null;
    authority_level?: string | null;
    source_tag?: string | null;
    is_leverage_point?: boolean;
    is_risk_point?: boolean;
    is_master_bottleneck?: boolean;
  };

  let signal = eSignal.confidence ?? 0.5;

  const maxPossibleDegree = Math.max(ctx.maxInDegree + ctx.maxOutDegree, 1);
  signal += 0.2 * ((ctx.inDegree + ctx.outDegree) / maxPossibleDegree);

  if (
    ctx.centralityMedian !== null &&
    eSignal.centrality_rank != null &&
    eSignal.centrality_rank < ctx.centralityMedian
  ) {
    signal += 0.15;
  }

  if (eSignal.authority_level && AUTHORITY_BOOST[eSignal.authority_level] !== undefined) {
    signal += AUTHORITY_BOOST[eSignal.authority_level];
  }

  if (eSignal.source_tag && SOURCE_TAG_BOOST[eSignal.source_tag] !== undefined) {
    signal += SOURCE_TAG_BOOST[eSignal.source_tag];
  }

  if (eSignal.is_leverage_point || eSignal.is_risk_point || eSignal.is_master_bottleneck) {
    signal += 0.2;
  }

  const signalStrength = clamp01(signal);

  return { abstractionLevel, tier, signalStrength };
}

// ── Map computation with collapse-detection rescaling ──

/**
 * Compute scores for every entity. Handles edge direction from edges array.
 * If the raw abstractionLevel distribution collapses (std-dev < 0.08), applies
 * rank-based rescaling so tiers split roughly 25/25/25/25. This prevents the
 * external-only-space failure mode where every entity looks the same on raw signals.
 */
export function computeEntityScoresMap(
  entities: Entity[],
  edges: Edge[],
  visibleDimensions?: Set<string>,
): Map<string, EntityScores> {
  const result = new Map<string, EntityScores>();
  if (entities.length === 0) return result;

  // Build degree maps (respecting visibleDimensions if provided)
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const ent of entities) {
    inDegree.set(ent.id, 0);
    outDegree.set(ent.id, 0);
  }
  const entityIds = new Set(entities.map((e) => e.id));
  for (const edge of edges) {
    if (visibleDimensions && !visibleDimensions.has(edge.dimension)) continue;
    if (!entityIds.has(edge.source_entity_id) || !entityIds.has(edge.target_entity_id)) continue;
    outDegree.set(edge.source_entity_id, (outDegree.get(edge.source_entity_id) ?? 0) + 1);
    inDegree.set(edge.target_entity_id, (inDegree.get(edge.target_entity_id) ?? 0) + 1);
  }

  let maxIn = 0;
  let maxOut = 0;
  for (const v of inDegree.values()) if (v > maxIn) maxIn = v;
  for (const v of outDegree.values()) if (v > maxOut) maxOut = v;

  // Centrality median from ranked entities
  const ranks: number[] = [];
  for (const ent of entities) {
    const r = (ent as Entity & { centrality_rank?: number | null }).centrality_rank;
    if (r != null) ranks.push(r);
  }
  let centralityMedian: number | null = null;
  if (ranks.length >= 3) {
    ranks.sort((a, b) => a - b);
    centralityMedian = ranks[Math.floor(ranks.length / 2)];
  }

  // First pass: compute raw scores
  const rawScores: Array<{ id: string; scores: EntityScores }> = [];
  for (const ent of entities) {
    const ctx: ScoreContext = {
      inDegree: inDegree.get(ent.id) ?? 0,
      outDegree: outDegree.get(ent.id) ?? 0,
      maxInDegree: maxIn,
      maxOutDegree: maxOut,
      centralityMedian,
    };
    const scores = computeEntityScores(ent, ctx);
    rawScores.push({ id: ent.id, scores });
  }

  // Collapse detection: std-dev of abstractionLevel
  const mean =
    rawScores.reduce((acc, s) => acc + s.scores.abstractionLevel, 0) / rawScores.length;
  const variance =
    rawScores.reduce((acc, s) => acc + (s.scores.abstractionLevel - mean) ** 2, 0) /
    rawScores.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev < 0.08 && rawScores.length >= 4) {
    // Rank-based rescale: sort by raw score, assign uniform [0,1]
    const sorted = [...rawScores].sort(
      (a, b) => a.scores.abstractionLevel - b.scores.abstractionLevel,
    );
    const n = sorted.length;
    for (let i = 0; i < n; i++) {
      const rescaledLevel = n === 1 ? 0.5 : i / (n - 1);
      sorted[i].scores = {
        ...sorted[i].scores,
        abstractionLevel: rescaledLevel,
        tier: tierFromAbstractionLevel(rescaledLevel),
      };
    }
  }

  for (const { id, scores } of rawScores) {
    result.set(id, scores);
  }

  return result;
}
