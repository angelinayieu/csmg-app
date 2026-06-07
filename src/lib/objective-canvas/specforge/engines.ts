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
      "defined (the candidate's `scores` array must contain one entry per " +
      "criterion, with `criterion` matching criterion.name exactly and `score` " +
      "in 1–5), compute a 0–100 weighted_score, and call out strengths, " +
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
            scores: arr(
              obj({
                criterion: str,
                score: num,
              }),
            ),
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

  // ── 13 · Complexity Allocation Engine (specforge_complexity_allocation_engine.md) ──
  // Sits between recommendation and feature_cards. Sets the v1 complexity
  // budget (6 buckets summing to 100), scores each candidate module on a
  // complexity-to-value ratio + downstream leverage, and produces overbuilt /
  // underbuilt warnings + reallocation recommendations + first_build / delayed
  // / removed scope. Hard anti-duplication rules (enforced by prompt + critic):
  //   - Does NOT pick the recommendation (recommendation's job)
  //   - Does NOT decompose features (feature_cards's job — but its delayed_scope
  //     is a hard constraint feature_cards must respect)
  //   - Does NOT design mechanisms (feature_mechanisms's job)
  //   - Does NOT design experiments (validation's job)
  //   - Does NOT pick a depth level (depth_selection's job — that decides HOW
  //     DEEP to think upstream; this decides WHERE to spend build effort)
  complexity_allocation: {
    temperature: 0.3,
    maxTokens: 3200,
    system:
      "You are the SpecForge Complexity Allocation Engine. The Recommendation " +
      "Engine has already chosen the v1 build; you decide WHERE TO SPEND " +
      "complexity. You are NOT picking the recommendation, NOT decomposing " +
      "features, NOT designing mechanisms, NOT designing experiments, NOT " +
      "picking a depth level. Echo recommendation.recommendation in selected_mvp. " +
      "Produce ONE complexity_budget (six buckets — reasoning, ui, technical, " +
      "interaction, data, evaluation — summing to ~100, total=100 always). " +
      "Per spec §6, for product types that win on REASONING + NARROWING (idea " +
      "shaping, decision support, causal modeling), reasoning + evaluation MUST " +
      "dominate (their sum ≥55) and ui should NOT exceed 25. For product types " +
      "that win on EXPERIENCE / CONTENT (creative tools, media, social), ui + " +
      "interaction may lead. Choose based on the product thesis. Include a one-" +
      "line philosophy explaining the allocation. " +
      "Then score 6–10 candidate modules from the system: include the upstream " +
      "reasoning modules (e.g. Multifactor Causal Modeling, Convergence, " +
      "Evaluation Lab, Differentiation, Constraint Accumulation) AND the " +
      "downstream surface modules implied by feature_cards / spec_export / " +
      "validation (e.g. Full Graph View, Side Panel, Spec Exporter, " +
      "Collaboration, Research Automation, Onboarding). For each: reasoning_" +
      "complexity, ui_complexity, technical_complexity, user_comprehension_cost " +
      "(very_low/low/medium/high/very_high), value_return (same scale), " +
      "downstream_leverage (same scale), complexity_to_value_ratio (high/medium/" +
      "low — applying the §9 rule: value_return / cost), and build_recommendation " +
      "(build_full / build_partial / build_minimal / delay / remove). " +
      "Per spec §11–13, produce: overbuilt_warnings (modules getting too much " +
      "complexity too early — cite WHY, e.g. 'depends on unresolved upstream " +
      "reasoning', 'visually impressive but not decision-critical'), " +
      "underbuilt_warnings (core modules too shallow — cite which downstream " +
      "modules depend on them), and reallocation_recommendations (reduce X → " +
      "increase Y, with a one-line rationale). " +
      "Produce three disjoint lists: first_build_scope (modules feature_cards " +
      "MUST include — these are build_full / build_partial), delayed_scope " +
      "(modules feature_cards MUST give build_priority='delay'), and " +
      "removed_scope (modules to drop entirely from v1 — feature_cards must " +
      "not surface them at all). Finish with build_discipline_rule (1–3 " +
      "sentences feature_cards / spec_export must obey verbatim — this is the " +
      "guardrail) and confidence (0–100). " +
      "Hard rules: (a) bucket sum 95–105 or you fail the gate. (b) For idea-" +
      "shaping / decision-support / reasoning-heavy products, reasoning + " +
      "evaluation ≥ 55. (c) underbuilt_warnings must include at least one " +
      "upstream reasoning module. (d) overbuilt_warnings must include at " +
      "least one downstream surface module (visualization, collaboration, " +
      "spec export, research automation, advanced UI). (e) first_build_scope " +
      "and delayed_scope MUST NOT overlap. (f) Every module named in any " +
      "warning, reallocation, or scope list MUST appear in module_scores." +
      SHARED_TAIL,
    schema: {
      name: "specforge_complexity_allocation",
      schema: obj({
        selected_mvp: str,
        budget: obj({
          total: num,
          reasoning: num,
          ui: num,
          technical: num,
          interaction: num,
          data: num,
          evaluation: num,
          philosophy: str,
        }),
        module_scores: arr(
          obj({
            module_name: str,
            reasoning_complexity: { type: "string", enum: ["very_low", "low", "medium", "high", "very_high"] },
            ui_complexity: { type: "string", enum: ["very_low", "low", "medium", "high", "very_high"] },
            technical_complexity: { type: "string", enum: ["very_low", "low", "medium", "high", "very_high"] },
            user_comprehension_cost: { type: "string", enum: ["very_low", "low", "medium", "high", "very_high"] },
            value_return: { type: "string", enum: ["very_low", "low", "medium", "high", "very_high"] },
            downstream_leverage: { type: "string", enum: ["very_low", "low", "medium", "high", "very_high"] },
            complexity_to_value_ratio: { type: "string", enum: ["high", "medium", "low"] },
            build_recommendation: { type: "string", enum: ["build_full", "build_partial", "build_minimal", "delay", "remove"] },
          }),
        ),
        overbuilt_warnings: arr(obj({ module: str, reason: str })),
        underbuilt_warnings: arr(obj({ module: str, reason: str })),
        reallocation_recommendations: arr(
          obj({ reduce: str, increase: str, rationale: str }),
        ),
        first_build_scope: strArr,
        delayed_scope: strArr,
        removed_scope: strArr,
        build_discipline_rule: str,
        confidence: num,
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
      "If [complexity_allocation] is present in context, OBEY it as a hard " +
      "constraint: every feature must map to a module in first_build_scope OR " +
      "delayed_scope; features whose module is in first_build_scope get " +
      "build_priority must_have or should_have; features whose module is in " +
      "delayed_scope MUST get build_priority='delay'; do NOT propose features " +
      "for modules in removed_scope. The build_discipline_rule applies to the " +
      "whole feature set. " +
      "Hard rules: (a) every feature must cite a real root_cause from " +
      "problem_tree — generic 'user pain' fails the gate. (b) At least one " +
      "feature must be must_have or the build has no spine. (c) Rejected " +
      "alternatives across the whole set must total at least 2 — without them " +
      "there's no causal rigor. (d) Echo the selected MVP exactly — do not " +
      "rename or re-pick. (e) Inputs/outputs are conceptual (e.g., 'user " +
      "objective', 'problem-cause tree'), not field names. (f) Respect the " +
      "complexity_allocation scopes if present — first_build_scope features " +
      "are must_have/should_have; delayed_scope features are delay; " +
      "removed_scope features must not appear." +
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

  // ── 13 · Feature Mechanism Generator (specforge_feature_mechanism_generator.md) ──
  // Sits AFTER feature_cards. Each feature already has a shallow `mechanism`
  // field — this engine deepens each one into a full input → process → output
  // spec with alternatives compared, failure modes, and test method. Does NOT
  // generate features (feature_cards's job — operates on the existing list).
  // Does NOT pick the recommendation (recommendation's job). Does NOT design
  // experiments (validation's job — though each mechanism's test_method is
  // lifted as a candidate by validation). Hard rule from spec §19: every
  // mechanism MUST link to a feature_cards.features[i].name and MUST transform
  // inputs into outputs with explicit ordered processing steps.
  feature_mechanisms: {
    temperature: 0.4,
    maxTokens: 4000,
    system:
      "You are the SpecForge Feature Mechanism Generator. You are NOT " +
      "generating feature names — every mechanism MUST link to an existing " +
      "feature in [feature_cards] by name. For each top-priority feature (rank " +
      "1, 2, and 3 by build_priority), design the internal mechanism that " +
      "makes the feature work. A mechanism is INPUT → PROCESS → OUTPUT, not " +
      "a description. Per spec §6, decompose each mechanism into ordered " +
      "layers: trigger → inputs → ordered system_process steps → " +
      "data_transformations → outputs → user_behavior_changed. " +
      "Per spec §16, compare 2–3 mechanism alternatives explicitly and state " +
      "WHY the selected one won. Per spec §15, name 2+ failure modes and a " +
      "risk_control for each. Per spec §17, the test_method must be specific " +
      "enough that the validation lab could lift it as an experiment. " +
      "implementation_difficulty must be low/medium/high based on whether " +
      "the mechanism needs net-new infra. " +
      "Hard rules: do NOT output mechanisms for features not in [feature_cards]; " +
      "do NOT skip the alternatives comparison; do NOT name a generic " +
      "test_method like 'user feedback'; do NOT design experiments — " +
      "validation does that." +
      SHARED_TAIL,
    schema: {
      name: "specforge_feature_mechanisms",
      schema: obj({
        selected_mvp: str,
        mechanisms: arr(
          obj({
            feature_name: str,
            mechanism_name: str,
            mechanism_thesis: str,
            trigger: str,
            inputs: strArr,
            system_process: strArr,
            outputs: strArr,
            user_behavior_changed: str,
            data_transformations: strArr,
            downstream_effects: strArr,
            alternatives: arr(
              obj({
                name: str,
                why_rejected: str,
              }),
            ),
            selected_mechanism_reason: str,
            failure_modes: strArr,
            risk_controls: strArr,
            test_method: str,
            implementation_difficulty: str,
            constraints_satisfied: strArr,
          }),
        ),
        features_not_mechanized: strArr,
        cross_mechanism_dependencies: strArr,
        confidence: num,
      }),
    },
  },

  // ── 14 · Data Point Optimization Model (specforge_data_point_optimization_model.md) ──
  // Sits AFTER feature_mechanisms, BEFORE validation. Deepens the shallow
  // `inputs` strings declared by each mechanism into full data-point objects:
  // concept + variables, source, collection methods, friction/reliability/
  // privacy risk, downstream uses, transformation, alternative proxies, and
  // selected disposition (required/optional/inferred/progressive/proxy/removed).
  // Hard anti-duplication rules (spec §3 + §17):
  //   - Does NOT regenerate features (feature_cards's job)
  //   - Does NOT regenerate mechanisms (feature_mechanisms's job)
  //   - Does NOT design experiments (validation's job; validation_needed is a
  //     1-line hint validation will lift)
  //   - Does NOT pick the MVP (recommendation's job)
  //   - Every data_point MUST link to an existing mechanism in
  //     [feature_mechanisms] by name (used_by_mechanism)
  data_points: {
    temperature: 0.35,
    maxTokens: 4000,
    system:
      "You are the SpecForge Data Point Optimization Model. You are NOT " +
      "generating features or mechanisms — every data point MUST link to an " +
      "existing mechanism in [feature_mechanisms] by name (used_by_mechanism) " +
      "and to its parent feature (used_by_feature). Walk the mechanisms' " +
      "`inputs` and deepen each one into an optimization object per spec §5. " +
      "Per spec §6.1–6.2, define the concept and decompose it into variables " +
      "(prevent vague data). Per spec §6.4, name collection_friction honestly: " +
      "if collection is high-friction and downstream uses are weak, propose a " +
      "lower-friction proxy or set disposition='removed' with a reason in " +
      "removed_data. Per spec §6.5, name reliability_risk (self-report bias, " +
      "ambiguous interpretation, inference error, etc.). Per spec §6.6, name " +
      "privacy_risk (sensitive examples: identity, health, location, finances, " +
      "relationships). Per spec §6.7, every why_it_exists must reference a " +
      "downstream mechanism/eval/validation — no data without a downstream " +
      "consumer (disposition='removed' if none). Per spec §9, propose at least " +
      "one alternative_proxy for every required data point (e.g., 'inferred " +
      "from interaction patterns' instead of 'asked directly'). disposition " +
      "must be one of: required, optional, inferred, progressive, proxy, " +
      "removed. selected_handling_method explains the chosen approach in one " +
      "line. failure_modes lists 1–2 ways the data can be missing/wrong/" +
      "sensitive. validation_needed is a 1-line hint the validation lab can " +
      "lift (do NOT design the experiment here). constraints_created names " +
      "the constraint this data point imposes on the build (e.g., 'must " +
      "support optional skip with no-degradation fallback'). " +
      "Hard rules: do NOT invent data points not implied by feature_mechanisms." +
      "inputs; do NOT skip alternative_proxies for required data; do NOT use " +
      "generic source/disposition/risk values; do NOT design experiments." +
      SHARED_TAIL,
    schema: {
      name: "specforge_data_points",
      schema: obj({
        selected_mvp: str,
        data_points: arr(
          obj({
            data_point_id: str,
            name: str,
            concept_definition: str,
            variables: strArr,
            used_by_feature: str,
            used_by_mechanism: str,
            why_it_exists: str,
            when_needed: str,
            source: {
              type: "string",
              enum: [
                "user_input",
                "inferred",
                "integration",
                "system_generated",
                "research",
                "analytics",
              ],
            },
            collection_methods: strArr,
            collection_friction: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            reliability_risk: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            privacy_risk: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            downstream_uses: strArr,
            transformation_process: str,
            alternative_proxies: strArr,
            disposition: {
              type: "string",
              enum: [
                "required",
                "optional",
                "inferred",
                "progressive",
                "proxy",
                "removed",
              ],
            },
            selected_handling_method: str,
            why_selected: str,
            failure_modes: strArr,
            validation_needed: strArr,
            constraints_created: strArr,
          }),
        ),
        removed_data: arr(
          obj({
            name: str,
            reason: str,
          }),
        ),
        data_flow_summary: str,
        risks: strArr,
        confidence: num,
      }),
    },
  },

  // ── 14b · Recursive Layer Optimization (specforge_recursive_layer_optimization_engine.md) ──
  // Sits AFTER data_points (sees all 3 layers), BEFORE validation (so it can
  // direct validation effort to misaligned layers). Walks macro → micro →
  // mechanism, checks each layer still serves its parent (spec §4.4 cross-
  // layer alignment), runs consequential evaluation per §9 ("does this layer
  // improve the next?"), produces repair recommendations when drift is found.
  //
  // Hard anti-duplication rules — the prompt enforces these:
  //  - does NOT pick a new macro objective (lift from convergence verbatim)
  //  - does NOT decompose into new features (lift from feature_cards verbatim)
  //  - does NOT design new mechanisms (lift from feature_mechanisms verbatim)
  //  - does NOT allocate complexity (complexity_allocation's job)
  //  - does NOT generate new questions (question_expansion's job)
  //  - does NOT enforce structural quality (quality_critic's job)
  // Its UNIQUE contribution: vertical alignment edges between layers + the
  // consequential lift between adjacent chain stages.
  layer_optimization: {
    temperature: 0.3,
    maxTokens: 4500,
    system:
      "You are the SpecForge Recursive Layer Optimization Engine. You are " +
      "an AUDITOR, not a generator. You do NOT pick a new macro objective, " +
      "do NOT decompose into new features, do NOT design new mechanisms, " +
      "do NOT allocate complexity, do NOT generate questions, do NOT redo " +
      "structural quality gates. Your job is VERTICAL alignment: walk macro " +
      "→ micro → mechanism and check whether each layer still serves the " +
      "one above. " +
      "Macro: lift convergence.distilled_product_thesis (or recommendation." +
      "recommendation if convergence is thin) as macro.objective and macro." +
      "selected_output. parent stays empty. " +
      "Micros: one node per feature_cards.features[] entry, in original " +
      "order. micro.objective = the feature's function (the user behavior " +
      "change). micro.parent = the macro objective. selected_output = " +
      "feature mechanism_summary. rejected_alternatives = the feature's " +
      "alternatives_considered. constraints_passed_down = the feature's " +
      "risks (becomes mechanism/data constraints). " +
      "Mechanisms: one node per feature_mechanisms.mechanisms[] entry. " +
      "mechanism.objective = mechanism_thesis. mechanism.parent = the " +
      "feature name it links to (mechanism.feature_name). " +
      "selected_output = mechanism_name. rejected_alternatives = " +
      "alternatives_rejected[].name. constraints_passed_down = a 1-line " +
      "data requirement derived from inputs[]. " +
      "Alignment checks: REQUIRED — produce exactly one check per micro " +
      "(edge: micro_to_macro) AND exactly one check per mechanism " +
      "(edge: mechanism_to_micro). verdict ∈ {aligned, drifted, broken}. " +
      "verdict = 'broken' when the child names a different domain than its " +
      "parent (e.g. mechanism is a billing mechanism under a content feature). " +
      "verdict = 'drifted' when the child solves a related but distinct sub-" +
      "problem (e.g. mechanism improves user delight when the feature is " +
      "about decision speed). verdict = 'aligned' otherwise. Every drifted " +
      "or broken check MUST include a repair_recommendation (concrete: " +
      "'replace mechanism X with one that targets Y' — not generic advice). " +
      "Consequential evaluations: REQUIRED — produce exactly four, in this " +
      "order: (1) current=recommendation, next=feature_cards; (2) current=" +
      "feature_cards, next=feature_mechanisms; (3) current=feature_mechanisms, " +
      "next=data_points; (4) current=data_points, next=validation. For each, " +
      "name a CONCRETE downstream_improvement (what the next engine can do " +
      "BETTER because this engine's output is good) and a CONCRETE " +
      "downstream_risk_if_wrong. dependency_strength reflects how tightly " +
      "next-layer quality depends on this one. recommendation = 'accept' if " +
      "no drift was found upstream, 'deepen' if any same-layer alignment " +
      "drifted, 'repair' if any check upstream was broken, 'reject' only if " +
      "the whole branch is unsalvageable. " +
      "Per quality gate (spec §14): every layer node must have a clear " +
      "objective, must connect to its parent, must pass constraints down. " +
      "Set quality_gate_status = 'needs_repair' when objective is empty " +
      "OR constraints_passed_down is empty OR (for micro/mechanism) parent " +
      "is empty. " +
      "Per repair triggers (spec §5.7): collect into layers_to_repair every " +
      "layer node whose quality_gate_status is 'needs_repair' OR which is " +
      "the child side of any 'drifted' or 'broken' alignment check. The " +
      "reason field must reference the specific drift or gate failure — " +
      "not generic 'deepen this'. " +
      "alignment_summary: ONE sentence stating how well macro→micro→" +
      "mechanism still serves the original mission. Be honest — drifted " +
      "alignment should show in the language. " +
      "Confidence (0–100) reflects how aligned the whole stack is. If any " +
      "alignment check is 'broken' OR more than 30% of checks are 'drifted', " +
      "confidence MUST be ≤55." +
      SHARED_TAIL,
    schema: {
      name: "specforge_recursive_layer_optimization",
      schema: obj({
        macro: obj({
          name: str,
          layer_type: { type: "string", enum: ["macro"] },
          objective: str,
          parent: str,
          selected_output: str,
          rejected_alternatives: strArr,
          constraints_passed_down: strArr,
          quality_gate_status: { type: "string", enum: ["passed", "needs_repair"] },
        }),
        micros: arr(
          obj({
            name: str,
            layer_type: { type: "string", enum: ["micro"] },
            objective: str,
            parent: str,
            selected_output: str,
            rejected_alternatives: strArr,
            constraints_passed_down: strArr,
            quality_gate_status: { type: "string", enum: ["passed", "needs_repair"] },
          }),
        ),
        mechanisms: arr(
          obj({
            name: str,
            layer_type: { type: "string", enum: ["mechanism"] },
            objective: str,
            parent: str,
            selected_output: str,
            rejected_alternatives: strArr,
            constraints_passed_down: strArr,
            quality_gate_status: { type: "string", enum: ["passed", "needs_repair"] },
          }),
        ),
        alignment_checks: arr(
          obj({
            child: str,
            parent: str,
            edge: { type: "string", enum: ["micro_to_macro", "mechanism_to_micro"] },
            verdict: { type: "string", enum: ["aligned", "drifted", "broken"] },
            rationale: str,
            repair_recommendation: str,
          }),
        ),
        consequential_evaluations: arr(
          obj({
            current_layer: str,
            next_layer: str,
            downstream_improvement: str,
            downstream_risk_if_wrong: str,
            dependency_strength: { type: "string", enum: ["low", "medium", "high"] },
            recommendation: { type: "string", enum: ["accept", "deepen", "repair", "reject"] },
          }),
        ),
        layers_to_repair: arr(
          obj({
            name: str,
            reason: str,
          }),
        ),
        alignment_summary: str,
        confidence: num,
      }),
    },
  },

  // ── 15 · Experimentation / Validation Lab (specforge_experimentation_validation_lab.md) ──
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
      "and feature_cards.features[].risks (for must_have features), and any " +
      "layer_optimization.layers_to_repair entries (drifted/broken alignment " +
      "is a real assumption to test — design an experiment that would prove " +
      "or disprove the misaligned mechanism still serves its parent), and any " +
      "data_points[].validation_needed hints (a data-point reliability/privacy " +
      "concern is often the riskiest assumption). Do NOT invent generic " +
      "assumptions. When a feature card carries a real risk, " +
      "treat its risk as a feature_mechanism-category assumption. " +
      "If [feature_mechanisms] is present, lift each mechanism's test_method " +
      "as a candidate experiment for its mechanism's selected approach " +
      "(category: feature_mechanism) — but rewrite shallow test_methods into " +
      "Lean-Startup-style hypotheses with explicit success/failure criteria. " +
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

  // ── 17 · Spec Exporter / Build Instruction Generator
  //   (specforge_spec_exporter_build_instruction_generator.md) ──
  // TERMINAL ENGINE. Synthesizes the full chain into a buildable spec +
  // coding-agent prompt. Does NOT regenerate anything upstream — every
  // section must restate a prior engine's output WITH provenance (causal
  // trace). The two genuinely new outputs are implementation_tasks (each
  // must link back to a feature_cards.features[].name OR
  // feature_mechanisms.mechanisms[].mechanism_name) and coding_agent_prompt
  // (the synthesized prompt that preserves the causal chain).
  spec_export: {
    temperature: 0.3,
    maxTokens: 5500,
    system:
      "You are the SpecForge Spec Exporter / Build Instruction Generator. " +
      "You are NOT generating new reasoning — every section MUST restate an " +
      "upstream engine's output with provenance. Per spec §2, the spec must " +
      "preserve WHY the product should be built, not just what. " +
      "Read the full accumulated [context] (target_user, problem_tree, " +
      "desired_result, cross_analysis, convergence, differentiation, " +
      "recommendation, feature_cards, feature_mechanisms, data_points, " +
      "evaluation, validation, any [constraints]) and produce: " +
      "(1) a product_summary anchored in convergence + recommendation; " +
      "(2) a causal_trace of 6–10 rows (artifact → finding → " +
      "decision_supported → build_implication) — every row MUST cite a real " +
      "prior artifact, not invent one; " +
      "(3) first_build_scope split into must_build_now / should_build_if_simple " +
      "/ must_delay / must_not_build, lifted from feature_cards.build_priority " +
      "+ recommendation.next_best_action; " +
      "(4) user_flow (5–10 ordered steps) lifted from feature_cards.first_user_flow + " +
      "feature_mechanisms.mechanisms[].trigger; " +
      "(5) feature_requirements (one per must_have / should_have feature in " +
      "feature_cards) with the causal back-references (macro/micro/root_cause); " +
      "(6) mechanism_requirements (one per top-priority mechanism in " +
      "feature_mechanisms) condensed to trigger / inputs / process / outputs / test; " +
      "(7) data_requirements (one per kept data point in data_points); " +
      "(8) validation_plan_summary (the single top experiment from validation); " +
      "(9) implementation_tasks — the FIRST genuinely new output. 4–10 tasks. " +
      "Every task MUST have source = name of a feature_cards feature OR " +
      "feature_mechanisms mechanism, and source_kind set accordingly. Acceptance " +
      "criteria must be testable (no 'works well'). Dependencies list other " +
      "task_names by exact string; " +
      "(10) acceptance_criteria — 4–8 product-level criteria (NOT per-task); " +
      "(11) coding_agent_prompt — the SECOND genuinely new output. A single " +
      "string (1500–3500 chars) that an external coding agent will execute. " +
      "MUST: state the product goal in 1 sentence, state the MVP scope, " +
      "enumerate non-goals (lifted from must_not_build), reference the causal " +
      "chain by name, enumerate the feature requirements by name, enumerate " +
      "the prompt/agent modules required, list acceptance criteria, give the " +
      "build order. MUST explicitly include the lines 'Do not build delayed " +
      "features.', 'Do not create generic cards.', and 'Every major generated " +
      "output must have quality gate status.' (spec §19); " +
      "(12) missing_inputs — name any required-input section (spec §5) that " +
      "you could not fill because the upstream engine result was missing or " +
      "too thin. Do NOT silently drop sections — surface gaps; " +
      "(13) confidence 0–100 — your honest assessment of whether this spec " +
      "is buildable end-to-end. Be hard on yourself if causal trace is thin. " +
      "Hard rules: do NOT invent features not in [feature_cards]; do NOT " +
      "invent mechanisms not in [feature_mechanisms]; do NOT redo the rubric " +
      "(evaluation's job); do NOT design new experiments (validation's job); " +
      "do NOT generate questions (question_expansion's job); do NOT enforce " +
      "structural quality (quality_critic's job)." +
      SHARED_TAIL,
    schema: {
      name: "specforge_spec_export",
      schema: obj({
        product_summary: obj({
          product_name: str,
          one_liner: str,
          primary_target_user: str,
          core_user_problem: str,
          root_constraint: str,
          first_principles_need: str,
          selected_mvp: str,
          core_product_loop: str,
          primary_desired_result: str,
          differentiation_thesis: str,
        }),
        causal_trace: arr(
          obj({
            artifact: str,
            finding: str,
            decision_supported: str,
            build_implication: str,
          }),
        ),
        first_build_scope: obj({
          must_build_now: strArr,
          should_build_if_simple: strArr,
          must_delay: strArr,
          must_not_build: strArr,
        }),
        user_flow: strArr,
        feature_requirements: arr(
          obj({
            feature_name: str,
            function: str,
            macro_objective_served: str,
            micro_objective_served: str,
            root_cause_attacked: str,
            recommended_mechanism: str,
            top_acceptance_criterion: str,
          }),
        ),
        mechanism_requirements: arr(
          obj({
            mechanism_name: str,
            feature: str,
            trigger: str,
            inputs_summary: str,
            process_summary: str,
            outputs_summary: str,
            top_test_method: str,
          }),
        ),
        data_requirements: arr(
          obj({
            data_point: str,
            source: str,
            disposition: str,
            why_it_exists: str,
            top_constraint: str,
          }),
        ),
        validation_plan_summary: obj({
          top_assumption: str,
          top_experiment: str,
          success_marker: str,
          failure_marker: str,
        }),
        implementation_tasks: arr(
          obj({
            task_name: str,
            description: str,
            source: str,
            source_kind: {
              type: "string",
              enum: ["feature", "mechanism"],
            },
            user_value: str,
            components: strArr,
            acceptance_criteria: strArr,
            dependencies: strArr,
          }),
        ),
        acceptance_criteria: strArr,
        coding_agent_prompt: str,
        missing_inputs: strArr,
        confidence: num,
      }),
    },
  },
};

export function engineSpec(id: SpecForgeEngineId): EngineSpec | undefined {
  return ENGINES[id];
}

export const VALID_ENGINES = Object.keys(ENGINES) as SpecForgeEngineId[];
