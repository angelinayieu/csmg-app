// ── SpecForge · engine prompts + response schemas (SERVER ONLY) ──
//
// One descriptor per engine: the system prompt + the strict OpenAI structured-
// output schema. Faithful to specforge_final_prompt_optimization_architecture
// .md (Power-Up §5, Target User §7, Problem Cause Tree §8, Desired Result §9,
// Convergence §11, Differentiation §12, Divergence §13, MVP Variation §16,
// Evaluation §18). Schemas are trimmed to the fields the board actually renders
// or threads forward as context — keeps each call fast without losing rigor.
//
// Imported ONLY by /api/canvas/specforge so the prompts never ship to the
// client bundle. The client maps the returned JSON → cards in ./cards.ts.

import type { SpecForgeEngineId } from "./types";

type JsonSchema = Record<string, unknown>;

const str = { type: "string" } as const;
const strArr = { type: "array", items: { type: "string" } } as const;
const bool = { type: "boolean" } as const;
const num = { type: "number" } as const;

/** Build a strict object schema (additionalProperties:false, all keys required). */
function obj(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

function arr(items: JsonSchema): JsonSchema {
  return { type: "array", items };
}

export interface EngineSpec {
  system: string;
  schema: { name: string; schema: JsonSchema };
  /** rank engines run cooler; generative ones a touch warmer. */
  temperature: number;
  maxTokens?: number;
}

const SHARED_TAIL =
  "\n\nGround every claim in the user's idea and the prior-stage context you " +
  "are given. Prefer causal specificity over impressive language. Be concrete, " +
  "name real mechanisms, and never invent facts — if a claim needs market " +
  "research, phrase it as a hypothesis. Keep each string tight (one or two " +
  "sentences); these render on small cards.";

const ENGINES: Record<SpecForgeEngineId, EngineSpec> = {
  // ── 1 · Prompt Power-Up Analyzer (§5) ──
  power_up: {
    temperature: 0.5,
    system:
      "You are the SpecForge Prompt Power-Up Analyzer. Your job is NOT to " +
      "generate features. Transform the raw idea into a stronger working " +
      "prompt for deeper causal product analysis. Identify what the user is " +
      "literally asking, the deeper intent, the result they actually want, the " +
      "likely target user and core problem, what is ambiguous, and the single " +
      "powered-up prompt a downstream analyst should run." +
      SHARED_TAIL,
    schema: {
      name: "specforge_power_up",
      schema: obj({
        clean_summary: str,
        root_intent: str,
        desired_result_guess: str,
        target_user_guess: str,
        core_problem_guess: str,
        ambiguities: strArr,
        powered_up_prompt: str,
      }),
    },
  },

  // ── 2 · Target User Layering Modeler (§7) ──
  target_user: {
    temperature: 0.5,
    system:
      "You are the SpecForge Target User Layering Modeler. Decompose the " +
      "target user into behaviorally useful layers — NOT demographics. Focus " +
      "on the variables that change product value, MVP direction, feature " +
      "priority, and willingness to use/pay. Identify where the user is broad " +
      "or vague and name the alternative user variants. Explain how each " +
      "variant changes the product." +
      SHARED_TAIL,
    schema: {
      name: "specforge_target_user",
      schema: obj({
        primary_segment: str,
        core_need: str,
        context: str,
        behavior_patterns: strArr,
        motivations: strArr,
        constraints: strArr,
        user_variants: strArr,
        implications_for_product: strArr,
      }),
    },
  },

  // ── 3 · Multifactor Causal Modeling Engine ──
  // Replaces the old linear Problem Cause Tree internally. The board still
  // gets a simplified problem card, but the reasoning now returns a full
  // causal-loop model with variables, signed links, loops, contradictions,
  // incentives, representation/worldview layers, a root-constraint tournament,
  // leverage ranking, and solution constraints.
  problem_tree: {
    temperature: 0.35,
    maxTokens: 5200,
    system:
      "You are the SpecForge Problem Causal Modeling Engine. Model the user's " +
      "problem as a multifactor causal system, not a simple cause list. Do not " +
      "generate features. Build a model deep enough to create strong solution " +
      "constraints for later MVP generation. Analyze: phenomenon, stakeholder " +
      "variants, behavioral/emotional/social/economic/interface/technical/data/" +
      "incentive/trust/friction variables, directional causal links, reinforcing " +
      "and balancing feedback loops, contradictions, incentives, representation " +
      "layers, worldview/narrative layers, counterfactuals, root-constraint " +
      "candidates, first-principles needs, leverage points, and solution " +
      "constraints. Quality floor: at least 12 variables, 3 stakeholder " +
      "variants, 8 causal links, 3 reinforcing loops, 1 balancing loop, 3 " +
      "contradictions, 5 root-constraint candidates, and 5 leverage points. " +
      "Reject shallow linear explanations; every leverage point must trace to " +
      "variables and constraints, not features." +
      SHARED_TAIL,
    schema: {
      name: "specforge_problem_causal_model",
      schema: obj({
        phenomenon: obj({
          phenomenon_statement: str,
          observable_behaviors: strArr,
          symptoms: strArr,
          initial_problem_frame: str,
        }),
        stakeholder_variants: arr(
          obj({
            name: str,
            experience: str,
            urgency: str,
            benefit_or_resistance: str,
          }),
        ),
        variables: arr(
          obj({
            id: str,
            name: str,
            category: str,
            definition: str,
            current_state: str,
          }),
        ),
        causal_links: arr(
          obj({
            source_id: str,
            target_id: str,
            polarity: {
              type: "string",
              enum: ["positive", "negative", "mixed"],
            },
            strength: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            uncertainty: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            mechanism: str,
            assumption: str,
          }),
        ),
        feedback_loops: arr(
          obj({
            id: str,
            name: str,
            kind: {
              type: "string",
              enum: ["reinforcing", "balancing"],
            },
            variable_ids: strArr,
            mechanism: str,
            effect_on_problem: str,
          }),
        ),
        contradictions: arr(
          obj({
            tension: str,
            tradeoff: str,
            resolution_principle: str,
          }),
        ),
        system_incentives: strArr,
        representation_layer: obj({
          current_value_representations: strArr,
          behavior_created_by_current_representation: strArr,
          alternative_value_representations: strArr,
          solution_implications: strArr,
        }),
        worldview_layer: obj({
          dominant_worldview: str,
          underlying_metaphors: strArr,
          cultural_assumptions: strArr,
          alternative_worldviews: strArr,
          product_thesis_implications: strArr,
        }),
        counterfactuals: arr(
          obj({
            world: str,
            what_changes: str,
            solution_principle: str,
          }),
        ),
        root_constraint_tournament: obj({
          candidates: arr(
            obj({
              constraint: str,
              score: num,
              why: str,
              weakness: str,
            }),
          ),
          selected_root_constraint: str,
          why_selected: str,
          rejected_candidates: strArr,
        }),
        first_principles_need: obj({
          candidates: strArr,
          selected: str,
          why_selected: str,
          solution_implications: strArr,
        }),
        leverage_points: arr(
          obj({
            name: str,
            variable_ids: strArr,
            downstream_impact: str,
            buildability: str,
            differentiation: str,
            risk: str,
            evidence_confidence: str,
            rank: num,
          }),
        ),
        solution_constraints: strArr,
        evidence_needed: strArr,
        quality_gate: obj({
          passes: bool,
          depth_score: num,
          causal_specificity_score: num,
          non_obviousness_score: num,
          solution_constraint_strength: num,
          issues: strArr,
        }),
      }),
    },
  },

  // ── 4 · Desired Result Layering Modeler (§9) ──
  desired_result: {
    temperature: 0.4,
    system:
      "You are the SpecForge Desired Result Layering Modeler. Decompose the " +
      "desired result into layered outcomes. Reject vague outcomes like " +
      "'better product' or 'more clarity' — translate them into functional, " +
      "decision, behavior-change, and MEASURABLE outcomes. Every result must " +
      "connect to a user behavior change; every measurable result must be " +
      "observable; if a result cannot guide MVP ranking, rewrite it." +
      SHARED_TAIL,
    schema: {
      name: "specforge_desired_result",
      schema: obj({
        functional_result: str,
        decision_result: str,
        behavior_change: str,
        measurable_success: str,
        strategic_outcome: str,
        first_principles_result: str,
        success_metrics: strArr,
        failure_conditions: strArr,
      }),
    },
  },

  // ── 5 · Cross-Analysis Engine (specforge_cross_analysis_engine.md) ──
  // Sits between layered modeling and convergence. Interweaves user × problem ×
  // result; does NOT redo intra-model causal contradictions (problem_tree) or
  // pick a final thesis (convergence). Outputs fit + blockage + cross-model
  // contradictions + weak links + a leverage candidate for convergence input.
  cross_analysis: {
    temperature: 0.35,
    maxTokens: 2400,
    system:
      "You are the SpecForge Cross-Analysis Engine. Do NOT summarize the target " +
      "user, problem causal model, or desired result separately — you already " +
      "have them in the prior-stage context. Focus on RELATIONSHIPS. Evaluate " +
      "three fits (user×problem, user×result, problem×result), build a concrete " +
      "cause→result blockage map (each entry names ONE cause from the causal " +
      "model and ONE result/metric it blocks via a stated mechanism), surface " +
      "cross-model contradictions (tensions that span TWO models, e.g., the " +
      "user values privacy but the desired result requires social proof), " +
      "identify weak links (the smartest-looking claim resting on the thinnest " +
      "evidence), then pick ONE highest-leverage intervention candidate to " +
      "PROPOSE to the convergence engine (you are not making the final " +
      "selection — convergence does). Score fits and confidence 0–100 with " +
      "honest uncertainty. Do not re-derive root constraint candidates or " +
      "intra-model causal contradictions — those belong to problem_tree." +
      SHARED_TAIL,
    schema: {
      name: "specforge_cross_analysis",
      schema: obj({
        user_problem_fit: obj({
          score: num,
          reason: str,
          blockers: strArr,
        }),
        user_result_fit: obj({
          score: num,
          reason: str,
          blockers: strArr,
        }),
        problem_result_fit: obj({
          score: num,
          reason: str,
          blockers: strArr,
        }),
        cause_result_blockages: arr(
          obj({
            cause: str,
            blocks_result: str,
            mechanism: str,
          }),
        ),
        cross_model_contradictions: strArr,
        weak_links: strArr,
        highest_leverage_intervention_candidate: str,
        convergence_inputs: strArr,
        confidence: num,
      }),
    },
  },

  // ── 6 · Convergence Engine (§11) ──
  convergence: {
    temperature: 0.4,
    system:
      "You are the SpecForge Convergence Engine. Given the target user model, " +
      "problem cause tree, desired result stack, AND the cross-analysis " +
      "outputs (user×problem/user×result/problem×result fits, cause→result " +
      "blockages, cross-model contradictions, weak links, leverage candidate, " +
      "convergence_inputs) that already precede you, converge on the DEEPEST " +
      "actionable product thesis. Treat the cross-analysis convergence_inputs " +
      "as priors: prefer interventions that resolve a high-fit blockage or a " +
      "named contradiction. Do not produce multiple equal theses — choose " +
      "the strongest, explain why weaker interpretations are less fundamental, " +
      "and ensure the thesis can generate solution families. State what it " +
      "rules out and what it implies for solution design." +
      SHARED_TAIL,
    schema: {
      name: "specforge_convergence",
      schema: obj({
        root_constraint: str,
        first_principles_need: str,
        highest_leverage_intervention: str,
        distilled_product_thesis: str,
        why_this_is_deeper_than_the_surface_problem: str,
        what_this_rules_out: strArr,
        what_this_implies_for_solution_design: strArr,
      }),
    },
  },

  // ── 6 · Differentiation Intelligence Engine (§12) ──
  differentiation: {
    temperature: 0.5,
    system:
      "You are the SpecForge Differentiation Intelligence Engine. Compare the " +
      "proposed product against current direct alternatives and indirect " +
      "workarounds. Do NOT compare surface features — compare by what deeper " +
      "problem each fails to solve and what user need stays unmet. For each " +
      "direct alternative give its name, what it solves, and the gap it leaves. " +
      "State the deeper problem none solve, the proposed product's advantage, " +
      "and the single sharpest differentiation thesis. Do not claim superiority " +
      "without naming the deeper problem solved." +
      SHARED_TAIL,
    schema: {
      name: "specforge_differentiation",
      schema: obj({
        direct_alternatives: {
          type: "array",
          items: obj({ name: str, solves: str, gap: str }),
        },
        indirect_workarounds: strArr,
        deeper_problem_not_solved: str,
        proposed_product_advantage: str,
        differentiation_thesis: str,
        final_positioning_options: strArr,
      }),
    },
  },

  // ── 7 · Divergence / Solution Family Generator (§13) ──
  solution_families: {
    temperature: 0.6,
    system:
      "You are the SpecForge Divergence Engine. Starting from the " +
      "first-principles need, highest-leverage intervention, and " +
      "differentiation thesis, generate 3–5 distinct SOLUTION FAMILIES. For " +
      "each: the root cause it attacks, the core mechanism it uses, and the " +
      "user behavior it changes. Every family must trace back to the root " +
      "constraint; prefer mechanisms that solve multiple downstream problems. " +
      "Name the single recommended family and the key risks." +
      SHARED_TAIL,
    schema: {
      name: "specforge_solution_families",
      schema: obj({
        solution_families: {
          type: "array",
          items: obj({
            name: str,
            attacks: str,
            mechanism: str,
            user_behavior_change: str,
          }),
        },
        recommended_family: str,
        risks: strArr,
      }),
    },
  },

  // ── 8 · MVP Variation Generator (§16) ──
  mvp_variations: {
    temperature: 0.6,
    system:
      "You are the SpecForge MVP Variation Generator. From the solution " +
      "families, generate 3–5 MVP variations. Each must attack a DIFFERENT " +
      "leverage point or use a meaningfully different mechanism — never MVPs " +
      "that only sound different. For each: a crisp name, the target user, the " +
      "core mechanism, the simplest shippable version, why it is valuable, the " +
      "build difficulty (low/medium/high), and a value_score 0–100 (value-to-" +
      "complexity × differentiation strength). Rank them and name the single " +
      "recommended MVP." +
      SHARED_TAIL,
    schema: {
      name: "specforge_mvp_variations",
      schema: obj({
        mvp_variations: {
          type: "array",
          items: obj({
            name: str,
            target_user: str,
            core_mechanism: str,
            simplest_version: str,
            why_valuable: str,
            build_difficulty: str,
            value_score: { type: "number" },
          }),
        },
        ranking: strArr,
        recommended_mvp: str,
      }),
    },
  },

  // ── 9 · Evaluation Engine → recommended first build (§18) ──
  recommendation: {
    temperature: 0.3,
    system:
      "You are the SpecForge Evaluation Engine. Choose the single recommended " +
      "FIRST BUILD from the MVP variations, judged on root-cause alignment, " +
      "target-user fit, desired-result fit, differentiation, speed-to-value, " +
      "buildability, and risk. Do not score on vibes — explain the causal and " +
      "differentiation basis for why this one won and the others lost. Name the " +
      "riskiest assumptions to test first and the immediate next best action." +
      SHARED_TAIL,
    schema: {
      name: "specforge_recommendation",
      schema: obj({
        recommendation: str,
        why_this_won: str,
        why_others_lost: strArr,
        assumptions_to_test: strArr,
        confidence_level: str,
        next_best_action: str,
      }),
    },
  },
};

export function engineSpec(id: SpecForgeEngineId): EngineSpec | undefined {
  return ENGINES[id];
}

export const VALID_ENGINES = Object.keys(ENGINES) as SpecForgeEngineId[];
