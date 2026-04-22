import type { Space, Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal, GoalRecommendation, ObjectiveBenchmark } from "@/types/goals";
import type {
  TwinState,
  TwinMacroState,
  TwinCoverage,
  TwinRiskExposure,
  TwinDynamics,
  TwinGoalOverlay,
} from "@/types/twin";

// ── Coverage computation ──

function computeCoverage(
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
  space: Space,
  synthesisData: SynthesisData | null
): TwinCoverage {
  const confidenceDistribution = { high: 0, medium: 0, low: 0 };
  const sourceDistribution = { explicit: 0, implicit: 0, assumed: 0 };

  for (const e of entities) {
    // Confidence buckets
    if (e.confidence >= 0.7) confidenceDistribution.high++;
    else if (e.confidence >= 0.4) confidenceDistribution.medium++;
    else confidenceDistribution.low++;

    // Source tag
    if (e.source_tag === "explicit") sourceDistribution.explicit++;
    else if (e.source_tag === "implicit") sourceDistribution.implicit++;
    else sourceDistribution.assumed++;
  }

  return {
    entities_modeled: entities.length,
    edges_mapped: edges.length,
    cycles_detected: cycles.length,
    orphan_count: space.orphan_count ?? 0,
    orphan_ratio: entities.length > 0 ? (space.orphan_count ?? 0) / entities.length : 0,
    open_questions: synthesisData?.open_questions?.length ?? 0,
    contradictions: synthesisData?.contradictions?.length ?? 0,
    confidence_distribution: confidenceDistribution,
    source_distribution: sourceDistribution,
  };
}

// ── Risk exposure computation ──

function computeRiskExposure(
  entities: Entity[],
  synthesisData: SynthesisData | null,
  // Tier 6: optional recent-prediction slice for live surprise density.
  // When omitted, risk_exposure is computed exactly as before.
  recentPredictions?: Array<{
    status: string;
    deviation_tag: string | null;
    resolved_at: string | null;
  }>,
): TwinRiskExposure {
  const riskEntities = entities.filter((e) => e.is_risk_point);
  const bottleneck = entities.find((e) => e.is_master_bottleneck);

  const aggregateBlast = riskEntities.reduce((sum, e) => sum + (e.blast_radius ?? 0), 0);
  const maxBlast = riskEntities.reduce((max, e) => Math.max(max, e.blast_radius ?? 0), 0);
  const criticalThreshold = entities.length > 0 ? entities.length * 0.5 : 0;
  const criticalRisks = riskEntities.filter((e) => (e.blast_radius ?? 0) > criticalThreshold).length;

  const bottleneckBlast = bottleneck?.blast_radius ?? 0;
  const bottleneckShare = entities.length > 0 ? Math.round((bottleneckBlast / entities.length) * 100) : 0;

  // Tier 6: aggregate recent resolved predictions in the last 30 days
  // to derive a surprise rate. Surprises (tag=surprise|regime_shift)
  // are the signal that says "model is wrong about something." A run
  // of them should visibly move risk_exposure — that's the whole
  // point of the twin not being frozen.
  let recentResolvedCount: number | undefined;
  let recentSurpriseCount: number | undefined;
  let surpriseRate: number | undefined;
  if (Array.isArray(recentPredictions) && recentPredictions.length > 0) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = recentPredictions.filter((p) => {
      if (p.status !== "resolved") return false;
      if (!p.resolved_at) return false;
      return new Date(p.resolved_at).getTime() >= cutoff;
    });
    const surprises = recent.filter(
      (p) => p.deviation_tag === "surprise" || p.deviation_tag === "regime_shift",
    );
    recentResolvedCount = recent.length;
    recentSurpriseCount = surprises.length;
    surpriseRate =
      recent.length > 0 ? Number((surprises.length / recent.length).toFixed(3)) : 0;
  }

  return {
    total_risk_points: riskEntities.length,
    aggregate_blast_radius: aggregateBlast,
    max_blast_radius: maxBlast,
    critical_risks: criticalRisks,
    bottleneck_name: bottleneck?.name ?? synthesisData?.master_bottleneck?.entity_id ?? null,
    bottleneck_blast_radius: bottleneckBlast,
    bottleneck_system_share: bottleneckShare,
    // Only attach the deviation fields when we actually received predictions.
    // Keeps the Twin shape non-surprising for pre-Tier-6 callers.
    ...(recentResolvedCount !== undefined
      ? {
          recent_predictions_resolved: recentResolvedCount,
          recent_surprises: recentSurpriseCount,
          surprise_rate: surpriseRate,
        }
      : {}),
  };
}

// ── Dynamics computation ──

