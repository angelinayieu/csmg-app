// ── Bootstrap simulation engine (Gap B, third rung) ─────────────────────
//
// Epistemic position in the taxonomy:
//
//   narrative_walk  < monte_carlo  < bootstrap  < deterministic_replay
//       |                 |              |              |
//     LLM guess      parametric     resampled       sandboxed
//                    Gaussian       from actual     artifact exec
//                    around stated  history
//                    values
//
// Bootstrap's distinguishing claim: the uncertainty envelope comes from
// the target metric's OWN historical observations, not from a fabricated
// σ on stated edge strengths. If the target has moved ±X% historically,
// that empirical volatility shows up in the distribution.
//
// What this engine does NOT do (yet):
//   - Paired-history sampling across downstream trackers. True bootstrap
//     over the whole graph would resample joint (target_delta,
//     downstream_delta) tuples from co-observed periods. That requires
//     a reliable entity↔tracker map per downstream node, which most
//     KGs don't have. We leave a hook for it (`pairedObservations`) and
//     fall back to Monte-Carlo propagation on the resampled seed.
//   - Residual modeling around a fit. Straight empirical resampling.
//
// Shape: mirrors `monte-carlo.ts` so the UI and route plumbing can
// treat the two interchangeably apart from the mode stamp + a few
// extra fields.

import type { Entity, Edge } from "@/types";
import { computeDownstreamSet, type CycleInfo } from "@/lib/pipeline/monte-carlo";

/** Kept in lockstep with monte-carlo.ts. If the taxonomy ever pulls
 *  these values apart, do it deliberately in both places — users
 *  comparing modes on the same subgraph shouldn't see cycle amplification
 *  diverge between MC and bootstrap. */
const CYCLE_DEFAULT_MULTIPLIER: Record<
  CycleInfo["classification"],
  number
> = {
  reinforcing_positive: 1.4,
  reinforcing_negative: 1.4,
  balancing: 0.6,
};

// ── Knobs ──────────────────────────────────────────────────────────────

export const DEFAULT_ITERATIONS = 500;

/** Minimum historical observations required to bootstrap. Below this
 *  the resample is effectively just jittering a tiny sample — the
 *  distribution isn't grounded enough to earn the `bootstrap` label. */
const MIN_HISTORICAL_OBSERVATIONS = 6;

/** Monte-Carlo-equivalent propagation knobs. Kept local rather than
 *  imported so future tuning of bootstrap and MC can diverge if their
 *  epistemic stances require different decay behavior. */
const SIGMA_STRENGTH_STATED = 0.1; // tighter than MC — bootstrap leans on historical volatility, not edge noise
const SIGMA_STRENGTH_FALLBACK = 0.2;
const FALLBACK_STRENGTH = 0.4;
const HOP_DECAY = 0.75;
const MAX_HOPS = 3;

// ── Public shapes ──────────────────────────────────────────────────────

export interface BootstrapInput {
  targetEntityId: string;
  direction: "strengthen" | "weaken" | "remove";
  /** User-chosen magnitude 0.1..1.0. Acts as the *center* of the
   *  bootstrap seed distribution — each iteration's seed is
   *  magnitude × (sampled historical delta / median historical delta),
   *  so the empirical volatility of the target modulates the seed
   *  around the user's chosen magnitude. */
  magnitude: number;
  entities: Entity[];
  edges: Edge[];
  /** Period-to-period deltas for the TARGET entity's linked tracker.
   *  Caller is responsible for the tracker match; see
   *  `matchTargetTracker` in the route. */
  targetHistoricalDeltas: number[];
  /** Reserved for future paired-history bootstrap. Today we accept it
   *  for shape-forward-compat but don't use it — see engine comment. */
  pairedObservations?: Map<string, number[]>;
  /** Same cycle-amplification hook as monte-carlo — when supplied, the
   *  propagation engine multiplies affected-entity deltas by the
   *  per-cycle multiplier so reinforcing loops aren't silently erased
   *  by HOP_DECAY. See monte-carlo.ts CycleInfo doc for rationale. */
  cycles?: CycleInfo[];
  iterations?: number;
}

