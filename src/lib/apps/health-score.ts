/**
 * Wave B — health score aggregator.
 *
 * `reconcileAppWithKG` already computes a per-factor breakdown
 * { coverage, momentum, risk } into state.health_breakdown. This module
 * rolls that breakdown up into the scalar `apps.health_score` numeric
 * column that the schema defined in 20260428 but no path has ever
 * populated.
 *
 * Contract:
 *   - Input: the breakdown (nullable fields allowed for apps with no
 *     dominant_entity_codes yet; we degrade gracefully).
 *   - Output: { score: 0..100, factors: {...}, rationale: string }.
 *
 * Rationale for the weights:
 *   - Coverage (35%): how much of this app's dominant factors are
 *     actually being tracked by the KG as leverage or risk. Low
 *     coverage = flying blind; high = well-instrumented.
 *   - Momentum (35%): lean of leverage-vs-risk in the dominant factor
 *     set. 75 = leverage-heavy; 50 = balanced; 35 = risk-heavy.
 *   - Inverse Risk (30%): (100 - risk%), so many risk factors drops
 *     the score. We weight this slightly lower than momentum because
 *     momentum already penalises risk-heavy apps.
 *
 * Goal-coupling bonus:
 *   If an app serves_goal_id + that goal is 'active', add a small
 *   bonus (+4). If the goal has been 'abandoned' or 'rejected', subtract
 *   a larger amount (-10). Callers supply the goal status; if unknown,
 *   pass null and no adjustment is applied. This wires Wave A's
 *   proposed/active/rejected lifecycle into the health signal without
 *   requiring the health function to fetch the goal itself.
 */

export interface HealthBreakdownInput {
  /** % of dominant factors tracked as leverage OR risk (0..100 or null). */
  coverage: number | null;
  /** Leverage vs risk lean (35 | 50 | 75). */
  momentum: number;
  /** % of dominant factors classified as risk (0..100). */
  risk: number;
}

export interface HealthContextInput {
  /** Status of the improvement_goal this app serves, if any.
   *  'proposed' | 'active' | 'achieved' | 'abandoned' | 'paused' | 'rejected' | null */
  goal_status?: string | null;
  /** How many interventions under this app are 'completed'. */
  interventions_completed?: number;
  /** Total number of interventions under this app. */
  interventions_total?: number;
  /** Count of recent predictions tagged 'surprise' (adverse deviation). */
  surprise_predictions?: number;
}

export interface HealthScoreResult {
  score: number; // 0..100, rounded
  factors: {
    coverage_contribution: number;
    momentum_contribution: number;
    inverse_risk_contribution: number;
    goal_bonus: number;
    delivery_bonus: number;
    surprise_penalty: number;
  };
  rationale: string;
}

const WEIGHT_COVERAGE = 0.35;
const WEIGHT_MOMENTUM = 0.35;
const WEIGHT_INVERSE_RISK = 0.30;

const GOAL_STATUS_ADJUSTMENT: Record<string, number> = {
  active: 4,
  achieved: 2, // done — small positive
  proposed: -3, // goal not yet confirmed, so app is speculative
  paused: -6,
  abandoned: -12,
  rejected: -15,
};

export function computeHealthScore(
  breakdown: HealthBreakdownInput,
  ctx: HealthContextInput = {},
): HealthScoreResult {
  const coverage = breakdown.coverage ?? 0;
  const momentum = breakdown.momentum;
  const inverseRisk = 100 - Math.max(0, Math.min(100, breakdown.risk));

  // ── Primary factors (95/100 of total) ──
  const coverageContrib = coverage * WEIGHT_COVERAGE;
  const momentumContrib = momentum * WEIGHT_MOMENTUM;
  const inverseRiskContrib = inverseRisk * WEIGHT_INVERSE_RISK;

  // ── Secondary signals ──
  const goalBonus = ctx.goal_status
    ? (GOAL_STATUS_ADJUSTMENT[ctx.goal_status] ?? 0)
    : 0;

  // Delivery bonus: completed / total interventions, mapped to a 0..8 bonus.
  // Apps with no interventions yet get 0 (no penalty).
  const deliveryBonus =
    ctx.interventions_total && ctx.interventions_total > 0
      ? (Math.max(0, ctx.interventions_completed ?? 0) /
          ctx.interventions_total) *
        8
      : 0;

  // Surprise penalty: each recent surprise prediction costs 2 points,
  // capped at -10 so a string of bad quarters doesn't tank a fundamentally
  // healthy app's score to 0.
  const surprisePenalty = Math.min(10, (ctx.surprise_predictions ?? 0) * 2);

  const raw =
    coverageContrib +
    momentumContrib +
    inverseRiskContrib +
    goalBonus +
    deliveryBonus -
    surprisePenalty;

  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const rationaleBits: string[] = [];
  if (coverage < 40)
    rationaleBits.push(`low coverage (${coverage}%)`);
  else if (coverage >= 70) rationaleBits.push(`strong coverage (${coverage}%)`);
  if (breakdown.risk >= 50) rationaleBits.push(`risk-heavy (${breakdown.risk}%)`);
  if (momentum >= 75) rationaleBits.push("leverage-positive");
  if (goalBonus <= -6)
    rationaleBits.push(`goal ${ctx.goal_status}`);
  if (surprisePenalty >= 4)
    rationaleBits.push(`${ctx.surprise_predictions} recent surprise(s)`);

  const rationale = rationaleBits.length > 0
    ? rationaleBits.join(" · ")
    : "Nominal";

  return {
    score,
    factors: {
      coverage_contribution: Math.round(coverageContrib),
      momentum_contribution: Math.round(momentumContrib),
      inverse_risk_contribution: Math.round(inverseRiskContrib),
      goal_bonus: goalBonus,
      delivery_bonus: Math.round(deliveryBonus),
      surprise_penalty: surprisePenalty,
    },
    rationale,
  };
}

/** Convenience: classify a score into a human tier for UI badges. */
export function healthTier(score: number | null): "strong" | "ok" | "weak" | "unknown" {
  if (score === null || score === undefined) return "unknown";
  if (score >= 70) return "strong";
  if (score >= 45) return "ok";
  return "weak";
}
