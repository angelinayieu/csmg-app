// ── Interaction discovery (D4 — docs/KG_DEPTH_CRITIQUE.md §9) ────────
//
// Detects multi-way interaction effects between entities — the
// strategically-critical class of relationships where joint(A, B, C) ≠
// linear sum of marginal effects. These are the "A and B together
// produce X but neither alone does" cases the strategizer is currently
// blind to (§7.2 of the critique: edges are strictly dyadic, no
// hyperedge primitive).
//
// Pattern: standard 2³ factorial ANOVA decomposition, executed via
// 7 Monte Carlo runs per candidate triple with the SAME seed (so
// Gaussian draws cancel and the difference between cells is pure
// signal, not sampling noise). The 3-way interaction term is:
//
//   Δ_ABC = E(ABC) - E(AB) - E(AC) - E(BC) + E(A) + E(B) + E(C)
//
// where E(...) is the target entity's p50 deviation under the labeled
// perturbation set. With baseline E(∅) = 0 (no perturbation, 0
// deviation by construction), positive |Δ_ABC| / |E(ABC)| means
// emergent effect.
//
// Activates the dormant `reactions` table (`reaction_type='emergent'`)
// with `entity_ids = [A, B, C]`, `mechanism = brief description`, and
// `probability` from the |Δ_ABC| score. Strategizer's new
// `interaction_density` signal counts these per candidate.
//
// Cost-bounded by aggressive pre-filtering (see CANDIDATE_BOUNDS):
// without bounds the search is O(n³); with bounds it's O(K) where K
// is small (typically ≤ 12 triples per detection run).

import type { SupabaseClient } from "@supabase/supabase-js";
import { simulateEntityChain } from "@/lib/simulation/simulate-entity-chain";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

// ── Tunables ────────────────────────────────────────────────────────

/**
 * Cost guards. Max numbers chosen so a typical space (15–50 entities)
 * runs in under 60s of `after()` budget.
 *
 * MC budget per detection: ≈ MAX_TRIPLES × 7 × MC_ITERATIONS × MC_TIMESTEPS
 * = 12 × 7 × 300 × 6 = 151,200 propagation steps. At ~10μs per step on
 * server hardware, ≈ 1.5s of pure compute + N edge fetches. Vercel-safe.
 */
const CANDIDATE_BOUNDS = {
  /** Max downstream targets to scan. Picks top-K by importance. */
  MAX_TARGETS: 3,
  /** Max upstream entities to consider per target. Top-K by centrality
   *  + leverage flag. With 5, C(5,3) = 10 triples per target. */
  MAX_UPSTREAM_PER_TARGET: 5,
  /** Hard cap on triples evaluated regardless of target/upstream counts. */
  MAX_TRIPLES: 12,
  /** BFS depth for "upstream of target" lookup. Must match
   *  simulate-entity-chain's depthHops to keep the subgraph the
   *  per-MC simulator sees consistent with the candidate selection. */
  UPSTREAM_BFS_DEPTH: 3,
};

const MC_ITERATIONS_FOR_DETECTION = 300;
const MC_TIMESTEPS_FOR_DETECTION = 6;
/** Magnitude applied to perturbed entities. Larger magnitude → bigger
 *  signal but easier to saturate threshold dynamics; 0.5 is the
 *  pre-existing convention from simulate-variant-lift.ts. */
const PERTURBATION_MAGNITUDE = 0.5;

/**
 * |Δ_ABC| / max(|E(ABC)|, ε) above this threshold = "interaction
 * detected." Empirically 0.2 catches genuine emergence while
 * filtering noise from the 2³ factorial bookkeeping. Tunable.
 */
const INTERACTION_EMERGENCE_THRESHOLD = 0.2;

/** Floor on |E(ABC)| to avoid divide-by-zero amplification when the
 *  joint effect is tiny. Below this floor, we don't claim an
 *  interaction even if the relative score is high — the absolute
 *  effect is too small to act on. */
const MIN_JOINT_EFFECT_MAGNITUDE = 0.05;

/** Fixed seed for reproducibility within a detection run. Same seed
 *  across all 7 MCs is THE essential thing — that's what makes the
 *  cell differences signal-pure. */
const DETECTION_SEED = 1729;

// ── I/O shapes ──────────────────────────────────────────────────────

export interface InteractionEntityRow {
  id: string;
  entity_id: string;
  name: string;
  importance?: string | null;
  is_leverage_point?: boolean | null;
  centrality_rank?: number | null;
}

export interface InteractionEdgeRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
}

export interface DetectInteractionsInput {
  spaceId: string;
  entities: ReadonlyArray<InteractionEntityRow>;
  edges: ReadonlyArray<InteractionEdgeRow>;
  /** Optional explicit downstream targets (e.g. improvement_goals,
   *  target_outcome). When omitted, we pick high-importance entities
   *  that have multiple incoming edges. */
  preferred_target_ids?: string[];
}

