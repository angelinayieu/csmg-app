// ── SpecForge · Polished Bullets (CLIENT/SERVER safe) ──────────────
//
// One headline + 2–4 bullets per engine result, distilled to what the
// USER cares about: the final polished output a downstream engine (or a
// reader) would consume. Strips internals — variable counts, link
// counts, contradiction tallies, repair status, depth scoring, raw
// modelJson, anything that names the technical pipeline.
//
// Why a separate file from operation-cards.ts: operation-cards is a
// single-line summary for the lane row; this is the "open-an-engine"
// view rendered in the side panel after cards stopped deploying on the
// board. Same data, different fidelity.

import type {
  SpecForgeEngineId,
  PowerUpResult,
  TargetUserResult,
  ProblemTreeResult,
  DesiredResultResult,
  CrossAnalysisResult,
  CrossAnalysisFit,
  QuestionExpansionResult,
  ConvergenceResult,
  DifferentiationResult,
  SolutionFamiliesResult,
  MvpVariationsResult,
  EvaluationResult,
  RecommendationResult,
  ComplexityAllocationResult,
  ComplexityModuleScore,
  FeatureCardsResult,
  FeatureCard,
  FeatureMechanismsResult,
  FeatureMechanism,
  DataPointsResult,
  DataPoint,
  LayerOptimizationResult,
  LayerAlignmentCheck,
  ValidationResult,
  ValidationExperiment,
  DeepeningResult,
  DeepeningBaseline,
  DeepeningUncertainty,
  SpecExportResult,
  SolutionFamily,
  MvpVariation,
} from "./types";

export interface PolishedBullets {
  /** Headline = the engine's single most-important polished output —
   *  usually the thing a downstream engine would quote. Falls back to
   *  the engine label when the result lacks a clear lead. */
  headline: string;
  /** ≤4 bullets, each one short. Strict order: highest-value first. */
  bullets: string[];
}

const clean = (v: unknown): string =>
  typeof v === "string" ? v.trim() : "";

function take<T>(arr: unknown, n: number): T[] {
  return Array.isArray(arr) ? (arr.slice(0, n) as T[]) : [];
}

function bulletList(items: (string | undefined | null | false)[], cap = 4): string[] {
  return items
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s): s is string => Boolean(s))
    .slice(0, cap);
}

/** Per-engine polished view. Soft-fails to `{ headline: label, bullets: [] }`
 *  if the result is null/undefined/wrong shape. */
