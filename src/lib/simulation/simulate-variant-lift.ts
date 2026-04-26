// ── simulate-variant-lift ─────────────────────────────────────────────
//
// Honest Tier 4 replacement for iv-scorer's LLM-self-rated
// `aggregate_lift`. Answers the well-defined counterfactual:
//
//   "If this variant's intervention hit entity X with magnitude Δ, what
//    p50 lift would downstream target Y see, based on the graph's
//    causal structure (polarity, dynamics, strength, cycles)?"
//
// Runs Monte Carlo twice — once with no perturbation (baseline), once
// with priorMean = Δ on the lever — reuses the same seed across both
// so Gaussian noise cancels. The remaining p50 delta is signal from
// the perturbation propagating through the graph.
//
// Limitations the caller should know about:
//   • Does not model "real-world lift" (we have no ground truth A/B
//     outcomes). Models "structural lift" — what the KG predicts.
//   • Requires a lever entity distinct from the target, with at least
//     one causal path between them. If the lever can't reach the
//     target, lift collapses to ~0 (noise) and we return null.
//   • Δ is an experimental parameter. Default 0.5 (half a standard
//     deviation) — this is a "moderate intervention" counterfactual.
//     Users who want "strong intervention" run again with Δ = 1.0.
//
// This file is pure orchestration. The MC math lives in
// `src/lib/simulation/monte-carlo.ts` and the subgraph build in
// `simulate-entity-chain.ts`. Both are already Tier 4 verified code.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  simulateEntityChain,
  type SimulateChainResult,
} from "./simulate-entity-chain";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface VariantLiftOpts {
  spaceId: string;
  /** Where the intervention lands. Priors on this node get the
   *  perturbation magnitude. */
  leverEntityId: string;
  /** Where we measure lift. Must be downstream of lever via ≥1 edge
   *  path within `depthHops`. */
  targetEntityId: string;
  /** Perturbation magnitude in units of the default prior stddev.
   *  Default 0.5 (moderate). Caps [-3, +3] so a huge number can't
   *  accidentally swamp other signals. */
  perturbationMagnitude?: number;
  /** MC iterations per run. Default 400 — same as app-generator's
   *  per-app baseline. Higher = tighter lift estimate, longer runtime. */
  iterations?: number;
  /** Same seed reused across baseline and variant so Gaussian noise
   *  cancels between the two p50 samples. Default 7919 (an arbitrary
   *  prime — deterministic but not obviously tuned). */
  seed?: number;
  /** Hops upstream from target to include in the subgraph. Default 3. */
  depthHops?: number;
}

export interface VariantLiftResult {
  baseline: {
    p10: number;
    p50: number;
    p90: number;
    stddev: number;
  };
  variant: {
    p10: number;
    p50: number;
    p90: number;
    stddev: number;
  };
  /** (variant.p50 − baseline.p50) / max(|baseline.p50|, 0.01). Signed;
   *  positive ⇒ this variant moves the target upward under the
   *  graph's structural rules. */
  liftPct: number;
  /** Absolute delta, same units as the distribution (deviations from
   *  baseline). Easier to interpret on near-zero baselines. */
  liftAbsolute: number;
  /** The actual perturbation magnitude applied. Echoed for audit. */
  perturbationMagnitude: number;
  /** Samples behind each distribution (iterations). */
  sampleCount: number;
  leverEntityId: string;
  targetEntityId: string;
  /** Non-null when either leg of the simulation failed. The caller
   *  should fall back to the LLM-rated lift + keep
   *  `score_provenance = "llm_review"`. */
  error: string | null;
}

const MIN_MAGNITUDE = -3;
const MAX_MAGNITUDE = 3;
const DEFAULT_MAGNITUDE = 0.5;
const DEFAULT_ITERATIONS = 400;
const DEFAULT_SEED = 7919;
const DEFAULT_DEPTH = 3;

/**
 * Compute real MC lift for a variant. Two runs, same seed, same
 * subgraph — the p50 delta IS the variant's structural impact on the
 * target entity under the intervention magnitude Δ.
 *
 * Returns `error: string` when either leg fails or the lever can't
 * reach the target; caller should treat as "MC unavailable, keep LLM
 * review."
 */
