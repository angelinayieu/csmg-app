// ── SpecForge · Causal Quality Critic / Repair Engine ───────────────
//
// A lightweight, deterministic implementation of the quality-gate spec. It
// runs after each engine output, decides whether the output is allowed
// downstream, and supplies a concise repair instruction for one server-side
// retry. The final board card gives the user a readable quality report.

import type {
  SpecForgeCard,
  SpecForgeEngineId,
  PowerUpResult,
  TargetUserResult,
  ProblemTreeResult,
  DesiredResultResult,
  CrossAnalysisResult,
  QuestionExpansionResult,
  ExpandedQuestion,
  ConvergenceResult,
  DifferentiationResult,
  SolutionFamiliesResult,
  MvpVariationsResult,
  EvaluationResult,
  RecommendationResult,
  ComplexityAllocationResult,
  ComplexityModuleScore,
  ComplexityWarning,
  ComplexityReallocation,
  FeatureCardsResult,
  FeatureCard,
  FeatureMechanismsResult,
  FeatureMechanism,
  DataPointsResult,
  DataPoint,
  LayerOptimizationResult,
  LayerNode,
  LayerAlignmentCheck,
  ConsequentialEvaluation,
  ValidationResult,
  ValidationExperiment,
  ValidationAssumption,
  DeepeningResult,
  DeepeningBaseline,
  DeepeningUncertainty,
  SpecExportResult,
  SpecExportImplementationTask,
  SpecExportCausalTraceRow,
  SpecExportFeatureRequirement,
  SpecExportMechanismRequirement,
} from "./types";

export type QualitySeverity = "critical" | "high" | "medium" | "low";

export interface QualityCriticIssue {
  severity: QualitySeverity;
  dimension: string;
  issue: string;
  repair: string;
}

export interface QualityCriticResult {
  engine: SpecForgeEngineId;
  passed: boolean;
  score: number;
  confidenceAfterRepair: number;
  repaired: boolean;
  issues: QualityCriticIssue[];
  constraintsAdded: string[];
  downstreamStalenessWarning: string;
}

const clean = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

function arr<T>(value: readonly T[] | null | undefined): T[];
function arr(value: unknown): unknown[];
function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function add(
  issues: QualityCriticIssue[],
  condition: boolean,
  severity: QualitySeverity,
  dimension: string,
  issue: string,
  repair: string,
) {
  if (!condition) return;
  issues.push({ severity, dimension, issue, repair });
}

function scoreIssues(issues: QualityCriticIssue[]): number {
  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === "critical") return sum + 30;
    if (issue.severity === "high") return sum + 18;
    if (issue.severity === "medium") return sum + 10;
    return sum + 4;
  }, 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function hasBlockingIssue(issues: QualityCriticIssue[]): boolean {
  return issues.some(
    (issue) => issue.severity === "critical" || issue.severity === "high",
  );
}

function compactIssue(issue: QualityCriticIssue): string {
  return `${issue.dimension}: ${issue.issue}. Repair: ${issue.repair}`;
}

export function buildCriticRepairInstruction(
  critic: QualityCriticResult,
): string | null {
  const repairable = critic.issues
    .filter((issue) => issue.severity !== "low")
    .slice(0, 6);
  if (!repairable.length || critic.passed) return null;
  return [
    "The SpecForge Causal Quality Critic rejected the previous output.",
    "Return the full JSON object again, preserving strong parts and repairing these issues:",
    ...repairable.map((issue, i) => `${i + 1}. ${compactIssue(issue)}`),
    "Do not add decorative detail. Add only causal specificity, constraints, traceability, evidence honesty, and buildable mechanism detail.",
  ].join("\n");
}

