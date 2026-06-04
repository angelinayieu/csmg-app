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

  // ── 5b · Question Expansion Engine (specforge_question_expansion_engine.md) ──
  // Sits between cross_analysis and convergence. Generates a small ranked list
  // of questions whose answers would change a downstream decision (target user,
  // root constraint, desired result, differentiation, MVP direction, feature
  // mechanism, evaluation criteria, or a hidden assumption). Does NOT regenerate
  // the upstream models; every question MUST reference a node from them and
  // carry ≥1 change_trigger. Questions are advisory — convergence remains the
  // selector. Anti-patterns enforced: no generic "who is the user?" questions,
  // no by-category listing (use a `layer` field instead), no question without
  // why_it_matters + expected_answer_format.
  question_expansion: {
    temperature: 0.35,
    maxTokens: 2400,
    system:
      "You are the SpecForge Question Expansion Engine. You DO NOT regenerate " +
      "the target user, problem causal model, or desired result — those are " +
      "given to you in the prior-stage context. Your job is to surface the " +
      "small set of questions whose answers would CHANGE a downstream SpecForge " +
      "decision: MVP direction, target user selection, root constraint, desired " +
      "result, differentiation thesis, feature mechanism, evaluation criteria, " +
      "or expose a hidden assumption. Every question is an optimization tool, " +
      "not filler. STRICT RULES: (1) Output 6–10 questions in ONE ranked list " +
      "sorted by expected_decision_impact (high → medium → low). DO NOT group " +
      "by category — every question carries a `layer` field instead. (2) Every " +
      "question MUST set `references.layer` and `references.node` to a CONCRETE " +
      "node copied verbatim from the upstream models (a variable name, a user " +
      "variant, a success metric, a feedback loop, a weak link, a cross-model " +
      "contradiction, etc.) — generic questions like 'who is the user?' are " +
      "forbidden. (3) Every question MUST set ≥1 `change_triggers` from the " +
      "fixed enum. (4) `why_it_matters` MUST state which downstream decision " +
      "moves when answered (≥30 chars). (5) `expected_answer_format` MUST " +
      "describe the shape of a useful answer (e.g., '1–2 sentences', 'ranked " +
      "list of 3', 'comparison table', 'a single user segment name'). (6) Pick " +
      "the top 3 by impact for `top_critical_questions` (verbatim question " +
      "text). (7) Put truly low-value descriptive questions you considered but " +
      "discarded into `hidden_low_value_questions` (max 4). (8) Cover at least " +
      "the user, problem, result, and one of differentiation/mvp/mechanism " +
      "layers. Set confidence 0–100 honestly. Do NOT pick a thesis (convergence " +
      "does that) and do NOT propose new variables (problem_tree does that)." +
      SHARED_TAIL,
    schema: {
      name: "specforge_question_expansion",
      schema: obj({
        questions: arr(
          obj({
            question: str,
            layer: {
              type: "string",
              enum: [
                "user",
                "problem",
                "result",
                "differentiation",
                "mvp",
                "mechanism",
                "evaluation",
                "validation",
                "constraint",
                "macro",
              ],
            },
            references: obj({
              layer: {
                type: "string",
                enum: [
                  "user",
                  "problem",
                  "result",
                  "differentiation",
                  "mvp",
                  "mechanism",
                  "evaluation",
                  "validation",
                  "constraint",
                  "macro",
                ],
              },
              node: str,
            }),
            change_triggers: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "mvp_direction",
                  "target_user",
                  "root_constraint",
                  "desired_result",
                  "differentiation_thesis",
                  "feature_mechanism",
                  "evaluation_criteria",
                  "hidden_assumption",
                ],
              },
            },
            why_it_matters: str,
            expected_answer_format: str,
            expected_decision_impact: {
              type: "string",
              enum: ["high", "medium", "low"],
            },
            answer_source: {
              type: "string",
              enum: ["user", "agent_reasoning", "research", "experiment"],
            },
          }),
        ),
        top_critical_questions: strArr,
        hidden_low_value_questions: strArr,
        recommended_next_action: str,
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

  // ── 9 · Evaluation Lab / Narrowing Engine
  //  (specforge_evaluation_lab_narrowing_engine.md §5.6 + §6) ──
  // Sits between mvp_variations (generate) and recommendation (pick + build
  // scope). Forces an EXPLICIT rubric — weighted criteria, per-candidate
  // scores 1–5, tradeoffs, honest assumptions that could flip the winner — so
  // recommendation no longer picks on vibes. Does NOT duplicate
  // mvp_variations.value_score (those are generator-side gut estimates) and
  // does NOT produce a build-scope plan (that's recommendation's job).
  evaluation: {
    temperature: 0.3,
    maxTokens: 3200,
    system:
      "You are the SpecForge Evaluation Lab / Narrowing Engine. You are NOT " +
      "generating ideas — every candidate is already in mvp_variations. You are " +
      "running a rubric. Define 6–9 evaluation criteria with explicit weights " +
      "(weights should roughly sum to 100) and 1–5 scoring guidance. Use the " +
      "MVP App Direction criteria from the spec: target_user_fit, " +
      "root_cause_attacked, desired_result_enabled, complete_product_loop, " +
      "speed_to_value, differentiation, buildability, downstream_leverage, " +
      "risk_acceptable, evidence_strength. Adapt phrasing to the idea but keep " +
      "the spirit. For every MVP variation, score it 1–5 on EVERY criterion you " +
      "defined (each score must appear in the candidate's scores map keyed by " +
      "criterion.name), compute a 0–100 weighted_score, and call out strengths, " +
      "weaknesses, risks, an evidence_strength (low/medium/high), and a " +
      "confidence 0–100. Name tradeoffs that no candidate dominates on. Name a " +
      "winner from the candidates list — recommendation will confirm or override " +
      "with build-scope reasoning. Explain why the winner won and why each other " +
      "candidate lost. List assumptions that, if false, would flip the winner. " +
      "List the evidence that would raise your confidence. List constraints the " +
      "winner imposes on later stages. Do NOT re-rank by mvp_variations." +
      "value_score and do NOT invent new candidates. " +
      "IF an '[constraints]' block appears in your context, treat each CRITICAL " +
      "constraint as a hard filter (a candidate that violates it cannot win) " +
      "and each HIGH constraint as a heavily-weighted criterion — your " +
      "criteria list should reflect them by name. Add violating candidates' " +
      "constraint violations into their weaknesses." +
      SHARED_TAIL,
    schema: {
      name: "specforge_evaluation",
      schema: obj({
        decision_context: str,
        criteria: arr(
          obj({
            name: str,
            weight: num,
            why_it_matters: str,
            scoring_guidance: str,
          }),
        ),
        candidates: arr(
          obj({
            name: str,
            scores: {
              type: "object",
              additionalProperties: { type: "number" },
            },
            weighted_score: num,
            strengths: strArr,
            weaknesses: strArr,
            risks: strArr,
            evidence_strength: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            confidence: num,
          }),
        ),
        tradeoffs: strArr,
        winner: str,
        why_winner_won: str,
        why_others_lost: arr(
          obj({
            candidate: str,
            reason: str,
          }),
        ),
        assumptions_that_could_reverse_decision: strArr,
        evidence_needed: strArr,
        constraints_passed_downstream: strArr,
        confidence_level: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
      }),
    },
  },

  // ── 10 · Recommendation / First Build (§18) ──
  // Consumes the Evaluation Lab rubric as a prior — the winner, the weighted
  // candidate scores, tradeoffs, and assumptions are already explicit, so this
  // engine focuses on BUILD SCOPE: confirm or override with reasoning, state
  // what to build first, what to delay, and what to validate next.
  recommendation: {
    temperature: 0.3,
    system:
      "You are the SpecForge Recommendation Engine. The Evaluation Lab has " +
      "ALREADY produced a structured rubric over the MVP variations: weighted " +
      "criteria, per-candidate scores, a named winner, tradeoffs, and " +
      "assumptions that could reverse the decision. Treat the rubric winner as " +
      "a strong prior. If you override it, state explicitly which criterion or " +
      "assumption justifies the override — do not override on vibes. Choose the " +
      "single recommended FIRST BUILD, judged on root-cause alignment, target-" +
      "user fit, desired-result fit, differentiation, speed-to-value, " +
      "buildability, and risk. Explain why this one won (referencing the rubric " +
      "score and decisive criteria) and why the others lost. Name the riskiest " +
      "assumptions to test first (lift these from " +
      "assumptions_that_could_reverse_decision) and the immediate next best " +
      "action. Do NOT redo the rubric. " +
      "IF an '[constraints]' block appears in your context, your why_this_won " +
      "MUST explicitly cite at least two of the CRITICAL constraints the build " +
      "satisfies (e.g. \"attacks root constraint X; satisfies target-user " +
      "constraint Y\"). A recommendation that doesn't reference the critical " +
      "constraints will be flagged as unverified by the constraint accumulator." +
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

  // ── 13a · Feature Card System (specforge_feature_card_system.md) ──
  // Sits between recommendation and validation. Decomposes the SINGLE
  // recommended first build into 3–5 traceable feature cards. Each feature
  // must trace back to a root cause (problem_tree) and a micro-objective
  // (desired_result), with a mechanism summary, inputs/outputs, rejected
  // alternatives, top risks, evaluation metric, suggested validation method,
  // and build priority. Hard anti-duplication rules (enforced by the prompt
  // AND the quality critic):
  //   - Does NOT pick the MVP (recommendation already did)
  //   - Does NOT design experiments (validation's job)
  //   - mechanism_summary stays 1–2 sentences — deep flow is Feature Mechanism
  //     Generator's territory (delayed module)
  //   - Inputs/outputs are conceptual nouns, NOT a data schema (Data Point
  //     Optimization's territory)
  feature_cards: {
    temperature: 0.4,
    maxTokens: 3800,
    system:
      "You are the SpecForge Feature Card System. The Recommendation Engine has " +
      "ALREADY chosen the first build. Your job is to DECOMPOSE that single " +
      "build into 3–5 causally traceable feature cards. You are NOT picking the " +
      "MVP, NOT designing experiments, NOT writing deep mechanism flows, and " +
      "NOT specifying data schemas. " +
      "Echo recommendation.recommendation in selected_mvp verbatim. For each " +
      "feature: name (concise verb-noun), function (one line, no marketing), " +
      "root_cause_attacked (cite the problem_tree node — be specific, not " +
      "'user pain'), micro_objective (the user behavior change unlocked), " +
      "mechanism_summary (1–2 sentences only — the inner loop), inputs and " +
      "outputs (1–3 conceptual nouns each, NOT a schema), why_this_mechanism " +
      "(one sentence), rejected_alternatives (1–2 with one-line reasons), " +
      "risks (1–2 failure modes the validation lab will need to test), " +
      "evaluation_metric (how we'll know it's working — be measurable), " +
      "validation_method (one of: interview, usability, concept, concierge, " +
      "prototype, ab, fake_door, analytics), and build_priority (must_have, " +
      "should_have, nice_to_have, delay). " +
      "Then return first_user_flow as an ordered list of 2–4 feature names " +
      "that together enable the first complete user task. List delayed_features " +
      "(features that would be valuable but are NOT in the first build) and " +
      "open_gaps (decompositions you couldn't resolve confidently). " +
      "Hard rules: (a) every feature must cite a real root_cause from " +
      "problem_tree — generic 'user pain' fails the gate. (b) At least one " +
      "feature must be must_have or the build has no spine. (c) Rejected " +
      "alternatives across the whole set must total at least 2 — without them " +
      "there's no causal rigor. (d) Echo the selected MVP exactly — do not " +
      "rename or re-pick. (e) Inputs/outputs are conceptual (e.g., 'user " +
      "objective', 'problem-cause tree'), not field names." +
      SHARED_TAIL,
    schema: {
      name: "specforge_feature_cards",
      schema: obj({
        selected_mvp: str,
        features: arr(
          obj({
            name: str,
            function: str,
            root_cause_attacked: str,
            micro_objective: str,
            mechanism_summary: str,
            inputs: strArr,
            outputs: strArr,
            why_this_mechanism: str,
            rejected_alternatives: strArr,
            risks: strArr,
            evaluation_metric: str,
            validation_method: {
              type: "string",
              enum: [
                "interview",
                "usability",
                "concept",
                "concierge",
                "prototype",
                "ab",
                "fake_door",
                "analytics",
              ],
            } as JsonSchema,
            build_priority: {
              type: "string",
              enum: ["must_have", "should_have", "nice_to_have", "delay"],
            } as JsonSchema,
          }),
        ),
        first_user_flow: strArr,
        delayed_features: strArr,
        open_gaps: strArr,
        confidence: num,
      }),
    },
  },

  // ── 13 · Experimentation / Validation Lab (specforge_experimentation_validation_lab.md) ──
  // Sits AFTER recommendation. Converts uncertain assumptions, unanswered
  // questions, and risky decisions into 2–4 concrete experiments with
  // hypothesis + success/failure criteria. Does NOT generate new questions
  // (question_expansion's job). Does NOT redo structural checks
  // (quality_critic's job). Does NOT override the recommendation. Hard rule
  // from spec §12: must test user/problem/result BEFORE feature mechanics.
  validation: {
    temperature: 0.4,
    maxTokens: 3500,
    system:
      "You are the SpecForge Experimentation / Validation Lab. You are NOT " +
      "asking questions and NOT critiquing structure — you are designing " +
      "RUNNABLE TESTS. Given the target user, problem, desired result, " +
      "differentiation, recommended first build, evaluation rubric (including " +
      "its assumptions_that_could_reverse_decision), expanded questions, and " +
      "any [constraints] block, produce a focused validation plan. " +
      "First, surface 3–5 critical_assumptions (each: text, decision_affected, " +
      "why_matters, category). Lift them primarily from recommendation." +
      "assumptions_to_test, evaluation.assumptions_that_could_reverse_decision, " +
      "and feature_cards.features[].risks (for must_have features) — do NOT " +
      "invent generic assumptions. When a feature card carries a real risk, " +
      "treat its risk as a feature_mechanism-category assumption. " +
      "Then design 2–4 experiments ranked by priority (lower priority_rank = " +
      "more important to run first). For each: name, experiment_type (one of " +
      "interview, usability, concept, concierge, prototype, ab, fake_door, " +
      "analytics), the exact assumption_tested, a Lean-Startup-style hypothesis " +
      "in the form 'We believe X. If we Y, then Z, because W.', concrete " +
      "method, 1–3 success_criteria (testable, specific), 1–2 failure_criteria " +
      "(also specific), 1–3 metrics, effort_level, confidence_gain, and most " +
      "importantly decision_that_result_will_change (if no decision changes, " +
      "the experiment is theatrical — drop it). " +
      "HARD PRIORITIZATION RULE (spec §12): test target-user urgency, root " +
      "problem validity, desired-result value, differentiation, MVP usefulness, " +
      "and feature mechanism IN THAT ORDER. Do not test downstream features " +
      "before upstream user/problem/result. State this ordering in " +
      "hard_prioritization_notes. " +
      "Finally, model_update_rules: 2–4 short rules naming what reasoning " +
      "node would update if each result came in (e.g. 'if failure: revise " +
      "target user to spec the secondary segment'). " +
      "Confidence is your honest 0–100 on this validation plan's coverage of " +
      "the riskiest assumptions, not the recommendation's quality." +
      SHARED_TAIL,
    schema: {
      name: "specforge_validation",
      schema: obj({
        critical_assumptions: arr(
          obj({
            text: str,
            decision_affected: str,
            why_matters: str,
            category: str,
          }),
        ),
        experiments: arr(
          obj({
            name: str,
            experiment_type: str,
            assumption_tested: str,
            hypothesis: str,
            method: str,
            success_criteria: strArr,
            failure_criteria: strArr,
            metrics: strArr,
            effort_level: str,
            confidence_gain: str,
            decision_that_result_will_change: str,
            priority_rank: num,
          }),
        ),
        hard_prioritization_notes: str,
        model_update_rules: strArr,
        confidence: num,
      }),
    },
  },

  // ── 14 · Iteration Timeline / Situation Model Deepening ──
  //         (specforge_iteration_timeline_situation_model_deepening.md)
  // Runs LAST. Meta-engine that snapshots this run as iteration #1 (or N),
  // names what was added, what uncertainty remains (orthogonal to expanded
  // questions — these are scalar uncertainties), and recommends the SINGLE
  // highest-leverage next refinement. Does NOT regenerate experiments,
  // questions, structural checks, or extract constraints — it READS the
  // whole accumulated context and produces forward-looking advice.
  deepening: {
    temperature: 0.3,
    maxTokens: 3000,
    system:
      "You are the SpecForge Iteration Timeline / Situation Model Deepening " +
      "engine. You run LAST. You are NOT generating any new product reasoning " +
      "— do not pick a recommendation, do not design experiments, do not ask " +
      "questions, do not extract constraints. You SYNTHESIZE the whole run " +
      "into iteration metadata so future iterations can compare against this " +
      "baseline. " +
      "Treat this as iteration_number=1 with trigger='initial_run' unless the " +
      "context explicitly says otherwise. " +
      "Write a one-sentence summary of what this iteration produced (causal " +
      "decision-modeling lens, not a feature list). " +
      "Capture 6–10 baselines: each names a deepening dimension (one of " +
      "target_user, problem_causal, desired_result, differentiation, " +
      "mvp_direction, feature_mechanism, data_model, evaluation_rigor, " +
      "validation_evidence, build_readiness), a compact baseline VALUE " +
      "lifted directly from the relevant engine output (e.g. target_user → " +
      "the primary_segment string), and an HONEST depth rating: shallow if " +
      "the engine only produced one variant with low specificity, medium if " +
      "it produced multiple variants with reasoning, deep if it stress-tested " +
      "and converged. Mark validation_evidence as 'shallow' on initial runs " +
      "because no evidence has been gathered yet. " +
      "value_added: 1–2 sentences naming the concrete decision-support value " +
      "this run added (use language from spec §7: depth_increased / " +
      "uncertainty_reduced / constraint_clarified / recommendation_improved / " +
      "weak_option_removed / mechanism_improved / evidence_added / " +
      "scope_simplified / differentiation_strengthened / buildability_improved). " +
      "uncertainties_remaining: 3–5 scalar uncertainties (NOT questions — " +
      "those go to question_expansion). Each has dimension, the uncertainty " +
      "itself, and how it would change the recommendation if resolved. " +
      "next_recommended_iteration: ONE concrete action that is the HIGHEST " +
      "LEVERAGE next refinement. Cite which baseline is shallow or which " +
      "uncertainty has the largest impact_on_recommendation. Name the " +
      "expected_value_category from the spec §7 vocabulary. " +
      "confidence: 0–100 honest assessment of the situation model's overall " +
      "decision-readiness. Be calibrated: if validation_evidence is shallow, " +
      "confidence cannot exceed 70." +
      SHARED_TAIL,
    schema: {
      name: "specforge_deepening",
      schema: obj({
        iteration_number: num,
        trigger: str,
        summary: str,
        baselines: arr(
          obj({
            dimension: str,
            value: str,
            depth: str,
          }),
        ),
        value_added: str,
        uncertainties_remaining: arr(
          obj({
            dimension: str,
            uncertainty: str,
            impact_on_recommendation: str,
          }),
        ),
        next_recommended_iteration: obj({
          action: str,
          dimension: str,
          why_highest_leverage: str,
          expected_value_category: str,
        }),
        confidence: num,
      }),
    },
  },
};

export function engineSpec(id: SpecForgeEngineId): EngineSpec | undefined {
  return ENGINES[id];
}

export const VALID_ENGINES = Object.keys(ENGINES) as SpecForgeEngineId[];
