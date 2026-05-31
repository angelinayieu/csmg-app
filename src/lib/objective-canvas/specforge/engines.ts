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

/** Build a strict object schema (additionalProperties:false, all keys required). */
function obj(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

export interface EngineSpec {
  system: string;
  schema: { name: string; schema: JsonSchema };
  /** rank engines run cooler; generative ones a touch warmer. */
  temperature: number;
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

  // ── 3 · Problem Cause Tree Engine (§8) ──
  problem_tree: {
    temperature: 0.4,
    system:
      "You are the SpecForge Problem Cause Tree Engine. Trace the problem from " +
      "the surface symptom down through task, decision, criteria, causal-model, " +
      "user-model, mechanism and workflow failures to the ROOT CONSTRAINT and " +
      "the FIRST-PRINCIPLES NEED. For each cause node give the failure layer " +
      "name and what is failing. Do not generate features. If the root " +
      "constraint is vague, go one layer deeper — stop only when the cause is " +
      "causal, actionable, software-solvable, and capable of generating " +
      "multiple solution families." +
      SHARED_TAIL,
    schema: {
      name: "specforge_problem_tree",
      schema: obj({
        surface_problem: str,
        cause_tree: {
          type: "array",
          items: obj({ layer: str, failing: str }),
        },
        root_constraint: str,
        first_principles_need: str,
        highest_leverage_cause: str,
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

  // ── 5 · Convergence Engine (§11) ──
  convergence: {
    temperature: 0.4,
    system:
      "You are the SpecForge Convergence Engine. Given the target user model, " +
      "problem cause tree, and desired result stack, converge on the DEEPEST " +
      "actionable product thesis. Do not produce multiple equal theses — choose " +
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
