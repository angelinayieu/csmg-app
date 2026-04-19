// Phase 7B: Strategic Recommendation types
// Transforms analysis findings into coherent strategy proposals with infrastructure

/**
 * A strategic perspective (BSC-inspired) — one row in the strategy-on-a-page.
 * Each perspective groups related metrics, targets, and entity references.
 */
export interface StrategyPerspective {
  name: string; // e.g., "Growth & Scale", "Risk & Resilience", "Capability Building", "Market Position"
  icon: string; // emoji
  objective: string; // what we're trying to achieve in this perspective
  key_metric: {
    name: string;
    current: string; // qualitative or quantitative
    target: string;
    unit?: string;
    /** Direction of recent change — used by Operating Twin for lab card trend arrow */
    trend_direction?: "up" | "down" | "stable";
    /** Optional formatted delta label, e.g. "↑ 4.2" or "↓ 12%" */
    trend_delta?: string;
    /** Estimated contribution to twin health score, 0-100 — used for lab card size & edge weight */
    contribution_to_health?: number;
  };
  supporting_entities: string[]; // entity IDs (C-prefixed and X-prefixed)
  /** Optional entity refs for lab card click-through (usually same as supporting_entities) */
  entity_refs?: string[];
  /** Optional rationale for why this perspective matters */
  rationale?: string;
  /** Stable id for this perspective (used by Operating Twin as lab id) */
  id?: string;
  actions: Array<{
    text: string;
    timeframe: "now" | "short_term" | "medium_term" | "long_term";
    entity_id?: string; // which entity this acts on
    dynamic_role?: "clears_threshold" | "starts_loop" | "accelerates_loop" | "linear_improvement";
    infrastructure_note?: string; // what infrastructure this creates or strengthens
  }>;
  confidence: "high" | "moderate" | "low";
}

/**
 * A micro tactic — concrete executable step that maps to the macro strategy.
 * These become sub-dashboard candidates.
 */
export interface MicroTactic {
  id: string; // unique key for React
  title: string;
  description: string;
  entity_id: string; // primary entity this acts on
  entity_name: string;
  macro_link: string; // which macro strategy element this serves
  infrastructure_action?: "build" | "strengthen" | "connect" | "monitor" | "configure";
  channels_established?: string[]; // "entity_id → entity_id" pairs
  priority: number; // 1 = highest
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  metric: {
    name: string;
    target: string;
    unit?: string;
    /** Current measured value (if available) — used by Operating Twin tracker lab */
    current_value?: string | number;
    /** Direction of recent change */
    trend?: "up" | "down" | "stable";
  };
  dependencies: string[]; // entity IDs that must be addressed first
  timeframe: "now" | "short_term" | "medium_term" | "long_term";
  // Enhancement 4: Implementation intention (Gollwitzer if-then format, ~2x follow-through)
  implementation_intention?: {
    trigger: string; // "When/If [specific situational cue]..."
    action: string;  // "...then I will [specific goal-directed behavior]"
    category: "proactive" | "reactive" | "course_correction";
  };
}

/**
 * Infrastructure map — the system architecture of the strategy.
 * Shows what components exist/need building and how they connect.
 */
export interface InfrastructureMap {
  core_components: Array<{
    entity_id: string; // existing entity ID or "NEW" for proposed
    entity_name: string;
    role: "hub" | "input" | "output" | "processor" | "monitor" | "gate";
    description: string;
    receives_from: string[]; // entity IDs
    produces_for: string[]; // entity IDs
    status: "exists" | "needs_strengthening" | "needs_building";
    priority: "critical" | "important" | "supporting";
  }>;
  key_channels: Array<{
    from: string; // entity ID
    to: string; // entity ID
    channel_type: "data_flow" | "feedback" | "control" | "dependency" | "amplification";
    description: string;
    exists: boolean;
    strength_needed: "strong" | "moderate";
  }>;
  activated_loops: Array<{
    name: string;
    activation_phase: string;
    role_in_strategy: string;
  }>;
}

