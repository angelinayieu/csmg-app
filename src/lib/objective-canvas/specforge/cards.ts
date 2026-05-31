// ── SpecForge · result → cards + context threading (CLIENT, tldraw-free) ──
//
// Maps each engine's raw JSON into the decision cards that unfurl on the board,
// and produces the compact one-paragraph summary the runner threads forward to
// the next engine. Kept off the shape/runner so the mapping lives in one place.

import type {
  SpecForgeCard,
  SpecForgeEngineId,
  PowerUpResult,
  TargetUserResult,
  ProblemTreeResult,
  DesiredResultResult,
  ConvergenceResult,
  DifferentiationResult,
  SolutionFamiliesResult,
  MvpVariationsResult,
  RecommendationResult,
} from "./types";

/** Join a few bullet strings into the shape's "\n"-delimited body. */
function bullets(items: (string | undefined)[], max = 4): string {
  return items
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .slice(0, max)
    .map((s) => `• ${s}`)
    .join("\n");
}

const clean = (s: unknown): string =>
  typeof s === "string" ? s.trim() : "";

/** result → the cards it unfurls. Soft: missing fields just shrink the card. */
export function resultToCards(
  engine: SpecForgeEngineId,
  result: unknown,
): SpecForgeCard[] {
  if (!result || typeof result !== "object") return [];

  switch (engine) {
    case "power_up": {
      const r = result as PowerUpResult;
      const summary = clean(r.clean_summary);
      if (!summary) return [];
      return [
        {
          stage: "input",
          title: summary,
          subtitle: r.root_intent ? `Intent — ${clean(r.root_intent)}` : undefined,
          body: bullets([
            r.core_problem_guess && `Core problem: ${clean(r.core_problem_guess)}`,
            r.desired_result_guess && `Wants: ${clean(r.desired_result_guess)}`,
          ]),
          layout: "spine",
        },
      ];
    }

    case "target_user": {
      const r = result as TargetUserResult;
      const seg = clean(r.primary_segment);
      if (!seg && !clean(r.core_need)) return [];
      return [
        {
          stage: "user",
          title: seg || "Target user",
          subtitle: r.core_need ? `Core need — ${clean(r.core_need)}` : undefined,
          body: bullets([
            ...(r.motivations ?? []).slice(0, 2).map((m) => `Motivation: ${clean(m)}`),
            ...(r.behavior_patterns ?? []).slice(0, 1).map((b) => `Behavior: ${clean(b)}`),
            (r.user_variants ?? []).length
              ? `Variants: ${(r.user_variants ?? []).map(clean).filter(Boolean).slice(0, 3).join(", ")}`
              : "",
          ]),
          layout: "spine",
        },
      ];
    }

    case "problem_tree": {
      const r = result as ProblemTreeResult;
      const cards: SpecForgeCard[] = [];
      if (clean(r.surface_problem) || (r.cause_tree ?? []).length) {
        cards.push({
          stage: "problem",
          title: clean(r.surface_problem) || "Problem cause tree",
          subtitle: r.highest_leverage_cause
            ? `Highest leverage — ${clean(r.highest_leverage_cause)}`
            : undefined,
          body: bullets(
            (r.cause_tree ?? []).map((c) =>
              [clean(c.layer), clean(c.failing)].filter(Boolean).join(": "),
            ),
            5,
          ),
          layout: "spine",
        });
      }
      if (clean(r.root_constraint)) {
        cards.push({
          stage: "convergence",
          eyebrow: "Root constraint",
          title: clean(r.root_constraint),
          layout: "spine",
        });
      }
      if (clean(r.first_principles_need)) {
        cards.push({
          stage: "convergence",
          eyebrow: "First-principles need",
          title: clean(r.first_principles_need),
          layout: "spine",
        });
      }
      return cards;
    }

    case "desired_result": {
      const r = result as DesiredResultResult;
      const lead = clean(r.first_principles_result) || clean(r.strategic_outcome);
      if (!lead && !clean(r.measurable_success)) return [];
      return [
        {
          stage: "result",
          title: lead || "Desired result",
          subtitle: r.behavior_change
            ? `Behavior change — ${clean(r.behavior_change)}`
            : undefined,
          body: bullets([
            r.measurable_success && `Success: ${clean(r.measurable_success)}`,
            ...(r.success_metrics ?? []).slice(0, 2).map((m) => `Metric: ${clean(m)}`),
          ]),
          layout: "spine",
        },
      ];
    }

    case "convergence": {
      const r = result as ConvergenceResult;
      const thesis = clean(r.distilled_product_thesis);
      if (!thesis) return [];
      return [
        {
          stage: "convergence",
          eyebrow: "Product thesis",
          title: thesis,
          subtitle: r.highest_leverage_intervention
            ? `Leverage — ${clean(r.highest_leverage_intervention)}`
            : undefined,
          body: bullets([
            clean(r.why_this_is_deeper_than_the_surface_problem),
            ...(r.what_this_implies_for_solution_design ?? []).slice(0, 1),
          ]),
          layout: "spine",
        },
      ];
    }

    case "differentiation": {
      const r = result as DifferentiationResult;
      const cards: SpecForgeCard[] = [];
      if ((r.direct_alternatives ?? []).length || clean(r.deeper_problem_not_solved)) {
        cards.push({
          stage: "alternatives",
          title: "What exists today",
          subtitle: r.deeper_problem_not_solved
            ? `Unsolved — ${clean(r.deeper_problem_not_solved)}`
            : undefined,
          body: bullets(
            (r.direct_alternatives ?? []).map((a) =>
              [clean(a.name), clean(a.gap)].filter(Boolean).join(" — gap: "),
            ),
            4,
          ),
          layout: "spine",
        });
      }
      if (clean(r.differentiation_thesis)) {
        cards.push({
          stage: "differentiation",
          eyebrow: "Differentiation thesis",
          title: clean(r.differentiation_thesis),
          subtitle: r.proposed_product_advantage
            ? `Advantage — ${clean(r.proposed_product_advantage)}`
            : undefined,
          body: bullets(
            (r.final_positioning_options ?? []).slice(0, 2).map((p) => clean(p)),
          ),
          layout: "spine",
        });
      }
      return cards;
    }

    case "solution_families": {
      const r = result as SolutionFamiliesResult;
      const fams = (r.solution_families ?? []).filter((f) => clean(f.name));
      if (!fams.length) return [];
      return [
        {
          stage: "families",
          title: "Solution families",
          subtitle: r.recommended_family
            ? `Lead — ${clean(r.recommended_family)}`
            : undefined,
          body: bullets(
            fams.map((f) =>
              [clean(f.name), clean(f.mechanism)].filter(Boolean).join(": "),
            ),
            5,
          ),
          layout: "spine",
        },
      ];
    }

    case "mvp_variations": {
      const r = result as MvpVariationsResult;
      const mvps = (r.mvp_variations ?? [])
        .filter((m) => clean(m.name))
        .slice()
        .sort((a, b) => (Number(b.value_score) || 0) - (Number(a.value_score) || 0))
        .slice(0, 3);
      if (!mvps.length) return [];
      const rec = clean(r.recommended_mvp);
      return mvps.map((m) => {
        const score = Math.round(Number(m.value_score) || 0);
        const isRec = !!rec && clean(m.name).toLowerCase() === rec.toLowerCase();
        return {
          stage: "mvp" as const,
          eyebrow: isRec ? "MVP · recommended" : `MVP · value ${score}`,
          title: clean(m.name),
          subtitle: m.core_mechanism ? clean(m.core_mechanism) : undefined,
          body: bullets([
            m.why_valuable && `Why: ${clean(m.why_valuable)}`,
            m.simplest_version && `v0: ${clean(m.simplest_version)}`,
            m.build_difficulty && `Build: ${clean(m.build_difficulty)}`,
          ]),
          layout: "diverge" as const,
        };
      });
    }

    case "recommendation": {
      const r = result as RecommendationResult;
      const pick = clean(r.recommendation);
      if (!pick) return [];
      return [
        {
          stage: "recommendation",
          title: pick,
          subtitle: r.why_this_won ? clean(r.why_this_won) : undefined,
          body: bullets([
            r.next_best_action && `Next: ${clean(r.next_best_action)}`,
            (r.assumptions_to_test ?? []).length
              ? `Test first: ${(r.assumptions_to_test ?? []).map(clean).filter(Boolean)[0]}`
              : "",
            r.confidence_level && `Confidence: ${clean(r.confidence_level)}`,
          ]),
          layout: "hero",
        },
      ];
    }

    default:
      return [];
  }
}

