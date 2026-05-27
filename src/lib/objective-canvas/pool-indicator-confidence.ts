// ── REML Pooling for Indicator Confidence (Phase 11.3) ────────────
//
// Wraps the project's existing REML τ² pooler (originally built for
// evidence-row effect-size pooling — see edge-strength-pooler.ts) so
// the same DerSimonian-Laird-iterated random-effects math powers
// proxy-indicator confidence heterogeneity analysis.
//
// What this answers:
//   For one indicator that the ensemble scorer graded across N
//   variations, are those N confidence estimates CONSISTENT or
//   HETEROGENEOUS?
//
// High τ² (between-variation variance) means the same proxy is
// being rated wildly differently across variations — which is a
// real signal: either the variations themselves vary in how cleanly
// they map to the proxy (genuine), or the LLM grader is
// inconsistent (noise). Either way the user wants to know.
//
// Why use REML τ² instead of plain stddev:
//   - Random-effects formulation properly weights variations by
//     their inverse within-study variance (here: 1/disagreement²)
//   - τ² in the units of the effect itself (confidence²) — directly
//     interpretable; not a scale-free percentage
//   - The pooled point estimate is BLUE under the random-effects
//     model, so the user sees a defensible "pooled confidence" not
//     just an unweighted mean
//
// Input shape per indicator: one row per variation that scored it,
// carrying the consensus confidence + the lens-disagreement stddev
// (which we use as the within-variation standard error). When the
// caller hasn't run the ensemble tier (rubric only), they fall back
// to plain mean — this module then is a no-op.

import { poolEffects, type PoolingResult } from "@/lib/evidence/edge-strength-pooler";

export interface IndicatorPoolInput {
  /** Variation that contributed this datapoint. */
  variation_id: string;
  /** Consensus confidence (or single-lens confidence) for the
   *  indicator on this variation. 0..1. */
  confidence: number;
  /** Stddev of lens confidences for this variation × indicator
   *  (Phase 11.3 only — provided by the ensemble scorer's
   *  disagreement_confidence). Becomes the within-variation standard
   *  error in the random-effects model. When omitted, defaults to
   *  a conservative 0.10 (the floor used by the pooler for
   *  evidence with no SE). */
  disagreement_confidence?: number;
}

/** Floor SE — used when the input row has no disagreement signal
 *  (e.g., rubric-only scores ported into this pooler). A small but
 *  non-zero value keeps the inverse-variance weights well-defined
 *  without dominating the pool. */
const DEFAULT_WITHIN_SE = 0.1;

export interface IndicatorPoolResult {
  indicator_text: string;
  outcome_id: string;
  outcome_name: string;
  /** Pooled confidence point estimate from the random-effects model. */
  pooled_confidence: number;
  /** Pooled 95% CI from the random-effects model. */
  pooled_ci_lower: number;
  pooled_ci_upper: number;
  /** τ² — between-variation heterogeneity variance. Units: confidence².
   *  Interpretation: 0..0.01 = consistent, 0.01..0.05 = moderate
   *  heterogeneity, >0.05 = inconsistent grading across variations. */
  tau_squared: number;
  /** How many variations contributed (i.e., how big the meta-study is). */
  n_variations: number;
}

/** Pool a set of per-variation indicator confidence estimates into a
 *  single random-effects estimate with τ² heterogeneity.
 *
 *  Returns null when there are no valid inputs OR when there's only
 *  one variation (degenerate single-study case — heterogeneity is
 *  undefined). The caller should fall back to the single value with
 *  τ²=0 in the UI; we surface null here so the caller can decide. */
export function poolIndicatorConfidence(
  inputs: IndicatorPoolInput[],
): { pooled_confidence: number; pooled_ci_lower: number; pooled_ci_upper: number; tau_squared: number; n_variations: number } | null {
  if (inputs.length === 0) return null;

  // Convert to the pooler's expected shape. effect_size = confidence
  // (treating it like an effect estimate on the unit scale); SE =
  // disagreement_confidence or DEFAULT_WITHIN_SE. evidence_id =
  // variation_id (just a stable label for the pooler).
  const valid = inputs.filter(
    (i) => Number.isFinite(i.confidence) && i.variation_id.length > 0,
  );
  if (valid.length === 0) return null;

  const result: PoolingResult | null = poolEffects(
    valid.map((i) => ({
      effect_size: Math.max(0, Math.min(1, i.confidence)),
      standard_error: Math.max(
        0.01, // hard floor — prevents division blowup when LLM emitted 0
        i.disagreement_confidence ?? DEFAULT_WITHIN_SE,
      ),
      evidence_id: i.variation_id,
    })),
  );
  if (!result) return null;

  return {
    pooled_confidence: Math.max(0, Math.min(1, result.pooled_effect)),
    // Clamp CI to [0,1] since confidence is bounded
    pooled_ci_lower: Math.max(0, Math.min(1, result.pooled_ci_lower)),
    pooled_ci_upper: Math.max(0, Math.min(1, result.pooled_ci_upper)),
    tau_squared: result.tau_squared,
    n_variations: result.n_studies,
  };
}

/** Convenience: pool ALL indicators present in an ensemble envelope.
 *  Groups inputs by (outcome_id, indicator_text), runs poolEffects
 *  per group, and returns one IndicatorPoolResult per indicator.
 *
 *  Use this directly from the score route after ensemble grading —
 *  the result becomes effectiveness_envelope.indicator_pool[]. */
export function poolEnsembleIndicators(
  groups: Array<{
    indicator_text: string;
    outcome_id: string;
    outcome_name: string;
    rows: IndicatorPoolInput[];
  }>,
): IndicatorPoolResult[] {
  const out: IndicatorPoolResult[] = [];
  for (const g of groups) {
    const pooled = poolIndicatorConfidence(g.rows);
    if (!pooled) continue;
    out.push({
      indicator_text: g.indicator_text,
      outcome_id: g.outcome_id,
      outcome_name: g.outcome_name,
      pooled_confidence: pooled.pooled_confidence,
      pooled_ci_lower: pooled.pooled_ci_lower,
      pooled_ci_upper: pooled.pooled_ci_upper,
      tau_squared: pooled.tau_squared,
      n_variations: pooled.n_variations,
    });
  }
  return out;
}