/**
 * Enhancement 2: Guiding Policy — the strategic LOGIC that connects
 * diagnosis to actions. Not a list of actions, but the coherent
 * principle that constrains all actions. (Rumelt's "kernel of strategy")
 */
export interface GuidingPolicy {
  /** One sentence: the overall approach (e.g., "Focus on busy professionals, not students") */
  policy_statement: string;
  /** Why this approach addresses the bottleneck and produces the aspiration */
  strategic_logic: string;
  /** What asymmetric advantage is being exploited */
  leverage_source: string;
  /** What this policy explicitly says NO to */
  what_this_excludes: string[];
  /** How the policy guides action in novel situations */
  coherence_test?: {
    situation_1: string;
    guidance_1: string;
    situation_2: string;
    guidance_2: string;
    reinforcing_explanation: string;
  };
}

/**
 * Enhancement 3: Pre-mortem failure mode — prospective hindsight using
 * past-tense grammar per Klein's research (+30% risk identification).
 */
export interface PreMortemFailureMode {
  /** internal | structural | competitive | timing | interaction */
  category: "internal" | "structural" | "competitive" | "timing" | "interaction";
  /** Past-tense narrative: "The strategy failed because..." (2-3 sentences) */
  narrative: string;
  /** Observable signs visible in the first weeks */
  early_warnings: string[];
  severity: "catastrophic" | "major" | "moderate";
  probability: "high" | "moderate" | "low";
  /** Which policy assumption this exposes as weak */
  assumption_exposed: string;
  related_entity_ids: string[];
}

/**
 * Enhancement 5: Strategy learning loop — the feedback system that wraps
 * the strategy. What to observe, when to pivot, how to learn.
 * (Boyd's OODA, Lean Startup validated learning)
 */
export interface StrategyLearningLoop {
  /** The aspiration metric itself — ultimate success indicator */
  lagging_indicator: {
    metric: string;
    target: string;
    deadline: string;
  };
  /** 2-4 predictive metrics that move BEFORE the lagging indicator */
  leading_indicators: Array<{
    metric: string;
    measurement_method: string;
    cadence: "daily" | "weekly" | "biweekly" | "monthly";
    green_reading: string;
    yellow_reading: string;
    red_reading: string;
    connects_to_policy_element: string;
  }>;
  /** How often to check and review */
  review_cadence: {
    metric_checks: string;
    full_strategy_review: string;
    total_cycles_in_timeline: number;
  };
  /** Pre-committed conditions for strategy revision */
  pivot_criteria: Array<{
    signal: string;
    timeline: string;
    response: "revise_diagnosis" | "revise_bottleneck" | "revise_policy" | "abandon" | "accelerate";
    specific_action: string;
  }>;
  /** Signals that justify staying the course despite setbacks */
  persistence_signals: Array<{
    signal: string;
    meaning: string;
  }>;
}

/**
 * The target objective the strategy is optimizing for.
 */
export interface StrategyTargetObjective {
  title: string;
  metric: string;
  current: string;
  target: string;
  source: "goal" | "auto_detected" | "inferred";
}

/**
 * The complete strategic recommendation — macro direction + infrastructure + micro execution.
 * This is what gets rendered as "Top Ranked #1 Recommendation Strategy".
 */
export interface StrategicRecommendation {
  // Macro strategy
  title: string;
  strategic_posture: "aggressive_growth" | "cautious_validation" | "pivot_exploration" | "consolidation" | "defensive";
  confidence: number; // 0-100
  summary: string; // 2-3 sentence strategic direction

  // What this strategy optimizes for
  target_objective?: StrategyTargetObjective;

  // FK to improvement_goals.id — the canonical goal this strategy targets.
  // Stamped post-LLM in the strategy-refresh route so it's deterministic,
  // not dependent on the LLM returning it.
  improvement_goal_id?: string;

  // Enhancement 2: The guiding policy — strategic logic, not action list
  guiding_policy?: GuidingPolicy;

  // The key decision this strategy addresses
  key_decision: {
    question: string;
    recommended: string;
    reasoning: string;
    alternatives: Array<{
      option: string;
      tradeoff: string;
    }>;
    supporting_entities: string[];
  };

