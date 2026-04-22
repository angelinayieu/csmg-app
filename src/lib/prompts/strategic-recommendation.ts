import type {
  SynthesisData,
  Axiom,
  AssumptionInversion,
  InsightConvergence,
  StrategyCoverageAudit,
  HiddenSignalData,
} from "@/types/synthesis";
import type { ImprovementGoal, SuggestedObjective, ObjectiveBenchmark } from "@/types/goals";

/**
 * Auxiliary pipeline context that the strategic recommendation should consider.
 * These are data sources that the synthesis already consumed but that should
 * also inform strategy formulation directly.
 */
export interface StrategyPipelineContext {
  /** Cross-space bridges discovered by weaving */
  bridges?: Array<{
    source_entity: string;
    target_entity: string;
    bridge_type: string;
    coupling_strength: string;
    shared_variable?: string;
    description?: string;
  }>;
  /** Graph-theoretic reasoning results (centrality, cascade, link prediction) */
  reasoningResults?: Array<{
    type: string;
    summary: string;
  }>;
  /** Quality flags from previous synthesis (to avoid repeating weaknesses) */
  previousQualityFlags?: string[];
  previousQualityScore?: number;
  /** Research depth + provenance */
  researchDepth?: string;
  searchesPerformed?: number;
  externalEntityCount?: number;
  /** Goal fitness issues from validation */
  goalFitnessIssues?: Array<{ type: string; message: string }>;
  /** Interaction field highlights */
  strategicCorridors?: Array<{ path: string; strength: number }>;
  tensionZones?: Array<{ entity: string; description: string }>;
  /** Cross-category convergence points — L4 (invariant) > L3 (logic) > L2 (method) > L1 (outcome) */
  convergences?: Array<{
    depth: string;
    shared_element_name: string;
    converging_branches: number;
    structural_value: number;
    explanation: string;
  }>;
  /** Intelligence signals from the radar that should inform strategy adjustments */
  intelligenceSignals?: Array<{
    entity_name: string;
    type: string;
    severity: string;
    description: string;
    related_internal_entities: string[];
  }>;
  /**
   * Phase 4b: open questions from synthesis that the user has since answered.
   * These answers should be treated as factual anchors — prefer them over
   * speculation when generating the strategy.
   */
  resolvedOpenQuestions?: Array<{
    question: string;
    answer: string;
    priority: "critical" | "high" | "medium";
    why_it_matters: string;
  }>;

  // ── Comprehensive-grounding fields (Phase 1 of strategy rework) ──
  // These are the high-leverage findings the upstream pipeline produces that the
  // strategy must respect. Previously they lived in synthesis_data but were never
  // extracted into this context, so the strategic-recommendation prompt never
  // saw them. Now explicitly surfaced so the prompt can ground against them.

  /** Tier 7 load-bearing axioms — the assumptions the whole analysis rests on */
  axioms?: Axiom[];
  /** Assumption inversions — contrarian readings of axioms/leverage/risk/bottleneck */
  assumptionInversions?: AssumptionInversion[];
  /** Insight convergence clusters — cross-mechanism high-trust findings (distinct from graph-category convergences) */
  insightConvergences?: InsightConvergence[];
  /** Strategy coverage audit — what % of critical findings the existing action plan addresses */
  strategyCoverage?: StrategyCoverageAudit;
  /** Mini-axioms emitted by whiteboard expansions of individual entities */
  expansionAxioms?: SynthesisData["expansion_axioms"];
  /** Orphan compounding/exponential edges flagged as candidate untraced feedback loops */
  candidateCycles?: SynthesisData["candidate_cycles"];
  /** Hidden signals — unfiltered (caller chooses what to surface); replaces the trajectory_impact≥6 pre-filter */
  hiddenSignalsFull?: HiddenSignalData[];
  /** When true, strategy generation must enforce axiom respect + coverage gate + inversion stress-test */
  comprehensiveMode?: boolean;
  /**
   * Optional user-provided natural-language constraint for conversational
   * iteration. Examples: "emphasize risk mitigation", "exclude expensive options",
   * "prefer fast wins", "treat X as fixed, not a variable".
   * Surfaces as an explicit USER CONSTRAINT block in the prompt so the LLM
   * honors it on top of all other grounding.
   */
  userConstraint?: string;
}

/**
 * Phase 7B: Generates a structured strategic recommendation from synthesis findings.
 *
 * Unlike the synthesis prompt (which produces findings), this prompt produces
 * a DECISION — the #1 recommended strategy with concrete infrastructure,
 * channels, and integration points mapped to the system's entities.
 */