export interface BootstrapAffectedEntityStats {
  entity_id: string;
  mean_delta: number;
  p10: number;
  p50: number;
  p90: number;
  sign_stability: number;
  /** See monte-carlo.ts AffectedEntityStats.cycle_role for semantics.
   *  Kept in lockstep with MC so UI treats the two engines' rows
   *  uniformly on cycle amplification. */
  cycle_role: "reinforcing" | "balancing" | null;
}

export interface BootstrapResult {
  simulation_mode: "bootstrap";
  iterations: number;
  /** N of historical observations the target's distribution was drawn
   *  from. Surfaced in the UI footer — "bootstrap over 24 weekly
   *  observations" reads very differently from "… over 6". */
  historical_n: number;
  /** Median of |historical deltas| — shown in the provenance footer so
   *  the user can sanity-check: "a typical move for this metric is
   *  0.12, and the bootstrap centered your 0.50 magnitude around
   *  that historical scale." */
  historical_median_abs_delta: number;
  aggregate_distribution: {
    p10: number;
    p50: number;
    p90: number;
    mean: number;
    stddev: number;
  };
  affected_entities: BootstrapAffectedEntityStats[];
  convergence_note: string;
  /** Fraction of edges in the propagation that had a numeric strength
   *  (vs fallback). Not strictly a bootstrap concept but lets the UI
   *  reuse the same provenance footer as Monte-Carlo for honesty. */
  numeric_edge_coverage: number;
}

export interface CanRunBootstrapResult {
  ok: boolean;
  reason?: string;
  historical_n: number;
  downstream_reachable_count: number;
}

// ── Gate ───────────────────────────────────────────────────────────────

export function canRunBootstrap(
  targetEntityId: string,
  entities: Entity[],
  edges: Edge[],
  targetHistoricalDeltas: number[],
): CanRunBootstrapResult {
  // Downstream reachability mirrors the MC gate — same BFS, same hop cap.
  const downstream = new Set<string>();
  let frontier = new Set<string>([targetEntityId]);
  for (let h = 0; h < MAX_HOPS; h++) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (
        frontier.has(edge.source_entity_id) &&
        !downstream.has(edge.target_entity_id) &&
        edge.target_entity_id !== targetEntityId
      ) {
        next.add(edge.target_entity_id);
      }
    }
    if (next.size === 0) break;
    for (const id of next) downstream.add(id);
    frontier = next;
  }

  if (!entities.some((e) => e.id === targetEntityId)) {
    return {
      ok: false,
      reason: "Target entity not in subgraph.",
      historical_n: targetHistoricalDeltas.length,
      downstream_reachable_count: downstream.size,
    };
  }

  if (targetHistoricalDeltas.length < MIN_HISTORICAL_OBSERVATIONS) {
    return {
      ok: false,
      reason: `Bootstrap needs ≥ ${MIN_HISTORICAL_OBSERVATIONS} historical observations for the target metric — found ${targetHistoricalDeltas.length}. Without enough history, resampling collapses to near-monte-carlo; log more observations or use narrative/monte-carlo instead.`,
      historical_n: targetHistoricalDeltas.length,
      downstream_reachable_count: downstream.size,
    };
  }

  if (downstream.size === 0) {
    return {
      ok: false,
      reason:
        "No downstream entities reachable from the target — nothing to propagate the resampled seed through.",
      historical_n: targetHistoricalDeltas.length,
      downstream_reachable_count: 0,
    };
  }

  return {
    ok: true,
    historical_n: targetHistoricalDeltas.length,
    downstream_reachable_count: downstream.size,
  };
}

// ── Engine ─────────────────────────────────────────────────────────────

