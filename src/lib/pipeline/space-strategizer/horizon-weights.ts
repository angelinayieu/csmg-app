// ── Horizon-aware weight modulation (Phase 4 §5.1) ────────────────────
//
// The target-outcome extractor surfaces a `horizon` for each run
// ("immediate" / "short_term" / "medium_term" / "long_term"). Without
// this signal, the strategizer ranks every run identically — but the
// SHAPE of useful work is genuinely different across horizons:
//
//   immediate  → the user needs an actionable move TODAY. Deep
//                root-cause work is wasted; surface user-controllable
//                levers near the outcome.
//   short_term → still action-biased but slightly more room for
//                proximate causes.
//   medium_term → balanced (the calibrated DEFAULT_WEIGHTS already
//                target this regime — no modulation).
//   long_term  → root-cause work pays off. Boost causal_depth +
//                convergence + outcome_alignment; trim the immediate
//                lever weights since "what can we do today" matters
//                less than "what's the upstream dynamic."
//
// Implemented as MULTIPLICATIVE overrides on top of base weights so
// the existing applyOverridesAndNormalize machinery handles them
// uniformly with user-supplied request.weight_overrides. When a user
// also passes overrides, the two compose multiplicatively (horizon ×
// user) — both intentions stack rather than one clobbering the other.
//
// Conservative magnitudes (0.7×–1.5×) chosen so a single horizon
// modulation can't entirely flip the ranking; the calibrated base
// weights still set the dominant ordering, horizon just nudges.

import type { SignalProfile } from "@/types/space-plan";

export type Horizon = "immediate" | "short_term" | "medium_term" | "long_term" | null;

/**
 * Per-horizon multiplicative weight overrides. Null/medium_term horizon
 * returns an empty object (no-op). The strategizer merges the result
 * with request.weight_overrides before passing to the ranker.
 */
export function deriveHorizonOverrides(
  horizon: Horizon,
): Partial<Record<keyof SignalProfile, number>> {
  switch (horizon) {
    case "immediate":
      // Action NOW — actionable levers + outcome proximity dominate;
      // shave deep root-cause work hard (it's not what the user is
      // asking about today).
      return {
        user_controllable_lever: 1.5,
        goal_proximity: 1.3,
        outcome_alignment: 1.3,
        cost_efficiency: 1.5,         // D3 phase 3: cheap-fast wins for tight deadlines
        intersection_density: 1.1,    // already-productive regions
        causal_depth_normalized: 0.6, // root-cause work doesn't help today
        convergence_count: 0.7,
        novelty: 0.7,                  // novel bridges take time to pay off
        // ── Phase 4 — temporal signals under "immediate" horizon ──
        // First-effect-soon dominates: boost time_to_outcome and
        // onset_alignment hard. Persistence matters less when the
        // outcome window is days, not years. Heterogeneity penalty
        // stays neutral — disagreement is bad regardless of horizon.
        time_to_outcome: 1.6,
        onset_alignment: 1.5,
        persistence_match: 0.8,
      };
    case "short_term":
      // Weeks-scale — bias toward action but leave some room for
      // proximate-cause work that pays off within the horizon.
      return {
        user_controllable_lever: 1.3,
        goal_proximity: 1.2,
        outcome_alignment: 1.2,
        cost_efficiency: 1.2,          // D3 phase 3: cost still matters at weeks-scale
        causal_depth_normalized: 0.85,
        novelty: 0.9,
        // Phase 4 — moderate temporal boosts.
        time_to_outcome: 1.3,
        onset_alignment: 1.2,
        persistence_match: 1.0,         // baseline at weeks-scale
      };
    case "long_term":
      // Year+ — root-cause work compounds. Push deep upstream signals
      // hard; trim the "right now" levers since pure quick-fixes won't
      // move long-horizon metrics.
      return {
        causal_depth_normalized: 1.5,
        convergence_count: 1.4,
        outcome_alignment: 1.2,
        coverage_gap: 1.15,            // time to fill structural holes
        layer_crossing: 1.15,
        user_controllable_lever: 0.85, // not zero — still want some actionable anchor
        goal_proximity: 0.9,
        cost_efficiency: 0.7,          // D3 phase 3: expensive root-cause investments are tolerable when the payoff window is years
        // ── Phase 4 — temporal signals under "long_term" horizon ──
        // Persistence is what matters: a treatment that fades after 6
        // months is pointless against a 2-year goal. Onset less so.
        // time_to_outcome stays neutral (a long path is fine when
        // the horizon is also long).
        persistence_match: 1.5,
        onset_alignment: 0.7,
        time_to_outcome: 0.9,
        // High-heterogeneity claims are especially costly long-term —
        // a contradicted timing today compounds over years.
        temporal_heterogeneity_penalty: 1.3,
      };
    case "medium_term":
    case null:
    default:
      // Default-calibrated weights are already tuned for this regime.
      return {};
  }
}

/**
 * Compose two override maps. Both are multiplicative against the base
 * weights, so composing them = multiplying their values where keys
 * overlap. This lets request.weight_overrides STACK with horizon-
 * derived overrides rather than one clobbering the other (e.g. a
 * "derisk mode" caller bumping `uncertainty` 2× should still get the
 * long-horizon `causal_depth × 1.5` boost).
 */
export function composeOverrides(
  a: Partial<Record<keyof SignalProfile, number>>,
  b: Partial<Record<keyof SignalProfile, number>>,
): Partial<Record<keyof SignalProfile, number>> {
  const out: Partial<Record<keyof SignalProfile, number>> = { ...a };
  for (const key of Object.keys(b) as Array<keyof SignalProfile>) {
    const bVal = b[key];
    if (typeof bVal !== "number" || bVal <= 0) continue;
    const aVal = out[key];
    out[key] = typeof aVal === "number" && aVal > 0 ? aVal * bVal : bVal;
  }
  return out;
}