  // Infrastructure map — what to build and how it connects
  infrastructure_map?: InfrastructureMap;

  // Strategy on a Page (BSC format)
  perspectives: StrategyPerspective[];

  // Micro tactics (concrete steps)
  micro_tactics: MicroTactic[];

  // Temporal flow
  temporal_phases: Array<{
    label: string;
    focus: string;
    key_metric: string;
    milestone: string;
    loops_activated?: string[];
    infrastructure_deployed?: string[];
  }>;

  // Enhancement 3: Pre-mortem failure analysis (past-tense, per Klein's research)
  pre_mortem?: PreMortemFailureMode[];

  // Enhancement 5: Strategy learning loop (Boyd's OODA, leading indicators, pivot criteria)
  learning_loop?: StrategyLearningLoop;

  // Phase 9: 4-layer reasoning architecture showing HOW the strategy was formed
  strategy_layers?: StrategyLayers;

  // Evidence grounding
  entity_references: string[];
  external_evidence_count: number;
  quality_signals: {
    grounded_in_data: boolean;
    temporal_aware: boolean;
    risk_addressed: boolean;
    external_validated: boolean;
    infrastructure_specified?: boolean;
    objective_targeted?: boolean;
  };
}

// ── Agent specs + mechanism hints ──────────────────────────────────────
//
// Item 1 of the App+Strategy Rigor sprint: agents become first-class on
// infrastructure proposals, so downstream (app-generator, manifest-builder,
// Sprint 3 agent loop) has concrete role/responsibility/measurement specs
// to bind to — instead of synthesizing agents from thin air.
//
// Kept optional for backward compatibility; older strategies without
// agent_specs/mechanism_hints still load and render.

/**
 * Role taxonomy for agents attached to an app. Closed union so downstream
 * dispatch + UI can branch on role. Add sparingly — each new role should
 * have a distinct responsibility, not a variation of an existing one.
 */
export type AgentRoleKind =
  | "reasoner"        // synthesizes signals → insights
  | "measurer"        // captures metrics, writes to ledgers
  | "predictor"       // forward-models metrics into prediction_ledger
  | "validator"       // runs experiments, resolves hypotheses
  | "simulator"       // runs what-if scenarios against twin state
  | "recommender"     // proposes next actions for the user
  | "critic";         // stress-tests other agents' outputs

/**
 * Declared input source for an agent. Used by the agent runtime to know
 * what context to hand the agent at invocation time.
 */
export interface AgentInputSpec {
  source:
    | "entity"              // a specific entity by id
    | "intervention"        // an intervention assigned to this app
    | "metric_series"       // a named metric's time series
    | "twin_state"          // current TwinState for the space
    | "user_signal"         // user-authored annotations/signals
    | "external_signal"     // intelligence_radar signal
    | "prediction_ledger"   // open or resolved predictions
    | "deviation_ledger"    // resolved predictions tagged as surprises
    | "other_agent_output"; // another AgentSpec's most recent output
  /** Source-specific selector (entity id, metric name, agent id, etc.). */
  selector?: Record<string, unknown>;
  /** Human description of why this input matters — aids prompt construction. */
  rationale?: string;
}

/**
 * Declared output destination for an agent. Every output must have a home
 * so the feedback loop can close.
 */
export interface AgentOutputSpec {
  kind:
    | "observation"           // free-form insight → app_state.recent_signals
    | "prediction"            // (metric, horizon, value, confidence) → prediction_ledger
    | "validation_result"     // experiment outcome → prediction_ledger (resolved)
    | "recommendation"        // proposed action → app_state.recent_signals as opportunity
    | "deviation_signal"      // surprise flag → deviation_ledger
    | "manifest_patch";       // Partial<AppConfig> via apply_agent_patch
  writes_to:
    | "app_state.recent_signals"
    | "app_state.last_agent_update"
    | "config.manifest"
    | "config.agent_hints"
    | "prediction_ledger"
    | "deviation_ledger";
  /** Optional cadence tag — informs schedule of this agent's output. */
  cadence_hint?: "on_event" | "hourly" | "daily" | "weekly";
}

