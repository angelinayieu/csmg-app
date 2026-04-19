// Twin quality validator — rigorous, layered guardrails.
//
// The digital twin is a deterministic projection of the KG. Its quality is
// entirely a function of the inputs. Today, the renderer (`buildWorkflowModel`)
// silently degrades on bad inputs — no stage coherence, no synthesis
// freshness check, no strategy alignment validation. This module gives the
// UI a trustworthy signal ("twin quality: 72/100, 3 warnings") so the user
// knows whether to trust what they see.
//
// Four layers of guardrails:
//   1. INPUT     — does the twin have enough raw material to mean anything?
//   2. COHERENCE — are the projected stages/variables internally consistent?
//   3. STRATEGY  — do the strategy's tactics/proposals resolve to the twin?
//   4. TRAJECTORY — is the twin aligned with the active goal's direction?
//
// Scoring: start at 100, subtract weighted cost per issue. Clamp [0, 100].
// Threshold 60 → "passed". Below that, the UI should block/warn the user.

import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type {
  InfrastructureMap,
  StrategicRecommendation,
} from "@/types/strategy";

// ── Types ────────────────────────────────────────────────────────────

export type TwinQualityLayer =
  | "input"
  | "coherence"
  | "strategy_alignment"
  | "trajectory";

export type TwinQualitySeverity = "error" | "warning" | "info";

export interface TwinQualityIssue {
  /** Stable id — survives across renders, suitable as a React key. */
  id: string;
  severity: TwinQualitySeverity;
  layer: TwinQualityLayer;
  /** Dotted path into the twin/inputs that triggered this. */
  path: string;
  /** Short human-readable summary. */
  message: string;
  /** Optional: what the user (or an agent) should do to fix it. */
  fix_hint?: string;
  /** Optional: action an agent could dispatch to auto-fix. */
  suggested_action?: {
    kind: string;
    payload?: Record<string, unknown>;
  };
}

export type TwinQualityGrade =
  | "excellent"    // 90-100
  | "good"         // 70-89
  | "fair"         // 60-69  (passing threshold)
  | "needs_attention" // 40-59
  | "critical";    // 0-39

export interface TwinQualityReport {
  score: number;              // 0-100, clamped
  grade: TwinQualityGrade;
  passed: boolean;            // score >= threshold
  threshold: number;          // default 60
  issues: TwinQualityIssue[];
  error_count: number;
  warning_count: number;
  info_count: number;
  /**
   * Score the twin would achieve if every issue resolved. Useful for
   * showing "you're 12 points from excellent" affordance.
   */
  potential_score: number;
  /**
   * Per-layer subscores (0-100 each). Useful for the readout UI to
   * surface "your Trajectory layer is weak" hints.
   */
  layer_scores: Record<TwinQualityLayer, number>;
  computed_at: string;
}

export interface ValidateTwinQualityInput {
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  synthesisData: SynthesisData | null;
  activeGoal: ImprovementGoal | null;
  infrastructureMap?: InfrastructureMap | null;
  strategicRecommendation?: StrategicRecommendation | null;
  /** How many days since strategy-refresh counts as stale. Default 7. */
  synthesis_freshness_days?: number;
  /** Score threshold for passed=true. Default 60. */
  threshold?: number;
}

// ── Cost table ───────────────────────────────────────────────────────

const SEVERITY_COST: Record<TwinQualitySeverity, number> = {
  error: 10,
  warning: 3,
  info: 1,
};

// ── Public entry point ───────────────────────────────────────────────

