// ── Post-generation strategy coherence validation (Phase 5 of strategy rework) ──
//
// After a strategy is produced, check for contradictions against the upstream
// reasoning. Specifically: does the strategy silently violate any critical or
// hidden axiom, does it leave strong convergences unaddressed, does it pay
// attention to coin-flip inversions.
//
// This is a RULE-BASED validator that operates on the provenance aggregate
// already computed by the engine. It doesn't re-invoke the LLM — it checks
// whether the strategy's declared backlinks cover the upstream findings.
//
// Downstream: issues surface in the StrategyValidationResult and in the UI as
// warning chips.

import type { StrategicRecommendation } from "@/types/strategy";
import type { StrategyPipelineContext } from "@/lib/prompts/strategic-recommendation";

export type CoherenceIssueSeverity = "critical" | "high" | "medium" | "low";

export interface CoherenceIssue {
  kind:
    | "critical_axiom_missed"
    | "hidden_axiom_missed"
    | "strong_convergence_missed"
    | "coin_flip_inversion_untested"
    | "coverage_low"
    | "provenance_empty"
    | "fabricated_id";
  severity: CoherenceIssueSeverity;
  message: string;
  /** Specific IDs (axiom_id, cluster_id, gap_id, etc.) this issue references */
  target_ids: string[];
}

export interface CoherenceCheckResult {
  /** 0-100, higher is better. Based on provenance_score + penalties for severe issues. */
  coherence_score: number;
  /** Did the strategy clear the minimum coherence bar? */
  passed: boolean;
  issues: CoherenceIssue[];
}

const SEVERITY_PENALTY: Record<CoherenceIssueSeverity, number> = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 2,
};

/**
 * Validate a strategy's coherence with its upstream pipeline context.
 *
 * @param strategy   The finalized strategic recommendation (must have provenance populated)
 * @param pipelineCtx The upstream context the strategy was generated from
 * @param strict     If true (comprehensive mode), use tighter thresholds and raise severity
 */
export function validateStrategyCoherence(
  strategy: StrategicRecommendation,
  pipelineCtx: StrategyPipelineContext | undefined,
  strict: boolean = false,
): CoherenceCheckResult {
  const issues: CoherenceIssue[] = [];
  const prov = strategy.provenance;

  // Baseline score: start from provenance_score if present, else 50
  let score = prov?.overall_provenance_score ?? 50;

  // ── Check 1: Critical axioms MUST be respected (never missed) ──
  if (prov && prov.critical_axioms_missed.length > 0) {
    issues.push({
      kind: "critical_axiom_missed",
      severity: strict ? "critical" : "high",
      message: `${prov.critical_axioms_missed.length} critical axiom${prov.critical_axioms_missed.length === 1 ? "" : "s"} not respected by any tactic or perspective. A strategy that ignores critical axioms is structurally incoherent.`,
      target_ids: prov.critical_axioms_missed,
    });
  }

  // ── Check 2: Hidden axioms must be acknowledged (respected OR challenged) ──
  if (prov && prov.hidden_axioms_missed.length > 0) {
    issues.push({
      kind: "hidden_axiom_missed",
      severity: strict ? "critical" : "high",
      message: `${prov.hidden_axioms_missed.length} HIDDEN axiom${prov.hidden_axioms_missed.length === 1 ? "" : "s"} neither respected nor challenged. Hidden axioms are the most dangerous unexamined assumptions; a strategy that silently depends on them is fragile.`,
      target_ids: prov.hidden_axioms_missed,
    });
  }

  // ── Check 3: Strong convergences (4+ signals) should be reflected ──
  if (prov && prov.strong_convergences_missed.length > 0) {
    issues.push({
      kind: "strong_convergence_missed",
      severity: strict ? "high" : "medium",
      message: `${prov.strong_convergences_missed.length} strong convergence cluster${prov.strong_convergences_missed.length === 1 ? "" : "s"} not addressed. These are the highest-trust findings (multiple independent mechanisms agree).`,
      target_ids: prov.strong_convergences_missed,
    });
  }

  // ── Check 4: Coin-flip inversions should be tested ──
  const coinFlipInversions = (pipelineCtx?.assumptionInversions ?? [])
    .map((inv, i) => ({ inv, id: `inv${i}` }))
    .filter((x) => x.inv.plausibility === "coin_flip");
  if (coinFlipInversions.length > 0 && prov) {
    const testedSet = new Set(prov.inversions_considered);
    const untested = coinFlipInversions.filter((x) => !testedSet.has(x.id)).map((x) => x.id);
    if (untested.length > 0) {
      issues.push({
        kind: "coin_flip_inversion_untested",
        severity: strict ? "high" : "medium",
        message: `${untested.length} coin-flip assumption inversion${untested.length === 1 ? "" : "s"} not tested. These are 50/50 alternative framings that should have cheap disconfirming tests in the early action plan.`,
        target_ids: untested,
      });
    }
  }

  // ── Check 5: Coverage threshold ──
  const coverage = pipelineCtx?.strategyCoverage?.overall_coverage;
  const coverageThreshold = strict ? 70 : 50;
  if (typeof coverage === "number" && coverage < coverageThreshold) {
    issues.push({
      kind: "coverage_low",
      severity: coverage < 40 ? "critical" : coverage < 60 ? "high" : "medium",
      message: `Coverage at generation time was ${coverage}%, below ${coverageThreshold}% threshold${strict ? " for comprehensive mode" : ""}. The action plan does not address enough critical findings.`,
      target_ids: (pipelineCtx?.strategyCoverage?.gaps ?? []).map((g) => g.id),
    });
  }

  // ── Check 6: Provenance completely empty on tactics ──
  const totalTactics = strategy.micro_tactics?.length ?? 0;
  const tacticsWithProvenance = (strategy.micro_tactics ?? []).filter(
    (t) =>
      (t.axiom_ids_respected?.length ?? 0) > 0 ||
      (t.convergence_ids_addressed?.length ?? 0) > 0 ||
      (t.coverage_gap_ids_closed?.length ?? 0) > 0,
  ).length;
  if (totalTactics > 0 && tacticsWithProvenance === 0) {
    issues.push({
      kind: "provenance_empty",
      severity: strict ? "critical" : "high",
      message: `No tactic declared any upstream backlink (axiom / convergence / gap). The strategy appears ungrounded — either the LLM ignored the grounding directive or the upstream provided no reasoning to reference.`,
      target_ids: [],
    });
  }

  // Apply penalties from issues
  for (const issue of issues) {
    score -= SEVERITY_PENALTY[issue.severity];
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Pass threshold: strict=65, lenient=40. Critical issues always fail.
  const hasCritical = issues.some((i) => i.severity === "critical");
  const passThreshold = strict ? 65 : 40;
  const passed = !hasCritical && score >= passThreshold;

  return { coherence_score: score, passed, issues };
}
