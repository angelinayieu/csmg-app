// ── Monte Carlo propagation engine (Gap B, middle of the taxonomy) ──────
//
// Epistemic position: `narrative_walk` is one LLM opinion; `monte_carlo`
// is N numeric samples run against a causal spec derived from the KG's
// edge strengths + polarities. Neither is a backtest (that's bootstrap)
// and neither is a real-code replay (that's deterministic_replay). This
// engine's job is to turn the graph into an honest *parametric
// distribution* of propagated effects, so the panel can draw p-bands
// that were actually earned.
//
// Model (linear signed propagation with sampled uncertainty):
//
//   1. Seed: target_entity.delta = ±magnitude (sign from direction)
//   2. For each iteration:
//        a. Sample each edge's effective strength as
//             strength ~ N(edge.strength, sigma_strength)
//           clamped to [0, 1]. Edges without a numeric strength get a
//           hardcoded `FALLBACK_STRENGTH` and a wider sigma.
//        b. Sample each edge's effective polarity:
//             with probability `edge.confidence` use the stated polarity,
//             otherwise flip it. Unsigned edges treated as +1.
//        c. BFS from the target, propagating in the edge direction:
//             dst.delta += src.delta × eff_strength × eff_polarity × decay^hops
//        d. Record each entity's final delta.
//   3. Aggregate across iterations → per-entity mean + empirical
//      percentiles + sign-stability.
//
// Scalar impact (for p10/p50/p90 display on the panel): sum of |delta|
// across all DOWNSTREAM entities (excludes target). This is the one
// number the panel renders as the headline distribution; per-entity
// distributions stay internal so the affected-entities list can show
// them inline.
//
// Gating: `canRunMonteCarlo(subgraph)` returns false when the graph
// lacks enough numeric structure (too few edges with strength values,
// or no reachable downstream). The route surfaces that to the UI so
// users don't click Monte-Carlo on a graph that can't earn it.

import type { Entity, Edge } from "@/types";

// ── Cycle structure ────────────────────────────────────────────────────
//
// The BFS's per-hop decay (HOP_DECAY^hops) exists to keep cycles from
// amplifying infinitely — which is exactly the behavior we don't want
// when reality DOES contain a reinforcing loop. Without this pass, MC
// would systematically underweight feedback dynamics: a +0.3 seed
// flowing into a reinforcing_positive cycle gets damped to ~0.05 by
// hop 3 when the real-world dynamic would compound it.
//
// Fix: accept cycles from the caller, and after BFS propagation,
// apply a multiplicative scaling on entities that sit inside a cycle,
// keyed on the cycle's classification and `estimated_multiplier`
// (stored on the cycles table by the loop-detection pipeline stage).
//
//   reinforcing_positive / _negative → multiplier > 1 → amplify |delta|
//   balancing                         → multiplier < 1 → dampen |delta|
//
// We apply the multiplier per-entity per-iteration so the resulting
// distribution inherits the usual BFS stochasticity. An entity
// belonging to multiple cycles gets each multiplier applied in
// sequence (compounded), which matches the intuition that sitting at
// the intersection of two reinforcing loops is structurally more
// leveraged than sitting in one.

export interface CycleInfo {
  cycle_id: string;
  classification: "reinforcing_positive" | "reinforcing_negative" | "balancing";
  entity_ids: string[];
  /** When the loop-detection stage has a point estimate for the cycle's
   *  compounding factor, we use it directly. Otherwise a default based
   *  on classification is used (see CYCLE_DEFAULT_MULTIPLIER). */
  estimated_multiplier: number | null;
}

/** Fallback multipliers when `estimated_multiplier` is null. Kept
 *  conservative so a missing estimate nudges rather than dominates. */
const CYCLE_DEFAULT_MULTIPLIER: Record<
  CycleInfo["classification"],
  number
> = {
  reinforcing_positive: 1.4,
  reinforcing_negative: 1.4, // same magnitude amplification; sign stays with delta
  balancing: 0.6,
};

