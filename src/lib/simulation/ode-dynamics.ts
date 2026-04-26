// ── ODE right-hand-side functions (R3 — Tier 4 → Tier 5 bridge) ──────
//
// For each EdgeDynamics kind, describe the continuous-time rate this
// edge contributes to the target node. The discrete-timestep engine in
// `monte-carlo.ts` treats dynamics as per-step scalar multipliers; the
// ODE engine treats them as rates dx/dt that accumulate via numerical
// integration. Same semantic labels, different math, different tier.
//
// Discrete vs. continuous mapping:
//
//   linear       discrete:  effect = strength × src               (per step)
//                continuous: dx/dt = strength × src               (unchanged — flow)
//
//   compounding  discrete:  effect = src × rate                    (per step)
//                continuous: dx/dt = rate × src × x                (logistic growth;
//                                                                  x participates)
//
//   decay        discrete:  effect = -(1 − 0.5^(1/halfLife)) × src (per step)
//                continuous: dx/dt = -(ln(2) / halfLife) × x       (exact expo decay)
//
//   exponential  discrete:  effect = strength × log1p(src)         (saturation curve)
//                continuous: dx/dt = strength × log1p(src)         (unchanged — rate)
//
//   threshold    discrete:  effect = src ≥ thr ? strength : 0     (discontinuous)
//                continuous: dx/dt = strength × σ((src − thr) × k) (smoothed with
//                                                                  sigmoid of sharpness
//                                                                  k=10; approaches
//                                                                  discrete as k → ∞)
//
// The ODE path is ONLY used when `SimulationSpec.integrator === "ode_rk4"`.
// Discrete paths use `applyDynamics` in monte-carlo.ts as before.
//
// Out of scope (see roadmap R3):
//   - Stiffness detection / adaptive step
//   - Event-handling for hard threshold crossings (hybrid ODE)
//   - User-authored rate laws (current implementation is fixed per kind)

import type { EdgeDynamics } from "./monte-carlo";

export interface RateContext {
  /** Current value of the source node. */
  source: number;
  /** Current value of the TARGET node (needed for compounding/decay). */
  target: number;
  /** Signed strength (polarity already baked in by caller). */
  strength: number;
  /** Optional per-dynamics params from EdgeSpec.params. */
  params?: Record<string, number>;
}

/**
 * Compute dx/dt contribution from a single edge to its target node.
 * Polarity sign is expected to be baked into `strength` by the caller
 * (same convention as discrete `applyDynamics`).
 */
export function edgeRate(kind: EdgeDynamics, ctx: RateContext): number {
  const { source, target, strength, params } = ctx;
  switch (kind) {
    case "linear":
      return strength * source;
    case "compounding": {
      // Logistic-style growth: rate ∝ source × target. Without `target`
      // the edge would accumulate forever; including it gives the
      // classic S-curve saturation when carrying capacity is implicit
      // via clamp/strength.
      const rate = params?.rate ?? strength;
      return rate * source * target;
    }
    case "decay": {
      // Exact exponential decay: rate = -ln(2)/halfLife × x. The
      // source gates the decay — no source value, no decay flow.
      const halfLife = Math.max(params?.halfLife ?? 5, 0.001);
      return -(Math.LN2 / halfLife) * target * Math.max(source, 0);
    }
    case "exponential":
      return strength * Math.log1p(Math.max(source, 0));
    case "threshold": {
      // Smoothed threshold via logistic. Sharpness k=10 gives a
      // near-step response over ±0.1 around `thr` — close enough to
      // discrete for typical strategy graphs, but integrable.
      const thr = params?.threshold ?? 0.5;
      const k = params?.sharpness ?? 10;
      const z = (source - thr) * k;
      // Numerically stable sigmoid — avoids NaN from exp(large).
      const sigmoid =
        z >= 0
          ? 1 / (1 + Math.exp(-z))
          : Math.exp(z) / (1 + Math.exp(z));
      return strength * sigmoid;
    }
    default:
      return strength * source;
  }
}