export function polishedBulletsFor(
  engine: SpecForgeEngineId,
  result: unknown,
  fallbackHeadline: string,
): PolishedBullets {
  if (!result || typeof result !== "object") {
    return { headline: fallbackHeadline, bullets: [] };
  }

  switch (engine) {
    case "power_up": {
      const r = result as PowerUpResult;
      return {
        headline: clean(r.clean_summary) || fallbackHeadline,
        bullets: bulletList([
          clean(r.root_intent) && `Intent — ${clean(r.root_intent)}`,
          clean(r.core_problem_guess) && `Core problem — ${clean(r.core_problem_guess)}`,
          clean(r.desired_result_guess) && `Wants — ${clean(r.desired_result_guess)}`,
        ]),
      };
    }

    case "target_user": {
      const r = result as TargetUserResult;
      return {
        headline: clean(r.primary_segment) || fallbackHeadline,
        bullets: bulletList([
          clean(r.core_need) && `Core need — ${clean(r.core_need)}`,
          ...take<string>(r.motivations, 2).map((m) => `Motivation — ${clean(m)}`),
          take<string>(r.behavior_patterns, 1)
            .map((b) => `Behavior — ${clean(b)}`)
            .find(Boolean) || "",
        ]),
      };
    }

    case "problem_tree": {
      const r = result as ProblemTreeResult;
      const root =
        clean(r.root_constraint_tournament?.selected_root_constraint) ||
        clean(r.root_constraint);
      const need =
        clean(r.first_principles_need?.selected) ||
        // Older saved results sometimes stored it as a bare string.
        clean(r.first_principles_need as unknown);
      const topLeverage =
        [...take<{ name?: string; rank?: number }>(r.leverage_points, 8)]
          .sort((a, b) => (Number(a.rank) || 999) - (Number(b.rank) || 999))
          .map((l) => clean(l.name))
          .find(Boolean) || clean(r.highest_leverage_cause);
      const firstConstraint = take<string>(r.solution_constraints, 1)
        .map(clean)
        .find(Boolean);
      return {
        headline: root || clean(r.phenomenon?.phenomenon_statement) || fallbackHeadline,
        bullets: bulletList([
          need && `First-principles need — ${need}`,
          topLeverage && `Highest leverage — ${topLeverage}`,
          firstConstraint && `Constraint — ${firstConstraint}`,
        ]),
      };
    }

    case "desired_result": {
      const r = result as DesiredResultResult;
      return {
        headline:
          clean(r.first_principles_result) ||
          clean(r.strategic_outcome) ||
          fallbackHeadline,
        bullets: bulletList([
          clean(r.behavior_change) && `Behavior change — ${clean(r.behavior_change)}`,
          clean(r.measurable_success) && `Success — ${clean(r.measurable_success)}`,
          ...take<string>(r.success_metrics, 2).map((m) => `Metric — ${clean(m)}`),
        ]),
      };
    }

    case "cross_analysis": {
      const r = result as CrossAnalysisResult;
      const fits: Array<[string, CrossAnalysisFit | undefined]> = [
        ["User × Problem", r.user_problem_fit],
        ["User × Result", r.user_result_fit],
        ["Problem × Result", r.problem_result_fit],
      ];
      return {
        headline:
          clean(r.highest_leverage_intervention_candidate) || fallbackHeadline,
        bullets: bulletList(
          fits.map(([label, fit]) => {
            const reason = clean(fit?.reason);
            const score = typeof fit?.score === "number" ? Math.round(fit.score) : null;
            if (!reason && score === null) return "";
            return score !== null && reason
              ? `${label} (${score}) — ${reason}`
              : reason
                ? `${label} — ${reason}`
                : `${label} — ${score}`;
          }),
        ),
      };
    }

    case "question_expansion": {
      const r = result as QuestionExpansionResult;
      const qs = take<{ question?: string }>(r.questions, 4);
      const top = take<string>(r.top_critical_questions, 4).map(clean).filter(Boolean);
      const bullets = top.length
        ? top
        : qs.slice(1).map((q) => clean(q.question)).filter(Boolean);
      return {
        headline:
          (qs[0] && clean(qs[0].question)) ||
          (top[0] ?? fallbackHeadline),
        bullets: bulletList(bullets),
      };
    }

    case "convergence": {
      const r = result as ConvergenceResult;
      return {
        headline: clean(r.distilled_product_thesis) || fallbackHeadline,
        bullets: bulletList([
          clean(r.root_constraint) && `Root constraint — ${clean(r.root_constraint)}`,
          clean(r.first_principles_need) && `First-principles need — ${clean(r.first_principles_need)}`,
          clean(r.highest_leverage_intervention) && `Highest leverage — ${clean(r.highest_leverage_intervention)}`,
        ]),
      };
    }

    case "differentiation": {
      const r = result as DifferentiationResult;
      return {
        headline: clean(r.differentiation_thesis) || fallbackHeadline,
        bullets: bulletList([
          clean(r.proposed_product_advantage) &&
            `Advantage — ${clean(r.proposed_product_advantage)}`,
          clean(r.deeper_problem_not_solved) &&
            `Underserved — ${clean(r.deeper_problem_not_solved)}`,
        ]),
      };
    }

    case "solution_families": {
      const r = result as SolutionFamiliesResult;
      const fams = take<SolutionFamily>(r.solution_families, 4);
      const rec = clean(r.recommended_family);
      return {
        headline: rec || fallbackHeadline,
        bullets: bulletList(
          fams.map((f) => {
            const name = clean(f.name);
            const mech = clean(f.mechanism);
            return name && mech ? `${name} — ${mech}` : name || mech;
          }),
        ),
      };
    }

    case "mvp_variations": {
      const r = result as MvpVariationsResult;
      const mvps = take<MvpVariation>(r.mvp_variations, 3);
      return {
        headline: clean(r.recommended_mvp) || fallbackHeadline,
        bullets: bulletList(
          mvps.map((m) => {
            const name = clean(m.name);
            const simple = clean(m.simplest_version);
            return name && simple ? `${name} — ${simple}` : name || simple;
          }),
        ),
      };
    }

    case "evaluation": {
      const r = result as EvaluationResult;
      return {
        headline: clean(r.winner) ? `Winner — ${clean(r.winner)}` : fallbackHeadline,
        bullets: bulletList([
          clean(r.why_winner_won) && clean(r.why_winner_won),
          ...take<string>(r.tradeoffs, 1).map((t) => `Tradeoff — ${clean(t)}`),
        ]),
      };
    }

    case "recommendation": {
      const r = result as RecommendationResult;
      return {
        headline: clean(r.recommendation) || fallbackHeadline,
        bullets: bulletList([
          clean(r.why_this_won) && clean(r.why_this_won),
          clean(r.next_best_action) && `Next — ${clean(r.next_best_action)}`,
        ]),
      };
    }

    case "complexity_allocation": {
      const r = result as ComplexityAllocationResult;
      const philosophy = clean(r.budget?.philosophy);
      const scope = take<string>(r.first_build_scope, 4)
        .map(clean)
        .filter(Boolean);
      if (scope.length) {
        return {
          headline: philosophy || fallbackHeadline,
          bullets: bulletList(scope.map((s) => `First build — ${s}`)),
        };
      }
      const mods = take<ComplexityModuleScore>(r.module_scores, 4);
      return {
        headline: philosophy || fallbackHeadline,
        bullets: bulletList(
          mods.map((m) => {
            const name = clean(m.module_name);
            const rec = clean(m.build_recommendation);
            return name && rec ? `${name} — ${rec.replace(/_/g, " ")}` : name;
          }),
        ),
      };
    }

    case "feature_cards": {
      const r = result as FeatureCardsResult;
      const must = take<FeatureCard>(r.features, 8).filter(
        (f) => clean(f.build_priority) === "must_have",
      );
      const list = (must.length ? must : take<FeatureCard>(r.features, 4)).slice(0, 4);
      return {
        headline: fallbackHeadline,
        bullets: bulletList(
          list.map((f) => {
            const name = clean(f.name);
            // FeatureCard exposes `mechanism_summary` rather than `one_liner`.
            const tag =
              clean((f as unknown as { mechanism_summary?: unknown }).mechanism_summary) ||
              clean((f as unknown as { one_liner?: unknown }).one_liner);
            return name && tag ? `${name} — ${tag}` : name || tag;
          }),
        ),
      };
    }

    case "feature_mechanisms": {
      const r = result as FeatureMechanismsResult;
      const ms = take<FeatureMechanism>(r.mechanisms, 4);
      return {
        headline: fallbackHeadline,
        bullets: bulletList(
          ms.map((m) => {
            const feat =
              clean((m as unknown as { feature?: unknown }).feature) ||
              clean((m as unknown as { feature_name?: unknown }).feature_name);
            const mech =
              clean((m as unknown as { mechanism?: unknown }).mechanism) ||
              clean(
                (m as unknown as { mechanism_summary?: unknown }).mechanism_summary,
              );
            return feat && mech ? `${feat} → ${mech}` : feat || mech;
          }),
        ),
      };
    }

    case "data_points": {
      const r = result as DataPointsResult;
      const pts = take<DataPoint>(r.data_points, 8).filter(
        (p) => clean((p as unknown as { disposition?: unknown }).disposition) !== "removed",
      );
      return {
        headline: fallbackHeadline,
        bullets: bulletList(
          pts
            .slice(0, 4)
            .map((p) => clean((p as unknown as { name?: unknown }).name)),
        ),
      };
    }

    case "layer_optimization": {
      const r = result as LayerOptimizationResult;
      const checks = take<LayerAlignmentCheck>(r.alignment_checks, 4);
      return {
        headline: fallbackHeadline,
        bullets: bulletList(
          checks.map((c) => {
            const from = clean((c as unknown as { from?: unknown }).from);
            const to = clean((c as unknown as { to?: unknown }).to);
            const v = clean((c as unknown as { verdict?: unknown }).verdict);
            return from && to ? `${from} → ${to}${v ? ` · ${v}` : ""}` : "";
          }),
        ),
      };
    }

    case "validation": {
      const r = result as ValidationResult;
      const exps = take<ValidationExperiment>(r.experiments, 3);
      return {
        headline: fallbackHeadline,
        bullets: bulletList(
          exps.map((e) => {
            const name = clean(e.name);
            const h = clean(e.hypothesis);
            return name && h ? `${name} — ${h}` : name || h;
          }),
        ),
      };
    }

    case "deepening": {
      const r = result as DeepeningResult;
      const u = take<DeepeningUncertainty>(r.uncertainties_remaining, 2);
      const b = take<DeepeningBaseline>(r.baselines, 2);
      return {
        headline: clean(r.value_added) || fallbackHeadline,
        bullets: bulletList([
          ...u.map((x) => clean(x.uncertainty) && `Uncertainty — ${clean(x.uncertainty)}`),
          ...b.map((x) => clean(x.value) && `Baseline — ${clean(x.value)}`),
        ]),
      };
    }

    case "spec_export": {
      const r = result as SpecExportResult;
      return {
        headline:
          clean(r.product_summary?.product_name) ||
          clean(r.product_summary?.one_liner) ||
          fallbackHeadline,
        bullets: bulletList([
          clean(r.product_summary?.one_liner) && clean(r.product_summary?.one_liner),
          clean(r.product_summary?.core_product_loop) &&
            `Core loop — ${clean(r.product_summary?.core_product_loop)}`,
        ]),
      };
    }
  }
}