// ── Knobs ──────────────────────────────────────────────────────────────

/** Default iteration count. 500 is enough for stable p10/p90 on a
 *  2-hop subgraph; cheap enough to run synchronously without a job. */
export const DEFAULT_ITERATIONS = 500;

/** How much noise to inject around each edge's stated strength.
 *  Wider when strength is missing (fallback path). */
const SIGMA_STRENGTH_STATED = 0.12;
const SIGMA_STRENGTH_FALLBACK = 0.25;

/** When an edge has no numeric strength, we sample around this.
 *  Weak enough that missing-strength edges don't dominate, strong
 *  enough that propagation still reaches the downstream. */
const FALLBACK_STRENGTH = 0.4;

/** Per-hop attenuation. Without it, long cycles amplify indefinitely. */
const HOP_DECAY = 0.75;

/** Max hops to walk. Matches the what-if subgraph radius so the
 *  Monte-Carlo sees what the narrative walk saw. */
const MAX_HOPS = 3;

/** Minimum numeric edges before we'll offer Monte-Carlo. Below this
 *  the distribution would reflect `FALLBACK_STRENGTH` guesses more
 *  than graph structure — dishonest to label monte_carlo. */
const MIN_NUMERIC_EDGES = 3;

// ── Public shapes ──────────────────────────────────────────────────────

export interface MonteCarloInput {
  targetEntityId: string;
  direction: "strengthen" | "weaken" | "remove";
  magnitude: number; // 0.1..1.0
  entities: Entity[];
  edges: Edge[];
  /** Cycles in the subgraph (from the `cycles` table). Optional — when
   *  omitted the engine behaves as before (BFS decay only). Supplied
   *  when the caller wants reinforcing loops to amplify and balancing
   *  loops to dampen, which is the only honest behavior on a KG that
   *  flags feedback structure. */
  cycles?: CycleInfo[];
  iterations?: number;
}

export interface AffectedEntityStats {
  entity_id: string;
  /** Mean signed delta across iterations. Positive = strengthens, negative = weakens. */
  mean_delta: number;
  /** Empirical percentiles, unnormalized. */
  p10: number;
  p50: number;
  p90: number;
  /**
   * Fraction of iterations where sign(delta) agreed with sign(mean_delta).
   * Low values (< 0.6) mean the sign itself is uncertain — honest display
   * is "direction ambiguous" rather than picking a random side.
   */
  sign_stability: number;
  /**
   * Which feedback role (if any) this entity played in cycle amplification.
   * - "reinforcing" — sits in at least one reinforcing loop (|delta| amplified)
   * - "balancing"   — sits only in balancing loops (|delta| dampened)
   * - null          — not in any cycle, propagation unchanged
   *
   * Surfaced to the UI so the user sees "this entity was amplified by a
   * reinforcing loop" as a first-class fact, not an opaque +0.23 number.
   */
  cycle_role: "reinforcing" | "balancing" | null;
}

export interface MonteCarloResult {
  /** "monte_carlo" — stamp so the API route can return it verbatim. */
  simulation_mode: "monte_carlo";
  iterations: number;

  /**
   * Headline distribution the panel renders as p10/p50/p90 pills.
   * Scalar: Σ |delta| across downstream entities (excludes target
   * itself). Normalized to 0..100 against the per-iteration max so the
   * UI's existing 0..100 percent scale continues to make sense.
   */
  aggregate_distribution: {
    p10: number;
    p50: number;
    p90: number;
    mean: number;
    stddev: number;
  };

  /** Per-affected-entity stats, sorted by |mean_delta| desc. */
  affected_entities: AffectedEntityStats[];

  /** Convergence note surfaced in the result footer. Short sentence. */
  convergence_note: string;
}

export interface CanRunMonteCarloResult {
  ok: boolean;
  reason?: string;
  /** Number of numeric-strength edges found (for the UI's "n/k edges
   *  have strengths" nudge when ok=false). */
  numeric_edge_count: number;
  downstream_reachable_count: number;
}

