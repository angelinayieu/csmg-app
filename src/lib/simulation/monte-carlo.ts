// ── Monte Carlo simulation engine (Phase 1 Step 7) ──
//
// Why: the original rigor question. Today's prediction_ledger stores
// `predicted_distribution` as an LLM-estimated {p10, p50, p90}. Those
// are guesses. This module does actual stochastic simulation on a
// causal subgraph — sampling N runs, propagating effects through
// typed edge-dynamics, and returning distributions derived from real
// samples.
//
// Scope (v1):
//   - Pure function, no DB, no pipeline wiring (call sites plug it in)
//   - Deterministic with `seed` param so tests can assert exact outputs
//   - Three edge dynamics: `linear`, `threshold`, `compounding`
//     (matches the decompose route's `edges.dynamics` enum)
//   - Fixed timestep propagation (default 10 steps per iteration);
//     simulates both forward cascade and feedback-loop compounding
//   - Output: per-node {p10, p50, p90, mean, stddev, samples[]}
//
// Out of scope (deferred):
//   - Bayesian inference / posterior updates (Phase 2 Python sidecar)
//   - Continuous-time differential equations
//   - Cross-node correlation in priors
//   - Cyclic graph convergence guarantees (we just cap timesteps)
//
// Design note: we deliberately don't use external stats libraries.
// Box-Muller is 20 lines, quantile sort is trivial, and shipping
// without new deps keeps the Vercel bundle tight.

export type EdgeDynamics =
  | "linear"
  | "threshold"
  | "compounding"
  | "decay"
  | "exponential";

export type EdgePolarity = "positive" | "negative" | "neutral" | "conditional";

export interface NodeSpec {
  id: string;
  /** Prior mean — the expected starting value. */
  priorMean: number;
  /** Prior stddev — uncertainty around the starting value. 0 = deterministic. */
  priorStdDev: number;
  /**
   * Optional lower/upper clamp. Values sampled outside [min,max] get
   * clamped before propagation. Use to encode domain constraints
   * (percentages ∈ [0,1], counts ≥ 0, etc.).
   */
  min?: number;
  max?: number;
}

export interface EdgeSpec {
  sourceId: string;
  targetId: string;
  /** Strength coefficient, typically 0..1. Polarity flips the sign. */
  strength: number;
  polarity?: EdgePolarity;
  dynamics: EdgeDynamics;
  /**
   * Optional per-dynamics parameters. Examples:
   *   threshold: { threshold: 0.5 }
   *   compounding: { rate: 0.1 }
   *   decay: { halfLife: 5 }
   */
  params?: Record<string, number>;
}

export interface SimulationSpec {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  /** Number of Monte Carlo iterations. Default 1000. */
  iterations?: number;
  /** Propagation timesteps per iteration. Default 10. */
  timesteps?: number;
  /** Deterministic seed. Default 42. */
  seed?: number;
}

export interface NodeDistribution {
  nodeId: string;
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  stddev: number;
  /** Raw samples — useful for downstream viz or cross-node joint distributions. */
  samples: number[];
}

export interface SimulationResult {
  iterations: number;
  timesteps: number;
  seed: number;
  nodes: NodeDistribution[];
  /** Milliseconds the full simulation took. Useful for cost budgeting. */
  durationMs: number;
}

const DEFAULT_ITERATIONS = 1000;
const DEFAULT_TIMESTEPS = 10;
const DEFAULT_SEED = 42;

/**
 * Main entry point. Runs N iterations of the causal subgraph and
 * returns per-node distributions. Pure function — no side effects,
 * no external state.
 */