export function runBootstrap(input: BootstrapInput): BootstrapResult {
  const {
    targetEntityId,
    direction,
    magnitude,
    entities: _entities,
    edges,
    targetHistoricalDeltas,
  } = input;
  void _entities; // reserved for future entity-level gating inside the engine
  const iterations = input.iterations ?? DEFAULT_ITERATIONS;
  const cycles = input.cycles ?? [];

  // Cycle multiplier map — identical shape + semantics to monte-carlo's.
  // Keeping the two in lockstep so MC and bootstrap agree on cycle
  // amplification; the only thing that should differ between them is
  // the seed-sampling distribution, not the propagation geometry.
  const cycleMultipliers = new Map<string, number[]>();
  const cycleRoles = new Map<string, "reinforcing" | "balancing">();
  for (const c of cycles) {
    const m =
      typeof c.estimated_multiplier === "number" &&
      Number.isFinite(c.estimated_multiplier) &&
      c.estimated_multiplier > 0
        ? c.estimated_multiplier
        : CYCLE_DEFAULT_MULTIPLIER[c.classification];
    const role =
      c.classification === "balancing" ? "balancing" : "reinforcing";
    for (const eid of c.entity_ids) {
      if (eid === targetEntityId) continue;
      const arr = cycleMultipliers.get(eid) ?? [];
      arr.push(m);
      cycleMultipliers.set(eid, arr);
      const existing = cycleRoles.get(eid);
      if (existing !== "reinforcing") cycleRoles.set(eid, role);
    }
  }

  // ── Pre-compute historical scale ──────────────────────────────────
  // We use the median of |historical deltas| as the reference "typical
  // move" for this target. Each iteration then samples a historical
  // delta d_i and scales the user's requested magnitude by
  // |d_i| / median. This gives an empirical volatility envelope around
  // the user's chosen center — small historical moves shrink the seed,
  // large ones enlarge it, and the median case equals the requested
  // magnitude exactly.
  const absDeltas = targetHistoricalDeltas
    .map((d) => Math.abs(d))
    .sort((a, b) => a - b);
  const medianAbs =
    absDeltas[Math.floor(absDeltas.length / 2)] || 1e-6; // avoid divide-by-zero on all-zero history

  // ── Theoretical-max anchor (see monte-carlo.ts for rationale) ─────
  // Bootstrap's seed varies per iteration because of historical
  // scaling, but we anchor the reported percentage to the user's
  // *chosen* magnitude so the UI's p-values stay comparable with the
  // Monte-Carlo tab on the same target. A per-iteration-varying anchor
  // would conflate two sources of variance (what the user asked for,
  // vs what history volatility scaled it to) in the headline number.
  const downstreamIds = computeDownstreamSet(targetEntityId, edges, MAX_HOPS);
  const downstreamCount = downstreamIds.size;
  const theoreticalMax = magnitude * Math.max(1, downstreamCount);

  // Direction sign — same convention as MC.
  const directionSign = direction === "strengthen" ? 1 : -1;

  // Edges-by-source index for BFS.
  const edgesBySource = new Map<string, Edge[]>();
  for (const e of edges) {
    const arr = edgesBySource.get(e.source_entity_id) ?? [];
    arr.push(e);
    edgesBySource.set(e.source_entity_id, arr);
  }

  const numericEdgeCount = edges.filter(
    (e) => typeof e.strength === "number" && Number.isFinite(e.strength),
  ).length;
  const numericEdgeCoverage =
    edges.length > 0 ? numericEdgeCount / edges.length : 0;

  const iterationDeltas: Array<Map<string, number>> = [];
  const aggregateScalars: number[] = [];

  // Propagation uses the same work-queue model as monte-carlo.ts: per-
  // iteration edge param caching, delta-increment propagation with
  // requeue on change, and cycle amplification applied at the point of
  // contribution so amplification flows downstream. See monte-carlo.ts
  // for the full rationale. Keeping the two engines structurally
  // identical means mode-to-mode differences on the same target come
  // from the seed-sampling distribution (the taxonomy's actual claim),
  // not from subtle propagation-math drift.
  const DELTA_CHANGE_EPSILON = 1e-4;
  const MAX_PROPAGATIONS_PER_NODE = MAX_HOPS + 2;

  interface EdgeParams {
    effStrength: number;
    effPolarity: number;
  }

  for (let i = 0; i < iterations; i++) {
    // ── Bootstrap step: sample one historical delta with replacement ──
    const sampleIdx = Math.floor(Math.random() * targetHistoricalDeltas.length);
    const sampledHistDelta = targetHistoricalDeltas[sampleIdx];
    const scale = Math.max(
      0.1,
      Math.min(3.0, Math.abs(sampledHistDelta) / medianAbs),
    );
    const seedDelta = directionSign * magnitude * scale;

    // Pre-sample edge params for this iteration.
    const edgeParams = new Map<string, EdgeParams>();
    for (const edge of edges) {
      const hasStrength =
        typeof edge.strength === "number" &&
        Number.isFinite(edge.strength);
      const baseStrength = hasStrength
        ? (edge.strength as number)
        : FALLBACK_STRENGTH;
      const sigma = hasStrength
        ? SIGMA_STRENGTH_STATED
        : SIGMA_STRENGTH_FALLBACK;
      const effStrength = clamp01(baseStrength + gaussian() * sigma);

      let polaritySign: number;
      if (edge.polarity === "negative") polaritySign = -1;
      else if (edge.polarity === "positive") polaritySign = 1;
      else if (edge.polarity === "conditional")
        polaritySign = Math.random() < 0.5 ? -1 : 1;
      else polaritySign = 0;
      const confidence =
        typeof edge.confidence === "number" &&
        Number.isFinite(edge.confidence)
          ? Math.max(0, Math.min(1, edge.confidence))
          : 0.7;
      const polarityFlipped = Math.random() > confidence ? -1 : 1;
      edgeParams.set(edge.id, {
        effStrength,
        effPolarity: polaritySign * polarityFlipped,
      });
    }

    const deltas = new Map<string, number>([[targetEntityId, seedDelta]]);
    const lastPropagated = new Map<string, number>([[targetEntityId, 0]]);
    const minHops = new Map<string, number>([[targetEntityId, 0]]);
    const propagationCount = new Map<string, number>();
    const queue: string[] = [targetEntityId];

    while (queue.length > 0) {
      const id = queue.shift()!;
      const hops = minHops.get(id) ?? 0;
      if (hops >= MAX_HOPS) continue;

      const pc = propagationCount.get(id) ?? 0;
      if (pc >= MAX_PROPAGATIONS_PER_NODE) continue;

      const currentDelta = deltas.get(id) ?? 0;
      const lastDelta = lastPropagated.get(id) ?? 0;
      const increment = currentDelta - lastDelta;
      if (Math.abs(increment) < DELTA_CHANGE_EPSILON) continue;
      lastPropagated.set(id, currentDelta);
      propagationCount.set(id, pc + 1);

      const outgoing = edgesBySource.get(id) ?? [];
      if (outgoing.length === 0) continue;
      const decay = Math.pow(HOP_DECAY, hops);

      for (const edge of outgoing) {
        const dst = edge.target_entity_id;
        if (dst === targetEntityId) continue;

        const params = edgeParams.get(edge.id);
        if (!params) continue;
        if (params.effPolarity === 0) continue;

        let contribution =
          increment * params.effStrength * params.effPolarity * decay;

        const mults = cycleMultipliers.get(dst);
        if (mults && contribution !== 0) {
          for (const m of mults) contribution *= m;
        }

        deltas.set(dst, (deltas.get(dst) ?? 0) + contribution);

        const existingMinHops = minHops.get(dst);
        if (existingMinHops === undefined || hops + 1 < existingMinHops) {
          minHops.set(dst, hops + 1);
        }
        queue.push(dst);
      }
    }

    iterationDeltas.push(deltas);

    let scalar = 0;
    for (const [id, d] of deltas) {
      if (id === targetEntityId) continue;
      scalar += Math.abs(d);
    }
    aggregateScalars.push(scalar);
  }

  // ── Per-entity stats ──────────────────────────────────────────────
  const perEntity = new Map<string, number[]>();
  for (const deltas of iterationDeltas) {
    for (const [id, d] of deltas) {
      if (id === targetEntityId) continue;
      const arr = perEntity.get(id) ?? [];
      arr.push(d);
      perEntity.set(id, arr);
    }
  }
  const everReached = new Set(perEntity.keys());
  for (let i = 0; i < iterations; i++) {
    const deltas = iterationDeltas[i];
    for (const id of everReached) {
      if (!deltas.has(id)) {
        perEntity.get(id)!.push(0);
      }
    }
  }

  const affected: BootstrapAffectedEntityStats[] = [];
  for (const [id, samples] of perEntity) {
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const meanSign = Math.sign(mean);
    const agreeing = samples.filter(
      (v) => Math.sign(v) === meanSign && v !== 0,
    ).length;
    const signStability = meanSign === 0 ? 0 : agreeing / samples.length;
    affected.push({
      entity_id: id,
      mean_delta: mean,
      p10: percentile(samples, 0.1),
      p50: percentile(samples, 0.5),
      p90: percentile(samples, 0.9),
      sign_stability: signStability,
      cycle_role: cycleRoles.get(id) ?? null,
    });
  }
  affected.sort((a, b) => Math.abs(b.mean_delta) - Math.abs(a.mean_delta));

  // ── Aggregate scalar distribution (normalized against theoreticalMax) ─
  const sortedAgg = [...aggregateScalars].sort((a, b) => a - b);
  const norm = (x: number) => Math.round((x / theoreticalMax) * 100);
  const aggMean =
    aggregateScalars.reduce((a, b) => a + b, 0) / aggregateScalars.length;
  const aggVariance =
    aggregateScalars.reduce((acc, x) => acc + (x - aggMean) ** 2, 0) /
    aggregateScalars.length;
  const aggStddev = Math.sqrt(aggVariance);

  const ratio = aggMean > 0 ? aggStddev / aggMean : 0;
  const convergenceNote =
    ratio > 0.5
      ? `Wide empirical distribution (σ/μ = ${ratio.toFixed(2)}). Your target's history shows high volatility; the p10/p90 band reflects that — not graph uncertainty.`
      : ratio > 0.25
        ? `Moderate empirical spread (σ/μ = ${ratio.toFixed(2)}). The bootstrap band reflects historical volatility more than graph uncertainty.`
        : `Tight empirical distribution (σ/μ = ${ratio.toFixed(2)}). Your target's history has been stable enough that the graph's structure dominates the resampled range.`;

  return {
    simulation_mode: "bootstrap",
    iterations,
    historical_n: targetHistoricalDeltas.length,
    historical_median_abs_delta: medianAbs,
    aggregate_distribution: {
      p10: norm(percentile(sortedAgg, 0.1)),
      p50: norm(percentile(sortedAgg, 0.5)),
      p90: norm(percentile(sortedAgg, 0.9)),
      mean: norm(aggMean),
      stddev: Math.round((aggStddev / theoreticalMax) * 100),
    },
    affected_entities: affected,
    convergence_note: convergenceNote,
    numeric_edge_coverage: numericEdgeCoverage,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Period-to-period deltas from an observation time-series. Caller is
 *  responsible for sorting observations by time before calling. */
export function computePeriodDeltas(valuesOverTime: number[]): number[] {
  if (valuesOverTime.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < valuesOverTime.length; i++) {
    out.push(valuesOverTime[i] - valuesOverTime[i - 1]);
  }
  return out;
}

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(q * sorted.length)),
  );
  return sorted[idx];
}
