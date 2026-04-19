// ── Tier classifier ──
//
// Maps an Entity to a visual tier for the whiteboard surface. Tier governs
// everything: background, size, whether body + sparkline render, border
// treatment. The formula blends eight signals already present on entities so
// no new backend work is required.
//
// Rationale for the weights — each signal answers a different question:
//   centrality_rank: how structurally central is this node in the graph?
//   edge_count: how connected is it, independent of rank?
//   importance (LLM-declared): how significant did the LLM judge it?
//   blast_radius: what's the cascade potential if this breaks?
//   manifold.strategic.alignment_to_goal: does it advance the user's goal?
//   leverage/risk/bottleneck flags: explicit strategic relevance?
//   authority_level: how trustworthy is this claim's backing?
//   manifold.toulmin_role: is this a load-bearing argumentative move
//     (claim, warrant, backing) vs ornamental (qualifier, rebuttal)?
//
// We normalize each to [0,1], weight them, and sum. The resulting weight is
// also a useful sort key — larger weight = more prominent on the canvas.

import type { Entity, Edge } from "@/types";

export type WhiteboardTier = "hero" | "key" | "support" | "peripheral";

export interface TierClassification {
  tier: WhiteboardTier;
  weight: number;      // 0..100 (scaled for display)
  normalized: number;  // 0..1 (internal)
  signals: {
    centrality: number;
    connectivity: number;
    importance: number;
    blastRadius: number;
    goalAlignment: number;
    strategicFlags: number;
    authority: number;
    toulmin: number;
  };
}

// ── Thresholds ──
// Tuned so typical graphs produce roughly:
//   5-10% hero, 15-20% key, 30-40% support, 30-40% peripheral
// This keeps the canvas from being a sea of heroes.
const TIER_THRESHOLDS = {
  hero: 0.82,
  key: 0.68,
  support: 0.50,
  // below support → peripheral
};

// Weights sum to 1.0. When extending, rescale the existing six proportionally
// so the tier thresholds stay calibrated.
const WEIGHTS = {
  centrality: 0.24,
  connectivity: 0.18,
  importance: 0.16,
  blastRadius: 0.10,
  goalAlignment: 0.10,
  strategicFlags: 0.08,
  authority: 0.08,
  toulmin: 0.06,
} as const;

// ── Helpers ──

function importanceToScore(importance: string | null | undefined): number {
  switch (importance) {
    case "fundamental":
      return 1.0;
    case "critical":
      return 0.8;
    case "important":
      return 0.55;
    case "moderate":
      return 0.3;
    default:
      return 0.3;
  }
}

function alignmentToScore(align: string | null | undefined): number {
  switch (align) {
    case "high":
      return 1.0;
    case "moderate":
      return 0.6;
    case "low":
      return 0.3;
    default:
      return 0.5;
  }
}

// Authority backing: how trustworthy is the evidence behind this node?
// "unverified" is penalized because an unverified leverage-point claim is
// actually less useful than a moderate-authority well-sourced fact.
function authorityToScore(level: string | null | undefined): number {
  switch (level) {
    case "high":
      return 1.0;
    case "moderate":
      return 0.6;
    case "low":
      return 0.3;
    case "unverified":
      return 0.15;
    default:
      return 0.5; // null = unknown, stay neutral rather than penalize
  }
}

// Toulmin role: which argumentative slot does this entity occupy?
// Claims and warrants are structurally load-bearing (remove them and the
// argument collapses). Grounds and backing support them. Qualifiers and
// rebuttals scope/constrain — useful but not load-bearing.
function toulminToScore(role: string | null | undefined): number {
  switch (role) {
    case "claim":
      return 1.0;
    case "warrant":
      return 0.9;
    case "backing":
      return 0.7;
    case "ground":
      return 0.6;
    case "qualifier":
      return 0.4;
    case "rebuttal":
      return 0.4;
    default:
      return 0.5; // absent → neutral, no penalty
  }
}

// Centrality is stored as an integer rank (1 = most central). We normalize
// inversely: rank 1 → 1.0, rank N → small value, null → 0.5 (unknown, middle).
function normalizeCentrality(rank: number | null | undefined, totalEntities: number): number {
  if (rank == null || totalEntities <= 1) return 0.5;
  const bounded = Math.max(1, Math.min(rank, totalEntities));
  return 1 - (bounded - 1) / totalEntities;
}

function normalizeConnectivity(edgeCount: number, maxEdges: number): number {
  if (maxEdges <= 0) return 0;
  // Log-scaled so a couple of extra edges matter a lot at the low end but
  // saturate at the high end (a node with 40 edges isn't 4x more visually
  // important than one with 10).
  return Math.min(1, Math.log(edgeCount + 1) / Math.log(maxEdges + 1));
}