// ── Gate ───────────────────────────────────────────────────────────────

export function canRunMonteCarlo(
  targetEntityId: string,
  entities: Entity[],
  edges: Edge[],
): CanRunMonteCarloResult {
  const numericEdges = edges.filter(
    (e) => typeof e.strength === "number" && Number.isFinite(e.strength),
  );

  // Downstream reachability — BFS from target along edge direction.
  const downstream = new Set<string>();
  let frontier = new Set<string>([targetEntityId]);
  for (let h = 0; h < MAX_HOPS; h++) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (frontier.has(edge.source_entity_id) &&
          !downstream.has(edge.target_entity_id) &&
          edge.target_entity_id !== targetEntityId) {
        next.add(edge.target_entity_id);
      }
    }
    if (next.size === 0) break;
    for (const id of next) downstream.add(id);
    frontier = next;
  }

  if (numericEdges.length < MIN_NUMERIC_EDGES) {
    return {
      ok: false,
      reason: `Only ${numericEdges.length} of ${edges.length} edges carry a numeric strength. Monte-Carlo needs ≥ ${MIN_NUMERIC_EDGES} to produce a distribution that reflects your graph, not placeholder values.`,
      numeric_edge_count: numericEdges.length,
      downstream_reachable_count: downstream.size,
    };
  }

  if (downstream.size === 0) {
    return {
      ok: false,
      reason: "No downstream entities are reachable from the target — nothing to propagate through.",
      numeric_edge_count: numericEdges.length,
      downstream_reachable_count: 0,
    };
  }

  // Basic sanity: entity set must contain the target.
  if (!entities.some((e) => e.id === targetEntityId)) {
    return {
      ok: false,
      reason: "Target entity not in subgraph.",
      numeric_edge_count: numericEdges.length,
      downstream_reachable_count: downstream.size,
    };
  }

  return {
    ok: true,
    numeric_edge_count: numericEdges.length,
    downstream_reachable_count: downstream.size,
  };
}

// ── Engine ─────────────────────────────────────────────────────────────