export interface InteractionEffect {
  /** The downstream target the interaction was measured AGAINST. */
  target_entity_id: string;
  target_entity_name: string;
  /** The 3 upstream entities forming the interaction (sorted by id
   *  for canonical ordering). */
  triple_entity_ids: [string, string, string];
  triple_entity_names: [string, string, string];
  /** ANOVA cell values — target's p50 deviation under each perturbation set. */
  cells: {
    abc: number;
    a: number;
    b: number;
    c: number;
    ab: number;
    ac: number;
    bc: number;
  };
  /** Δ_ABC = abc - (ab + ac + bc) + (a + b + c). Zero when purely additive. */
  three_way_term: number;
  /** Normalized: |Δ_ABC| / max(|abc|, ε). Higher = stronger emergence. */
  emergence_score: number;
  /** Sign of the effect. positive: synergy. negative: antagonism. */
  polarity: "positive" | "negative";
  /** Probability for the persisted reactions row. Mapped from
   *  emergence_score: 0.5 at threshold, 0.95 saturating. */
  probability: number;
}

export interface DetectInteractionsResult {
  effects: InteractionEffect[];
  stats: {
    candidate_targets: number;
    candidate_triples_evaluated: number;
    interactions_detected: number;
    mc_calls: number;
    duration_ms: number;
  };
}

// ── Public entry ────────────────────────────────────────────────────

export async function detectInteractions(
  db: AnyDb,
  input: DetectInteractionsInput,
): Promise<DetectInteractionsResult> {
  const t0 = Date.now();

  const stats = {
    candidate_targets: 0,
    candidate_triples_evaluated: 0,
    interactions_detected: 0,
    mc_calls: 0,
    duration_ms: 0,
  };
  const effects: InteractionEffect[] = [];

  // 1. Pick candidate downstream targets.
  const targets = pickTargets(input);
  stats.candidate_targets = targets.length;
  if (targets.length === 0) {
    stats.duration_ms = Date.now() - t0;
    return { effects, stats };
  }

  // 2. For each target, find upstream candidates + form triples.
  const allTriples: Array<{
    target: InteractionEntityRow;
    triple: [InteractionEntityRow, InteractionEntityRow, InteractionEntityRow];
  }> = [];

  // Reverse adjacency for BFS upstream
  const reverseAdj = buildReverseAdjacency(input.edges);
  const entityById = new Map(input.entities.map((e) => [e.id, e]));

  for (const target of targets) {
    const upstream = bfsUpstream(
      target.id,
      reverseAdj,
      entityById,
      CANDIDATE_BOUNDS.UPSTREAM_BFS_DEPTH,
    );
    // Score upstream candidates by centrality + leverage
    const ranked = upstream
      .map((e) => ({
        entity: e,
        score:
          (e.is_leverage_point ? 2 : 0) +
          (typeof e.centrality_rank === "number" && e.centrality_rank > 0
            ? 1 / e.centrality_rank
            : 0) +
          importanceWeight(e.importance ?? null),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, CANDIDATE_BOUNDS.MAX_UPSTREAM_PER_TARGET);

    const candidates = ranked.map((r) => r.entity);
    // Generate triples
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        for (let k = j + 1; k < candidates.length; k++) {
          if (allTriples.length >= CANDIDATE_BOUNDS.MAX_TRIPLES) break;
          allTriples.push({
            target,
            triple: [candidates[i], candidates[j], candidates[k]],
          });
        }
      }
    }
  }

  // 3. Evaluate each triple via 7-cell MC.
  for (const { target, triple } of allTriples) {
    if (effects.length >= CANDIDATE_BOUNDS.MAX_TRIPLES) break;
    stats.candidate_triples_evaluated += 1;

    let cells: InteractionEffect["cells"];
    try {
      cells = await measureCells({
        db,
        spaceId: input.spaceId,
        targetEntityId: target.id,
        triple,
        statsRef: stats,
      });
    } catch (err) {
      console.warn(
        `[interaction-discovery] triple ${triple.map((t) => t.entity_id).join("·")} → ${target.entity_id} failed (non-fatal):`,
        err,
      );
      continue;
    }

    const abc = cells.abc;
    const threeWay =
      abc - (cells.ab + cells.ac + cells.bc) + (cells.a + cells.b + cells.c);

    if (Math.abs(abc) < MIN_JOINT_EFFECT_MAGNITUDE) continue;
    const emergence = Math.abs(threeWay) / Math.max(Math.abs(abc), 1e-6);
    if (emergence < INTERACTION_EMERGENCE_THRESHOLD) continue;

    // Map emergence → probability for the reactions row. Saturating
    // sigmoid: 0.5 at threshold, ~0.95 at 1.0+.
    const probability = clamp01(0.5 + (emergence - INTERACTION_EMERGENCE_THRESHOLD) * 0.7);

    const sortedTriple = [triple[0].id, triple[1].id, triple[2].id].sort() as [
      string,
      string,
      string,
    ];
    const sortedNames = sortedTriple.map(
      (id) => triple.find((t) => t.id === id)?.name ?? "",
    ) as [string, string, string];

    effects.push({
      target_entity_id: target.id,
      target_entity_name: target.name,
      triple_entity_ids: sortedTriple,
      triple_entity_names: sortedNames,
      cells,
      three_way_term: threeWay,
      emergence_score: emergence,
      polarity: threeWay >= 0 ? "positive" : "negative",
      probability,
    });
    stats.interactions_detected += 1;
  }

  stats.duration_ms = Date.now() - t0;
  return { effects, stats };
}