/**
 * A measurement contract: what this agent tracks, how often, and what it
 * compares its measurement against. Without this, "measurer" agents become
 * vague dashboards with no feedback grounding.
 */
export interface AgentMeasurementSpec {
  /** The metric name this agent is responsible for. */
  metric: string;
  /** How often to refresh the measurement. */
  cadence: "on_event" | "hourly" | "daily" | "weekly";
  /** What the measurement is compared against to produce a signal. */
  compare_against: "baseline" | "prediction" | "target" | "peer_agent";
  /** Optional threshold/rule that triggers a signal emission. */
  signal_rule?: string;
}

/**
 * An agent attached to an InfrastructureProposal (and later, to the App
 * generated from it). One proposal MAY have multiple agents (multi-agent
 * apps); each agent has a distinct role and responsibility.
 */
export interface AgentSpec {
  /** Stable id, referenced by App.config.agents later. e.g. "agent_primary". */
  id: string;
  /** One of the closed role kinds. */
  role: AgentRoleKind;
  /** ONE sentence: what this agent owns. Not a list — a responsibility. */
  responsibility: string;
  /** What this agent reads at invocation time. At least one input required. */
  inputs: AgentInputSpec[];
  /** Where this agent's outputs land. At least one output required. */
  insight_outputs: AgentOutputSpec[];
  /** Required for "measurer" and "predictor" roles; optional otherwise. */
  measurement_spec?: AgentMeasurementSpec;
  /** Other AgentSpec.ids this agent coordinates with (multi-agent apps). */
  collaborates_with?: string[];
  /** Confidence that this agent's role is well-scoped (0-1). */
  scoping_confidence?: number;
}

/**
 * Mechanism hints — signals to the app-manifest-builder about which
 * digital-twin mechanisms this app needs. Drives widget selection
 * (simulation_lab vs. plain dashboard, etc.) once the plugin registry
 * (Item 3) is wired.
 */
export type MechanismHint =
  | "simulation"            // supports what-if runs against twin state
  | "prediction"            // writes to prediction_ledger
  | "validation"            // runs experiments / hypothesis tests
  | "baseline_tracking"     // captures baseline at generation time
  | "deviation_capture"     // flags surprises as high-value data
  | "game"                  // behavioral / engagement mechanics
  | "ml_personalization";   // personalized model consuming ledgers

/**
 * An infrastructure setup proposal — a concrete tool/app/system
 * that should be built to support the strategy execution.
 * Maps from BSC perspectives → executable infrastructure.
 */
export interface InfrastructureProposal {
  id: string; // unique key
  name: string; // e.g., "Customer Feedback Tracker", "Innovation Pipeline Dashboard"
  description: string;
  type: "app" | "tool" | "dashboard" | "workflow" | "integration" | "monitor";
  source_perspective: string; // which BSC perspective this supports
  source_components: string[]; // entity_ids from infrastructure_map this implements
  metrics_tracked: string[]; // what KPIs this tool monitors
  priority: number; // 1 = highest
  complexity: "low" | "medium" | "high";
  status: "proposed" | "approved" | "building" | "active";
  /**
   * Agents that staff this proposal once it becomes an App. Optional for
   * backward compatibility — strategies generated before the agent-spec
   * schema will have this absent, and the app-generator treats absence as
   * "no agents specified, fall back to defaults."
   */
  agent_specs?: AgentSpec[];
  /**
   * Which digital-twin mechanisms this proposal needs. Consumed by the
   * manifest builder to pick appropriate widgets (simulation_lab,
   * prediction_panel, validation_lab, baseline_deviation_tracker, etc.).
   */
  mechanism_hints?: MechanismHint[];
}

/**
 * Strategy status — tracks lifecycle from generation to confirmation
 */
export type StrategyStatus = "generated" | "reviewing" | "confirmed" | "superseded";

/**
 * A change proposal when an existing confirmed strategy needs updating
 */
