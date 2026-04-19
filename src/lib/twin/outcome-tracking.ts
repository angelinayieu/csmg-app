// Layer 15: Outcome Tracking
// Records whether recommendations/action items actually worked,
// computes accuracy reports, and derives entity reliability scores.

// ── Types ──

export interface OutcomeRecord {
  recommendation_id: string;
  source_entity_id: string | null;
  source_type: string; // from goal_recommendations.source_type
  outcome: "effective" | "ineffective" | "partial" | "not_tested";
  recorded_at: string;
  notes?: string;
}

export interface AccuracyReport {
  total_tracked: number;
  effective_count: number;
  ineffective_count: number;
  partial_count: number;
  effective_rate: number; // 0-1
  by_source_type: Record<
    string,
    { total: number; effective: number; rate: number }
  >;
  entity_reliability: Map<string, number>; // entity_id -> 0-1 reliability
}

// ── Functions ──

/**
 * Creates an outcome record for a recommendation or action item.
 */
export function recordOutcome(
  recommendation: {
    id: string;
    source_entity_id?: string | null;
    status: string;
  },
  outcome: "effective" | "ineffective" | "partial" | "not_tested"
): OutcomeRecord {
  // Infer source_type from the recommendation status field.
  // In practice, source_type would come from the GoalRecommendation row;
  // we fall back to the status string as a reasonable proxy when the
  // full recommendation object isn't available.
  const sourceType = recommendation.status || "unknown";

  return {
    recommendation_id: recommendation.id,
    source_entity_id: recommendation.source_entity_id ?? null,
    source_type: sourceType,
    outcome,
    recorded_at: new Date().toISOString(),
  };
}

/**
 * Given all outcomes for a space/goal, compute an accuracy report.
 *
 * - effective_rate = effective / (effective + ineffective + partial)
 *   (not_tested outcomes are excluded from the denominator)
 * - by_source_type breaks down accuracy per source category
 * - entity_reliability maps each referenced entity to a 0-1 score
 */
export function computeRecommendationAccuracy(
  outcomes: OutcomeRecord[]
): AccuracyReport {
  // Filter to outcomes that were actually tested
  const tested = outcomes.filter((o) => o.outcome !== "not_tested");

  const effective_count = tested.filter((o) => o.outcome === "effective").length;
  const ineffective_count = tested.filter(
    (o) => o.outcome === "ineffective"
  ).length;
  const partial_count = tested.filter((o) => o.outcome === "partial").length;

  const denominator = effective_count + ineffective_count + partial_count;
  const effective_rate = denominator > 0 ? effective_count / denominator : 0;

  // By source_type breakdown
  const bySourceMap = new Map<
    string,
    { total: number; effective: number }
  >();
  for (const o of tested) {
    const entry = bySourceMap.get(o.source_type) ?? { total: 0, effective: 0 };
    entry.total++;
    if (o.outcome === "effective") entry.effective++;
    bySourceMap.set(o.source_type, entry);
  }

  const by_source_type: AccuracyReport["by_source_type"] = {};
  for (const [key, val] of bySourceMap) {
    by_source_type[key] = {
      total: val.total,
      effective: val.effective,
      rate: val.total > 0 ? val.effective / val.total : 0,
    };
  }

  // Entity-level reliability
  const entity_reliability = new Map<string, number>();
  const entityIds = new Set(
    tested
      .map((o) => o.source_entity_id)
      .filter((id): id is string => id != null)
  );
  for (const entityId of entityIds) {
    entity_reliability.set(
      entityId,
      computeEntityReliability(entityId, outcomes)
    );
  }

  return {
    total_tracked: tested.length,
    effective_count,
    ineffective_count,
    partial_count,
    effective_rate,
    by_source_type,
    entity_reliability,
  };
}

/**
 * Returns a 0-1 reliability score for an entity based on how often
 * recommendations referencing it were effective.
 *
 * Scoring: effective = 1.0, partial = 0.5, ineffective = 0.0
 * not_tested outcomes are excluded.
 */
export function computeEntityReliability(
  entityId: string,
  outcomes: OutcomeRecord[]
): number {
  const relevant = outcomes.filter(
    (o) => o.source_entity_id === entityId && o.outcome !== "not_tested"
  );

  if (relevant.length === 0) return 0;

  let score = 0;
  for (const o of relevant) {
    if (o.outcome === "effective") score += 1.0;
    else if (o.outcome === "partial") score += 0.5;
    // ineffective adds 0
  }

  return score / relevant.length;
}
