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
  CrossAnalysisResult,
  CrossAnalysisFit,
  ConvergenceResult,
  DifferentiationResult,
  SolutionFamiliesResult,
  MvpVariationsResult,
  EvaluationResult,
  EvaluationCandidate,
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

function count(items: unknown): number {
  return Array.isArray(items) ? items.length : 0;
}

function firstClean(items: unknown, field?: string): string {
  if (!Array.isArray(items)) return "";
  for (const item of items) {
    if (field && item && typeof item === "object") {
      const value = clean((item as Record<string, unknown>)[field]);
      if (value) return value;
    }
    const value = clean(item);
    if (value) return value;
  }
  return "";
}

function stringifyModel(result: unknown): string {
  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}

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
      const root =
        clean(r.root_constraint_tournament?.selected_root_constraint) ||
        clean(r.root_constraint);
      const need =
        clean(r.first_principles_need?.selected) ||
        clean(r.first_principles_need);
      const phenomenon =
        clean(r.phenomenon?.phenomenon_statement) ||
        clean(r.surface_problem) ||
        "Causal system model";
      const topLeverage =
        [...(r.leverage_points ?? [])]
          .sort((a, b) => (Number(a.rank) || 999) - (Number(b.rank) || 999))
          .map((l) => clean(l.name))
          .find(Boolean) ||
        clean(r.highest_leverage_cause);
      const loops = r.feedback_loops ?? [];
      const reinforcing = loops.filter((loop) => loop.kind === "reinforcing").length;
      const balancing = loops.filter((loop) => loop.kind === "balancing").length;

      if (root || need || phenomenon) {
        return [
          {
            stage: "problem",
            eyebrow: "Causal model",
            title: root || phenomenon,
            subtitle: need ? `Need — ${need}` : phenomenon,
            body: bullets([
              `${count(r.variables)} variables · ${count(r.causal_links)} links · ${reinforcing}R/${balancing}B loops`,
              `${count(r.contradictions)} contradictions · ${count(r.root_constraint_tournament?.candidates)} root candidates`,
              topLeverage && `Top leverage: ${topLeverage}`,
              firstClean(r.solution_constraints) &&
                `Constraint: ${firstClean(r.solution_constraints)}`,
            ]),
            layout: "spine",
            modelJson: stringifyModel(result),
          },
        ];
      }
      return [];
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

    case "cross_analysis": {
      const r = result as CrossAnalysisResult;
      const fits = [
        { label: "User×Problem", fit: r.user_problem_fit },
        { label: "User×Result", fit: r.user_result_fit },
        { label: "Problem×Result", fit: r.problem_result_fit },
      ].filter((row) => row.fit && Number.isFinite(Number(row.fit.score)));
      const topBlockage = (r.cause_result_blockages ?? []).find(
        (b) => clean(b.cause) && clean(b.blocks_result),
      );
      const candidate = clean(r.highest_leverage_intervention_candidate);
      const conf = Number.isFinite(Number(r.confidence))
        ? Math.round(Number(r.confidence))
        : null;
      if (!fits.length && !topBlockage && !candidate) return [];
      const title = topBlockage
        ? `${clean(topBlockage.cause)} blocks ${clean(topBlockage.blocks_result)}`
        : candidate || "Cross-analysis";
      return [
        {
          stage: "analysis",
          eyebrow: "Cross-analysis",
          title,
          subtitle: candidate ? `Convergence input — ${candidate}` : undefined,
          body: bullets([
            ...fits
              .slice(0, 3)
              .map(
                (row) =>
                  `${row.label}: ${Math.round(Number(row.fit.score) || 0)} — ${clean(row.fit.reason)}`,
              ),
            firstClean(r.cross_model_contradictions)
              ? `Tension: ${firstClean(r.cross_model_contradictions)}`
              : "",
            firstClean(r.weak_links)
              ? `Weak link: ${firstClean(r.weak_links)}`
              : "",
            conf !== null ? `Confidence: ${conf}/100` : "",
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

    case "evaluation": {
      const r = result as EvaluationResult;
      const cands: EvaluationCandidate[] = Array.isArray(r.candidates)
        ? r.candidates.filter((c) => clean(c?.name))
        : [];
      const winner = clean(r.winner);
      const ranked = cands
        .slice()
        .sort(
          (a, b) =>
            (Number(b.weighted_score) || 0) - (Number(a.weighted_score) || 0),
        )
        .slice(0, 3);
      if (!cands.length && !winner) return [];
      const criteriaSummary =
        Array.isArray(r.criteria) && r.criteria.length
          ? `${r.criteria.length} criteria · weights ${r.criteria
              .slice(0, 4)
              .map((c) => `${clean(c.name)}${Number.isFinite(Number(c.weight)) ? ` ${Math.round(Number(c.weight))}` : ""}`)
              .filter(Boolean)
              .join(", ")}${r.criteria.length > 4 ? ", …" : ""}`
          : "";
      const winnerCand = winner
        ? cands.find(
            (c) => clean(c.name).toLowerCase() === winner.toLowerCase(),
          )
        : undefined;
      const winnerScore = winnerCand
        ? Math.round(Number(winnerCand.weighted_score) || 0)
        : null;
      const rankingLine = ranked.length
        ? `Ranked: ${ranked
            .map(
              (c) =>
                `${clean(c.name)} ${Math.round(Number(c.weighted_score) || 0)}`,
            )
            .join(" · ")}`
        : "";
      const tradeoff = firstClean(r.tradeoffs);
      const flip = firstClean(r.assumptions_that_could_reverse_decision);
      return [
        {
          stage: "evaluation",
          eyebrow: "Evaluation rubric",
          title: winner
            ? `${winner}${winnerScore !== null ? ` · ${winnerScore}/100` : ""}`
            : "Rubric ranking",
          subtitle: clean(r.why_winner_won) || clean(r.decision_context) || undefined,
          body: bullets([
            criteriaSummary,
            rankingLine,
            tradeoff && `Tradeoff: ${tradeoff}`,
            flip && `Reverses if: ${flip}`,
            clean(r.confidence_level) && `Rubric confidence: ${clean(r.confidence_level)}`,
          ]),
          layout: "spine",
        },
      ];
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
      const root =
        clean(r.root_constraint_tournament?.selected_root_constraint) ||
        clean(r.root_constraint);
      const need =
        clean(r.first_principles_need?.selected) ||
        clean(r.first_principles_need);
      const topLeverage = [...(r.leverage_points ?? [])]
        .sort((a, b) => (Number(a.rank) || 999) - (Number(b.rank) || 999))
        .slice(0, 3)
        .map((l) => clean(l.name))
        .filter(Boolean)
        .join("; ");
      const keyLoops = (r.feedback_loops ?? [])
        .slice(0, 4)
        .map((loop) => `${loop.kind}: ${clean(loop.name)} — ${clean(loop.effect_on_problem)}`)
        .filter(Boolean)
        .join(" | ");
      const constraints = (r.solution_constraints ?? [])
        .map(clean)
        .filter(Boolean)
        .slice(0, 5)
        .join("; ");
      return [
        `Phenomenon: ${clean(r.phenomenon?.phenomenon_statement) || clean(r.surface_problem)}`,
        `Root constraint: ${root}`,
        `First-principles need: ${need}`,
        `Top leverage points: ${topLeverage || clean(r.highest_leverage_cause)}`,
        `Key feedback loops: ${keyLoops}`,
        `Solution constraints: ${constraints}`,
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
    case "cross_analysis": {
      const r = result as CrossAnalysisResult;
      const fitLine = (label: string, fit?: CrossAnalysisFit | null) =>
        fit && Number.isFinite(Number(fit.score))
          ? `${label} fit: ${Math.round(Number(fit.score) || 0)} — ${clean(fit.reason)}`
          : "";
      const blockages = (r.cause_result_blockages ?? [])
        .slice(0, 3)
        .map((b) => `${clean(b.cause)} → blocks → ${clean(b.blocks_result)}`)
        .filter((line) => line.includes(" → blocks → ") && !line.startsWith(" → "))
        .join(" | ");
      const tensions = (r.cross_model_contradictions ?? [])
        .map(clean)
        .filter(Boolean)
        .slice(0, 3)
        .join("; ");
      const inputs = (r.convergence_inputs ?? [])
        .map(clean)
        .filter(Boolean)
        .slice(0, 4)
        .join("; ");
      return [
        fitLine("User-Problem", r.user_problem_fit),
        fitLine("User-Result", r.user_result_fit),
        fitLine("Problem-Result", r.problem_result_fit),
        blockages && `Cause→result blockages: ${blockages}`,
        tensions && `Cross-model tensions: ${tensions}`,
        clean(r.highest_leverage_intervention_candidate) &&
          `Leverage candidate: ${clean(r.highest_leverage_intervention_candidate)}`,
        inputs && `Convergence inputs: ${inputs}`,
      ]
        .filter(Boolean)
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
    case "evaluation": {
      const r = result as EvaluationResult;
      const criteriaLine = Array.isArray(r.criteria)
        ? r.criteria
            .map((c) =>
              [
                clean(c.name),
                Number.isFinite(Number(c.weight))
                  ? `(w ${Math.round(Number(c.weight))})`
                  : "",
              ]
                .filter(Boolean)
                .join(" "),
            )
            .filter(Boolean)
            .join("; ")
        : "";
      const ranked = (Array.isArray(r.candidates) ? r.candidates : [])
        .slice()
        .sort(
          (a, b) =>
            (Number(b.weighted_score) || 0) - (Number(a.weighted_score) || 0),
        )
        .slice(0, 5)
        .map(
          (c) =>
            `${clean(c.name)} ${Math.round(Number(c.weighted_score) || 0)}/100`,
        )
        .filter((s) => !s.startsWith(" "))
        .join(" · ");
      const losses = (Array.isArray(r.why_others_lost) ? r.why_others_lost : [])
        .slice(0, 3)
        .map((l) => `${clean(l.candidate)} — ${clean(l.reason)}`)
        .filter((s) => !s.startsWith(" — "))
        .join(" | ");
      const tradeoffs = (Array.isArray(r.tradeoffs) ? r.tradeoffs : [])
        .map(clean)
        .filter(Boolean)
        .slice(0, 3)
        .join("; ");
      const flips = (Array.isArray(r.assumptions_that_could_reverse_decision)
        ? r.assumptions_that_could_reverse_decision
        : [])
        .map(clean)
        .filter(Boolean)
        .slice(0, 3)
        .join("; ");
      const constraints = (Array.isArray(r.constraints_passed_downstream)
        ? r.constraints_passed_downstream
        : [])
        .map(clean)
        .filter(Boolean)
        .slice(0, 4)
        .join("; ");
      return [
        clean(r.decision_context) && `Decision context: ${clean(r.decision_context)}`,
        criteriaLine && `Rubric criteria: ${criteriaLine}`,
        ranked && `Ranked candidates: ${ranked}`,
        clean(r.winner) && `Rubric winner: ${clean(r.winner)}`,
        clean(r.why_winner_won) && `Why winner won: ${clean(r.why_winner_won)}`,
        losses && `Why others lost: ${losses}`,
        tradeoffs && `Tradeoffs: ${tradeoffs}`,
        flips && `Decision reverses if: ${flips}`,
        constraints && `Constraints to pass downstream: ${constraints}`,
        clean(r.confidence_level) && `Rubric confidence: ${clean(r.confidence_level)}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    default:
      return "";
  }
}