export function validateTwinQuality(
  input: ValidateTwinQualityInput
): TwinQualityReport {
  const threshold = input.threshold ?? 60;
  const freshnessDays = input.synthesis_freshness_days ?? 7;

  const issues: TwinQualityIssue[] = [];
  issues.push(...checkInputLayer(input, freshnessDays));
  issues.push(...checkCoherenceLayer(input));
  issues.push(...checkStrategyAlignmentLayer(input));
  issues.push(...checkTrajectoryLayer(input));

  // Compute overall score
  const totalCost = issues.reduce((sum, i) => sum + SEVERITY_COST[i.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - totalCost));

  // Compute per-layer scores
  const layer_scores: Record<TwinQualityLayer, number> = {
    input: 100,
    coherence: 100,
    strategy_alignment: 100,
    trajectory: 100,
  };
  for (const issue of issues) {
    layer_scores[issue.layer] = Math.max(
      0,
      layer_scores[issue.layer] - SEVERITY_COST[issue.severity]
    );
  }

  // Count by severity
  const error_count = issues.filter((i) => i.severity === "error").length;
  const warning_count = issues.filter((i) => i.severity === "warning").length;
  const info_count = issues.filter((i) => i.severity === "info").length;

  // Potential score — what would be achievable if every issue resolved
  const potential_score = 100; // By definition; every issue is in principle resolvable.

  return {
    score,
    grade: gradeFromScore(score),
    passed: score >= threshold,
    threshold,
    issues,
    error_count,
    warning_count,
    info_count,
    potential_score,
    layer_scores,
    computed_at: new Date().toISOString(),
  };
}

// ── Layer 1: Input guardrails ────────────────────────────────────────

function checkInputLayer(
  input: ValidateTwinQualityInput,
  freshnessDays: number
): TwinQualityIssue[] {
  const issues: TwinQualityIssue[] = [];
  const { entities, edges, synthesisData, activeGoal } = input;

  // ── Hard floor: can't form a twin at all ──
  if (entities.length < 3) {
    issues.push({
      id: "input.entities.too_few",
      severity: "error",
      layer: "input",
      path: "entities.length",
      message: `Only ${entities.length} entities — twin needs at least 3 to form stages.`,
      fix_hint: "Add more entities via the whiteboard or run a deeper analysis.",
    });
  }

  // ── Process-entity ratio ──
  const processCount = entities.filter(
    (e) => e.entity_category === "process"
  ).length;
  if (entities.length >= 3 && processCount < 2) {
    issues.push({
      id: "input.process_entities.too_few",
      severity: "warning",
      layer: "input",
      path: "entities[entity_category='process']",
      message:
        processCount === 0
          ? "No process entities found — twin will fall back to causal participants, which is less accurate."
          : `Only ${processCount} process entity — twin will partially fall back to causal participants.`,
      fix_hint:
        "Mark key workflow steps with entity_category='process' so stages are authentic.",
    });
  }

  // ── Causal / temporal edges to order stages ──
  const orderingEdges = edges.filter(
    (e) =>
      e.dimension === "causal" ||
      e.dimension === "temporal" ||
      e.dimension === "functional"
  );
  if (entities.length >= 3 && orderingEdges.length === 0) {
    issues.push({
      id: "input.ordering_edges.missing",
      severity: "error",
      layer: "input",
      path: "edges[dimension='causal|temporal|functional']",
      message:
        "No causal, temporal, or functional edges — stages cannot be ordered.",
      fix_hint:
        "Add directional edges between workflow steps, or run re-evaluate to infer them.",
    });
  }

  // ── Synthesis presence ──
  if (!synthesisData) {
    issues.push({
      id: "input.synthesis.missing",
      severity: "warning",
      layer: "input",
      path: "synthesisData",
      message:
        "No synthesis run yet — twin will show stages without lever/risk annotations.",
      fix_hint: "Run the synthesis pipeline to surface leverage and risk points.",
    });
  } else {
    // Freshness check
    const generatedAt = (synthesisData as unknown as { generated_at?: string })
      .generated_at;
    if (generatedAt) {
      const ageMs = Date.now() - new Date(generatedAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays > freshnessDays) {
        issues.push({
          id: "input.synthesis.stale",
          severity: "info",
          layer: "input",
          path: "synthesisData.generated_at",
          message: `Synthesis is ${Math.round(ageDays)} days old — twin may not reflect recent changes.`,
          fix_hint: "Re-run synthesis to refresh leverage/risk annotations.",
        });
      }
    }

    // Leverage + risk presence
    const leverageCount = (synthesisData.leverage_points ?? []).length;
    const riskCount = (synthesisData.risk_points ?? []).length;
    const hasBottleneck = synthesisData.master_bottleneck != null;
    if (leverageCount === 0 && riskCount === 0 && !hasBottleneck) {
      issues.push({
        id: "input.synthesis.no_signal",
        severity: "warning",
        layer: "input",
        path: "synthesisData.{leverage_points,risk_points,master_bottleneck}",
        message:
          "Synthesis produced no leverage, risk, or bottleneck — twin will render without role highlights.",
        fix_hint:
          "The synthesis may have failed to find signal. Consider adding more entities first.",
      });
    }
  }

  // ── Goal presence — soft, not blocking ──
  if (!activeGoal) {
    issues.push({
      id: "input.goal.missing",
      severity: "info",
      layer: "input",
      path: "activeGoal",
      message: "No active goal — twin trajectory layer will be inert.",
      fix_hint: "Set an ultimate goal to orient the twin's completion signals.",
    });
  } else if (!activeGoal.metric_name) {
    issues.push({
      id: "input.goal.no_metric",
      severity: "warning",
      layer: "input",
      path: "activeGoal.metric_name",
      message: "Goal has no metric — twin can't compute progress toward stages.",
      fix_hint: "Edit the goal and add a measurable metric.",
    });
  }

  return issues;
}