export function evaluateSpecForgeQuality(
  engine: SpecForgeEngineId,
  result: unknown,
  repaired = false,
): QualityCriticResult {
  const issues: QualityCriticIssue[] = [];

  if (!result || typeof result !== "object") {
    issues.push({
      severity: "critical",
      dimension: "traceability",
      issue: "engine returned no structured object",
      repair: "return the required JSON schema with concrete downstream constraints",
    });
    return finalize(engine, issues, repaired, []);
  }

  switch (engine) {
    case "power_up": {
      const r = result as PowerUpResult;
      add(issues, !clean(r.clean_summary), "critical", "specificity", "missing clean summary", "extract the idea in one concrete sentence");
      add(issues, !clean(r.root_intent), "high", "desired result alignment", "missing root intent", "separate literal request from deeper intent");
      add(issues, !clean(r.target_user_guess), "high", "target user alignment", "missing target user guess", "name the likely first user segment");
      add(issues, !clean(r.core_problem_guess), "high", "causal depth", "missing core problem guess", "state the likely blocked cause before features");
      add(issues, !clean(r.powered_up_prompt), "medium", "downstream usefulness", "missing powered-up prompt", "write a stronger prompt for later engines");
      add(issues, arr(r.ambiguities).length === 0, "medium", "uncertainty visibility", "ambiguities are hidden", "list open ambiguities instead of smoothing them over");
      return finalize(engine, issues, repaired, ["explicit facts vs inference boundary"]);
    }

    case "target_user": {
      const r = result as TargetUserResult;
      add(issues, !clean(r.primary_segment), "critical", "target user alignment", "missing primary segment", "select one behaviorally specific first user");
      add(issues, !clean(r.core_need), "high", "desired result alignment", "missing core need", "name the recurring need that makes the product valuable");
      add(issues, arr(r.behavior_patterns).length < 2, "high", "specificity", "too few behavior patterns", "add behavior patterns that change product design");
      add(issues, arr(r.constraints).length < 2, "medium", "constraint satisfaction", "weak user constraints", "pass user constraints downstream");
      add(issues, arr(r.user_variants).length < 2, "medium", "uncertainty visibility", "no meaningful user variants", "compare at least two plausible variants");
      add(issues, arr(r.implications_for_product).length < 2, "medium", "downstream usefulness", "few product implications", "state how the user model changes MVP direction");
      return finalize(engine, issues, repaired, arr(r.constraints).map(clean).filter(Boolean).slice(0, 3));
    }

    case "problem_tree": {
      const r = result as ProblemTreeResult;
      const loops = arr<{ kind?: string }>(r.feedback_loops);
      const reinforcing = loops.filter((loop) => loop.kind === "reinforcing").length;
      const balancing = loops.filter((loop) => loop.kind === "balancing").length;
      const root =
        clean(r.root_constraint_tournament?.selected_root_constraint) ||
        clean(r.root_constraint);
      add(issues, !root, "critical", "root constraint alignment", "no selected root constraint", "run the root-constraint tournament and select a winner");
      add(issues, arr(r.variables).length < 12, "high", "causal depth", `only ${arr(r.variables).length} causal variables`, "expand behavioral, trust, incentive, interface, data, and technical variables");
      add(issues, arr(r.causal_links).length < 8, "high", "traceability", `only ${arr(r.causal_links).length} causal links`, "connect variables with signed mechanisms and assumptions");
      add(issues, reinforcing < 3, "high", "causal depth", `only ${reinforcing} reinforcing loops`, "add reinforcing loops that explain compounding behavior");
      add(issues, balancing < 1, "medium", "causal depth", "no balancing loop", "add a balancing loop or explain why none exists");
      add(issues, arr(r.contradictions).length < 3, "medium", "uncertainty visibility", "few contradictions", "extract tensions and tradeoffs that affect solution scope");
      add(issues, arr(r.root_constraint_tournament?.candidates).length < 5, "high", "non-genericness", "weak root-constraint tournament", "compare at least five root-constraint candidates");
      add(issues, arr(r.leverage_points).length < 5, "high", "downstream usefulness", "not enough ranked leverage points", "rank leverage points with buildability, differentiation, and risk");
      add(issues, arr(r.evidence_needed).length < 2, "medium", "evidence honesty", "evidence needs are missing", "state what evidence would change the model");
      add(issues, r.quality_gate?.passes === false, "medium", "constraint satisfaction", "internal quality gate failed", "repair the internal quality issues before downstream use");
      return finalize(engine, issues, repaired, arr(r.solution_constraints).map(clean).filter(Boolean).slice(0, 4));
    }

    case "desired_result": {
      const r = result as DesiredResultResult;
      add(issues, !clean(r.decision_result), "high", "desired result alignment", "missing decision result", "state what decision the user can make after using the product");
      add(issues, !clean(r.behavior_change), "high", "target user alignment", "missing behavior change", "connect the result to observable user behavior");
      add(issues, !clean(r.measurable_success), "high", "evidence honesty", "missing measurable success", "define observable success without vanity metrics");
      add(issues, !clean(r.first_principles_result), "medium", "causal depth", "missing first-principles result", "rewrite the result as the underlying state change");
      add(issues, arr(r.success_metrics).length < 2, "medium", "downstream usefulness", "too few success metrics", "add metrics that can rank MVP directions");
      return finalize(engine, issues, repaired, arr(r.success_metrics).map(clean).filter(Boolean).slice(0, 3));
    }

    case "cross_analysis": {
      const r = result as CrossAnalysisResult;
      const validFit = (fit: { score?: unknown; reason?: unknown } | undefined) =>
        !!fit && Number.isFinite(Number(fit.score)) && !!clean(fit.reason);
      add(issues, !validFit(r.user_problem_fit), "critical", "user-problem fit", "missing user×problem fit", "score the fit and explain it in one sentence");
      add(issues, !validFit(r.user_result_fit), "critical", "user-result fit", "missing user×result fit", "score the fit and explain why the user cares about the result");
      add(issues, !validFit(r.problem_result_fit), "critical", "problem-result fit", "missing problem×result fit", "score the fit and explain which causes block which results");
      add(issues, arr(r.cause_result_blockages).length < 3, "high", "cause-result blockage map", "fewer than 3 cause→result blockages", "name at least 3 cause→result edges with a stated mechanism");
      add(issues, arr(r.cross_model_contradictions).length < 2, "high", "cross-model tensions", "fewer than 2 cross-model contradictions", "surface tensions that span TWO of {user, problem, result}, not within one");
      add(issues, arr(r.weak_links).length < 2, "medium", "uncertainty visibility", "weak links not surfaced", "name where smart-looking claims rest on thin evidence");
      add(issues, !clean(r.highest_leverage_intervention_candidate), "high", "leverage alignment", "no highest-leverage intervention candidate", "propose ONE leverage candidate for convergence to consider");
      add(issues, arr(r.convergence_inputs).length < 2, "high", "downstream usefulness", "convergence_inputs too thin", "list inputs convergence should prioritize");
      add(issues, !Number.isFinite(Number(r.confidence)), "medium", "evidence honesty", "missing confidence", "state confidence 0–100 honestly");
      return finalize(engine, issues, repaired, arr(r.convergence_inputs).map(clean).filter(Boolean).slice(0, 3));
    }

    case "question_expansion": {
      const r = result as QuestionExpansionResult;
      const questions = arr<ExpandedQuestion>(r.questions);
      const total = questions.length;
      const anyHasTrigger = questions.some(
        (q) => Array.isArray(q?.change_triggers) && q.change_triggers.length > 0,
      );
      const genericQuestions = questions.filter((q) => {
        const refLayer = clean(q?.references?.layer);
        const refNode = clean(q?.references?.node);
        const why = clean(q?.why_it_matters);
        const impact = clean(q?.expected_decision_impact);
        return !refLayer || !refNode || why.length < 30 || !impact;
      }).length;
      const layersCovered = new Set(
        questions
          .map((q) => clean(q?.layer))
          .filter(Boolean) as string[],
      );
      const coversCoreLayer = ["user", "problem", "result", "differentiation"].some(
        (layer) => layersCovered.has(layer),
      );
      const missingAnswerFormat = questions.some(
        (q) => !clean(q?.expected_answer_format),
      );

      add(
        issues,
        total === 0,
        "critical",
        "downstream usefulness",
        "no questions generated",
        "return 6–10 decision-changing questions tied to upstream nodes",
      );
      add(
        issues,
        total > 0 && !anyHasTrigger,
        "critical",
        "decision impact",
        "no question carries a change_trigger",
        "tag every question with ≥1 change_trigger (mvp_direction, target_user, root_constraint, desired_result, differentiation_thesis, feature_mechanism, evaluation_criteria, hidden_assumption)",
      );
      add(
        issues,
        total > 0 && genericQuestions > 0,
        "high",
        "non-genericness",
        `${genericQuestions} generic question${genericQuestions === 1 ? "" : "s"} (no node reference, weak why_it_matters, or missing impact)`,
        "tie every question to a specific upstream node, write a ≥30-char why_it_matters, and set expected_decision_impact",
      );
      add(
        issues,
        total > 0 && total < 6,
        "medium",
        "downstream usefulness",
        `only ${total} question${total === 1 ? "" : "s"} — fewer than 6`,
        "expand to 6–10 ranked questions",
      );
      add(
        issues,
        total > 0 && !coversCoreLayer,
        "medium",
        "traceability",
        "no question covers user / problem / result / differentiation",
        "ensure questions span the core upstream layers, not just one",
      );
      add(
        issues,
        total > 0 && missingAnswerFormat,
        "low",
        "downstream usefulness",
        "some questions are missing expected_answer_format",
        "describe the shape of a useful answer for every question",
      );
      add(
        issues,
        !Number.isFinite(Number(r.confidence)),
        "low",
        "evidence honesty",
        "missing confidence",
        "state confidence 0–100 honestly",
      );
      return finalize(
        engine,
        issues,
        repaired,
        arr<string>(r.top_critical_questions).map(clean).filter(Boolean).slice(0, 3),
      );
    }

    case "convergence": {
      const r = result as ConvergenceResult;
      add(issues, !clean(r.distilled_product_thesis), "critical", "downstream usefulness", "missing product thesis", "select the strongest thesis instead of listing interpretations");
      add(issues, !clean(r.root_constraint), "high", "root constraint alignment", "root constraint not carried forward", "carry the selected root constraint into the thesis");
      add(issues, !clean(r.first_principles_need), "high", "causal depth", "missing first-principles need", "derive the need beneath the visible problem");
      add(issues, arr(r.what_this_rules_out).length < 2, "medium", "constraint satisfaction", "few rejected directions", "state what the thesis rules out");
      add(issues, arr(r.what_this_implies_for_solution_design).length < 2, "medium", "buildability", "few solution-design implications", "convert the thesis into build constraints");
      return finalize(engine, issues, repaired, arr(r.what_this_implies_for_solution_design).map(clean).filter(Boolean).slice(0, 3));
    }

    case "differentiation": {
      const r = result as DifferentiationResult;
      add(issues, arr(r.direct_alternatives).length < 2, "high", "differentiation strength", "too few direct alternatives", "compare the product against real adjacent alternatives");
      add(issues, arr(r.indirect_workarounds).length < 2, "medium", "target user alignment", "few indirect workarounds", "include how the user solves this today without a product");
      add(issues, !clean(r.deeper_problem_not_solved), "high", "causal depth", "missing deeper unsolved problem", "state the problem alternatives fail to solve");
      add(issues, !clean(r.differentiation_thesis), "critical", "differentiation strength", "missing differentiation thesis", "write one causal thesis for why this wins");
      add(issues, !clean(r.proposed_product_advantage), "medium", "non-genericness", "advantage is not explicit", "name the product advantage without feature-list language");
      return finalize(engine, issues, repaired, [clean(r.differentiation_thesis)].filter(Boolean));
    }

    case "solution_families": {
      const r = result as SolutionFamiliesResult;
      const families = r.solution_families ?? [];
      add(issues, families.length < 3, "high", "downstream usefulness", "too few solution families", "generate at least three meaningfully different mechanism families");
      add(issues, families.some((f) => !clean(f.mechanism)), "high", "buildability", "a family lacks a mechanism", "define the behavior-changing mechanism for every family");
      add(issues, families.some((f) => !clean(f.attacks)), "medium", "root constraint alignment", "a family does not trace to a cause", "state which root cause or leverage point each family attacks");
      add(issues, !clean(r.recommended_family), "high", "constraint satisfaction", "no recommended family", "choose the strongest family and explain tradeoffs");
      add(issues, arr(r.risks).length < 2, "medium", "evidence honesty", "risks are thin", "state risks that could invalidate the family");
      return finalize(engine, issues, repaired, [clean(r.recommended_family)].filter(Boolean));
    }

    case "mvp_variations": {
      const r = result as MvpVariationsResult;
      const mvps = r.mvp_variations ?? [];
      add(issues, mvps.length < 3, "high", "downstream usefulness", "too few MVP directions", "generate at least three distinct app directions");
      add(issues, mvps.some((m) => !clean(m.core_mechanism)), "high", "buildability", "an MVP lacks a core mechanism", "define the simplest behavior-changing mechanism for every MVP");
      add(issues, mvps.some((m) => !clean(m.simplest_version)), "medium", "buildability", "an MVP lacks v0 scope", "draw a strict first-build boundary");
      add(issues, mvps.some((m) => !Number.isFinite(Number(m.value_score))), "medium", "evidence honesty", "MVP scores are missing", "score value-to-complexity and differentiation explicitly");
      add(issues, !clean(r.recommended_mvp), "critical", "constraint satisfaction", "no selected MVP", "select one MVP winner");
      return finalize(engine, issues, repaired, [clean(r.recommended_mvp)].filter(Boolean));
    }

    case "evaluation": {
      const r = result as EvaluationResult;
      const criteria = arr<{ name?: unknown; weight?: unknown }>(r.criteria);
      const candidates = arr<{
        name?: unknown;
        scores?: unknown;
        weighted_score?: unknown;
        confidence?: unknown;
      }>(r.candidates);
      const totalWeight = criteria.reduce(
        (sum, c) => sum + (Number.isFinite(Number(c.weight)) ? Number(c.weight) : 0),
        0,
      );
      const criterionNames = new Set(
        criteria.map((c) => clean(c.name)).filter(Boolean),
      );
      const candidatesMissingScores = candidates.filter((c) => {
        const scores =
          c.scores && typeof c.scores === "object"
            ? (c.scores as Record<string, unknown>)
            : null;
        if (!scores) return true;
        const scored = new Set(Object.keys(scores).filter((k) => Number.isFinite(Number(scores[k]))));
        for (const name of criterionNames) {
          if (!scored.has(name)) return true;
        }
        return false;
      }).length;
      add(issues, criteria.length < 6, "high", "rubric specificity", `only ${criteria.length} evaluation criteria`, "define 6–9 weighted criteria across user/problem/result/differentiation/buildability/risk");
      add(issues, totalWeight < 70 || totalWeight > 130, "medium", "rubric calibration", `criteria weights sum to ${Math.round(totalWeight)} (target ~100)`, "rebalance weights to roughly sum to 100");
      add(issues, candidates.length < 2, "critical", "narrowing strength", "fewer than 2 candidates scored", "score every MVP variation against the rubric");
      add(issues, criterionNames.size > 0 && candidatesMissingScores > 0, "high", "rubric coverage", `${candidatesMissingScores} candidate(s) missing scores`, "score every candidate on every criterion");
      add(issues, !clean(r.winner), "critical", "decision clarity", "no rubric winner", "name the highest-scoring candidate explicitly");
      const winnerCand = clean(r.winner)
        ? candidates.find(
            (c) => clean(c.name).toLowerCase() === clean(r.winner).toLowerCase(),
          )
        : undefined;
      add(issues, !!clean(r.winner) && !winnerCand, "high", "decision clarity", "rubric winner is not in the scored candidates list", "ensure the winner name matches one scored candidate exactly");
      add(issues, !clean(r.why_winner_won), "high", "evidence honesty", "winner lacks rationale", "explain which weighted criteria drove the win");
      add(issues, arr(r.why_others_lost).length < 1, "medium", "narrowing strength", "no losing rationales", "explain why each non-winner lost on at least one decisive criterion");
      add(issues, arr(r.tradeoffs).length < 2, "medium", "uncertainty visibility", "few tradeoffs surfaced", "name tensions no candidate dominates on");
      add(issues, arr(r.assumptions_that_could_reverse_decision).length < 2, "high", "uncertainty visibility", "few flip-the-decision assumptions", "list assumptions that would reverse the winner if false");
      add(issues, arr(r.constraints_passed_downstream).length < 1, "medium", "downstream usefulness", "no downstream constraints", "name constraints the winner imposes on build/validation");
      add(issues, !clean(r.confidence_level), "medium", "evidence honesty", "missing rubric confidence level", "state rubric confidence honestly (low/medium/high)");
      return finalize(
        engine,
        issues,
        repaired,
        arr(r.constraints_passed_downstream).map(clean).filter(Boolean).slice(0, 4),
      );
    }

    case "recommendation": {
      const r = result as RecommendationResult;
      add(issues, !clean(r.recommendation), "critical", "downstream usefulness", "missing recommended first build", "name the one first build");
      add(issues, !clean(r.why_this_won), "high", "evidence honesty", "winner lacks rationale", "explain the causal and differentiation basis for the winner");
      add(issues, arr(r.why_others_lost).length < 2, "medium", "constraint satisfaction", "losing options not explained", "state why alternatives lost");
      add(issues, arr(r.assumptions_to_test).length < 2, "medium", "uncertainty visibility", "few assumptions to test", "name assumptions that could reverse the decision");
      add(issues, !clean(r.next_best_action), "medium", "buildability", "missing next action", "state the immediate next validation or build action");
      // Constraint-citation discipline (paired with the recommendation prompt
      // update): the rationale should reference which constraints the build
      // satisfies. Soft keyword check — matches the prompt's required language
      // without needing the client-side accumulator state on the server.
      const rationale = clean(r.why_this_won).toLowerCase();
      const citesConstraints =
        /\bconstraint(s)?\b/.test(rationale) ||
        /\battacks?\b/.test(rationale) ||
        /\bsatisf(y|ies)\b/.test(rationale) ||
        /\broot[- ]?cause\b/.test(rationale);
      add(
        issues,
        clean(r.why_this_won).length > 60 && !citesConstraints,
        "medium",
        "constraint satisfaction",
        "rationale does not cite which constraints the winner satisfies",
        "name at least two critical constraints the recommended build attacks or satisfies",
      );
      return finalize(engine, issues, repaired, arr(r.assumptions_to_test).map(clean).filter(Boolean).slice(0, 3));
    }

    case "complexity_allocation": {
      const r = result as ComplexityAllocationResult;
      const b = r.budget;
      const scores = arr<ComplexityModuleScore>(r.module_scores);
      const over = arr<ComplexityWarning>(r.overbuilt_warnings);
      const under = arr<ComplexityWarning>(r.underbuilt_warnings);
      const realloc = arr<ComplexityReallocation>(r.reallocation_recommendations);
      const firstBuild = arr<string>(r.first_build_scope);
      const delayed = arr<string>(r.delayed_scope);
      const removed = arr<string>(r.removed_scope);

      // Critical — without these the engine fails its core spec.
      add(issues, !b, "critical", "downstream usefulness", "missing complexity_budget", "produce the six-bucket budget summing to ~100");
      add(issues, !scores.length, "critical", "downstream usefulness", "no module_scores produced", "score 6–10 candidate modules so feature_cards can route its decomposition");
      add(issues, !firstBuild.length, "critical", "downstream usefulness", "empty first_build_scope", "name the modules feature_cards MUST decompose into v1");
      add(issues, !clean(r.build_discipline_rule), "critical", "downstream usefulness", "missing build_discipline_rule", "give feature_cards / spec_export a 1–3 sentence verbatim rule to obey");

      // Budget arithmetic gate (spec §6 — must sum to ~100, total=100).
      if (b) {
        const sum =
          (Number(b.reasoning) || 0) +
          (Number(b.ui) || 0) +
          (Number(b.technical) || 0) +
          (Number(b.interaction) || 0) +
          (Number(b.data) || 0) +
          (Number(b.evaluation) || 0);
        add(issues, sum < 95 || sum > 105, "high", "evidence honesty", `bucket sum is ${Math.round(sum)} (target 100)`, "rebalance bucket budgets so they sum to 95–105");
        add(issues, Number(b.total) !== 100, "medium", "evidence honesty", "total ≠ 100", "set total to 100");
        add(issues, !clean(b.philosophy), "medium", "evidence honesty", "missing budget philosophy", "explain in one line why this allocation creates leverage for THIS product");
      }

      // Disjoint-scope rule (spec §13 — first_build_scope and delayed_scope can't overlap).
      const fbSet = new Set(firstBuild.map((s) => clean(s).toLowerCase()).filter(Boolean));
      const overlap = delayed.filter((d) => fbSet.has(clean(d).toLowerCase()));
      add(issues, overlap.length > 0, "high", "constraint satisfaction", `${overlap.length} module(s) in both first_build_scope and delayed_scope`, "scopes must be disjoint — pick one bucket per module");
      const removedInFb = removed.filter((d) => fbSet.has(clean(d).toLowerCase()));
      add(issues, removedInFb.length > 0, "high", "constraint satisfaction", "removed module appears in first_build_scope", "removed modules must not be in the first build");

      // Reasoning-heavy product gate (spec §6 — reasoning + evaluation ≥ 55 for narrowing-shaped MVPs).
      if (b) {
        const reasoningPlusEval = (Number(b.reasoning) || 0) + (Number(b.evaluation) || 0);
        const looksReasoningHeavy =
          /caus|reason|narrow|decision|model|spec|analy|plan|map|graph/i.test(
            clean(r.selected_mvp) + " " + clean(b.philosophy),
          );
        add(
          issues,
          looksReasoningHeavy && reasoningPlusEval < 55,
          "high",
          "constraint satisfaction",
          `reasoning+evaluation is ${Math.round(reasoningPlusEval)} for a reasoning-shaped MVP`,
          "raise reasoning + evaluation to ≥55 for narrowing/decision-support products (spec §6)",
        );
        add(
          issues,
          looksReasoningHeavy && (Number(b.ui) || 0) > 25,
          "medium",
          "constraint satisfaction",
          `ui budget is ${Math.round(Number(b.ui) || 0)} for a reasoning-shaped MVP`,
          "keep ui ≤25 until value proves out (spec §6)",
        );
      }

      // Warning-side discipline (spec §11–12 — both lists must be populated thoughtfully).
      add(issues, !over.length, "high", "evidence honesty", "no overbuilt warnings", "early MVPs always overbuild SOMETHING — name the downstream surface module being overbuilt");
      add(issues, !under.length, "high", "evidence honesty", "no underbuilt warnings", "name at least one upstream reasoning module that needs more depth");

      // Provenance: every name in any list MUST appear in module_scores.
      const scored = new Set(scores.map((s) => clean(s?.module_name).toLowerCase()).filter(Boolean));
      const nameOrphans: string[] = [];
      for (const n of [
        ...over.map((w) => clean(w?.module)),
        ...under.map((w) => clean(w?.module)),
        ...realloc.flatMap((rr) => [clean(rr?.reduce), clean(rr?.increase)]),
        ...firstBuild.map(clean),
        ...delayed.map(clean),
        ...removed.map(clean),
      ]) {
        if (n && !scored.has(n.toLowerCase())) nameOrphans.push(n);
      }
      add(
        issues,
        nameOrphans.length > 0,
        "high",
        "evidence honesty",
        `${nameOrphans.length} module(s) named in lists but missing from module_scores: ${nameOrphans.slice(0, 3).join(", ")}`,
        "every named module must appear in module_scores with explicit complexity-to-value ratio",
      );

      // Spec §13 examples — at least ONE upstream reasoning module underbuilt-warned.
      const reasoningKeywords = /caus|reason|converg|evaluation|differentiat|constraint|target.user|problem|desired.result/i;
      const reasoningUnder = under.some((w) => reasoningKeywords.test(clean(w?.module)));
      add(issues, under.length > 0 && !reasoningUnder, "medium", "constraint satisfaction", "no upstream reasoning module flagged as underbuilt", "spec §12: shallow upstream reasoning is the most common SpecForge failure — name one");

      // Spec §11 examples — at least ONE downstream surface module overbuilt-warned.
      const surfaceKeywords = /graph.view|spec.export|collabor|research.automation|onboarding|advanced.ui|visualiz|side.panel|whiteboard.unfurl/i;
      const surfaceOver = over.some((w) => surfaceKeywords.test(clean(w?.module)));
      add(issues, over.length > 0 && !surfaceOver, "medium", "constraint satisfaction", "no downstream surface module flagged as overbuilt", "spec §11: visualization / spec export / collaboration are common early overbuilds — name one");

      add(issues, !Number.isFinite(Number(r.confidence)), "medium", "evidence honesty", "missing confidence", "state allocation confidence 0–100 honestly");

      // Context strip — the discipline rule + first_build line is what downstream
      // engines (feature_cards + spec_export) actually need to see.
      const ctx = [
        firstBuild.map(clean).filter(Boolean).slice(0, 3).join(", "),
        clean(r.build_discipline_rule),
      ].filter(Boolean);
      return finalize(engine, issues, repaired, ctx);
    }

    case "feature_cards": {
      const r = result as FeatureCardsResult;
      const features = arr<FeatureCard>(r.features);
      add(issues, !features.length, "critical", "downstream usefulness", "no feature cards produced", "decompose the selected MVP into 3–5 traceable features");
      add(issues, features.length === 1, "high", "downstream usefulness", "only one feature card", "a single-feature MVP is rarely a feature SET — produce at least 3");

      const missingTrace = features.filter((f) => !clean(f?.root_cause_attacked)).length;
      add(issues, missingTrace > 0, "high", "causal alignment", `${missingTrace} feature${missingTrace === 1 ? "" : "s"} lack root_cause_attacked`, "cite the problem_tree node each feature attacks — generic 'user pain' fails");

      const missingMicro = features.filter((f) => !clean(f?.micro_objective)).length;
      add(issues, missingMicro > 0, "high", "causal alignment", `${missingMicro} feature${missingMicro === 1 ? "" : "s"} lack a micro_objective`, "name the user behavior change each feature unlocks");

      const missingMech = features.filter((f) => !clean(f?.mechanism_summary)).length;
      add(issues, missingMech > 0, "high", "evidence honesty", `${missingMech} feature${missingMech === 1 ? "" : "s"} lack a mechanism_summary`, "give each feature a 1–2 sentence mechanism summary");

      const mustHave = features.filter((f) => String(f?.build_priority) === "must_have");
      add(issues, !mustHave.length, "high", "downstream usefulness", "no must_have features", "a build with no must_have feature has no spine — mark at least one must_have");

      const totalRejected = features
        .map((f) => arr<string>(f?.rejected_alternatives).map(clean).filter(Boolean).length)
        .reduce((a, b) => a + b, 0);
      add(issues, totalRejected < 2, "medium", "evidence honesty", "no rejected mechanism alternatives across the set", "name at least 2 rejected mechanisms across all features to show causal rigor");

      const mustHaveMissingMetric = mustHave.filter((f) => !clean(f?.evaluation_metric)).length;
      add(issues, mustHaveMissingMetric > 0, "medium", "evidence honesty", `${mustHaveMissingMetric} must_have feature${mustHaveMissingMetric === 1 ? "" : "s"} lack an evaluation_metric`, "every must_have feature needs a measurable signal that it's working");

      // Generic-feature-name guard (catches "Dashboard", "Settings", etc.)
      const generic = features.filter((f) => {
        const name = clean(f?.name).toLowerCase();
        return /^(dashboard|settings|profile|home|onboarding|help|admin)$/.test(name);
      }).length;
      add(issues, generic > 0, "medium", "downstream usefulness", `${generic} feature${generic === 1 ? "" : "s"} are generic CRUD names`, "rename generic features after the mechanism they actually run, not the screen they live on");

      add(issues, !clean(r.selected_mvp), "high", "constraint satisfaction", "selected_mvp not echoed from recommendation", "echo recommendation.recommendation verbatim into selected_mvp");
      add(issues, arr<string>(r.first_user_flow).filter(Boolean).length < 2, "medium", "downstream usefulness", "first_user_flow is empty or under-decomposed", "list the 2–4 features that together enable the first user task");

      add(issues, features.length < 3, "medium", "downstream usefulness", "fewer than 3 features", "a first build is usually 3–5 features — consider decomposing further");
      add(issues, !Number.isFinite(Number(r.confidence)), "medium", "evidence honesty", "missing confidence", "state confidence 0–100 honestly on this decomposition");

      const ctx = mustHave.slice(0, 3).map((f) => clean(f.name)).filter(Boolean);
      return finalize(engine, issues, repaired, ctx);
    }

    case "feature_mechanisms": {
      const r = result as FeatureMechanismsResult;
      const mechs = arr<FeatureMechanism>(r.mechanisms);
      // Spec §19 quality gates — critical first.
      add(issues, !mechs.length, "critical", "downstream usefulness", "no feature mechanisms produced", "design at least 2 mechanisms tied to features in feature_cards");
      const missingFeatureLink = mechs.filter((m) => !clean(m?.feature_name)).length;
      add(issues, missingFeatureLink > 0, "critical", "constraint satisfaction", `${missingFeatureLink} mechanism${missingFeatureLink === 1 ? "" : "s"} not linked to a feature_card`, "every mechanism must echo a feature_cards.features[i].name");
      const missingProcess = mechs.filter(
        (m) => arr<string>(m?.system_process).filter(Boolean).length < 3,
      ).length;
      add(issues, missingProcess > 0, "critical", "downstream usefulness", `${missingProcess} mechanism${missingProcess === 1 ? "" : "s"} have fewer than 3 ordered process steps`, "decompose each mechanism into trigger → input → ordered steps → output (spec §6 layers)");
      const missingOutputs = mechs.filter(
        (m) => arr<string>(m?.outputs).filter(Boolean).length === 0,
      ).length;
      add(issues, missingOutputs > 0, "critical", "downstream usefulness", `${missingOutputs} mechanism${missingOutputs === 1 ? "" : "s"} produce no outputs`, "every mechanism must transform inputs into a named output artifact (spec §12)");

      // High severity — mechanism rigor.
      const missingTrigger = mechs.filter((m) => !clean(m?.trigger)).length;
      add(issues, missingTrigger > 0, "high", "downstream usefulness", `${missingTrigger} mechanism${missingTrigger === 1 ? "" : "s"} have no trigger`, "name what starts each mechanism (user action, event, or upstream artifact)");
      const fewAlternatives = mechs.filter(
        (m) => arr(m?.alternatives).length < 2,
      ).length;
      add(issues, fewAlternatives > 0, "high", "evidence honesty", `${fewAlternatives} mechanism${fewAlternatives === 1 ? "" : "s"} compared fewer than 2 alternatives`, "per spec §16, compare at least 2 alternatives and state why the selected one won");
      const missingFailures = mechs.filter(
        (m) => arr<string>(m?.failure_modes).filter(Boolean).length === 0,
      ).length;
      add(issues, missingFailures > 0, "high", "evidence honesty", `${missingFailures} mechanism${missingFailures === 1 ? "" : "s"} have no failure modes`, "per spec §15, name 2+ ways each mechanism can fail and 1+ risk control");
      const shallowTest = mechs.filter((m) => {
        const t = clean(m?.test_method).toLowerCase();
        return !t || t === "user feedback" || t === "feedback" || t.length < 20;
      }).length;
      add(issues, shallowTest > 0, "high", "downstream usefulness", `${shallowTest} mechanism${shallowTest === 1 ? "" : "s"} have shallow test_method`, "name a specific test the validation lab could lift as an experiment (not 'user feedback')");

      // Medium severity.
      const missingBehavior = mechs.filter((m) => !clean(m?.user_behavior_changed)).length;
      add(issues, missingBehavior > 0, "medium", "downstream usefulness", `${missingBehavior} mechanism${missingBehavior === 1 ? "" : "s"} don't change user behavior`, "spec §13: if no behavior changes, the mechanism is weak — name what the user does differently");
      const missingDifficulty = mechs.filter((m) => !clean(m?.implementation_difficulty)).length;
      add(issues, missingDifficulty > 0, "medium", "buildability", `${missingDifficulty} mechanism${missingDifficulty === 1 ? "" : "s"} missing implementation_difficulty`, "rate each mechanism low/medium/high based on whether net-new infra is needed");
      add(issues, !Number.isFinite(Number(r.confidence)), "medium", "evidence honesty", "missing confidence", "state confidence 0–100 honestly on this mechanism plan");

      const ctx = mechs.slice(0, 3).map((m) => clean(m?.mechanism_name)).filter(Boolean);
      return finalize(engine, issues, repaired, ctx);
    }

    case "data_points": {
      const r = result as DataPointsResult;
      const pts = arr<DataPoint>(r.data_points);
      const kept = pts.filter((p) => p && String(p?.disposition) !== "removed");
      // Critical: no data points means the engine effectively didn't run.
      add(issues, !pts.length, "critical", "downstream usefulness", "no data points produced", "extract a data point from each unique input across feature_mechanisms.mechanisms[].inputs");
      // Critical: every data point must trace back to a mechanism (spec §3 +
      // anti-duplication rule in the prompt).
      const untraced = pts.filter((p) => !clean(p?.used_by_mechanism)).length;
      add(issues, untraced > 0, "critical", "downstream usefulness", `${untraced} data point${untraced === 1 ? "" : "s"} not traced to a mechanism`, "set used_by_mechanism to a mechanism name from feature_mechanisms — orphan data is forbidden");
      // High: every why_it_exists must reference a downstream consumer (spec §6.7).
      const missingWhy = pts.filter((p) => !clean(p?.why_it_exists)).length;
      add(issues, missingWhy > 0, "high", "evidence honesty", `${missingWhy} data point${missingWhy === 1 ? "" : "s"} missing why_it_exists`, "spec §6.7: no data without a stated downstream consumer (or set disposition='removed')");
      // High: every REQUIRED data point must propose alternative_proxies (spec §9).
      const requiredWithoutProxies = pts.filter(
        (p) =>
          String(p?.disposition) === "required" &&
          arr<string>(p?.alternative_proxies).filter(Boolean).length < 1,
      ).length;
      add(issues, requiredWithoutProxies > 0, "high", "downstream usefulness", `${requiredWithoutProxies} required data point${requiredWithoutProxies === 1 ? "" : "s"} have no alternative_proxies`, "spec §9: every required data point must consider a lower-friction proxy — name at least one");
      // High: variables[] must decompose the concept (spec §6.2 prevents vague data).
      const noVariables = kept.filter((p) => arr<string>(p?.variables).filter(Boolean).length < 2).length;
      add(issues, noVariables > 0, "high", "downstream usefulness", `${noVariables} data point${noVariables === 1 ? "" : "s"} have <2 decomposed variables`, "spec §6.2: a single-variable concept is usually too vague — decompose into 2+ named variables");
      // High: high-friction data must justify itself with strong downstream uses (spec §6.4).
      const highFrictionThin = kept.filter(
        (p) =>
          String(p?.collection_friction) === "high" &&
          arr<string>(p?.downstream_uses).filter(Boolean).length < 2,
      ).length;
      add(issues, highFrictionThin > 0, "high", "constraint satisfaction", `${highFrictionThin} high-friction data point${highFrictionThin === 1 ? "" : "s"} have <2 downstream uses`, "spec §6.4 rule: do not collect high-friction data unless it strongly improves downstream output — add downstream uses or set disposition to proxy/removed");
      // Medium: every data point should name failure_modes (spec §6.10).
      const noFailures = kept.filter((p) => arr<string>(p?.failure_modes).filter(Boolean).length < 1).length;
      add(issues, noFailures > 0, "medium", "uncertainty visibility", `${noFailures} data point${noFailures === 1 ? "" : "s"} have no failure_modes`, "spec §6.10: name 1–2 ways the data can be missing/wrong/sensitive");
      // Medium: every data point should impose at least one downstream constraint.
      const noConstraints = kept.filter((p) => arr<string>(p?.constraints_created).filter(Boolean).length < 1).length;
      add(issues, noConstraints > 0, "medium", "constraint satisfaction", `${noConstraints} data point${noConstraints === 1 ? "" : "s"} create no downstream constraint`, "name the constraint each data point imposes on the build (e.g., 'must support optional skip with no-degradation fallback')");
      // Medium: data_flow_summary must exist for the spec exporter.
      add(issues, !clean(r.data_flow_summary), "medium", "downstream usefulness", "missing data_flow_summary", "write a 1–2 sentence upstream → collection → transform → mechanism → downstream summary");
      add(issues, !Number.isFinite(Number(r.confidence)), "medium", "evidence honesty", "missing confidence", "state confidence 0–100 honestly on this data plan");

      const ctx = kept.slice(0, 3).map((p) => clean(p?.name)).filter(Boolean);
      return finalize(engine, issues, repaired, ctx);
    }

    case "layer_optimization": {
      const r = result as LayerOptimizationResult;
      const macro = (r.macro ?? {}) as LayerNode;
      const micros = arr<LayerNode>(r.micros);
      const mechs = arr<LayerNode>(r.mechanisms);
      const checks = arr<LayerAlignmentCheck>(r.alignment_checks);
      const conseq = arr<ConsequentialEvaluation>(r.consequential_evaluations);

      // Critical: macro must exist with an objective. Without it, no vertical
      // alignment is meaningful (every check would compare against nothing).
      add(issues, !clean(macro?.objective), "critical", "downstream usefulness", "missing macro objective", "lift convergence.distilled_product_thesis (or recommendation.recommendation) as macro.objective");

      // Critical (spec §14): at least one micro AND one mechanism are required
      // for the audit to mean anything. An empty stack is not "aligned" — it's
      // not even auditable.
      add(issues, !micros.length, "critical", "downstream usefulness", "no micro layer nodes", "produce one micro node per feature_cards.features[] entry");
      add(issues, !mechs.length, "critical", "downstream usefulness", "no mechanism layer nodes", "produce one mechanism node per feature_mechanisms.mechanisms[] entry");

      // High: every micro/mechanism MUST have its parent set, OR the layer is
      // orphaned. This is the central anti-orphan rule of recursive layering
      // (spec §6 schema field is required for a reason).
      const orphanedMicros = micros.filter((m) => !clean(m?.parent)).length;
      const orphanedMechs = mechs.filter((m) => !clean(m?.parent)).length;
      add(issues, orphanedMicros > 0, "high", "downstream usefulness", `${orphanedMicros} micro node(s) missing parent`, "set every micro.parent to the macro objective");
      add(issues, orphanedMechs > 0, "high", "downstream usefulness", `${orphanedMechs} mechanism node(s) missing parent`, "set every mechanism.parent to the feature_name it links to");

      // High: every layer node must pass constraints downstream (spec §5.5).
      // If 'constraints_passed_down' is empty, that layer is a dead-end —
      // downstream engines lose the narrowing they need.
      const noDownMicros = micros.filter((m) => !arr<string>(m?.constraints_passed_down).filter(Boolean).length).length;
      add(issues, noDownMicros > 0, "high", "constraint satisfaction", `${noDownMicros} micro node(s) pass no constraints downstream`, "each micro must name at least one constraint the mechanism layer must obey");

      // High: alignment check COVERAGE (spec §4.4). For the audit to mean
      // anything, every micro should be checked against the macro and every
      // mechanism against its micro. We let one or two missing pass as a
      // medium issue; broad gaps fail high.
      const microChecks = checks.filter((c) => clean(c?.edge) === "micro_to_macro").length;
      const mechChecks = checks.filter((c) => clean(c?.edge) === "mechanism_to_micro").length;
      const microCoverageGap = Math.max(0, micros.length - microChecks);
      const mechCoverageGap = Math.max(0, mechs.length - mechChecks);
      add(issues, microCoverageGap >= Math.max(1, Math.ceil(micros.length / 2)), "high", "downstream usefulness", `${microCoverageGap} micro(s) not checked against macro`, "produce one micro_to_macro alignment_check per micro node");
      add(issues, mechCoverageGap >= Math.max(1, Math.ceil(mechs.length / 2)), "high", "downstream usefulness", `${mechCoverageGap} mechanism(s) not checked against parent feature`, "produce one mechanism_to_micro alignment_check per mechanism node");

      // High: drifted/broken checks MUST have a non-generic
      // repair_recommendation. Without it, "drift" is just naming — not
      // actionable for validation to lift.
      const driftedNoRepair = checks
        .filter((c) => ["drifted", "broken"].includes(String(c?.verdict)))
        .filter((c) => !clean(c?.repair_recommendation)).length;
      add(issues, driftedNoRepair > 0, "high", "evidence honesty", `${driftedNoRepair} drifted/broken check(s) without a repair recommendation`, "for every drifted or broken alignment, name a CONCRETE repair (replace X with mechanism that targets Y) — not generic advice");

      // High (spec §9): four consequential handoffs are required —
      // recommendation→feature_cards, feature_cards→feature_mechanisms,
      // feature_mechanisms→data_points, data_points→validation. Anything less
      // means the engine is not auditing the whole spine.
      const expectedHandoffs = new Set([
        "recommendation>feature_cards",
        "feature_cards>feature_mechanisms",
        "feature_mechanisms>data_points",
        "data_points>validation",
      ]);
      const seenHandoffs = new Set(
        conseq
          .map((c) => `${clean(c?.current_layer)}>${clean(c?.next_layer)}`)
          .filter((s) => !s.startsWith(">")),
      );
      const missingHandoffs = [...expectedHandoffs].filter((h) => !seenHandoffs.has(h));
      add(issues, missingHandoffs.length > 0, "high", "downstream usefulness", `${missingHandoffs.length} required consequential handoff(s) missing`, `produce a consequential_evaluation for each of: ${missingHandoffs.join(", ")}`);

      // Medium: consequential evaluations need concrete improvements/risks.
      // Generic "improves quality" doesn't help anyone downstream.
      const genericConseq = conseq.filter(
        (c) =>
          !clean(c?.downstream_improvement) ||
          !clean(c?.downstream_risk_if_wrong),
      ).length;
      add(issues, genericConseq > 0, "medium", "evidence honesty", `${genericConseq} consequential evaluation(s) missing improvement or risk`, "name the SPECIFIC improvement and risk for each handoff — not generic phrases");

      // High: drifted/broken alignment MUST surface in layers_to_repair.
      // Otherwise the engine has identified a problem and abandoned it.
      const driftedNames = new Set(
        checks
          .filter((c) => ["drifted", "broken"].includes(String(c?.verdict)))
          .map((c) => clean(c?.child))
          .filter(Boolean),
      );
      const repairs = arr<{ name?: unknown; reason?: unknown }>(r.layers_to_repair);
      const repairNames = new Set(repairs.map((x) => clean(x?.name)).filter(Boolean));
      const driftedNotRepaired = [...driftedNames].filter((n) => !repairNames.has(n)).length;
      add(issues, driftedNotRepaired > 0, "high", "downstream usefulness", `${driftedNotRepaired} drifted/broken layer(s) not in layers_to_repair`, "every drifted or broken alignment child must appear in layers_to_repair with a concrete reason");

      // Medium: alignment_summary must exist — it's the one-line surface
      // the user reads at a glance.
      add(issues, !clean(r.alignment_summary), "medium", "downstream usefulness", "missing alignment_summary", "one sentence stating macro→micro→mechanism alignment honestly");

      // Medium (spec §11): if any check is broken OR more than 30% drifted,
      // confidence MUST be ≤55. Overclaiming alignment is the failure mode.
      const drifted = checks.filter((c) => String(c?.verdict) === "drifted").length;
      const broken = checks.filter((c) => String(c?.verdict) === "broken").length;
      const driftRate = checks.length > 0 ? drifted / checks.length : 0;
      const conf = Number(r.confidence);
      add(
        issues,
        (broken > 0 || driftRate > 0.3) && Number.isFinite(conf) && conf > 55,
        "high",
        "evidence honesty",
        `confidence ${Math.round(conf)} with ${broken} broken / ${drifted} drifted alignment(s)`,
        "alignment honesty: cap confidence ≤55 when any check is broken or >30% are drifted",
      );
      add(issues, !Number.isFinite(Number(r.confidence)), "medium", "evidence honesty", "missing confidence", "state alignment confidence 0–100 honestly");

      // Context strip downstream: top drifted/broken layer names so
      // validation can lift them into experiments (closes the loop with the
      // updated validation prompt).
      const driftedCtx = [...driftedNames].slice(0, 3);
      return finalize(engine, issues, repaired, driftedCtx);
    }

    case "validation": {
      const r = result as ValidationResult;
      const assumptions = arr<ValidationAssumption>(r.critical_assumptions);
      const experiments = arr<ValidationExperiment>(r.experiments);
      add(issues, !experiments.length, "critical", "downstream usefulness", "no experiments produced", "design at least 2 ranked experiments tied to the riskiest assumptions");
      add(issues, !assumptions.length, "critical", "evidence honesty", "no critical assumptions surfaced", "lift 3–5 assumptions from recommendation.assumptions_to_test and evaluation.assumptions_that_could_reverse_decision");

      // Per-experiment structural quality (spec §13 quality gates).
      const missingHypothesis = experiments.filter((e) => !clean(e?.hypothesis)).length;
      const missingSuccess = experiments.filter((e) => !arr<string>(e?.success_criteria).map(clean).filter(Boolean).length).length;
      const missingFailure = experiments.filter((e) => !arr<string>(e?.failure_criteria).map(clean).filter(Boolean).length).length;
      const missingDecision = experiments.filter((e) => !clean(e?.decision_that_result_will_change)).length;
      const missingAssumption = experiments.filter((e) => !clean(e?.assumption_tested)).length;
      add(issues, missingHypothesis > 0, "high", "evidence honesty", `${missingHypothesis} experiment(s) missing hypothesis`, "every experiment needs a 'We believe X. If we Y, then Z, because W.' hypothesis");
      add(issues, missingSuccess > 0, "high", "evidence honesty", `${missingSuccess} experiment(s) missing success criteria`, "each experiment needs 1–3 concrete success criteria");
      add(issues, missingFailure > 0, "high", "evidence honesty", `${missingFailure} experiment(s) missing failure criteria`, "each experiment needs 1–2 concrete failure criteria");
      add(issues, missingDecision > 0, "critical", "downstream usefulness", `${missingDecision} experiment(s) won't change a decision`, "an experiment that changes no decision is theatrical — replace it with one that does");
      add(issues, missingAssumption > 0, "high", "evidence honesty", `${missingAssumption} experiment(s) don't name the assumption tested`, "name the exact assumption each experiment tests");

      // Spec §12 hard rule: don't test downstream features before upstream
      // user/problem/result. Heuristic — if any feature_mechanism / data_point
      // experiment is ranked before any target_user / problem / desired_result
      // experiment, flag it.
      const ordered = experiments
        .slice()
        .sort((a, b) => (Number(a?.priority_rank) || 99) - (Number(b?.priority_rank) || 99));
      const upstreamCats = new Set(["target_user", "problem", "desired_result", "differentiation"]);
      let earliestUpstream = Infinity;
      let earliestDownstream = Infinity;
      for (let i = 0; i < ordered.length; i++) {
        const exp = ordered[i];
        const matchedAssumption = assumptions.find(
          (a) => clean(a?.text) && clean(exp?.assumption_tested).includes(clean(a.text).slice(0, 20)),
        );
        const cat = clean(matchedAssumption?.category);
        if (upstreamCats.has(cat) && i < earliestUpstream) earliestUpstream = i;
        if ((cat === "feature_mechanism" || cat === "data_point") && i < earliestDownstream) earliestDownstream = i;
      }
      add(
        issues,
        earliestDownstream < earliestUpstream && earliestUpstream !== Infinity,
        "high",
        "constraint satisfaction",
        "downstream-feature experiment ranked before upstream user/problem test",
        "reorder: test target-user urgency, root problem, and desired-result value FIRST per spec §12",
      );

      add(issues, !clean(r.hard_prioritization_notes), "medium", "buildability", "missing prioritization rationale", "state the user→problem→result→differentiation→MVP→feature ordering rule");
      add(issues, arr<string>(r.model_update_rules).length < 2, "medium", "downstream usefulness", "few model update rules", "name 2–4 rules for how experiment results would update the reasoning model");
      add(issues, !Number.isFinite(Number(r.confidence)), "medium", "evidence honesty", "missing validation confidence", "state honest 0–100 confidence in the plan's coverage of riskiest assumptions");

      // Constraints passed downstream: each top experiment becomes an
      // evidence-required constraint on the build.
      const evidenceConstraints = ordered
        .slice(0, 2)
        .map((e) => `Evidence required: ${clean(e?.assumption_tested) || clean(e?.name)}`)
        .filter((s) => s.split(": ")[1]);
      return finalize(engine, issues, repaired, evidenceConstraints);
    }

    case "deepening": {
      const r = result as DeepeningResult;
      const baselines = arr<DeepeningBaseline>(r.baselines);
      const uncertainties = arr<DeepeningUncertainty>(r.uncertainties_remaining);
      const next = r.next_recommended_iteration;
      const conf = Number(r.confidence);
      const confOk = Number.isFinite(conf);

      add(issues, !clean(r.summary), "high", "downstream usefulness", "missing iteration summary", "write a one-sentence narrative of what this iteration produced");
      add(issues, baselines.length < 6, "high", "downstream usefulness", `only ${baselines.length} baselines (spec requires 6–10)`, "capture baselines across target_user, problem_causal, desired_result, differentiation, mvp_direction, validation_evidence at minimum");
      add(issues, !clean(r.value_added), "high", "evidence honesty", "missing value_added narrative", "name what concrete decision-support value this run added using the spec §7 vocabulary");
      add(issues, !next || !clean(next.action), "critical", "downstream usefulness", "missing next_recommended_iteration.action", "name ONE concrete next refinement — the whole iteration timeline depends on this");
      add(issues, !next || !clean(next.why_highest_leverage), "high", "evidence honesty", "next iteration lacks rationale", "cite which baseline is shallow or which uncertainty has the largest impact_on_recommendation");
      add(issues, !next || !clean(next.expected_value_category), "medium", "downstream usefulness", "next iteration missing expected_value_category", "name the expected value category from spec §7 (depth_increased, uncertainty_reduced, etc.)");
      add(issues, uncertainties.length < 3, "medium", "uncertainty visibility", `only ${uncertainties.length} uncertainties_remaining`, "name 3–5 scalar uncertainties (not questions) with impact_on_recommendation");

      // Calibration: spec says confidence cannot exceed 70 if validation_evidence
      // baseline is still shallow. This is the spec's anti-overconfidence guard.
      const valEvBaseline = baselines.find((b) => clean(b?.dimension) === "validation_evidence");
      const shallowValEv = valEvBaseline && clean(valEvBaseline.depth) === "shallow";
      add(
        issues,
        Boolean(shallowValEv && confOk && conf > 70),
        "high",
        "evidence honesty",
        `confidence ${Math.round(conf)} exceeds 70 with shallow validation_evidence`,
        "cap confidence at 70 until validation evidence has been gathered",
      );
      add(issues, !confOk, "medium", "evidence honesty", "missing iteration confidence", "state an honest 0–100 model-readiness confidence");

      // Discipline: deepening must reference real dimensions from the spec
      // vocabulary, not freeform strings. Catches generic non-causal output.
      const allowedDims = new Set<string>([
        "target_user", "problem_causal", "desired_result", "differentiation",
        "mvp_direction", "feature_mechanism", "data_model", "evaluation_rigor",
        "validation_evidence", "build_readiness",
      ]);
      const offDimBaselines = baselines.filter(
        (b) => clean(b?.dimension) && !allowedDims.has(clean(b.dimension)),
      ).length;
      add(
        issues,
        offDimBaselines > 0,
        "medium",
        "downstream usefulness",
        `${offDimBaselines} baseline(s) use off-vocabulary dimensions`,
        "use only the spec §8 deepening dimensions (target_user, problem_causal, …, build_readiness)",
      );

      // Deepening doesn't pass new constraints downstream — its output is the
      // iteration snapshot itself. Quality strip stays empty.
      return finalize(engine, issues, repaired, []);
    }

    case "spec_export": {
      // Per specforge_spec_exporter_build_instruction_generator.md §20:
      // a spec FAILS if any of {causal trace, target user, root constraint,
      // desired result, differentiation thesis, MVP direction, feature
      // cards traceable, mechanisms, data model, quality gates, validation,
      // build tasks scoped, delayed scope explicit, acceptance criteria}
      // is missing or vague. We enforce the structural slice deterministically.
      const r = result as SpecExportResult;
      const summary = r.product_summary ?? ({} as SpecExportResult["product_summary"]);
      const trace = arr<SpecExportCausalTraceRow>(r.causal_trace);
      const scope = r.first_build_scope ?? ({} as SpecExportResult["first_build_scope"]);
      const features = arr<SpecExportFeatureRequirement>(r.feature_requirements);
      const mechanisms = arr<SpecExportMechanismRequirement>(r.mechanism_requirements);
      const tasks = arr<SpecExportImplementationTask>(r.implementation_tasks);
      const acceptance = arr<string>(r.acceptance_criteria);
      const userFlow = arr<string>(r.user_flow);

      // §20 critical anchors — these must exist or the spec is unbuildable.
      add(issues, !clean(summary?.primary_target_user), "critical", "downstream usefulness", "spec missing primary_target_user", "lift it from target_user.primary_segment");
      add(issues, !clean(summary?.root_constraint), "critical", "root constraint alignment", "spec missing root_constraint", "lift it from convergence.root_constraint");
      add(issues, !clean(summary?.primary_desired_result), "critical", "downstream usefulness", "spec missing primary_desired_result", "lift it from desired_result.functional_result");
      add(issues, !clean(summary?.differentiation_thesis), "critical", "differentiation defensibility", "spec missing differentiation_thesis", "lift it from differentiation.differentiation_thesis");
      add(issues, !clean(summary?.selected_mvp), "critical", "downstream usefulness", "spec missing selected_mvp", "lift it from recommendation.recommendation");
      add(issues, trace.length < 6, "critical", "downstream usefulness", `causal_trace has only ${trace.length} row(s) (need 6+)`, "restate target_user, root_constraint, desired_result, differentiation, MVP, feature_cards, validation as distinct trace rows");

      // §20 high — provenance + traceability rules.
      const tracelessTraceRows = trace.filter(
        (t) => !clean(t?.artifact) || !clean(t?.build_implication),
      ).length;
      add(issues, tracelessTraceRows > 0, "high", "evidence honesty", `${tracelessTraceRows} causal_trace row(s) missing artifact or build_implication`, "every trace row must cite an upstream artifact AND state the build implication it creates");

      add(issues, features.length < 1, "high", "downstream usefulness", "no feature_requirements", "lift one requirement per must_have / should_have feature from feature_cards");
      const featuresMissingLinks = features.filter(
        (f) => !clean(f?.macro_objective_served) || !clean(f?.root_cause_attacked),
      ).length;
      add(issues, featuresMissingLinks > 0, "high", "downstream usefulness", `${featuresMissingLinks} feature(s) missing causal back-references`, "every feature_requirement must name macro_objective_served + root_cause_attacked (spec §12)");

      add(issues, mechanisms.length < 1, "high", "downstream usefulness", "no mechanism_requirements", "lift one requirement per top-priority mechanism from feature_mechanisms");

      add(issues, tasks.length < 3, "high", "buildability", `only ${tasks.length} implementation_task(s) — too thin to build from`, "decompose the must_build_now scope into 4+ concrete tasks");

      // §18: every task must have provenance back to a feature or mechanism.
      // Take feature/mechanism names case-insensitively for the membership check.
      const featureNames = new Set(
        features
          .map((f) => clean(f?.feature_name).toLowerCase())
          .filter(Boolean),
      );
      const mechanismNames = new Set(
        mechanisms
          .map((m) => clean(m?.mechanism_name).toLowerCase())
          .filter(Boolean),
      );
      const orphanTasks = tasks.filter((t) => {
        const src = clean(t?.source).toLowerCase();
        if (!src) return true;
        if (t?.source_kind === "feature") return !featureNames.has(src);
        if (t?.source_kind === "mechanism") return !mechanismNames.has(src);
        return true; // missing or invalid source_kind
      }).length;
      add(issues, orphanTasks > 0, "critical", "evidence honesty", `${orphanTasks} implementation_task(s) lack provenance to a feature or mechanism`, "every task's source must EXACTLY match a feature_requirements.feature_name (source_kind:feature) or mechanism_requirements.mechanism_name (source_kind:mechanism)");

      const tasksMissingAcceptance = tasks.filter(
        (t) => arr<string>(t?.acceptance_criteria).map(clean).filter(Boolean).length < 1,
      ).length;
      add(issues, tasksMissingAcceptance > 0, "high", "evidence honesty", `${tasksMissingAcceptance} task(s) have no testable acceptance criteria`, "name at least one testable acceptance criterion per task (no 'works well')");

      // §20: first-build scope split is required.
      const mustNow = arr<string>(scope?.must_build_now).map(clean).filter(Boolean);
      const mustDelay = arr<string>(scope?.must_delay).map(clean).filter(Boolean);
      add(issues, mustNow.length < 1, "high", "downstream usefulness", "first_build_scope.must_build_now is empty", "name the smallest sequence of features required to enable the first user flow");
      add(issues, mustDelay.length < 1, "medium", "downstream usefulness", "first_build_scope.must_delay is empty", "spec §8 requires an explicit delayed scope — name features delayed past v1");

      add(issues, acceptance.map(clean).filter(Boolean).length < 3, "high", "evidence honesty", "<3 product-level acceptance criteria", "name 4–8 testable product-level criteria (NOT per-task)");

      add(issues, userFlow.map(clean).filter(Boolean).length < 4, "medium", "downstream usefulness", "user_flow is under-decomposed", "list 5–10 ordered steps lifted from feature_cards.first_user_flow + mechanism triggers");

      // §19: the coding_agent_prompt is the synthesized export. It must
      // include the three hard rules verbatim, and be long enough to be a
      // real instruction (not a one-liner).
      const prompt = clean(r.coding_agent_prompt);
      add(issues, !prompt, "critical", "downstream usefulness", "missing coding_agent_prompt", "synthesize a single string prompt (1500+ chars) covering goal, scope, non-goals, architecture, features, build order");
      add(issues, prompt.length > 0 && prompt.length < 600, "high", "downstream usefulness", `coding_agent_prompt is too short (${prompt.length} chars)`, "the prompt must cover goal, scope, non-goals, architecture, features, build order — at least 1500 chars");
      const hasDoNotBuildDelayed = /do not build delayed features/i.test(prompt);
      const hasDoNotGeneric = /do not create generic cards/i.test(prompt);
      const hasQualityGate = /quality gate status/i.test(prompt);
      const missingRules = [
        !hasDoNotBuildDelayed && "'Do not build delayed features.'",
        !hasDoNotGeneric && "'Do not create generic cards.'",
        !hasQualityGate && "'Every major generated output must have quality gate status.'",
      ].filter(Boolean) as string[];
      add(issues, missingRules.length > 0, "high", "evidence honesty", `coding_agent_prompt missing ${missingRules.length} required hard rule(s)`, `include the verbatim line(s): ${missingRules.join(", ")} (spec §19)`);

      // missing_inputs surfaces gaps — should not be silently empty when the
      // spec is being graded poorly on the critical checks above.
      const declaredMissing = arr<string>(r.missing_inputs).map(clean).filter(Boolean);
      const hasCriticalIssue = issues.some((i) => i.severity === "critical");
      add(issues, hasCriticalIssue && declaredMissing.length === 0, "medium", "evidence honesty", "missing_inputs is empty despite critical gaps", "per spec §5: when an upstream input is missing or too thin, list the section here rather than silently dropping it");

      // §11: confidence must be honestly low when causal trace is thin.
      const conf = Number(r.confidence);
      add(issues, !Number.isFinite(conf), "medium", "evidence honesty", "missing build-spec confidence", "state confidence 0–100 honestly");
      add(issues, Number.isFinite(conf) && conf >= 70 && trace.length < 8, "high", "evidence honesty", "high build-spec confidence with thin causal trace", "drop confidence below 60 until the causal trace covers 8+ artifacts");

      // No new constraints from spec_export — it consumes, not produces.
      return finalize(engine, issues, repaired, []);
    }
  }
}

