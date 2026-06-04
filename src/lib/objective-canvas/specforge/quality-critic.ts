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
  ConvergenceResult,
  DifferentiationResult,
  SolutionFamiliesResult,
  MvpVariationsResult,
  EvaluationResult,
  RecommendationResult,
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