export interface StrategyChangeProposal {
  change_type: "modify_perspective" | "add_tactic" | "remove_tactic" | "adjust_timeline" | "reprioritize" | "pivot";
  target: string; // what's being changed (perspective name, tactic id, etc.)
  current: string; // current state description
  proposed: string; // proposed change description
  reasoning: string;
  impact: "low" | "medium" | "high";
  urgency: "low" | "medium" | "high";
}

/**
 * A ranked strategy alternative — wraps the full recommendation with ranking metadata
 */
export interface RankedStrategy {
  rank: number; // 1 = top recommendation
  recommendation: StrategicRecommendation;
  ranking_rationale: string; // why this ranks where it does
  infrastructure_proposals: InfrastructureProposal[];
  tradeoff_vs_top: string | null; // null for rank 1, describes what you give up vs #1
}

// ── Phase 9: Strategy Layer Architecture ──
// 4-layer reasoning hierarchy showing HOW the strategy was formed from 3 pillars

export type StrategyPillar = "assets" | "deep_research" | "concept_graph";

export interface PillarContribution {
  pillar: StrategyPillar;
  /** Entity IDs, edge labels, or graph structures that contributed */
  source_refs: string[];
  /** 1-sentence: what this pillar contributed to this element */
  contribution: string;
}

export interface L1Outcome {
  id: string;
  outcome: string;
  sequence_position: number;
  sequence_rationale: string;
  target_metric?: string;
  served_by_l2: string[];
  pillar_sources: PillarContribution[];
}

export interface L2MethodChain {
  id: string;
  title: string;
  causal_chain: Array<{
    step: string;
    entity_refs: string[];
    mechanism: string;
  }>;
  optimality_rationale: string;
  serves_l1: string[];
  justified_by_l3: string[];
  pillar_sources: PillarContribution[];
}

export interface L3ReasoningUnit {
  id: string;
  logic_statement: string;
  reasoning_type: "multiplier" | "threshold" | "feedback_activation" | "risk_negation" | "structural_leverage";
  evidence: string[];
  justifies_l2: string[];
  enhanced_by_l4: string[];
  pillar_sources: PillarContribution[];
}

export interface L4AtomicInsight {
  id: string;
  insight: string;
  scale: "macro" | "micro";
  insight_type: "hidden_variable" | "structural_pattern" | "cross_domain_analog" | "timing_signal" | "compounding_factor" | "blind_spot";
  enhances_l3: string[];
  pillar_sources: PillarContribution[];
  confidence: "high" | "moderate" | "low";
}

export interface StrategyLayers {
  l1_outcomes: L1Outcome[];
  l2_methods: L2MethodChain[];
  l3_reasoning: L3ReasoningUnit[];
  l4_insights: L4AtomicInsight[];
  /** 1-sentence: overall reasoning architecture */
  architecture_summary: string;
}

/**
 * Stored in synthesis_data.strategic_recommendation
 */
export interface StrategicRecommendationData {
  /** Primary (top-ranked) recommendation — backward compatible */
  recommendation: StrategicRecommendation;
  /** All ranked strategies (includes primary as rank 1) */
  ranked_strategies?: RankedStrategy[];
  /** Strategy lifecycle status */
  status: StrategyStatus;
  /** Change proposals (only when status is "confirmed" and re-synthesis produces updates) */
  change_proposals?: StrategyChangeProposal[];
  /** Multi-step reasoning trace (diagnosis → synthesis → verification) */
  reasoning_trace?: import("@/types/strategy-reasoning").StrategyReasoningTrace;
  /** Summary of probability spaces used in strategy generation */
  probability_space_summary?: import("@/types/strategy-reasoning").ProbabilitySpaceSummary;
  /** Full probability spaces — persisted so the /probability page can hydrate without recomputing */
  probability_spaces?: import("@/types/probability-space").ProbabilitySpace[];
  /** Full space intersections */
  space_intersections?: import("@/types/probability-space").SpaceIntersection[];
  /** FK to improvement_goals.id at wrapper level — mirrors recommendation.improvement_goal_id for convenience */
  improvement_goal_id?: string;
  generated_at: string;
  pipeline_version: number;
}