/** A compact line or two the runner appends to the rolling context, so each
 *  engine builds on what's already decided instead of re-deriving it. */
export function summarizeForContext(
  engine: SpecForgeEngineId,
  result: unknown,
): string {
  if (!result || typeof result !== "object") return "";
  switch (engine) {
    case "power_up": {
      const r = result as PowerUpResult;
      return [
        `Clean summary: ${clean(r.clean_summary)}`,
        `Root intent: ${clean(r.root_intent)}`,
        `Likely user: ${clean(r.target_user_guess)}`,
        `Core problem: ${clean(r.core_problem_guess)}`,
      ]
        .filter((l) => l.split(": ")[1])
        .join("\n");
    }
    case "target_user": {
      const r = result as TargetUserResult;
      return [
        `Target user: ${clean(r.primary_segment)}`,
        `Core need: ${clean(r.core_need)}`,
      ]
        .filter((l) => l.split(": ")[1])
        .join("\n");
    }
    case "problem_tree": {
      const r = result as ProblemTreeResult;
      return [
        `Surface problem: ${clean(r.surface_problem)}`,
        `Root constraint: ${clean(r.root_constraint)}`,
        `First-principles need: ${clean(r.first_principles_need)}`,
        `Highest-leverage cause: ${clean(r.highest_leverage_cause)}`,
      ]
        .filter((l) => l.split(": ")[1])
        .join("\n");
    }
    case "desired_result": {
      const r = result as DesiredResultResult;
      return [
        `Desired result: ${clean(r.first_principles_result) || clean(r.strategic_outcome)}`,
        `Measurable success: ${clean(r.measurable_success)}`,
      ]
        .filter((l) => l.split(": ")[1])
        .join("\n");
    }
    case "convergence": {
      const r = result as ConvergenceResult;
      return [
        `Product thesis: ${clean(r.distilled_product_thesis)}`,
        `Highest-leverage intervention: ${clean(r.highest_leverage_intervention)}`,
        `First-principles need: ${clean(r.first_principles_need)}`,
      ]
        .filter((l) => l.split(": ")[1])
        .join("\n");
    }
    case "differentiation": {
      const r = result as DifferentiationResult;
      return [
        `Differentiation thesis: ${clean(r.differentiation_thesis)}`,
        `Advantage: ${clean(r.proposed_product_advantage)}`,
        `Deeper problem unsolved by others: ${clean(r.deeper_problem_not_solved)}`,
      ]
        .filter((l) => l.split(": ")[1])
        .join("\n");
    }
    case "solution_families": {
      const r = result as SolutionFamiliesResult;
      const names = (r.solution_families ?? [])
        .map((f) => clean(f.name))
        .filter(Boolean)
        .join("; ");
      return [
        names && `Solution families: ${names}`,
        `Recommended family: ${clean(r.recommended_family)}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "mvp_variations": {
      const r = result as MvpVariationsResult;
      const names = (r.mvp_variations ?? [])
        .map((m) => clean(m.name))
        .filter(Boolean)
        .join("; ");
      return [
        names && `MVP variations: ${names}`,
        `Recommended MVP: ${clean(r.recommended_mvp)}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    default:
      return "";
  }
}