function computeDynamics(
  entities: Entity[],
  cycles: Cycle[],
  synthesisData: SynthesisData | null
): TwinDynamics {
  const leverageEntities = entities.filter((e) => e.is_leverage_point);
  const topLeverage = leverageEntities.sort(
    (a, b) => (a.centrality_rank ?? 99) - (b.centrality_rank ?? 99)
  )[0];

  // Prefer synthesis feedback loops count if available, fall back to DB cycles
  const loopCount = synthesisData?.feedback_loops?.length ?? cycles.length;
  let reinforcingPositive = 0;
  let reinforcingNegative = 0;
  let balancing = 0;

  if (synthesisData?.feedback_loops?.length) {
    for (const loop of synthesisData.feedback_loops) {
      if (loop.type === "positive") reinforcingPositive++;
      else reinforcingNegative++;
    }
  } else {
    for (const cycle of cycles) {
      if (cycle.classification === "reinforcing_positive") reinforcingPositive++;
      else if (cycle.classification === "reinforcing_negative") reinforcingNegative++;
      else balancing++;
    }
  }

  return {
    total_loops: loopCount,
    reinforcing_positive: reinforcingPositive,
    reinforcing_negative: reinforcingNegative,
    balancing,
    leverage_points: leverageEntities.length,
    top_leverage_name: topLeverage?.name ?? null,
    scenarios_modeled: synthesisData?.scenarios?.length ?? 0,
  };
}

// ── Health score computation ──
// Weighted composite of multiple signals, 0-100