// ── Public entry point ──

export interface ClassifyOptions {
  /** Total entity count in the graph (for centrality normalization) */
  totalEntities: number;
  /** Max edge degree observed in the graph (for connectivity normalization) */
  maxEdgeDegree: number;
}

export function classifyTier(entity: Entity, edgeDegree: number, opts: ClassifyOptions): TierClassification {
  // Signal extraction
  const centrality = normalizeCentrality(entity.centrality_rank, opts.totalEntities);
  const connectivity = normalizeConnectivity(edgeDegree, opts.maxEdgeDegree);
  const importance = importanceToScore(entity.importance);
  const blastRadius = Math.max(0, Math.min(1, (entity.blast_radius ?? 0) / 100));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manifold = (entity as any).manifold as Record<string, unknown> | null;
  const strategic = manifold && typeof manifold === "object" ? (manifold.strategic as Record<string, unknown> | undefined) : undefined;
  const goalAlignment = alignmentToScore(strategic?.alignment_to_goal as string | undefined);

  // Strategic flag contribution — explicit markings bump the node up:
  //   leverage point: +1.0
  //   master bottleneck: +1.0
  //   risk point: +0.8 (risks are important to see but slightly less "positive")
  let flagScore = 0;
  if (entity.is_leverage_point) flagScore = Math.max(flagScore, 1.0);
  if (entity.is_master_bottleneck) flagScore = Math.max(flagScore, 1.0);
  if (entity.is_risk_point) flagScore = Math.max(flagScore, 0.8);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isFault = (entity.entity_category as string) === "fault";
  if (isFault) flagScore = Math.max(flagScore, 0.9); // faults are structurally important

  // Authority backing (column) — trustworthy evidence boosts prominence.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authority = authorityToScore((entity as any).authority_level as string | undefined);

  // Toulmin role (manifold.toulmin_role) — argumentative load-bearing role.
  const toulmin = toulminToScore(manifold && typeof manifold === "object"
    ? (manifold.toulmin_role as string | undefined)
    : undefined);

  // Weighted sum
  const normalized =
    centrality * WEIGHTS.centrality +
    connectivity * WEIGHTS.connectivity +
    importance * WEIGHTS.importance +
    blastRadius * WEIGHTS.blastRadius +
    goalAlignment * WEIGHTS.goalAlignment +
    flagScore * WEIGHTS.strategicFlags +
    authority * WEIGHTS.authority +
    toulmin * WEIGHTS.toulmin;

  // Tier assignment
  let tier: WhiteboardTier;
  if (normalized >= TIER_THRESHOLDS.hero) tier = "hero";
  else if (normalized >= TIER_THRESHOLDS.key) tier = "key";
  else if (normalized >= TIER_THRESHOLDS.support) tier = "support";
  else tier = "peripheral";

  return {
    tier,
    weight: Math.round(normalized * 100),
    normalized,
    signals: {
      centrality,
      connectivity,
      importance,
      blastRadius,
      goalAlignment,
      strategicFlags: flagScore,
      authority,
      toulmin,
    },
  };
}

/**
 * Batch classify all entities in one pass. Computes edge degree per entity
 * and the max degree once, then classifies each entity with shared normalizers.
 */
export function classifyAll(
  entities: Entity[],
  edges: Edge[],
): Map<string, TierClassification> {
  const degree = new Map<string, number>();
  for (const e of entities) degree.set(e.id, 0);
  for (const edge of edges) {
    degree.set(edge.source_entity_id, (degree.get(edge.source_entity_id) ?? 0) + 1);
    degree.set(edge.target_entity_id, (degree.get(edge.target_entity_id) ?? 0) + 1);
  }
  const maxDegree = Math.max(1, ...Array.from(degree.values()));

  const result = new Map<string, TierClassification>();
  for (const entity of entities) {
    const d = degree.get(entity.id) ?? 0;
    result.set(entity.id, classifyTier(entity, d, { totalEntities: entities.length, maxEdgeDegree: maxDegree }));
  }
  return result;
}

/**
 * Detect convergence nodes — entities with ≥3 incoming edges from distinct
 * sources. These get special visual treatment (pulsing ring) because they
 * represent where multiple decomposition paths meet.
 */
export function detectConvergenceNodes(edges: Edge[]): Set<string> {
  const inCounts = new Map<string, Set<string>>();
  for (const e of edges) {
    const set = inCounts.get(e.target_entity_id) ?? new Set();
    set.add(e.source_entity_id);
    inCounts.set(e.target_entity_id, set);
  }
  const convergence = new Set<string>();
  for (const [target, sources] of inCounts) {
    if (sources.size >= 3) convergence.add(target);
  }
  return convergence;
}