// ── Layer 2: Coherence guardrails ────────────────────────────────────

function checkCoherenceLayer(
  input: ValidateTwinQualityInput
): TwinQualityIssue[] {
  const issues: TwinQualityIssue[] = [];
  const { entities, edges, synthesisData } = input;

  // ── Orphan entities ──
  const touched = new Set<string>();
  for (const e of edges) {
    touched.add(e.source_entity_id);
    touched.add(e.target_entity_id);
  }
  const orphans = entities.filter(
    (e) => !touched.has(e.id) && !touched.has(e.entity_id)
  );
  if (orphans.length > 0 && entities.length >= 3) {
    const ratio = orphans.length / entities.length;
    if (ratio >= 0.4) {
      issues.push({
        id: "coherence.orphan_ratio.high",
        severity: "error",
        layer: "coherence",
        path: "entities[no incident edges]",
        message: `${orphans.length} of ${entities.length} entities are orphaned (no edges) — twin cannot place them.`,
        fix_hint:
          "Run re-evaluate to infer missing connections, or delete unused entities.",
      });
    } else if (ratio >= 0.2) {
      issues.push({
        id: "coherence.orphan_ratio.medium",
        severity: "warning",
        layer: "coherence",
        path: "entities[no incident edges]",
        message: `${orphans.length} of ${entities.length} entities are orphaned.`,
        fix_hint: "Consider connecting them or marking them as external context.",
      });
    }
  }

  // ── Synthesis → entity presence (dangling leverage/risk refs) ──
  if (synthesisData) {
    const entityCodes = new Set(entities.map((e) => e.entity_id));
    const missingLev = (synthesisData.leverage_points ?? []).filter(
      (lp) => lp.entity_id && !entityCodes.has(lp.entity_id)
    );
    const missingRisk = (synthesisData.risk_points ?? []).filter(
      (rp) => rp.entity_id && !entityCodes.has(rp.entity_id)
    );
    const missingBottleneck =
      synthesisData.master_bottleneck?.entity_id &&
      !entityCodes.has(synthesisData.master_bottleneck.entity_id);

    if (missingLev.length > 0) {
      issues.push({
        id: "coherence.leverage.dangling",
        severity: "warning",
        layer: "coherence",
        path: "synthesisData.leverage_points[].entity_id",
        message: `${missingLev.length} leverage point${missingLev.length === 1 ? "" : "s"} reference entities that no longer exist.`,
        fix_hint: "Re-run synthesis — the KG has shifted since the last pass.",
      });
    }
    if (missingRisk.length > 0) {
      issues.push({
        id: "coherence.risk.dangling",
        severity: "warning",
        layer: "coherence",
        path: "synthesisData.risk_points[].entity_id",
        message: `${missingRisk.length} risk point${missingRisk.length === 1 ? "" : "s"} reference missing entities.`,
        fix_hint: "Re-run synthesis.",
      });
    }
    if (missingBottleneck) {
      issues.push({
        id: "coherence.bottleneck.dangling",
        severity: "error",
        layer: "coherence",
        path: "synthesisData.master_bottleneck.entity_id",
        message: "Master bottleneck references an entity that no longer exists.",
        fix_hint: "Re-run synthesis to reselect.",
      });
    }
  }

  // ── Cycles reference existing entities ──
  const dangling_cycle_refs = (input.cycles ?? []).reduce((n, c) => {
    const refs = (c.entity_ids ?? []) as string[];
    const existing = refs.filter((id) =>
      entities.some((e) => e.id === id || e.entity_id === id)
    );
    return n + (refs.length - existing.length);
  }, 0);
  if (dangling_cycle_refs > 0) {
    issues.push({
      id: "coherence.cycles.dangling_refs",
      severity: "warning",
      layer: "coherence",
      path: "cycles[].entity_ids",
      message: `${dangling_cycle_refs} cycle participant reference${dangling_cycle_refs === 1 ? "" : "s"} point to missing entities.`,
      fix_hint: "Re-run re-evaluate to recompute cycles.",
    });
  }

  return issues;
}