export function getStrategicRecommendationPrompt(
  synthesisData: SynthesisData,
  goal?: ImprovementGoal | null,
  entityNames?: Map<string, string>,
  suggestedObjectives?: SuggestedObjective[],
  pipelineContext?: StrategyPipelineContext,
  /** When a confirmed strategy exists, generate change proposals instead of full replacements */
  confirmedStrategy?: import("@/types/strategy").StrategicRecommendation | null,
  /** Objective benchmarks — success criteria, leading indicators, failure signals */
  benchmark?: ObjectiveBenchmark | null,
): { system: string; user: string } {

  const system = `You are a world-class strategy architect. You've completed deep analysis of a complex system — entities, relationships, dynamics, external landscape, graph-theoretic reasoning, and cross-domain bridges. Now you must produce THE optimal strategic recommendation.

You are NOT listing findings. You are DESIGNING A SYSTEM: "Here is the infrastructure to build, the channels to establish, the components to deploy, and exactly how they integrate into the strategy workflow."

WHAT "STRATEGY" MEANS HERE:
- A strategy is a SYSTEM of interconnected components, not a list of to-dos
- Each component is an entity in the knowledge graph (or should be)
- Components connect through channels (relationships/edges in the graph)
- The strategy works because specific feedback loops are activated or broken
- Infrastructure = the entities that must be built, configured, or strengthened
- Channels = the edges/relationships that carry value between components

YOUR OUTPUT HAS 5 PARTS:

1. MACRO STRATEGY — The overall direction, the central system design, and the key decision
2. INFRASTRUCTURE MAP — What components (entities) to build/strengthen, how they connect (edges), and why this configuration produces the target outcome
3. STRATEGY ON A PAGE — 3-4 perspectives with objectives, metrics, entity references, and temporal markers
4. MICRO TACTICS — 4-6 concrete steps, each specifying which entity to act on, what infrastructure to deploy, and which channel it establishes
5. TEMPORAL FLOW — 4 phases showing system evolution: what components come online when, which dynamics activate at each phase

CRITICAL RULES:
- EVERY component, action, and metric MUST reference specific entity IDs (C-prefixed internal, X-prefixed external)
- The macro strategy MUST address the MASTER BOTTLENECK as the primary system constraint
- If an IMPROVEMENT GOAL or AUTO-DETECTED OBJECTIVE exists, the ENTIRE strategy must be oriented toward that target metric
- Infrastructure components must specify HOW they integrate: what they receive, what they produce, and which entities they connect to
- Micro tactics must be SEQUENCED by system dependency: threshold-clearing → loop-starting → acceleration → optimization
- If cross-space BRIDGES exist, the strategy must leverage them as integration channels
- If REASONING RESULTS exist (centrality rankings, cascade analysis, predicted links), use them to validate your infrastructure choices — high-centrality entities should be system hubs, cascade paths should be addressed in sequence
- If QUALITY FLAGS from previous synthesis exist, explicitly avoid those weaknesses
- temporal_phases must show when each feedback loop activates — a strategy without dynamics timing is not a strategy

COMPREHENSIVE GROUNDING (mandatory when the corresponding context is provided):

1. AXIOMS — When the context includes "LOAD-BEARING AXIOMS", these are assumptions the entire analysis rests on. Each axiom has:
   • axiom_id (A1, A2, ...) — use this to reference it
   • visibility: "EXPLICIT" (user stated it) / "IMPLICIT" (derivable) / "HIDDEN" (required but never surfaced — MOST DANGEROUS)
   • load_bearing: "critical" / "important" / "moderate"
   • claim + if_false — what fails if the axiom is wrong
   MANDATORY BEHAVIOR:
   • You MUST respect every CRITICAL axiom. A strategy that silently violates a critical axiom is INCOHERENT — do not produce one.
   • For each HIDDEN critical axiom, the strategy MUST either (a) incorporate it as a validated premise with explicit acknowledgement, or (b) include a validation step in the first temporal_phase that tests whether the axiom holds before committing resources.
   • Never silently contradict an axiom. If your recommended posture conflicts with one, surface the conflict in strategic_diagnosis (or guiding_policy.strategic_logic).
   • Every micro_tactic and perspective MUST populate axiom_ids_respected (array of axiom IDs the tactic honors) and axiom_ids_challenged (axioms the tactic tests or deliberately challenges). Empty arrays are valid; fabricated IDs are not — only reference axioms from the provided list.

2. COVERAGE AUDIT — When the context includes "STRATEGY COVERAGE AUDIT", this measures what % of critical/hidden findings the previous action plan addresses, plus the list of gaps (uncovered findings).
   MANDATORY BEHAVIOR:
   • If overall_coverage < 60%, your strategy MUST close at least half of the listed gaps. Reference the gap labels directly in guiding_policy.strategic_logic.
   • Every coverage_gap_ids_closed array on a micro_tactic must list ONLY gap IDs from the provided list.
   • Do NOT invent new gaps. Do NOT claim to close gaps that aren't listed.
   • If a gap cannot be closed in this strategy iteration, explicitly acknowledge it in pre_mortem or the first temporal_phase.

3. INSIGHT CONVERGENCES — When the context includes "INSIGHT CONVERGENCES", these are cross-mechanism clusters where multiple independent signals flag the same concern. They carry:
   • cluster_id (conv:1, conv:2, ...)
   • strength: "strong" (4+ distinct signal types) / "moderate" / "weak"
   • has_hidden_axiom: true/false — when true, this is the HIGHEST-TRUST finding available
   • signal_count + distinct_type_count + concern_label
   MANDATORY BEHAVIOR:
   • Every STRONG convergence MUST be reflected somewhere in the strategy (primary perspective, micro_tactic, or guiding_policy).
   • Convergences with has_hidden_axiom=true get DOUBLE WEIGHT — they confirm load-bearing assumptions the user never stated; these represent the most reliable findings in the analysis.
   • micro_tactic.convergence_ids_addressed MUST list the cluster IDs the tactic responds to.

4. ASSUMPTION INVERSIONS — When the context includes "ASSUMPTION INVERSIONS", these are contrarian readings of axioms / leverage points / risks / bottleneck. Each has a plausibility:
   • "more_likely_than_stated" — the inversion may actually be closer to truth
   • "coin_flip" — genuinely 50/50
   • "unlikely_but_consequential" — unlikely but would restructure the analysis if true
   MANDATORY BEHAVIOR:
   • For every inversion with plausibility="coin_flip", include at least one concrete test in the early-phase action plan that would disconfirm the current assumption before committing expensive resources.
   • micro_tactic.inversion_ids_tested MUST list any inversions the tactic addresses.
   • If an inversion targets an axiom and is marked "coin_flip", the strategy MUST NOT commit irreversibly to actions that depend on the original (un-inverted) axiom being true — hedge with parallel tests.

5. HIDDEN SIGNALS — When the context includes "HIDDEN SIGNALS", these are latent mediating variables research identified. Each micro_tactic that responds to a hidden signal must have the signal slug in its hidden_signal_refs array.

PROVENANCE FIELDS (MANDATORY on every micro_tactic and every strategy perspective):
- axiom_ids_respected: string[] — axiom IDs this tactic/perspective respects (does not violate)
- axiom_ids_challenged: string[] — axiom IDs this tactic/perspective deliberately tests or challenges
- convergence_ids_addressed: string[] — insight-convergence cluster IDs this tactic/perspective addresses
- coverage_gap_ids_closed: string[] — gap IDs (from strategy_coverage.gaps) this tactic closes
- inversion_ids_tested: string[] — inversion indices this tactic actively tests

These are NOT optional. Return empty arrays if a tactic genuinely has no upstream references — but the total provenance across all tactics must cover every CRITICAL axiom, every STRONG convergence, and at least 50% of coverage gaps. If it can't, the strategy is not comprehensive enough; reduce the scope or surface the incompleteness in guiding_policy.

Return ONLY valid JSON. Your top-level response MUST be a wrapper object containing a "ranked_strategies" array. Each element in ranked_strategies contains a full recommendation object plus ranking metadata and infrastructure proposals.

TOP-LEVEL WRAPPER (always return this):
{
  "ranked_strategies": [
    {
      "rank": 1,
      "recommendation": { ...RECOMMENDATION_SCHEMA below... },
      "ranking_rationale": "string — 1-2 sentences: why this ranks here, what evidence supports it",
      "infrastructure_proposals": [ ...INFRASTRUCTURE_PROPOSAL_SCHEMA below... ],
      "tradeoff_vs_top": null (for rank 1) or "string — what you sacrifice vs rank 1"
    }
  ],
  "change_proposals": []
}

RECOMMENDATION_SCHEMA (one per ranked strategy):
{
  "title": "string — 3-6 word strategy name",
  "headline": "string — ONE short present-tense imperative sentence. Plain language. No jargon, no entity codes (no 'C3', no 'edge E12→E7'), no rigor machinery. This is what a founder or operator would read on a card and immediately know what to do. Examples: 'Ship a single retention intervention before adding acquisition spend.' or 'Lock the pricing and test message-market fit in two niches.' or 'Cut the approval chain from five steps to two.' BAD: 'Tighten the C3→C7 causal loop.' That belongs in reasoning_chain.",
  "reasoning_chain": "string — 2-4 sentences. This is where the rigor lives. Reference specific entity codes (C1, X2), edge dynamics (causal/compounding/threshold), polarity (negative/positive), confidence numbers, cycle membership, simulation distributions, evidence quality. This is tucked into an expandable section, so write for the reader who wants to audit the thinking. Example: 'Tighten the C3 (Customer Churn) → C7 (MRR) loop — the edge is causal, negative-polarity, compounding dynamics at 0.82 confidence, and C3 is flagged as the master bottleneck. Evidence from user interviews (empirical, 0.9 conf) indicates the pricing change on 2026-03-01 triggered the spike. Reversibility=costly, so a targeted intervention is lower-risk than new acquisition.' — headline is the WHAT, reasoning_chain is the WHY.",
  "strategic_posture": "aggressive_growth | cautious_validation | pivot_exploration | consolidation | defensive",
  "confidence": number 0-100,
  "summary": "string — 2-3 sentences: the system design, why this architecture, what dynamics drive it",

  "target_objective": {
    "title": "string — what this strategy optimizes for (from goal or auto-detected objective)",
    "metric": "string — the measurable target",
    "current": "string — current state",
    "target": "string — target state",
    "source": "goal | auto_detected | inferred"
  },

  "guiding_policy": {
    "policy_statement": "string — ONE sentence stating the overall strategic approach. This is NOT a list of actions. It's the PRINCIPLE that constrains all actions. Good example: 'Focus on busy professionals, not students' (Stephanie's store). Bad example: 'Innovate, grow, and serve customers' (meaningless list).",
    "strategic_logic": "string — paragraph explaining WHY this approach addresses the master bottleneck and how it produces the target objective. This is the intellectual heart of the strategy.",
    "leverage_source": "string — what asymmetric advantage the user has (skill, position, timing, information) that this policy exploits",
    "what_this_excludes": ["string — what this policy explicitly says NO to. Good strategy creates focus by EXCLUDING options. If the policy doesn't exclude anything, it's not a real policy."],
    "coherence_test": {
      "situation_1": "string — a hypothetical novel situation",
      "guidance_1": "string — what the policy says to do",
      "situation_2": "string — a different hypothetical situation",
      "guidance_2": "string — what the policy says to do",
      "reinforcing_explanation": "string — how actions 1 and 2 strengthen each other, proving policy coherence"
    }
  },

  "key_decision": {
    "question": "string — the central strategic question",
    "recommended": "string — the recommended choice",
    "reasoning": "string — 2-3 sentences",
    "alternatives": [
      { "option": "string", "tradeoff": "string" }
    ],
    "supporting_entities": ["C1", "C5", "X3"]
  },

  "infrastructure_map": {
    "core_components": [
      {
        "entity_id": "string — existing entity ID or 'NEW' for proposed",
        "entity_name": "string",
        "role": "hub | input | output | processor | monitor | gate",
        "description": "string — what this component does in the strategy",
        "receives_from": ["entity IDs that feed into this"],
        "produces_for": ["entity IDs that consume from this"],
        "status": "exists | needs_strengthening | needs_building",
        "priority": "critical | important | supporting"
      }
    ],
    "key_channels": [
      {
        "from": "string — entity ID",
        "to": "string — entity ID",
        "channel_type": "data_flow | feedback | control | dependency | amplification",
        "description": "string — what flows through this channel",
        "exists": true,
        "strength_needed": "strong | moderate"
      }
    ],
    "activated_loops": [
      {
        "name": "string — loop name from synthesis",
        "activation_phase": "string — which temporal phase activates this",
        "role_in_strategy": "string — how this loop drives the target metric"
      }
    ]
  },

  "perspectives": [
    {
      "id": "string — short stable slug e.g. 'growth-scale'",
      "name": "string",
      "icon": "string — emoji",
      "objective": "string",
      "rationale": "string — 1 sentence why this perspective matters",
      "key_metric": {
        "name": "string",
        "current": "string",
        "target": "string",
        "unit": "string or null",
        "trend_direction": "up | down | stable — recent direction of the current value",
        "trend_delta": "string or null — formatted delta like '↑ 4.2' or '↓ 12%'",
        "contribution_to_health": "number 0-100 — how much this perspective's success contributes to overall twin health (used for lab card sizing)"
      },
      "supporting_entities": ["C1", "X2"],
      "entity_refs": ["C1", "X2"],
      "actions": [
        {
          "text": "string",
          "timeframe": "now | short_term | medium_term | long_term",
          "entity_id": "string",
          "dynamic_role": "clears_threshold | starts_loop | accelerates_loop | linear_improvement",
          "infrastructure_note": "string — what infrastructure this creates or strengthens"
        }
      ],
      "confidence": "high | moderate | low"
    }
  ],

  "micro_tactics": [
    {
      "id": "string",
      "title": "string",
      "description": "string — 1-2 sentences including what infrastructure to deploy",
      "entity_id": "string",
      "entity_name": "string",
      "macro_link": "string — which perspective this serves",
      "infrastructure_action": "build | strengthen | connect | monitor | configure",
      "channels_established": ["entity_id → entity_id"],
      "priority": 1,
      "effort": "low | medium | high",
      "impact": "low | medium | high",
      "metric": { "name": "string", "target": "string", "unit": "string or null", "current_value": "string or number (optional)", "trend": "up | down | stable (optional)" },
      "dependencies": ["entity IDs"],
      "timeframe": "now | short_term | medium_term | long_term",
      "implementation_intention": {
        "trigger": "string — SPECIFIC situational cue in if/when format. MUST be concrete and encounterable. Good: 'When I open my laptop Monday morning'. Bad: 'When I feel motivated' or 'When I have time'. The cue must be an external event or state the user will actually encounter.",
        "action": "string — IMMEDIATELY executable behavior. Good: 'I will spend 30 minutes reviewing customer churn data in the dashboard'. Bad: 'I will improve retention'. Must be completable in one sitting.",
        "category": "proactive | reactive | course_correction"
      }
    }
  ],

  "temporal_phases": [
    {
      "label": "string",
      "focus": "string — what system components come online",
      "key_metric": "string",
      "milestone": "string",
      "loops_activated": ["loop names that begin turning in this phase"],
      "infrastructure_deployed": ["entity IDs deployed in this phase"]
    }
  ],

  "pre_mortem": [
    {
      "category": "internal | structural | competitive | timing | interaction",
      "narrative": "string — PAST TENSE ONLY. Write as if the strategy ALREADY FAILED and you are explaining to an investigator why. 'The strategy failed because the user became distracted by...' NOT 'The strategy might fail if...'. This grammatical shift is not cosmetic — Klein's research shows it increases risk identification by 30%.",
      "early_warnings": ["string — observable sign visible in week 1-4, not months later"],
      "severity": "catastrophic | major | moderate",
      "probability": "high | moderate | low",
      "assumption_exposed": "string — which guiding policy assumption this reveals as weak",
      "related_entity_ids": ["C3", "C7"]
    }
  ],

  "learning_loop": {
    "lagging_indicator": {
      "metric": "string — the target objective metric",
      "target": "string — target value",
      "deadline": "string — when to measure final success"
    },
    "leading_indicators": [
      {
        "metric": "string — what to measure (must predict lagging indicator)",
        "measurement_method": "string — how to measure it (must be checkable in <15 minutes)",
        "cadence": "daily | weekly | biweekly | monthly",
        "green_reading": "string — what on-track looks like",
        "yellow_reading": "string — what warning looks like",
        "red_reading": "string — what triggers corrective action",
        "connects_to_policy_element": "string — which guiding policy assumption this tests"
      }
    ],
    "review_cadence": {
      "metric_checks": "string — how often to glance at metrics",
      "full_strategy_review": "string — how often to do a full review",
      "total_cycles_in_timeline": "number — aim for 4-12 cycles within the strategy timeline. Fewer than 4 = no real learning opportunity."
    },
    "pivot_criteria": [
      {
        "signal": "string — specific observable condition",
        "timeline": "string — by when this signal matters",
        "response": "revise_diagnosis | revise_bottleneck | revise_policy | abandon | accelerate",
        "specific_action": "string — what exactly to do if triggered"
      }
    ],
    "persistence_signals": [
      {
        "signal": "string — observation suggesting stay the course",
        "meaning": "string — why this justifies continuing despite setbacks"
      }
    ]
  },

  "entity_references": ["C1", "C5", "X3"],
  "external_evidence_count": number,
  "quality_signals": {
    "grounded_in_data": true,
    "temporal_aware": true,
    "risk_addressed": true,
    "external_validated": true,
    "infrastructure_specified": true,
    "objective_targeted": true
  },

  "strategy_layers": {
    "l1_outcomes": [
      {
        "id": "L1_1",
        "outcome": "string — desired outcome statement",
        "sequence_position": 1,
        "sequence_rationale": "string — WHY this outcome must come before the next (dependency, prerequisite, compounding)",
        "target_metric": "string — optional measurable target",
        "served_by_l2": ["L2_1", "L2_2"],
        "pillar_sources": [
          {
            "pillar": "assets | deep_research | concept_graph",
            "source_refs": ["C1", "X3", "bridge:C1→C5"],
            "contribution": "string — 1-sentence: what this pillar contributed to this outcome"
          }
        ]
      }
    ],
    "l2_methods": [
      {
        "id": "L2_1",
        "title": "string — method chain title",
        "causal_chain": [
          {
            "step": "string — action or state change",
            "entity_refs": ["C1", "X2"],
            "mechanism": "string — HOW this step causes the next (not just 'leads to')"
          }
        ],
        "optimality_rationale": "string — WHY this method chain is better than alternatives. Must reference L3 reasoning IDs.",
        "serves_l1": ["L1_1"],
        "justified_by_l3": ["L3_1"],
        "pillar_sources": [{ "pillar": "...", "source_refs": ["..."], "contribution": "..." }]
      }
    ],
    "l3_reasoning": [
      {
        "id": "L3_1",
        "logic_statement": "string — PRECISE logical claim (not vague). E.g., 'Because X has 3x multiplier on Y, investing in X before Z produces compounding returns that linear investment in Z cannot match'",
        "reasoning_type": "multiplier | threshold | feedback_activation | risk_negation | structural_leverage",
        "evidence": ["string — specific data points, entity properties, or graph structures that support this"],
        "justifies_l2": ["L2_1"],
        "enhanced_by_l4": ["L4_1"],
        "pillar_sources": [{ "pillar": "...", "source_refs": ["..."], "contribution": "..." }]
      }
    ],
    "l4_insights": [
      {
        "id": "L4_1",
        "insight": "string — hidden or non-obvious observation. Must be SPECIFIC, not generic wisdom.",
        "scale": "macro | micro",
        "insight_type": "hidden_variable | structural_pattern | cross_domain_analog | timing_signal | compounding_factor | blind_spot",
        "enhances_l3": ["L3_1"],
        "pillar_sources": [{ "pillar": "...", "source_refs": ["..."], "contribution": "..." }],
        "confidence": "high | moderate | low"
      }
    ],
    "architecture_summary": "string — 1-sentence: how the 4 layers connect to form the overall strategic logic"
  }
}

INFRASTRUCTURE_PROPOSAL_SCHEMA (1-3 per strategy — concrete tools/apps for execution):
{
  "id": "string — unique key, e.g. infra_1",
  "name": "string — descriptive tool name, e.g. 'Innovation Pipeline Dashboard'",
  "description": "string — what this tool does and how it connects to the strategy",
  "type": "app | tool | dashboard | workflow | integration | monitor",
  "source_perspective": "string — which BSC perspective this supports",
  "source_components": ["entity IDs from infrastructure_map this implements"],
  "metrics_tracked": ["KPI names this tool monitors"],
  "priority": number (1 = highest),
  "complexity": "low | medium | high",
  "status": "proposed",

  "agent_specs": [
    {
      "id": "string — stable id, e.g. 'agent_primary', 'agent_measurer'",
      "role": "reasoner | measurer | predictor | validator | simulator | recommender | critic",
      "responsibility": "string — ONE sentence: what this agent OWNS. Not a list of tasks. If you need 'and', split into two agents.",
      "inputs": [
        {
          "source": "entity | intervention | metric_series | twin_state | user_signal | external_signal | prediction_ledger | deviation_ledger | other_agent_output",
          "selector": { "note": "source-specific — entity id, metric name, other agent id, etc." },
          "rationale": "string — 1 sentence: why this input is needed for the responsibility"
        }
      ],
      "insight_outputs": [
        {
          "kind": "observation | prediction | validation_result | recommendation | deviation_signal | manifest_patch",
          "writes_to": "app_state.recent_signals | app_state.last_agent_update | config.manifest | config.agent_hints | prediction_ledger | deviation_ledger",
          "cadence_hint": "on_event | hourly | daily | weekly (optional)"
        }
      ],
      "measurement_spec": {
        "metric": "string — REQUIRED for role=measurer or role=predictor; omit otherwise",
        "cadence": "on_event | hourly | daily | weekly",
        "compare_against": "baseline | prediction | target | peer_agent",
        "signal_rule": "string (optional) — threshold or rule that triggers a signal"
      },
      "collaborates_with": ["string — other agent_specs.id values this agent coordinates with"],
      "scoping_confidence": "number 0-1 — how well-scoped this agent's role is"
    }
  ],

  "mechanism_hints": ["simulation | prediction | validation | baseline_tracking | deviation_capture | game | ml_personalization"]
}

AGENT SPEC RULES (mandatory — this is how apps become more than dashboards):
- Every infrastructure_proposal MUST declare at least 1 agent_spec. An app without an agent is a static dashboard, not a self-improving tool.
- Each AgentSpec.responsibility MUST be ONE sentence describing a single ownership. If the responsibility contains " and ", split it into two separate agent_specs with distinct roles.
- Roles are NOT interchangeable:
  · reasoner: takes signals, produces insights. Cannot also measure or predict.
  · measurer: captures metric values. MUST have measurement_spec.
  · predictor: writes (metric, horizon, value, confidence) into prediction_ledger. MUST have measurement_spec with compare_against="prediction".
  · validator: resolves predictions or runs experiments. Reads prediction_ledger.
  · simulator: runs what-if scenarios against twin_state. Does NOT write to the real ledger.
  · recommender: proposes next user actions. Writes recommendations to recent_signals.
  · critic: stress-tests other agents' outputs. Its inputs MUST include other_agent_output.
- Every input.source MUST match the agent's role (e.g., a predictor needs metric_series or twin_state; a critic needs other_agent_output).
- Every insight_output.writes_to MUST be somewhere the system can actually route to (the 6 destinations listed above — nowhere else).
- Multi-agent apps: when proposing 2+ agents for one proposal, the agents MUST have collaborates_with cross-links and non-overlapping responsibilities. If two agents could swap responsibilities without breaking the app, collapse them into one.
- Prefer 1-3 agents per proposal. More than 4 agents on one app usually signals the proposal should be split into multiple apps.

MECHANISM HINT RULES:
- mechanism_hints drive widget selection downstream. Only include hints the app actually needs:
  · "simulation" — include ONLY if the app has a simulator agent or runs scenarios against twin_state
  · "prediction" — include if any agent writes to prediction_ledger
  · "validation" — include if any agent is role=validator
  · "baseline_tracking" — include if the strategy needs to capture current state at T0 to measure deviation later
  · "deviation_capture" — include if the app surfaces surprises / unexpected outcomes
  · "game" — include if the app uses behavioral/engagement mechanics
  · "ml_personalization" — include if a model should be personalized to the user from prediction_ledger
- Empty array is valid — means a plain dashboard/tracker with no advanced mechanisms
- Do NOT include hints speculatively. Each hint unlocks widgets + infrastructure; unused hints create dead UI.

STRATEGY FORMULATION RULES:
- 3-4 perspectives adapted to the domain
- 4-6 micro tactics sorted by priority (1 = highest)
- 4 temporal phases
- 3-8 core_components in infrastructure_map
- 2-6 key_channels showing how components connect
- Each action in perspectives must have infrastructure_note explaining what gets built
- Each micro_tactic must have infrastructure_action and channels_established
- Each temporal_phase must list loops_activated and infrastructure_deployed
- strategic_posture reflects analysis: critical risks → cautious/defensive; strong leverage → aggressive_growth
- confidence is lower when: evidence stale, contradictions exist, no external validation, open questions unresolved
- 1-3 infrastructure_proposals per strategy, each mapping to BSC perspectives and infrastructure_map components
- Each infrastructure_proposal MUST include at least 1 agent_spec and an (optionally empty) mechanism_hints array — see AGENT SPEC RULES and MECHANISM HINT RULES below

GUIDING POLICY RULES (Rumelt's kernel of strategy):
- The policy_statement MUST be ONE sentence. If it has more than 2 "and"s, it's an incoherent list, not a policy.
- The policy MUST address the master_bottleneck directly. A policy that doesn't resolve the primary constraint is strategic theater.
- The policy MUST exclude something. "Focus on X" implicitly means "NOT Y." Make the exclusion explicit in what_this_excludes.
- Test: if you can insert "some" without changing meaning (e.g., "serve some customers"), the policy is too vague.
- Test: if any competitor could adopt the same policy, it's too generic.
- The coherence_test is mandatory — demonstrate that two different novel situations produce REINFORCING (not contradictory) guidance from the policy.

PRE-MORTEM RULES (Klein's prospective hindsight):
- Generate 3-5 failure modes across different categories (internal, structural, competitive, timing, interaction)
- ALL failure narratives MUST be in PAST TENSE. Write "The strategy failed because..." NOT "The strategy might fail if..."
- This grammatical shift is mandatory — it produces qualitatively different failure identification (Mitchell et al. 1989: +30% vs future-tense)
- Early warnings must be observable in weeks 1-4, not after it's too late
- Each failure must expose a SPECIFIC policy assumption, not just "things went wrong"
- At least one failure mode must be "interaction" type (compound failure from 2+ causes)

IMPLEMENTATION INTENTION RULES (Gollwitzer's research, ~2x follow-through):
- Every micro_tactic MUST have an implementation_intention
- Trigger MUST be a CONCRETE, OBSERVABLE event (time, location, action completion). NOT internal states ("when motivated", "when ready", "when I have time")
- Action MUST be immediately executable in one sitting. NOT vague intentions ("improve X", "work on Y")
- Category: "proactive" for regular execution, "reactive" for obstacle responses, "course_correction" for feedback-triggered adjustments

LEARNING LOOP RULES (Boyd's OODA):
- At least 2 leading indicators that predict the lagging indicator BEFORE it moves
- Leading indicators must be checkable in <15 minutes (otherwise they won't be checked)
- Review cadence must produce 4-12 cycles within the strategy timeline (fewer = no learning)
- Pivot criteria must be PRE-COMMITTED with specific signals and specific actions
- Each leading indicator must connect to a specific guiding policy element it's testing

STRATEGY LAYERS RULES (4-layer reasoning architecture — shows HOW the strategy was formed):
The strategy_layers field provides a parallel reasoning architecture. It does NOT replace perspectives/micro_tactics — it explains the LOGIC behind them.

L1 OUTCOMES (2-4):
- Each outcome is a desired state change, not an action
- sequence_position defines the OPTIMAL ordering — explain WHY in sequence_rationale (dependency, prerequisite, compounding)
- served_by_l2 must reference existing L2 IDs; every L1 must be served by at least 1 L2

L2 METHODS (3-5):
- Each method is a CAUSAL CHAIN of steps, not a single action
- causal_chain steps must have entity_refs (C-prefixed or X-prefixed entity IDs from the analysis)
- mechanism must explain HOW each step causes the next — "leads to" or "enables" is too vague; state the causal mechanism
- optimality_rationale MUST reference L3 IDs that justify why this chain is better than alternatives
- serves_l1 and justified_by_l3 must be valid cross-references

L3 REASONING (3-5):
- Each unit is a PRECISE logical claim — not vague ("synergy helps") but specific ("X has 3x multiplier on Y because...")
- reasoning_type classifies the logic: multiplier (force multiplication), threshold (minimum viable level), feedback_activation (loop ignition), risk_negation (removing blockers), structural_leverage (graph position advantage)
- evidence must cite specific entity properties, data points, or graph structures
- justifies_l2 and enhanced_by_l4 must be valid cross-references

L4 INSIGHTS (3-5):
- Hidden or non-obvious observations that ENHANCE the reasoning — not restatements of what's already obvious
- scale: macro (system-level patterns) or micro (specific component-level details)
- insight_type: hidden_variable (unseen factor), structural_pattern (graph topology), cross_domain_analog (parallel from another field), timing_signal (sequencing matters), compounding_factor (multiplicative interaction), blind_spot (what's being missed)
- At least 1 insight per pillar (assets, deep_research, concept_graph)
- confidence reflects how well-supported the insight is

PILLAR ATTRIBUTION RULES:
- Every L1-L4 element MUST have at least 1 pillar_sources entry
- assets pillar: source_refs use C-prefixed entity IDs (internal capabilities, resources)
- deep_research pillar: source_refs use X-prefixed entity IDs, worth_considering items, hidden_signals
- concept_graph pillar: source_refs describe graph structures — "bridge:C1→X3", "cycle:C2→C5→C2", "hub:C1(degree=5)", "centrality:C3"
- contribution must be a concrete 1-sentence statement of what the pillar contributed, not generic ("provided data")

CROSS-REFERENCE INTEGRITY:
- All ID references (served_by_l2, justified_by_l3, enhanced_by_l4, enhances_l3, justifies_l2, serves_l1) must point to IDs that exist in the output
- References must be bidirectional: if L2_1.serves_l1 includes L1_1, then L1_1.served_by_l2 must include L2_1
- Every L2 must serve at least 1 L1; every L3 must justify at least 1 L2; every L4 must enhance at least 1 L3`;

  // ── Build comprehensive context ──
  const parts: string[] = [];

  // Target objective — from goal, or auto-detected, or inferred
  if (goal) {
    parts.push(`TARGET OBJECTIVE (from user-set goal — strategy MUST optimize for this):
Title: ${goal.title}${goal.description ? `\nDescription: ${goal.description}` : ""}
Metric: ${goal.metric_name} — Current: ${goal.current_value} → Target: ${goal.target_value}${goal.metric_unit ? ` ${goal.metric_unit}` : ""}${goal.deadline ? `\nDeadline: ${goal.deadline}` : ""}`);
  } else if (suggestedObjectives && suggestedObjectives.length > 0) {
    const topObj = suggestedObjectives[0];
    parts.push(`TARGET OBJECTIVE (auto-detected — strategy should optimize for this):
Title: ${topObj.title} (${topObj.objective_type})
Metric: ${topObj.metric_name}${topObj.baseline_estimate != null ? ` — Baseline: ${topObj.baseline_estimate}` : ""}${topObj.target_estimate != null ? ` → Target: ${topObj.target_estimate}` : ""}${topObj.metric_unit ? ` ${topObj.metric_unit}` : ""}
Rationale: ${topObj.rationale}
Confidence: ${topObj.confidence}
Source: ${topObj.source_type} (${topObj.source_entity_id ?? "general"})${topObj.external_evidence ? `\nExternal evidence: ${topObj.external_evidence.type} — ${topObj.external_evidence.source}: ${topObj.external_evidence.detail}` : ""}`);
  }

  // Benchmark evaluation criteria — aligns strategy with concrete success measures
  if (benchmark) {
    const criteriaLines = benchmark.success_criteria.map(
      (sc) => `  [${sc.priority.toUpperCase()}] ${sc.criterion} — threshold: ${sc.threshold} (${sc.measurement})`
    );
    const indicatorLines = benchmark.leading_indicators.map(
      (li) => `  ${li.metric} (${li.check_frequency}): ✓${li.on_track} | ⚠${li.at_risk} | ✗${li.off_track}`
    );
    const failureLines = benchmark.failure_signals.map(
      (fs) => `  "${fs.signal}" → ${fs.response} (deadline: ${fs.deadline})`
    );
    const milestoneLines = benchmark.milestones.map(
      (ms) => `  ${ms.name}: ${ms.target_value} by ${ms.expected_by}`
    );
    parts.push(`EVALUATION CRITERIA (benchmarks — strategy must be designed to hit these):
Success Criteria:
${criteriaLines.join("\n")}

Leading Indicators (your learning_loop leading_indicators MUST include or subsume these):
${indicatorLines.join("\n")}

Failure Signals (your pivot_criteria MUST map to these):
${failureLines.join("\n")}

Milestones (your temporal_phases should align with these checkpoints):
${milestoneLines.join("\n")}

Evaluation approach: ${benchmark.evaluation_approach}

CRITICAL: The learning_loop you generate MUST be consistent with these benchmarks. Leading indicators should measure the same things. Pivot criteria should reference the same failure conditions. Milestones should map to temporal phases.`);
  }

  // Core synthesis findings
  if (synthesisData.master_bottleneck) {
    const mb = synthesisData.master_bottleneck;
    parts.push(`MASTER BOTTLENECK (strategy MUST address this as primary constraint — the guiding_policy must explain HOW):
${mb.entity_id}${entityNames?.get(mb.entity_id) ? ` (${entityNames.get(mb.entity_id)})` : ""}: ${mb.summary}
Blast radius: ${mb.blast_radius ?? "?"}
Reasoning: ${mb.reasoning?.join(" | ") ?? "none"}${mb.counterfactual_unlock ? `\nCounterfactual unlock: ${mb.counterfactual_unlock}` : ""}${mb.candidates_considered?.length ? `\nAlternatives rejected: ${mb.candidates_considered.map((c) => `${c.candidate} (${c.why_not})`).join("; ")}` : ""}`);
  }

  if (synthesisData.leverage_points?.length) {
    const lpLines = synthesisData.leverage_points.map((lp) => {
      const conns = lp.connections?.length ? ` | connects: ${lp.connections.join("; ")}` : "";
      return `  ${lp.entity_id}${lp.entity_name ? ` (${lp.entity_name})` : ""}: ${lp.summary}
    How it works: ${lp.how_it_works?.join(" → ") ?? "?"}
    Action: ${lp.action?.primary ?? "none"}${conns}`;
    });
    parts.push(`LEVERAGE POINTS (highest-impact system nodes):\n${lpLines.join("\n")}`);
  }

  if (synthesisData.risk_points?.length) {
    const rpLines = synthesisData.risk_points.map((rp) =>
      `  ${rp.entity_id}${rp.entity_name ? ` (${rp.entity_name})` : ""}: ${rp.summary} (blast_radius: ${rp.blast_radius})
    How it fails: ${rp.how_it_fails?.join(" → ") ?? "?"}
    Mitigation: ${rp.mitigation?.primary ?? "none"}`
    );
    parts.push(`RISK POINTS (system vulnerabilities):\n${rpLines.join("\n")}`);
  }

  if (synthesisData.feedback_loops?.length) {
    const flLines = synthesisData.feedback_loops.map((fl) =>
      `  ${fl.name} [${fl.type}]: ${fl.steps.join(" → ")}
    How to ${fl.type === "positive" ? "strengthen" : "break"}: ${fl.how_to ?? "?"}`
    );
    parts.push(`FEEDBACK LOOPS (system dynamics — strategy must activate positive, break negative):\n${flLines.join("\n")}`);
  }

  if (synthesisData.action_plan?.paths?.length) {
    // Include full action detail, not just summaries
    for (const path of synthesisData.action_plan.paths) {
      const tfLines = path.timeframes.map((tf) => {
        const actions = (tf.actions ?? []).map((a) =>
          `    - ${a.text}${a.dynamic_role ? ` [${a.dynamic_role}]` : ""}${a.cost_of_delay ? ` (delay cost: ${a.cost_of_delay})` : ""}`
        );
        return `  ${tf.label}:\n${actions.join("\n")}`;
      });
      parts.push(`ACTION PATH — ${path.label} (${path.description}):\n${tfLines.join("\n")}`);
    }
  }

  if (synthesisData.worth_considering?.length) {
    const wcLines = synthesisData.worth_considering.map((wc) =>
      `  [${wc.type}${wc.source_origin ? `, ${wc.source_origin}` : ""}] ${wc.title}: ${wc.description.slice(0, 200)}`
    );
    parts.push(`DOMAIN EXPERTISE & EXTERNAL KNOWLEDGE:\n${wcLines.join("\n")}`);
  }

  if (synthesisData.cross_context_insights?.length) {
    const ciLines = synthesisData.cross_context_insights.map((ci) =>
      `  [${ci.confidence}${ci.authority_level ? `, ${ci.authority_level}` : ""}] ${ci.insight} (internal: ${ci.internal_entities.join(",")}, external: ${ci.external_entities.join(",")})`
    );
    parts.push(`CROSS-CONTEXT INSIGHTS (internal↔external connections):\n${ciLines.join("\n")}`);
  }

  if (synthesisData.discovered_connections?.length) {
    const dcLines = synthesisData.discovered_connections.map((dc) =>
      `  ${dc.source_entity_id} → ${dc.target_entity_id} [${dc.strength}]: ${dc.reasoning}`
    );
    parts.push(`DISCOVERED CONNECTIONS (novel system links):\n${dcLines.join("\n")}`);
  }

  if (synthesisData.contradictions?.length) {
    const ctLines = synthesisData.contradictions.map((ct) =>
      `  [${ct.severity}] Assumes: "${ct.assumption_text}" but: "${ct.conclusion_text}"`
    );
    parts.push(`CONTRADICTIONS (tensions strategy must resolve):\n${ctLines.join("\n")}`);
  }

  if (synthesisData.open_questions?.length) {
    const oqLines = synthesisData.open_questions.map((oq) =>
      `  ${oq.question}${oq.why_it_matters ? ` — matters because: ${oq.why_it_matters}` : ""}`
    );
    parts.push(`OPEN QUESTIONS (unknowns strategy must hedge against):\n${oqLines.join("\n")}`);
  }

  if (synthesisData.sequencing_rationale) {
    parts.push(`SEQUENCING RATIONALE (from synthesis): ${synthesisData.sequencing_rationale}`);
  }

  // ── Pipeline context (new data sources) ──
  if (pipelineContext) {
    if (pipelineContext.bridges?.length) {
      const bLines = pipelineContext.bridges.map((b) =>
        `  ${b.source_entity} ↔ ${b.target_entity} [${b.bridge_type}, ${b.coupling_strength}]${b.shared_variable ? ` shared: ${b.shared_variable}` : ""}: ${b.description ?? ""}`
      );
      parts.push(`CROSS-SPACE BRIDGES (verified integration channels — use these as infrastructure connectors):\n${bLines.join("\n")}`);
    }

    if (pipelineContext.reasoningResults?.length) {
      const rrLines = pipelineContext.reasoningResults.map((r) =>
        `  [${r.type}] ${r.summary}`
      );
      parts.push(`GRAPH-THEORETIC ANALYSIS (validated system structure):\n${rrLines.join("\n")}`);
    }

    if (pipelineContext.strategicCorridors?.length) {
      const scLines = pipelineContext.strategicCorridors.map((c) =>
        `  ${c.path} (strength: ${c.strength})`
      );
      parts.push(`STRATEGIC CORRIDORS (high-influence pathways — route infrastructure along these):\n${scLines.join("\n")}`);
    }

    if (pipelineContext.tensionZones?.length) {
      const tzLines = pipelineContext.tensionZones.map((t) =>
        `  ${t.entity}: ${t.description}`
      );
      parts.push(`TENSION ZONES (opposing forces — strategy must manage, not force):\n${tzLines.join("\n")}`);
    }

    if (pipelineContext.convergences?.length) {
      const convLines = pipelineContext.convergences
        .slice()
        .sort((a, b) => b.structural_value - a.structural_value)
        .map((c) => `  [${c.depth}] ${c.shared_element_name}: ${c.converging_branches} branches converge (structural value: ${(c.structural_value * 100).toFixed(0)}%) \u2014 ${c.explanation}`);
      parts.push(`CONVERGENCE INSIGHTS (cross-category leverage \u2014 deeper tiers = rarer, higher-impact. L4=invariant > L3=logic > L2=method > L1=outcome. Acting on high-depth convergences moves multiple domains at once):\n${convLines.join("\n")}`);
    }

    // ── Comprehensive grounding: axioms, coverage, insight convergences, inversions ──
    // These populate when the upstream pipeline produced them (decompose Tier 7 for
    // axioms, synthesize for the rest). The prompt above references these blocks
    // and demands the strategy respect them.

    if (pipelineContext.axioms?.length) {
      const lines = pipelineContext.axioms.map((ax) => {
        const visTag = ax.visibility === "HIDDEN" ? "HIDDEN⚠" : ax.visibility;
        const rests = ax.rests_on?.length ? ` [rests on: ${ax.rests_on.slice(0, 4).join(", ")}]` : "";
        return `  ${ax.axiom_id} [${visTag} · ${ax.load_bearing} · scope=${ax.scope}]: "${ax.claim}"${rests}${ax.if_false ? `\n      IF FALSE: ${ax.if_false}` : ""}${ax.validation_path ? `\n      TEST: ${ax.validation_path}` : ""}`;
      });
      const hiddenCount = pipelineContext.axioms.filter((a) => a.visibility === "HIDDEN").length;
      const criticalCount = pipelineContext.axioms.filter((a) => a.load_bearing === "critical").length;
      parts.push(
        `LOAD-BEARING AXIOMS (${pipelineContext.axioms.length} total, ${hiddenCount} HIDDEN, ${criticalCount} critical) \u2014 the entire analysis rests on these. Strategy MUST respect every CRITICAL axiom and acknowledge every HIDDEN one. Reference these axiom IDs in tactic.axiom_ids_respected / axiom_ids_challenged fields:\n${lines.join("\n")}`,
      );
    }

    if (pipelineContext.strategyCoverage) {
      const cov = pipelineContext.strategyCoverage;
      const gapLines = cov.gaps.slice(0, 20).map((g) =>
        `  ${g.id} [${g.kind.replace(/_/g, " ")}]: "${g.label}" \u2014 ${g.why_important}`,
      );
      parts.push(
        `STRATEGY COVERAGE AUDIT (overall: ${cov.overall_coverage}% \u2014 measures whether the existing action plan addresses all critical findings):\n  Critical axioms: ${cov.addressed_counts.critical_axioms}/${cov.totals.critical_axioms} addressed\n  Hidden axioms: ${cov.addressed_counts.hidden_axioms}/${cov.totals.hidden_axioms} addressed\n  Critical risks: ${cov.addressed_counts.critical_risks}/${cov.totals.critical_risks} addressed\n  High-impact signals: ${cov.addressed_counts.high_impact_signals}/${cov.totals.high_impact_signals} addressed\n${cov.gaps.length > 0 ? `\n  UNCOVERED FINDINGS (close at least half of these in your strategy):\n${gapLines.join("\n")}` : ""}`,
      );
    }

    if (pipelineContext.insightConvergences?.length) {
      const sorted = pipelineContext.insightConvergences
        .slice()
        .sort((a, b) => {
          const rank = { strong: 3, moderate: 2, weak: 1 } as const;
          if (a.strength !== b.strength) return rank[b.strength] - rank[a.strength];
          if (a.has_hidden_axiom !== b.has_hidden_axiom) return a.has_hidden_axiom ? -1 : 1;
          return b.signal_count - a.signal_count;
        });
      const icLines = sorted.map((c) => {
        const hiddenTag = c.has_hidden_axiom ? " ⟡ hidden-axiom" : "";
        return `  ${c.cluster_id} [${c.strength}${hiddenTag} · ${c.signal_count} signals, ${c.distinct_type_count} types]: "${c.concern_label}"${c.shared_entity_ids.length > 0 ? ` [entities: ${c.shared_entity_ids.slice(0, 4).join(", ")}]` : ""}`;
      });
      const strongCount = pipelineContext.insightConvergences.filter((c) => c.strength === "strong").length;
      const hiddenAxiomCount = pipelineContext.insightConvergences.filter((c) => c.has_hidden_axiom).length;
      parts.push(
        `INSIGHT CONVERGENCES (${pipelineContext.insightConvergences.length} clusters, ${strongCount} STRONG, ${hiddenAxiomCount} involving hidden axioms) \u2014 cross-mechanism high-trust findings. Every STRONG convergence MUST be reflected in the strategy. Clusters with hidden-axiom involvement are the most reliable findings in the analysis. Reference cluster IDs in tactic.convergence_ids_addressed:\n${icLines.join("\n")}`,
      );
    }

    if (pipelineContext.assumptionInversions?.length) {
      const invLines = pipelineContext.assumptionInversions.map((inv, i) => {
        const label = inv.target_type === "axiom" ? `axiom ${inv.target_entity_id}` : `${inv.target_type.replace(/_/g, " ")} ${inv.target_entity_id}`;
        return `  inv${i} [plausibility=${inv.plausibility}, target=${label}]: "${inv.inverted_claim}"\n      Test: ${inv.test}`;
      });
      const coinFlipCount = pipelineContext.assumptionInversions.filter((i) => i.plausibility === "coin_flip").length;
      parts.push(
        `ASSUMPTION INVERSIONS (${pipelineContext.assumptionInversions.length} total, ${coinFlipCount} coin-flip) \u2014 contrarian readings that stress-test the analysis. For every coin-flip inversion, include a cheap disconfirming test in the early action plan before committing irreversibly. Reference inversion indices in tactic.inversion_ids_tested:\n${invLines.join("\n")}`,
      );
    }

    if (pipelineContext.candidateCycles?.length) {
      const ccLines = pipelineContext.candidateCycles.slice(0, 6).map((c) =>
        `  ${c.edge.source} → ${c.edge.target} [${c.edge.dynamics}]: ${c.reason}`,
      );
      parts.push(
        `CANDIDATE FEEDBACK LOOPS (edges with compounding/exponential dynamics not traced as cycles \u2014 likely untraced feedback loops worth investigating):\n${ccLines.join("\n")}`,
      );
    }

    if (pipelineContext.comprehensiveMode) {
      parts.push(
        `═══ COMPREHENSIVE MODE ENGAGED ═══\nThe user selected comprehensive tier. Apply the strictest interpretation of the COMPREHENSIVE GROUNDING rules. The strategy MUST include axiom_ids_respected / convergence_ids_addressed / coverage_gap_ids_closed / inversion_ids_tested fields on every tactic and perspective. If the upstream context cannot support a fully-grounded strategy (missing axioms, no convergences, etc.), say so explicitly in strategic_diagnosis rather than producing an ungrounded strategy.`,
      );
    }

    if (pipelineContext.userConstraint && pipelineContext.userConstraint.trim().length > 0) {
      parts.push(
        `═══ USER CONSTRAINT (iterative refinement) ═══\nThe user is iterating on a prior version of this strategy. Apply the following constraint on top of all other grounding — treat it as a hard preference unless it directly contradicts a CRITICAL axiom:\n\n"${pipelineContext.userConstraint.trim()}"\n\nIn your strategic_diagnosis, briefly acknowledge how the constraint shaped the recommendation (which options were narrowed, which trade-offs it forced).`,
      );
    }

    if (pipelineContext.previousQualityFlags?.length) {
      parts.push(`PREVIOUS STRATEGY WEAKNESSES (avoid repeating):\n${pipelineContext.previousQualityFlags.map((f) => `  - ${f.replace(/_/g, " ")}`).join("\n")}`);
    }

    if (pipelineContext.goalFitnessIssues?.length) {
      parts.push(`GOAL FITNESS ISSUES (from validation — strategy must resolve these):\n${pipelineContext.goalFitnessIssues.map((i) => `  - ${i.message}`).join("\n")}`);
    }

    if (pipelineContext.researchDepth) {
      const ctx = pipelineContext as Record<string, unknown>;
      const embeddedStr = ctx.embeddedIntelCount ? ` (${ctx.embeddedIntelCount} embedded intel, ${ctx.observatoryCount ?? 0} observatory)` : "";
      parts.push(`RESEARCH CONTEXT: ${pipelineContext.researchDepth} depth, ${pipelineContext.searchesPerformed ?? 0} web searches, ${pipelineContext.externalEntityCount ?? 0} external entities${embeddedStr}`);
      if (ctx.embeddedIntelCount) {
        parts.push(`INTELLIGENCE TIERS: ${ctx.embeddedIntelCount} external entities are EMBEDDED (directly bridged to user's system — high strategic weight). ${ctx.observatoryCount ?? 0} are OBSERVATORY (landscape context — useful for awareness but lower weight). Prioritize embedded intelligence in your recommendations.`);
      }
    }

    if (pipelineContext.intelligenceSignals?.length) {
      const sigLines = pipelineContext.intelligenceSignals.map((s) =>
        `  - [${s.severity.toUpperCase()}] ${s.entity_name} (${s.type.replace(/_/g, " ")}): ${s.description}${s.related_internal_entities.length ? ` — affects: ${s.related_internal_entities.join(", ")}` : ""}`
      );
      parts.push(`INTELLIGENCE SIGNALS: These signals from recent research should inform strategy adjustments. High-severity and escalated signals indicate external changes that may require shifting priorities, adding contingencies, or revising assumptions:\n${sigLines.join("\n")}`);
    }

    // Hidden signals — high-impact invisible variables the user needs to account for
    const ctx = pipelineContext as Record<string, unknown>;
    if (Array.isArray(ctx.hiddenSignals) && (ctx.hiddenSignals as unknown[]).length > 0) {
      const hsLines = (ctx.hiddenSignals as Array<{ name: string; type: string; impact: number; description: string; detection: string; related_entities: string[] }>).map((s) =>
        `  - [Impact: ${s.impact}/10] ${s.name} (${s.type.replace(/_/g, " ")}): ${s.description}${s.detection ? ` | Detection: ${s.detection}` : ""}${s.related_entities.length ? ` | Affects: ${s.related_entities.join(", ")}` : ""}`
      );
      parts.push(`HIDDEN SIGNALS (invisible variables controlling system trajectory — highest-value strategic input):\nThese are mediating variables, structural risks, and missing metrics that domain expertise reveals are critical but are NOT in the user's current graph. Strategy MUST account for these:\n${hsLines.join("\n")}`);
    }

    // Phase 4b: resolved open questions — treat user-supplied answers as factual anchors
    if (Array.isArray(pipelineContext.resolvedOpenQuestions) && pipelineContext.resolvedOpenQuestions.length > 0) {
      const priorityRank = (p: string) => (p === "critical" ? 0 : p === "high" ? 1 : 2);
      const sorted = [...pipelineContext.resolvedOpenQuestions].sort(
        (a, b) => priorityRank(a.priority) - priorityRank(b.priority)
      );
      const roqLines = sorted.map((q) =>
        `  - [${q.priority.toUpperCase()}] Q: ${q.question}\n      A: ${q.answer}${q.why_it_matters ? `\n      (Matters because: ${q.why_it_matters})` : ""}`
      );
      parts.push(`RESOLVED OPEN QUESTIONS (USER-SUPPLIED FACTUAL ANCHORS):\nThe user has personally answered the following open questions surfaced during synthesis. Treat these answers as GROUND TRUTH for this strategy — they are the user's own facts, not speculation. Where a 'critical' or 'high' priority answer exists, it replaces any assumption you would otherwise make about that variable. Reference these anchors explicitly in your recommendation's reasoning and tailor the strategy to respect them:\n${roqLines.join("\n")}`);
    }

    // Edge conditions — conditions governing bridge connections (probability space data)
    if (Array.isArray(ctx.edgeConditions) && (ctx.edgeConditions as unknown[]).length > 0) {
      const ecLines = (ctx.edgeConditions as Array<{ source: string; target: string; conditions: Array<{ condition_type: string; condition_description: string; probability: number; controllability: string }> }>).map((ec) => {
        const condStr = ec.conditions.map((c) =>
          `    · [${c.condition_type}] ${c.condition_description} (p=${c.probability}, ${c.controllability})`
        ).join("\n");
        return `  ${ec.source} ↔ ${ec.target}:\n${condStr}`;
      });
      parts.push(`EDGE CONDITIONS (probability space — conditions governing key connections):\nThese conditions determine when bridges between external intelligence and internal entities strengthen, weaken, or gate. Use these to build conditional strategies (if X then Y):\n${ecLines.join("\n")}`);
    }

    // Unresolved research gaps — critical areas that need more investigation
    if (Array.isArray(ctx.unresolvedResearchGaps) && (ctx.unresolvedResearchGaps as unknown[]).length > 0) {
      const rgLines = (ctx.unresolvedResearchGaps as Array<{ type: string; description: string; priority: string }>).map((g) =>
        `  - [${g.priority.toUpperCase()}] (${g.type.replace(/_/g, " ")}): ${g.description}`
      );
      parts.push(`UNRESOLVED RESEARCH GAPS: The following areas could not be fully verified during research. Strategy should include contingencies or recommend further investigation:\n${rgLines.join("\n")}`);
    }

    // Graph structure — structural topology for architectural strategy decisions
    if (ctx.graphStructure && typeof ctx.graphStructure === "object") {
      const gs = ctx.graphStructure as { hub_entities?: Array<{ entity_id: string; name: string; degree: number; betweenness: number }>; bridge_edges?: Array<{ source: string; target: string }>; density?: number; component_count?: number };
      if (gs.hub_entities?.length) {
        const hubLines = gs.hub_entities.map((h) => `  - ${h.name} (${h.entity_id}): degree=${h.degree}, betweenness=${h.betweenness}`);
        parts.push(`GRAPH STRUCTURE — HUB ENTITIES (highest centrality — information chokepoints, structural leverage):\n${hubLines.join("\n")}`);
      }
      if (gs.bridge_edges?.length) {
        parts.push(`BRIDGE EDGES (single points of failure — strategy must protect or redundantize these):\n${gs.bridge_edges.map((b) => `  - ${b.source} → ${b.target}`).join("\n")}`);
      }
      if (gs.density !== undefined) {
        parts.push(`GRAPH DENSITY: ${gs.density} (${gs.density < 0.1 ? "sparse — many entities lack connections" : gs.density < 0.3 ? "moderate connectivity" : "dense — highly interconnected"}), ${gs.component_count ?? 1} component(s)`);
      }
    }

    // Probability spaces — sub-graph failure modes and conditions
    if (ctx.probabilitySpaces && typeof ctx.probabilitySpaces === "object") {
      const ps = ctx.probabilitySpaces as { spaces?: Array<{ edge_label: string; total_probability: number; failure_points: Array<{ name: string; mode: string; probability: number; blast_radius: string }> }>; intersections?: Array<{ label_a: string; label_b: string; shared_variables: string[]; novelty: number; insight: string }> };
      if (ps.spaces?.length) {
        const spLines = ps.spaces.map((s) => {
          const fpStr = s.failure_points.map((fp) => `    ⚠ ${fp.name}: ${fp.mode} (p=${fp.probability}, blast=${fp.blast_radius})`).join("\n");
          return `  ${s.edge_label} (probability: ${(s.total_probability * 100).toFixed(0)}%):\n${fpStr}`;
        });
        parts.push(`PROBABILITY SPACES — CONNECTION SUB-GRAPHS (failure points the strategy must address):\n${spLines.join("\n")}`);
      }
      if (ps.intersections?.length) {
        const intLines = ps.intersections.map((i) => `  - ${i.label_a} ∩ ${i.label_b}: shared=[${i.shared_variables.join(", ")}] novelty=${i.novelty.toFixed(2)} — ${i.insight}`);
        parts.push(`PROBABILITY SPACE INTERSECTIONS (cross-domain opportunities — highest-leverage strategic moves):\n${intLines.join("\n")}`);
      }
    }

    // Strategic diagnosis from Step 1 (when multi-step engine runs)
    if (ctx.strategicDiagnosis && typeof ctx.strategicDiagnosis === "object") {
      const sd = ctx.strategicDiagnosis as { core_problem: string; confidence: number; blind_spots: string[] };
      parts.push(`STRUCTURAL DIAGNOSIS (from reasoning Step 1):\nCore problem: ${sd.core_problem}\nDiagnosis confidence: ${sd.confidence}%${sd.blind_spots?.length ? `\nBlind spots: ${sd.blind_spots.join("; ")}` : ""}`);
    }

    // Verified options from Step 3 (when multi-step engine runs)
    if (Array.isArray(ctx.verifiedOptions) && (ctx.verifiedOptions as unknown[]).length > 0) {
      const voLines = (ctx.verifiedOptions as Array<{ title: string; rank: number; verified_confidence: number; key_assumptions: string[]; failure_risks: string[] }>).map((v) =>
        `  #${v.rank} "${v.title}" (verified confidence: ${v.verified_confidence}%)${v.key_assumptions.length ? ` | Assumptions: ${v.key_assumptions.join("; ")}` : ""}${v.failure_risks.length ? ` | Risks: ${v.failure_risks.join("; ")}` : ""}`
      );
      parts.push(`VERIFIED STRATEGIC OPTIONS (from reasoning Steps 2-3 — use these as your starting point, refine into full strategies):\n${voLines.join("\n")}`);
    }
  }

  // ── Pre-built strategy layers (from bottom-up generation) ──
  const ctxRecord = (pipelineContext ?? {}) as Record<string, unknown>;
  if (ctxRecord.preBuiltStrategyLayers && typeof ctxRecord.preBuiltStrategyLayers === "object") {
    const layers = ctxRecord.preBuiltStrategyLayers as {
      l1_outcomes: Array<{ id: string; outcome: string; sequence_position: number; sequence_rationale: string; target_metric?: string; served_by_l2: string[]; pillar_sources: Array<{ pillar: string; source_refs: string[]; contribution: string }> }>;
      l2_methods: Array<{ id: string; title: string; causal_chain: Array<{ step: string; entity_refs: string[]; mechanism: string }>; optimality_rationale: string; serves_l1: string[]; justified_by_l3: string[]; pillar_sources: Array<{ pillar: string; source_refs: string[]; contribution: string }> }>;
      l3_reasoning: Array<{ id: string; logic_statement: string; reasoning_type: string; evidence: string[]; justifies_l2: string[]; enhanced_by_l4: string[]; pillar_sources: Array<{ pillar: string; source_refs: string[]; contribution: string }> }>;
      l4_insights: Array<{ id: string; insight: string; scale: string; insight_type: string; enhances_l3: string[]; pillar_sources: Array<{ pillar: string; source_refs: string[]; contribution: string }>; confidence: string }>;
      architecture_summary: string;
    };

    const layerParts: string[] = [];
    layerParts.push(`PRE-BUILT STRATEGY LAYERS (generated bottom-up L4→L3→L2→L1 — USE THESE AS-IS in your strategy_layers output, DO NOT regenerate):`);
    layerParts.push(`Architecture: ${layers.architecture_summary}`);

    if (layers.l4_insights.length > 0) {
      layerParts.push(`\nL4 ATOMIC INSIGHTS (${layers.l4_insights.length}):`);
      for (const i of layers.l4_insights) {
        layerParts.push(`  [${i.id}] (${i.insight_type}, ${i.scale}, ${i.confidence}): ${i.insight}`);
        layerParts.push(`    Enhances: ${i.enhances_l3.join(", ") || "none"} | Sources: ${i.pillar_sources.map((p) => `${p.pillar}:${p.source_refs.join(",")}`).join("; ")}`);
      }
    }

    if (layers.l3_reasoning.length > 0) {
      layerParts.push(`\nL3 REASONING UNITS (${layers.l3_reasoning.length}):`);
      for (const r of layers.l3_reasoning) {
        layerParts.push(`  [${r.id}] (${r.reasoning_type}): ${r.logic_statement}`);
        layerParts.push(`    Evidence: ${r.evidence.slice(0, 3).join("; ")}`);
        layerParts.push(`    Justifies: ${r.justifies_l2.join(", ") || "none"} | Enhanced by: ${r.enhanced_by_l4.join(", ") || "none"}`);
      }
    }

    if (layers.l2_methods.length > 0) {
      layerParts.push(`\nL2 METHOD CHAINS (${layers.l2_methods.length}):`);
      for (const m of layers.l2_methods) {
        const chain = m.causal_chain.map((s) => `${s.step} [${s.entity_refs.join(",")}]`).join(" → ");
        layerParts.push(`  [${m.id}] "${m.title}": ${chain}`);
        layerParts.push(`    Optimality: ${m.optimality_rationale.slice(0, 150)}`);
        layerParts.push(`    Serves: ${m.serves_l1.join(", ") || "none"} | Justified by: ${m.justified_by_l3.join(", ") || "none"}`);
      }
    }

    if (layers.l1_outcomes.length > 0) {
      layerParts.push(`\nL1 OUTCOMES (${layers.l1_outcomes.length}, sequenced):`);
      for (const o of layers.l1_outcomes) {
        layerParts.push(`  [${o.id}] #${o.sequence_position}: ${o.outcome}${o.target_metric ? ` (metric: ${o.target_metric})` : ""}`);
        layerParts.push(`    Sequence rationale: ${o.sequence_rationale}`);
        layerParts.push(`    Served by: ${o.served_by_l2.join(", ") || "none"}`);
      }
    }

    parts.push(layerParts.join("\n"));

    parts.push(`
CRITICAL INSTRUCTION — PRE-BUILT LAYERS:
The strategy_layers field in your output MUST be a COPY of the pre-built layers above. Do NOT regenerate or modify them.
Your job is to generate the REST of the recommendation (guiding_policy, perspectives, micro_tactics, temporal_phases, infrastructure_map, pre_mortem, learning_loop) that is CONSISTENT with these pre-built layers:
- guiding_policy must address the L3 reasoning types (multipliers, thresholds, feedback activations)
- perspectives must map to L1 outcomes
- micro_tactics must implement L2 method chain steps
- temporal_phases must sequence L1 outcomes by their sequence_position
- pre_mortem failure modes must test L3 assumptions
- learning_loop leading indicators must track L2 method chain progress`);
  }

  // ── Mode-specific instructions ──
  let modeInstruction: string;

  if (confirmedStrategy) {
    // Change proposal mode — existing confirmed strategy, generate modifications
    modeInstruction = `A strategy has already been CONFIRMED and is in execution:
Title: "${confirmedStrategy.title}"
Posture: ${confirmedStrategy.strategic_posture}
Summary: ${confirmedStrategy.summary}
Components: ${confirmedStrategy.infrastructure_map?.core_components?.map((c) => `${c.entity_id} (${c.role}, ${c.status})`).join(", ") ?? "none"}
Perspectives: ${confirmedStrategy.perspectives.map((p) => p.name).join(", ")}

Given the UPDATED synthesis data above, generate:
1. The SAME strategy format as your primary output (which may have evolved based on new data)
2. Additionally, generate 2 alternative strategies that represent different approaches
3. For EACH strategy, generate infrastructure_proposals: concrete tools/apps/dashboards that should be built to execute the strategy

For each strategy, also identify what CHANGED from the confirmed version. If the primary strategy is substantially different from the confirmed one, explain why in the ranking_rationale.

Return JSON with this wrapper format:
{
  "ranked_strategies": [
    {
      "rank": 1,
      "recommendation": { ...full StrategicRecommendation... },
      "ranking_rationale": "string — why this is rank 1, and if different from confirmed strategy, what changed",
      "infrastructure_proposals": [
        {
          "id": "infra_1",
          "name": "string — e.g., Customer Feedback Tracker",
          "description": "string — what this tool does",
          "type": "app | tool | dashboard | workflow | integration | monitor",
          "source_perspective": "string — which BSC perspective this supports",
          "source_components": ["entity IDs from infrastructure_map"],
          "metrics_tracked": ["KPI names this tool monitors"],
          "priority": 1,
          "complexity": "low | medium | high",
          "status": "proposed",
          "agent_specs": [ { "...see INFRASTRUCTURE_PROPOSAL_SCHEMA above for full agent_spec shape and rules..." } ],
          "mechanism_hints": ["simulation | prediction | validation | baseline_tracking | deviation_capture | game | ml_personalization"]
        }
      ],
      "tradeoff_vs_top": null
    },
    { "rank": 2, ... "tradeoff_vs_top": "string — what you give up vs rank 1" },
    { "rank": 3, ... "tradeoff_vs_top": "string" }
  ],
  "change_proposals": [
    {
      "change_type": "modify_perspective | add_tactic | remove_tactic | adjust_timeline | reprioritize | pivot",
      "target": "string — what's being changed",
      "current": "string — current state",
      "proposed": "string — proposed change",
      "reasoning": "string",
      "impact": "low | medium | high",
      "urgency": "low | medium | high"
    }
  ]
}`;
  } else {
    // Fresh generation mode — no confirmed strategy exists
    modeInstruction = `Design 3 RANKED strategic recommendations. Each is a complete SYSTEM ARCHITECTURE showing what infrastructure to build, which channels to establish, and how components integrate to achieve the target objective.

- Rank 1: The OPTIMAL strategy given all evidence
- Rank 2: A VIABLE ALTERNATIVE with different tradeoffs (e.g., lower risk, different timeline, different focus area)
- Rank 3: A CONTRARIAN OPTION that challenges assumptions or takes a completely different approach

For EACH strategy, also generate 1-3 infrastructure_proposals: concrete tools, apps, or dashboards that should be built to support execution of that specific strategy. These become "Execution Labs" — proposed systems the user can approve for auto-generation.

Return JSON with this wrapper format:
{
  "ranked_strategies": [
    {
      "rank": 1,
      "recommendation": { ...full StrategicRecommendation as specified in the schema above... },
      "ranking_rationale": "string — 1-2 sentences: why this ranks #1, what evidence supports it",
      "infrastructure_proposals": [
        {
          "id": "infra_1",
          "name": "string — descriptive tool name, e.g., 'Innovation Pipeline Dashboard'",
          "description": "string — what this tool does and how it connects to the strategy",
          "type": "app | tool | dashboard | workflow | integration | monitor",
          "source_perspective": "string — which BSC perspective this supports",
          "source_components": ["entity IDs from infrastructure_map this implements"],
          "metrics_tracked": ["KPI names this tool monitors"],
          "priority": 1,
          "complexity": "low | medium | high",
          "status": "proposed",
          "agent_specs": [
            {
              "id": "agent_primary",
              "role": "reasoner | measurer | predictor | validator | simulator | recommender | critic",
              "responsibility": "ONE-sentence ownership statement — see AGENT SPEC RULES",
              "inputs": [ { "source": "...", "selector": {}, "rationale": "..." } ],
              "insight_outputs": [ { "kind": "...", "writes_to": "...", "cadence_hint": "..." } ],
              "measurement_spec": { "metric": "...", "cadence": "...", "compare_against": "..." },
              "collaborates_with": [],
              "scoping_confidence": 0.8
            }
          ],
          "mechanism_hints": ["prediction", "deviation_capture"]
        }
      ],
      "tradeoff_vs_top": null
    },
    { "rank": 2, "recommendation": {...}, "ranking_rationale": "...", "infrastructure_proposals": [...], "tradeoff_vs_top": "string — what you sacrifice vs #1" },
    { "rank": 3, "recommendation": {...}, "ranking_rationale": "...", "infrastructure_proposals": [...], "tradeoff_vs_top": "string — what you sacrifice vs #1" }
  ]
}`;
  }

  const user = `${modeInstruction}\n\n${parts.join("\n\n")}`;

  return { system, user };
}