export function runMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const { targetEntityId, direction, magnitude, entities, edges } = input;
  const iterations = input.iterations ?? DEFAULT_ITERATIONS;
  const cycles = input.cycles ?? [];

  // ── Theoretical-max anchor ─────────────────────────────────────────
  // The aggregate scalar (Σ|delta| over downstream) is reported as a
  // percentage of a *theoretical max*, not of the per-run maximum. The
  // old normalization against `sortedAgg[last]` produced numbers that
  // were self-relative — p50=60 told you nothing about absolute impact,
  // only about the shape of this one run's histogram. Anchor instead
  // against `magnitude × downstream_count`, which is the Σ|delta| you'd
  // see if every reachable downstream entity received the full seed
  // delta (strength=1, no decay, no sign flip). Percentages become
  // comparable across runs, and a graph that barely propagates shows
  // a small p50 instead of whatever-got-normalized-to-100.
  const downstreamIds = computeDownstreamSet(targetEntityId, edges, MAX_HOPS);
  const downstreamCount = downstreamIds.size;
  const theoreticalMax = magnitude * Math.max(1, downstreamCount);

  // Build a per-entity multiplier map: entity_id → [mult₁, mult₂, …].
  // Each cycle contributes one multiplier to every entity it contains
  // (excluding the target — seeding an intervention on a cycle point
  // is itself how the intervention interacts with the loop, so we
  // don't double-count by amplifying the seed). Compounding means
  // intersection entities accumulate both multipliers.
  const cycleMultipliers = new Map<string, number[]>();
  // Parallel map for UI display: which kind of loop is this entity in?
  // An entity in BOTH reinforcing and balancing loops rolls up as
  // "reinforcing" — the stronger signal is the one users need to see.
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

  // Seed direction: strengthen = +magnitude, weaken/remove = -magnitude.
  // "remove" is a clamped-to-zero signal; we model it as a large
  // negative delta that the decay chain will attenuate.
  const seedDelta =
    direction === "strengthen" ? magnitude : -magnitude;

  // Index edges by source for fast BFS.
  const edgesBySource = new Map<string, Edge[]>();
  for (const e of edges) {
    const arr = edgesBySource.get(e.source_entity_id) ?? [];
    arr.push(e);
    edgesBySource.set(e.source_entity_id, arr);
  }

  // ── Iterative delta-propagation with cycle amplification at source ─
  //
  // The original BFS was strict-once-visit: each entity got pushed onto
  // the frontier at most once, so contributions arriving via a second
  // path added to its delta but never re-propagated downstream. That
  // systematically under-reports impact for densely connected graphs.
  // Cycle amplification was also post-hoc (scale the delta after BFS),
  // which meant an amplified entity's downstream neighbors never saw
  // the amplification — a reinforcing loop lifted the loop members but
  // not what they feed into.
  //
  // New propagation model:
  //   - Per iteration, sample each edge's parameters ONCE and cache by
  //     edge id. Within a single iteration, repeated traversals of the
  //     same edge use the same eff-strength + eff-polarity — which is
  //     the statistically coherent thing to do (the edge's properties
  //     don't re-roll when an entity revisits it).
  //   - Work-queue BFS: when a node's delta CHANGES (a new contribution
  //     arrives from a repeatedly-visited upstream), requeue the node
  //     so it re-emits its *delta change*, not its full delta. Bounded
  //     by MAX_PROPAGATIONS_PER_NODE to guarantee termination.
  //   - Cycle amplification applied AT THE POINT OF CONTRIBUTION: when
  //     a contribution lands on an entity in a reinforcing loop, that
  //     contribution is amplified before it's added to the entity's
  //     delta. This way, when the entity later re-emits a delta change,
  //     it emits the *amplified* change, which flows to downstream
  //     neighbors. Amplification now propagates through the graph
  //     rather than staying stuck on cycle members.
  const DELTA_CHANGE_EPSILON = 1e-4;
  const MAX_PROPAGATIONS_PER_NODE = MAX_HOPS + 2;

  interface EdgeParams {
    effStrength: number;
    /** Signed: ±1 for pos/neg (with confidence-flip), ±1 for conditional,
     *  or 0 for neutral/missing. Cached per-iteration. */
    effPolarity: number;
  }

  const iterationDeltas: Array<Map<string, number>> = [];
  const aggregateScalars: number[] = [];

  for (let i = 0; i < iterations; i++) {
    // Pre-sample edge parameters for this iteration.
    const edgeParams = new Map<string, EdgeParams>();
    for (const edge of edges) {
      const hasStrength =
        typeof edge.strength === "number" && Number.isFinite(edge.strength);
      const baseStrength = hasStrength
        ? (edge.strength as number)
        : FALLBACK_STRENGTH;
      const sigma = hasStrength ? SIGMA_STRENGTH_STATED : SIGMA_STRENGTH_FALLBACK;
      const effStrength = clamp01(baseStrength + gaussian() * sigma);

      // Polarity — four-valued. See polarity doc in previous version.
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
        if (dst === targetEntityId) continue; // never loop back into seed

        const params = edgeParams.get(edge.id);
        if (!params) continue;
        if (params.effPolarity === 0) continue; // neutral edge — no propagation

        let contribution = increment * params.effStrength * params.effPolarity * decay;

        // Cycle amplification at the POINT OF CONTRIBUTION. If dst sits
        // in a reinforcing loop, the change arriving at dst is amplified
        // before landing. Because later we'll re-propagate dst's delta
        // change downstream, the amplification flows into dst's
        // successors — recovering the feedback signal HOP_DECAY would
        // otherwise erase on the loop's *neighbors*, not just its members.
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

    // Scalar impact for this iteration: Σ |delta| across downstream only.
    let scalar = 0;
    for (const [id, d] of deltas) {
      if (id === targetEntityId) continue;
      scalar += Math.abs(d);
    }
    aggregateScalars.push(scalar);
  }

  // ── Per-entity stats ──────────────────────────────────────────────
  // Collect each entity's delta trajectory across iterations.
  const perEntity = new Map<string, number[]>();
  for (const deltas of iterationDeltas) {
    for (const [id, d] of deltas) {
      if (id === targetEntityId) continue;
      const arr = perEntity.get(id) ?? [];
      arr.push(d);
      perEntity.set(id, arr);
    }
    // Also record zero-deltas for entities not reached this iteration,
    // so the empirical percentile reflects "sometimes this node isn't
    // affected at all" rather than pretending reached-iterations are
    // the population. Only do this for entities EVER reached.
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

  const affected: AffectedEntityStats[] = [];
  for (const [id, samples] of perEntity) {
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const meanSign = Math.sign(mean);
    const agreeing = samples.filter((v) => Math.sign(v) === meanSign && v !== 0).length;
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

  // Sort most-affected first.
  affected.sort((a, b) => Math.abs(b.mean_delta) - Math.abs(a.mean_delta));

  // ── Aggregate scalar distribution ─────────────────────────────────
  // Normalize against theoreticalMax (see top of function) so 100 means
  // "every downstream entity received the full seed delta this
  // iteration." p-values > 100 are allowed — they mean multi-path
  // compounding pushed aggregate impact past the naïve max, which is
  // real signal worth surfacing honestly rather than clamping.
  const sortedAgg = [...aggregateScalars].sort((a, b) => a - b);
  const norm = (x: number) => Math.round((x / theoreticalMax) * 100);
  const aggMean =
    aggregateScalars.reduce((a, b) => a + b, 0) / aggregateScalars.length;
  const aggVariance =
    aggregateScalars.reduce((acc, x) => acc + (x - aggMean) ** 2, 0) /
    aggregateScalars.length;
  const aggStddev = Math.sqrt(aggVariance);

  // Convergence heuristic: if stddev/mean > 0.5, the distribution is
  // wide enough that p10/p90 should be read as "huge uncertainty" not
  // as a tight band. Surface that to the panel.
  const ratio = aggMean > 0 ? aggStddev / aggMean : 0;
  const convergenceNote =
    ratio > 0.5
      ? `Wide distribution (σ/μ = ${ratio.toFixed(2)}). Treat p10/p90 as a large band — the graph's polarity confidences don't pin this down.`
      : ratio > 0.25
        ? `Moderate spread (σ/μ = ${ratio.toFixed(2)}). p10/p90 reflect real variability in edge strengths.`
        : `Tight distribution (σ/μ = ${ratio.toFixed(2)}). The graph's structure pins the answer within a narrow band.`;

  return {
    simulation_mode: "monte_carlo",
    iterations,
    aggregate_distribution: {
      p10: norm(percentile(sortedAgg, 0.1)),
      p50: norm(percentile(sortedAgg, 0.5)),
      p90: norm(percentile(sortedAgg, 0.9)),
      mean: norm(aggMean),
      stddev: Math.round((aggStddev / theoreticalMax) * 100),
    },
    affected_entities: affected,
    convergence_note: convergenceNote,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Box-Muller gaussian. Stdlib doesn't give us one and we don't need a
 *  seedable RNG here — iterations are independent, and the route
 *  aggregates across all of them. */
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
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * sorted.length)));
  return sorted[idx];
}

/** BFS reachability from target along edge direction, capped at MAX_HOPS.
 *  Exported so bootstrap can reuse the same definition of "downstream"
 *  when computing its own theoretical-max anchor. */
export function computeDownstreamSet(
  targetEntityId: string,
  edges: Edge[],
  maxHops: number,
): Set<string> {
  const downstream = new Set<string>();
  let frontier = new Set<string>([targetEntityId]);
  for (let h = 0; h < maxHops; h++) {
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
  return downstream;
}