// ── Layer 3: Strategy alignment guardrails ──────────────────────────

function checkStrategyAlignmentLayer(
  input: ValidateTwinQualityInput
): TwinQualityIssue[] {
  const issues: TwinQualityIssue[] = [];
  const { entities, strategicRecommendation, infrastructureMap } = input;
  if (!strategicRecommendation) return issues; // Strategy missing is handled elsewhere

  const entityCodes = new Set(entities.map((e) => e.entity_id));

  // ── Every micro_tactic.entity_id should resolve to a known entity ──
  const tactics = strategicRecommendation.micro_tactics ?? [];
  const unresolvedTactics = tactics.filter(
    (t) => t.entity_id && !entityCodes.has(t.entity_id)
  );
  if (unresolvedTactics.length > 0) {
    issues.push({
      id: "strategy_alignment.tactics.unresolved",
      severity: "error",
      layer: "strategy_alignment",
      path: "strategy.micro_tactics[].entity_id",
      message: `${unresolvedTactics.length} strategy tactic${unresolvedTactics.length === 1 ? "" : "s"} target entities that don't exist in the twin.`,
      fix_hint: "Re-run strategy-refresh — KG has drifted from strategy.",
    });
  }

  // ── infrastructure_map.core_components should all resolve ──
  if (infrastructureMap?.core_components) {
    const unresolvedComponents = infrastructureMap.core_components.filter(
      (c) =>
        c.entity_id &&
        c.entity_id !== "NEW" &&
        !entityCodes.has(c.entity_id)
    );
    if (unresolvedComponents.length > 0) {
      issues.push({
        id: "strategy_alignment.infra.unresolved",
        severity: "warning",
        layer: "strategy_alignment",
        path: "infrastructureMap.core_components[].entity_id",
        message: `${unresolvedComponents.length} infrastructure component${unresolvedComponents.length === 1 ? "" : "s"} reference missing entities.`,
        fix_hint: "Re-run strategy-refresh.",
      });
    }
  }

  // ── At least one tactic per perspective (no dead perspectives) ──
  const perspectives = strategicRecommendation.perspectives ?? [];
  const perspectiveCoverage = new Map<string, number>();
  for (const p of perspectives) perspectiveCoverage.set(p.name, 0);
  for (const t of tactics) {
    if (t.macro_link && perspectiveCoverage.has(t.macro_link)) {
      perspectiveCoverage.set(
        t.macro_link,
        (perspectiveCoverage.get(t.macro_link) ?? 0) + 1
      );
    }
  }
  const deadPerspectives = [...perspectiveCoverage.entries()]
    .filter(([, count]) => count === 0)
    .map(([name]) => name);
  if (deadPerspectives.length > 0 && perspectives.length >= 2) {
    issues.push({
      id: "strategy_alignment.perspectives.uncovered",
      severity: "info",
      layer: "strategy_alignment",
      path: `strategy.perspectives[${deadPerspectives.join(", ")}]`,
      message: `${deadPerspectives.length} perspective${deadPerspectives.length === 1 ? "" : "s"} have no tactics — strategy is lopsided.`,
      fix_hint:
        "Either add tactics for these perspectives or remove the perspectives from the strategy.",
    });
  }

  return issues;
}