function finalize(
  engine: SpecForgeEngineId,
  issues: QualityCriticIssue[],
  repaired: boolean,
  constraintsAdded: string[],
): QualityCriticResult {
  const score = scoreIssues(issues);
  const passed = !hasBlockingIssue(issues) && score >= 72;
  return {
    engine,
    passed,
    score,
    confidenceAfterRepair: repaired ? Math.max(score, 68) : score,
    repaired,
    issues,
    constraintsAdded,
    downstreamStalenessWarning: hasBlockingIssue(issues)
      ? "Downstream stages may be stale if this output is accepted without repair."
      : "",
  };
}

export function qualityReportToCard(
  critics: QualityCriticResult[],
): SpecForgeCard | null {
  if (!critics.length) return null;
  const valid = critics.filter((critic) => Number.isFinite(critic.score));
  if (!valid.length) return null;

  const avg = Math.round(
    valid.reduce((sum, critic) => sum + critic.score, 0) / valid.length,
  );
  const failed = valid.filter((critic) => !critic.passed);
  const repaired = valid.filter((critic) => critic.repaired).length;
  const topIssues = valid
    .flatMap((critic) =>
      critic.issues.map((issue) => ({
        critic,
        issue,
        weight:
          issue.severity === "critical"
            ? 4
            : issue.severity === "high"
              ? 3
              : issue.severity === "medium"
                ? 2
                : 1,
      })),
    )
    .sort((a, b) => b.weight - a.weight || a.critic.score - b.critic.score)
    .slice(0, 4);

  const body =
    topIssues.length > 0
      ? topIssues
          .map(
            ({ critic, issue }) =>
              `• ${labelEngine(critic.engine)} — ${issue.issue}; ${issue.repair}`,
          )
          .join("\n")
      : [
          `• All ${valid.length} stage gates passed after critic checks`,
          repaired ? `• ${repaired} stage${repaired === 1 ? "" : "s"} repaired before downstream use` : "",
          "• Ready for tech spec, prototype, and validation planning",
        ]
          .filter(Boolean)
          .join("\n");

  return {
    stage: "quality",
    eyebrow: failed.length ? "Quality critic · review" : "Quality critic · passed",
    title: failed.length
      ? `${failed.length} stage${failed.length === 1 ? "" : "s"} need attention`
      : `Quality gate passed · ${avg}/100`,
    subtitle: repaired
      ? `${repaired} repair ${repaired === 1 ? "retry" : "retries"} applied before downstream use`
      : "No blocking causal-quality issues detected",
    body,
    layout: "hero",
  };
}

function labelEngine(engine: SpecForgeEngineId): string {
  return engine
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