export async function simulateVariantLift(
  db: AnyDb,
  opts: VariantLiftOpts,
): Promise<VariantLiftResult> {
  const magnitude = clamp(
    typeof opts.perturbationMagnitude === "number" &&
      Number.isFinite(opts.perturbationMagnitude)
      ? opts.perturbationMagnitude
      : DEFAULT_MAGNITUDE,
    MIN_MAGNITUDE,
    MAX_MAGNITUDE,
  );
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const seed = opts.seed ?? DEFAULT_SEED;
  const depthHops = opts.depthHops ?? DEFAULT_DEPTH;

  if (opts.leverEntityId === opts.targetEntityId) {
    return errorResult(
      opts,
      magnitude,
      iterations,
      "lever and target must be distinct entities",
    );
  }

  // Baseline run — no perturbation. Uses the standard simulateEntityChain
  // semantics: priorMean=0 for all non-target nodes.
  const baselineRes = await simulateEntityChain(db, {
    spaceId: opts.spaceId,
    targetEntityId: opts.targetEntityId,
    depthHops,
    iterations,
    seed,
  });
  if (baselineRes.error !== null || !baselineRes.targetDistribution) {
    return errorResult(
      opts,
      magnitude,
      iterations,
      baselineRes.error ?? "baseline target distribution missing",
    );
  }

  // Reachability check: if the lever isn't in the subgraph, there's no
  // path from lever → target within depthHops. Nudging a disconnected
  // node produces pure noise. Refuse so the caller can honestly keep
  // LLM review.
  const leverInSubgraph = subgraphContains(baselineRes, opts.leverEntityId);
  if (!leverInSubgraph) {
    return errorResult(
      opts,
      magnitude,
      iterations,
      `lever ${opts.leverEntityId} is not within ${depthHops} hops upstream of target ${opts.targetEntityId}`,
    );
  }

  // Variant run — same seed, same subgraph, lever priorMean overridden.
  const perturbations = new Map<
    string,
    { priorMean?: number; priorStdDev?: number }
  >();
  perturbations.set(opts.leverEntityId, { priorMean: magnitude });

  const variantRes = await simulateEntityChain(db, {
    spaceId: opts.spaceId,
    targetEntityId: opts.targetEntityId,
    depthHops,
    iterations,
    seed,
    perturbations,
  });
  if (variantRes.error !== null || !variantRes.targetDistribution) {
    return errorResult(
      opts,
      magnitude,
      iterations,
      variantRes.error ?? "variant target distribution missing",
    );
  }

  const baseline = baselineRes.targetDistribution;
  const variant = variantRes.targetDistribution;

  const liftAbsolute = variant.p50 - baseline.p50;
  // Denominator guard: when baseline p50 is ~0, pct lift explodes.
  // Floor at 0.01 to keep the number useful without lying about scale.
  const liftPct = liftAbsolute / Math.max(Math.abs(baseline.p50), 0.01);

  return {
    baseline: {
      p10: baseline.p10,
      p50: baseline.p50,
      p90: baseline.p90,
      stddev: baseline.stddev,
    },
    variant: {
      p10: variant.p10,
      p50: variant.p50,
      p90: variant.p90,
      stddev: variant.stddev,
    },
    liftPct,
    liftAbsolute,
    perturbationMagnitude: magnitude,
    sampleCount: iterations,
    leverEntityId: opts.leverEntityId,
    targetEntityId: opts.targetEntityId,
    error: null,
  };
}

// ── helpers ──────────────────────────────────────────────────────────

function subgraphContains(
  res: SimulateChainResult,
  entityId: string,
): boolean {
  // SimulateChainResult doesn't directly expose the subgraph node list;
  // nodeCount + distribution nodes cover it. The simulation.nodes array
  // has one entry per included entity, so presence here = included in
  // the subgraph. Plus the target itself is always included.
  if (entityId === res.simulation.nodes[0]?.nodeId) return true;
  return res.simulation.nodes.some((n) => n.nodeId === entityId);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function errorResult(
  opts: VariantLiftOpts,
  magnitude: number,
  iterations: number,
  error: string,
): VariantLiftResult {
  return {
    baseline: { p10: 0, p50: 0, p90: 0, stddev: 0 },
    variant: { p10: 0, p50: 0, p90: 0, stddev: 0 },
    liftPct: 0,
    liftAbsolute: 0,
    perturbationMagnitude: magnitude,
    sampleCount: iterations,
    leverEntityId: opts.leverEntityId,
    targetEntityId: opts.targetEntityId,
    error,
  };
}