// ── Layer 4: Trajectory (goal alignment) guardrails ─────────────────

function checkTrajectoryLayer(
  input: ValidateTwinQualityInput
): TwinQualityIssue[] {
  const issues: TwinQualityIssue[] = [];
  const { activeGoal, strategicRecommendation } = input;
  if (!activeGoal) return issues; // Handled in input layer

  // ── Goal should be referenced by strategy ──
  if (strategicRecommendation) {
    const strategyGoalId = strategicRecommendation.improvement_goal_id;
    if (strategyGoalId && strategyGoalId !== activeGoal.id) {
      issues.push({
        id: "trajectory.goal.mismatch",
        severity: "warning",
        layer: "trajectory",
        path: "strategy.improvement_goal_id vs activeGoal.id",
        message:
          "Strategy was built against a different goal — twin's trajectory overlay may be misleading.",
        fix_hint:
          "Re-run strategy-refresh so the strategy re-aligns to the active goal.",
      });
    }

    // Strategy's target_objective metric should match the active goal's metric
    const targetMetric = strategicRecommendation.target_objective?.metric;
    if (
      targetMetric &&
      activeGoal.metric_name &&
      !metricMatchesRoughly(targetMetric, activeGoal.metric_name)
    ) {
      issues.push({
        id: "trajectory.metric.mismatch",
        severity: "info",
        layer: "trajectory",
        path: "strategy.target_objective.metric vs activeGoal.metric_name",
        message: `Strategy optimizes "${targetMetric}" but goal tracks "${activeGoal.metric_name}".`,
        fix_hint:
          "Align these — either edit the goal's metric or re-run strategy against the current goal.",
      });
    }
  }

  // ── Goal has enough structure to contribute to trajectory layer ──
  if (
    activeGoal.target_value == null ||
    activeGoal.baseline_value == null ||
    activeGoal.target_value === activeGoal.baseline_value
  ) {
    issues.push({
      id: "trajectory.goal.unbounded",
      severity: "warning",
      layer: "trajectory",
      path: "activeGoal.{baseline_value,target_value}",
      message:
        "Goal has no numeric range — twin cannot project progress percentages onto stages.",
      fix_hint: "Edit the goal and set a baseline and target value.",
    });
  }

  return issues;
}

// ── Helpers ──────────────────────────────────────────────────────────

function gradeFromScore(score: number): TwinQualityGrade {
  if (score >= 90) return "excellent";
  if (score >= 70) return "good";
  if (score >= 60) return "fair";
  if (score >= 40) return "needs_attention";
  return "critical";
}

function metricMatchesRoughly(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  // Token overlap fallback: if the shorter string's tokens are a subset of
  // the longer's, treat them as matching (catches "signup rate" vs "signups").
  const ta = new Set(na.split(" ").filter((t) => t.length >= 3));
  const tb = new Set(nb.split(" ").filter((t) => t.length >= 3));
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (small.size === 0) return false;
  let overlap = 0;
  for (const t of small) if (big.has(t)) overlap++;
  return overlap / small.size >= 0.5;
}