function computeHealthScore(
  coverage: TwinCoverage,
  riskExposure: TwinRiskExposure,
  dynamics: TwinDynamics,
  maturity: Space["maturity"],
  externalCoverage: { externalCount: number; bridgeCount: number },
  benchmarkQuality?: { hasBenchmark: boolean; mustHaveCount: number; indicatorCount: number; milestoneCount: number }
): { score: number; label: "strong" | "developing" | "fragile" | "critical" } {
  let score = 50; // Baseline: "we have a model"

  // Coverage quality (+/- up to 20 points)
  const confRatio = coverage.entities_modeled > 0
    ? coverage.confidence_distribution.high / coverage.entities_modeled
    : 0;
  score += confRatio * 15; // High confidence entities boost score
  score -= coverage.orphan_ratio * 10; // Orphans hurt
  score -= Math.min(coverage.open_questions, 5) * 1; // Each open question costs 1pt, max 5
  score -= Math.min(coverage.contradictions, 3) * 2; // Contradictions are costly

  // Model richness (+/- up to 15 points)
  if (coverage.entities_modeled >= 10) score += 5;
  if (coverage.edges_mapped >= 10) score += 5;
  if (coverage.cycles_detected >= 1) score += 3;
  if (dynamics.scenarios_modeled >= 2) score += 2;

  // Risk penalty (up to -15 points)
  if (riskExposure.critical_risks > 0) score -= riskExposure.critical_risks * 5;
  if (riskExposure.bottleneck_system_share > 50) score -= 5;
  if (riskExposure.bottleneck_system_share > 75) score -= 5;

  // ── Tier 6: live deviation penalty ────────────────────────────────
  // When the caller passed recent predictions, their surprise rate is
  // the clearest "model is wrong" signal we have. Damp the health
  // score by up to -12 when the surprise rate is high across a
  // meaningful resolved-count sample. The twin is no longer frozen at
  // synthesis time — it breathes with reality.
  //
  // Scale carefully:
  //   - Need ≥5 resolved predictions to trust the rate (avoids one
  //     surprise dropping a fresh space)
  //   - surprise_rate ∈ [0, 1]; -12 × rate gives linear penalty
  //   - When recent_predictions is absent, skip entirely (no-op)
  if (
    typeof riskExposure.recent_predictions_resolved === "number" &&
    riskExposure.recent_predictions_resolved >= 5 &&
    typeof riskExposure.surprise_rate === "number"
  ) {
    score -= Math.round(riskExposure.surprise_rate * 12);
  }

  // Dynamics bonus (up to +10 points)
  if (dynamics.leverage_points >= 1) score += 3;
  if (dynamics.reinforcing_positive >= 1) score += 3;
  score -= dynamics.reinforcing_negative * 2; // Negative loops are bad

  // External coverage (+/- up to +8 / -3 points)
  if (externalCoverage.externalCount > 0) score += 3;           // Has some external context
  if (externalCoverage.externalCount >= 5) score += 2;          // Moderate coverage
  if (externalCoverage.externalCount >= 10 && externalCoverage.bridgeCount > 0) score += 3; // Strong coverage with bridge connections
  // Penalty: complex space with zero external grounding
  if (coverage.entities_modeled >= 15 && externalCoverage.externalCount === 0) score -= 3;

  // Maturity modifier
  const maturityBonus: Record<string, number> = {
    actionable_now: 5,
    waiting_on_dependency: 0,
    theoretical: -5,
    blocked: -15,
  };
  score += maturityBonus[maturity] ?? 0;

  // Benchmark quality bonus (+/- up to 5 points)
  if (benchmarkQuality) {
    if (benchmarkQuality.hasBenchmark) {
      score += 2; // Has defined success criteria
      if (benchmarkQuality.mustHaveCount >= 1) score += 1; // Has must-have criteria
      if (benchmarkQuality.indicatorCount >= 1) score += 1; // Has leading indicators
      if (benchmarkQuality.milestoneCount >= 2) score += 1; // Has milestone roadmap
    } else if (coverage.entities_modeled >= 10) {
      // Penalty: non-trivial analysis without evaluation criteria
      score -= 3;
    }
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Label
  let label: "strong" | "developing" | "fragile" | "critical";
  if (score >= 70) label = "strong";
  else if (score >= 50) label = "developing";
  else if (score >= 30) label = "fragile";
  else label = "critical";

  return { score, label };
}

// ── Goal overlay computation ──

function computeGoalOverlay(
  goal: ImprovementGoal,
  synthesisData: SynthesisData | null,
  recommendations: GoalRecommendation[]
): TwinGoalOverlay {
  const range = Number(goal.target_value) - Number(goal.baseline_value);
  const progress = Number(goal.current_value) - Number(goal.baseline_value);
  const progressPct = range !== 0 ? Math.round((progress / range) * 100) : 0;
  const gapRemaining = Number(goal.target_value) - Number(goal.current_value);

  const sorted = [...recommendations].sort((a, b) => a.rank - b.rank);

  return {
    goal,
    progress_pct: Math.max(0, Math.min(100, progressPct)),
    gap_remaining: gapRemaining,
    trajectory: synthesisData?.goal_trajectory_estimate ?? undefined,
    top_recommendation: sorted[0] ?? null,
    recommendation_count: recommendations.length,
  };
}

// ── Per-entity health contribution ──
// Breaks down how each entity affects the health score

export interface EntityHealthContribution {
  entityId: string;
  /** Positive = helps health, negative = hurts */
  contribution: number;
  /** Short explanation */
  reason: string;
}

export function computeEntityHealthContributions(
  entities: Entity[],
  cycles: Cycle[]
): Map<string, EntityHealthContribution> {
  const map = new Map<string, EntityHealthContribution>();
  const total = entities.length || 1;

  for (const entity of entities) {
    let contribution = 0;
    const reasons: string[] = [];

    // Confidence contribution (part of the +15 confRatio bonus)
    if (entity.confidence >= 0.7) {
      const perEntityShare = 15 / total;
      contribution += perEntityShare;
      reasons.push("high confidence");
    } else if (entity.confidence < 0.4) {
      // Low confidence entities dilute the ratio
      const perEntityShare = -(15 / total) * 0.5;
      contribution += perEntityShare;
      reasons.push("low confidence");
    }

    // Leverage bonus (part of +3 for having leverage points)
    if (entity.is_leverage_point) {
      const leverageCount = entities.filter((e) => e.is_leverage_point).length;
      contribution += 3 / (leverageCount || 1);
      reasons.push("leverage point");
    }

    // Risk penalty (part of -5 per critical risk)
    if (entity.is_risk_point) {
      const criticalThreshold = total * 0.5;
      if ((entity.blast_radius ?? 0) > criticalThreshold) {
        contribution -= 5;
        reasons.push("critical risk");
      }
    }

    // Bottleneck penalty
    if (entity.is_master_bottleneck) {
      const share = ((entity.blast_radius ?? 0) / total) * 100;
      if (share > 75) contribution -= 10;
      else if (share > 50) contribution -= 5;
      reasons.push("system bottleneck");
    }

    // Cycle participation (contributes to dynamics bonus)
    const entityCycles = cycles.filter((c) => c.entity_ids?.includes(entity.id));
    for (const cycle of entityCycles) {
      if (cycle.classification === "reinforcing_positive") {
        const membersInCycle = cycle.entity_ids?.length ?? 1;
        contribution += 3 / membersInCycle;
        reasons.push("positive loop");
      } else if (cycle.classification === "reinforcing_negative") {
        const membersInCycle = cycle.entity_ids?.length ?? 1;
        contribution -= 2 / membersInCycle;
        reasons.push("negative loop");
      }
    }

    // Ambiguity classification
    const ambType = (entity as any).ambiguity_type;
    if (ambType === "harmful") {
      contribution -= 2;
      reasons.push("harmful ambiguity");
    } else if (ambType === "strategic") {
      contribution += 0.5;
      reasons.push("strategic ambiguity");
    }
    if (entity.source_tag === "assumed" && entity.confidence < 0.6 && !ambType) {
      contribution -= 1;
      reasons.push("unclassified uncertainty");
    }

    // Temporal validity
    const tv = (entity as any).temporal_validity as Record<string, unknown> | null;
    if (tv?.decay_rate === "immediate") {
      contribution -= 1.5;
      reasons.push("immediate decay");
    } else if (tv?.decay_rate === "fast") {
      contribution -= 0.5;
      reasons.push("fast decay");
    }

    // Manifold quality
    const mf = (entity as any).manifold as Record<string, any> | null;
    if (mf) {
      if (mf.epistemic?.evidence_strength === "empirical") {
        contribution += 0.5;
        reasons.push("empirical evidence");
      } else if (mf.epistemic?.evidence_strength === "assumed") {
        contribution -= 0.5;
        reasons.push("assumed evidence");
      }
      if (mf.strategic?.reversibility === "irreversible" && entity.is_leverage_point) {
        contribution -= 1;
        reasons.push("irreversible leverage");
      }
    }

    contribution = Math.round(contribution * 10) / 10;

    if (contribution !== 0 || reasons.length > 0) {
      map.set(entity.id, {
        entityId: entity.id,
        contribution,
        reason: reasons.join(", ") || "standard",
      });
    }
  }

  return map;
}

// ── Main export: compute full TwinState ──

/**
 * Tier 6: shape of the optional deviation-signal input. When the caller
 * passes recent resolved predictions, the twin augments risk_exposure
 * with live surprise density — so a run of unexpected outcomes bumps
 * risk visibly, instead of the twin sitting frozen at synthesis time.
 *
 * The shape is deliberately narrow — only the fields needed for
 * aggregation. Callers pass a filtered slice of prediction_ledger
 * (status='resolved', resolved_at within the observation window).
 */
export interface RecentPredictionSignal {
  status: "open" | "resolved" | "abandoned";
  deviation_tag: "expected" | "regime_shift" | "surprise" | "qualitative" | null;
  resolved_at: string | null;
}

export function computeTwinState(
  space: Space,
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
  synthesisData: SynthesisData | null,
  activeGoal?: ImprovementGoal | null,
  recommendations?: GoalRecommendation[],
  // Tier 6 optional: recent resolved predictions for live risk signal.
  // When omitted, twin computes exactly as before (unchanged behavior
  // for synthesis-time / dashboard callers that don't have predictions).
  recentPredictions?: RecentPredictionSignal[],
): TwinState {
  const coverage = computeCoverage(entities, edges, cycles, space, synthesisData);
  const riskExposure = computeRiskExposure(entities, synthesisData, recentPredictions);
  const dynamics = computeDynamics(entities, cycles, synthesisData);

  const externalEntities = entities.filter((e) => e.knowledge_layer === "external").length;
  const bridgeEdges = edges.filter((e) => e.knowledge_layer === "bridge").length;

  // Extract benchmark quality for active goal
  let benchmarkQuality: { hasBenchmark: boolean; mustHaveCount: number; indicatorCount: number; milestoneCount: number } | undefined;
  if (activeGoal && synthesisData) {
    const sd = synthesisData as unknown as Record<string, unknown>;
    const goalBenchmarks = sd.goal_benchmarks as Record<string, ObjectiveBenchmark> | undefined;
    const bm = goalBenchmarks?.[activeGoal.id];
    if (bm) {
      benchmarkQuality = {
        hasBenchmark: true,
        mustHaveCount: bm.success_criteria?.filter(sc => sc.priority === "must_have").length ?? 0,
        indicatorCount: bm.leading_indicators?.length ?? 0,
        milestoneCount: bm.milestones?.length ?? 0,
      };
    } else {
      benchmarkQuality = { hasBenchmark: false, mustHaveCount: 0, indicatorCount: 0, milestoneCount: 0 };
    }
  }

  const { score, label } = computeHealthScore(coverage, riskExposure, dynamics, space.maturity, {
    externalCount: externalEntities,
    bridgeCount: bridgeEdges,
  }, benchmarkQuality);

  const macro: TwinMacroState = {
    health_score: score,
    health_label: label,
    coverage,
    risk_exposure: riskExposure,
    dynamics,
    maturity: space.maturity,
    analysis_tier: space.analysis_tier,
    last_updated: space.updated_at,
    external_entities: externalEntities,
    worth_considering_count: synthesisData?.worth_considering?.length ?? 0,
    cross_context_insights: synthesisData?.cross_context_insights?.length ?? 0,
  };

  const goalOverlay =
    activeGoal && activeGoal.status === "active"
      ? computeGoalOverlay(activeGoal, synthesisData, recommendations ?? [])
      : null;

  return { macro, goal_overlay: goalOverlay };
}