// ── Internals ───────────────────────────────────────────────────────

async function measureCells(input: {
  db: AnyDb;
  spaceId: string;
  targetEntityId: string;
  triple: [InteractionEntityRow, InteractionEntityRow, InteractionEntityRow];
  statsRef: DetectInteractionsResult["stats"];
}): Promise<InteractionEffect["cells"]> {
  const { db, spaceId, targetEntityId, triple, statsRef } = input;
  const [A, B, C] = triple;

  const runCell = async (
    perturbedIds: ReadonlyArray<string>,
  ): Promise<number> => {
    const perturbations = new Map<
      string,
      { priorMean?: number; priorStdDev?: number }
    >();
    for (const id of perturbedIds) {
      perturbations.set(id, { priorMean: PERTURBATION_MAGNITUDE });
    }
    const result = await simulateEntityChain(db, {
      spaceId,
      targetEntityId,
      depthHops: CANDIDATE_BOUNDS.UPSTREAM_BFS_DEPTH,
      iterations: MC_ITERATIONS_FOR_DETECTION,
      timesteps: MC_TIMESTEPS_FOR_DETECTION,
      seed: DETECTION_SEED,
      perturbations,
    });
    statsRef.mc_calls += 1;
    if (result.error || !result.targetDistribution) return 0;
    return result.targetDistribution.p50;
  };

  // 7 perturbation sets. We don't run the empty set (E(∅) = 0 by
  // construction with priorMean=0 baseline + same seed). This saves
  // 1/8 of the MC budget per triple for free.
  const [a, b, c, ab, ac, bc, abc] = await Promise.all([
    runCell([A.id]),
    runCell([B.id]),
    runCell([C.id]),
    runCell([A.id, B.id]),
    runCell([A.id, C.id]),
    runCell([B.id, C.id]),
    runCell([A.id, B.id, C.id]),
  ]);

  return { a, b, c, ab, ac, bc, abc };
}

// ── Candidate selection helpers ─────────────────────────────────────

function pickTargets(
  input: DetectInteractionsInput,
): InteractionEntityRow[] {
  // Prefer explicit targets (improvement_goals, target_outcome).
  if (input.preferred_target_ids && input.preferred_target_ids.length > 0) {
    const set = new Set(input.preferred_target_ids);
    return input.entities
      .filter((e) => set.has(e.id))
      .slice(0, CANDIDATE_BOUNDS.MAX_TARGETS);
  }

  // Fallback: pick high-importance entities with multiple incoming edges.
  // Indegree bookkeeping
  const indegree = new Map<string, number>();
  for (const e of input.edges) {
    indegree.set(
      e.target_entity_id,
      (indegree.get(e.target_entity_id) ?? 0) + 1,
    );
  }
  return [...input.entities]
    .filter((e) => (indegree.get(e.id) ?? 0) >= 2)
    .sort((a, b) => {
      const ia = importanceWeight(a.importance ?? null);
      const ib = importanceWeight(b.importance ?? null);
      if (ib !== ia) return ib - ia;
      return (indegree.get(b.id) ?? 0) - (indegree.get(a.id) ?? 0);
    })
    .slice(0, CANDIDATE_BOUNDS.MAX_TARGETS);
}

function buildReverseAdjacency(
  edges: ReadonlyArray<InteractionEdgeRow>,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    let bucket = adj.get(e.target_entity_id);
    if (!bucket) {
      bucket = new Set();
      adj.set(e.target_entity_id, bucket);
    }
    bucket.add(e.source_entity_id);
  }
  return adj;
}

function bfsUpstream(
  startId: string,
  reverseAdj: Map<string, Set<string>>,
  entityById: Map<string, InteractionEntityRow>,
  maxDepth: number,
): InteractionEntityRow[] {
  const visited = new Set<string>([startId]);
  let frontier = new Set<string>([startId]);
  let depth = 0;
  while (depth < maxDepth && frontier.size > 0) {
    const next = new Set<string>();
    for (const node of frontier) {
      const upstream = reverseAdj.get(node);
      if (!upstream) continue;
      for (const u of upstream) {
        if (!visited.has(u)) {
          visited.add(u);
          next.add(u);
        }
      }
    }
    frontier = next;
    depth += 1;
  }
  visited.delete(startId); // exclude target itself
  const out: InteractionEntityRow[] = [];
  for (const id of visited) {
    const e = entityById.get(id);
    if (e) out.push(e);
  }
  return out;
}

function importanceWeight(importance: string | null): number {
  switch (importance) {
    case "fundamental":
      return 4;
    case "critical":
      return 3;
    case "important":
      return 2;
    case "moderate":
      return 1;
    default:
      return 0;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