export function runMonteCarlo(spec: SimulationSpec): SimulationResult {
  const iterations = spec.iterations ?? DEFAULT_ITERATIONS;
  const timesteps = spec.timesteps ?? DEFAULT_TIMESTEPS;
  const seed = spec.seed ?? DEFAULT_SEED;
  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  const rng = makeSeededRng(seed);
  const samplesByNode = new Map<string, number[]>();
  for (const n of spec.nodes) samplesByNode.set(n.id, []);

  // Index edges by target so propagation is O(edges × timesteps).
  const incoming = new Map<string, EdgeSpec[]>();
  for (const e of spec.edges) {
    const list = incoming.get(e.targetId) ?? [];
    list.push(e);
    incoming.set(e.targetId, list);
  }

  for (let i = 0; i < iterations; i++) {
    // Fresh starting values per iteration.
    const values = new Map<string, number>();
    for (const n of spec.nodes) {
      const raw = n.priorMean + sampleNormal(rng) * n.priorStdDev;
      values.set(n.id, clamp(raw, n.min, n.max));
    }

    // Propagate effects through `timesteps` rounds. Each round reads
    // the prior round's state and writes new state so all effects
    // apply simultaneously (synchronous update — matches spreadsheet
    // intuition better than asynchronous for small graphs).
    let state = new Map(values);
    for (let t = 0; t < timesteps; t++) {
      const next = new Map(state);
      for (const node of spec.nodes) {
        const prior = state.get(node.id) ?? 0;
        const edges = incoming.get(node.id) ?? [];
        if (edges.length === 0) {
          // No inbound edges — value persists (minus any self-decay
          // the node's own outbound carries can't influence itself here).
          continue;
        }
        let contribution = 0;
        for (const edge of edges) {
          const src = state.get(edge.sourceId) ?? 0;
          const polarSign = edge.polarity === "negative" ? -1 : 1;
          const effect = applyDynamics(edge.dynamics, src, edge.strength * polarSign, edge.params);
          contribution += effect;
        }
        // Blend prior + contribution. For v1 we use a damped
        // additive update: target_new = prior + contribution / N-steps.
        // Divides by timesteps so total injected magnitude is
        // independent of simulation resolution.
        const raw = prior + contribution / timesteps;
        next.set(node.id, clamp(raw, node.min, node.max));
      }
      state = next;
    }

    // Record final state for this iteration.
    for (const node of spec.nodes) {
      samplesByNode.get(node.id)!.push(state.get(node.id) ?? 0);
    }
  }

  const nodes: NodeDistribution[] = spec.nodes.map((n) => {
    const samples = samplesByNode.get(n.id)!;
    return {
      nodeId: n.id,
      ...summarize(samples),
      samples,
    };
  });

  const endedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  return {
    iterations,
    timesteps,
    seed,
    nodes,
    durationMs: Math.round(endedAt - startedAt),
  };
}

// ── Internals ──────────────────────────────────────────────────────

/**
 * Apply an edge-dynamics function: given a source value + strength +
 * optional params, return the contribution to the target.
 */
function applyDynamics(
  kind: EdgeDynamics,
  source: number,
  strength: number,
  params?: Record<string, number>,
): number {
  switch (kind) {
    case "linear":
      return strength * source;
    case "threshold": {
      const thr = params?.threshold ?? 0.5;
      return source >= thr ? strength : 0;
    }
    case "compounding": {
      // Geometric: small repeated-effect style. `rate` defaults to the
      // strength itself; treating strength as a per-step multiplier.
      const rate = params?.rate ?? strength;
      return source * rate;
    }
    case "decay": {
      // Half-life in timesteps — contribution erodes each step.
      const halfLife = params?.halfLife ?? 5;
      const factor = Math.pow(0.5, 1 / Math.max(halfLife, 0.001));
      return -(1 - factor) * source;
    }
    case "exponential": {
      // Saturation curve: small source values get amplified, large
      // ones approach the cap. Keeps values bounded for chain graphs.
      return strength * Math.log1p(Math.max(source, 0));
    }
    default:
      return strength * source;
  }
}

/** Clamp to [min, max] when either bound is defined. */
function clamp(value: number, min?: number, max?: number): number {
  let v = value;
  if (typeof min === "number" && v < min) v = min;
  if (typeof max === "number" && v > max) v = max;
  return v;
}

/**
 * Box-Muller transform — turns 2 uniform samples into 1 normal sample.
 * We return a single-sample function; the discarded second value is
 * cheap relative to the iteration count.
 */
function sampleNormal(rng: () => number): number {
  let u1 = rng();
  let u2 = rng();
  if (u1 <= Number.EPSILON) u1 = Number.EPSILON;
  if (u2 <= Number.EPSILON) u2 = Number.EPSILON;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Mulberry32 — 32-bit seedable PRNG. Deterministic, fast, adequate
 * for MC simulation where we don't need crypto-grade randomness.
 */
function makeSeededRng(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Compute {p10, p50, p90, mean, stddev} from a sample array. */
function summarize(samples: number[]): {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  stddev: number;
} {
  if (samples.length === 0) {
    return { p10: 0, p50: 0, p90: 0, mean: 0, stddev: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p10 = quantile(sorted, 0.1);
  const p50 = quantile(sorted, 0.5);
  const p90 = quantile(sorted, 0.9);
  const mean = samples.reduce((acc, v) => acc + v, 0) / samples.length;
  const variance =
    samples.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / samples.length;
  const stddev = Math.sqrt(variance);
  return { p10, p50, p90, mean, stddev };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}
