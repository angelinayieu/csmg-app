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
    /**
     * Experimental-design role of this metric. Drives variable_proposals
     * classification on strategy approval (replaces the heuristic
     * classifier in extract-variable-proposals.ts when populated).
     * Default: "dependent" (most key_metrics are what you measure).
     */
    variable_role?:
      | "independent"
      | "dependent"
      | "controlled"
      | "confounding"
      | "outcome"
      | "mediator"
      | "modifier"
      | "instrument"
      | "condition";
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

  // ── Comprehensive provenance (Phase 4 of strategy rework) ──
  // Upstream reasoning backlinks — enables UI to show "this perspective respects
  // axiom A2 and addresses strong convergence conv:1". Empty arrays are valid;
  // fabricated IDs are rejected by the validator.
  axiom_ids_respected?: string[];
  convergence_ids_addressed?: string[];
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
    /**
     * Experimental-design role of this metric. For micro_tactics whose
     * infrastructure_action is "build" or "configure", the LLM should
     * mark this "independent" (the manipulable variable). For "monitor"
     * tactics it's typically "dependent". Drives variable_proposals
     * classification on strategy approval.
     */
    variable_role?:
      | "independent"
      | "dependent"
      | "controlled"
      | "confounding"
      | "outcome"
      | "mediator"
      | "modifier"
      | "instrument"
      | "condition";
  };
  dependencies: string[]; // entity IDs that must be addressed first
  timeframe: "now" | "short_term" | "medium_term" | "long_term";
  // Enhancement 4: Implementation intention (Gollwitzer if-then format, ~2x follow-through)
  implementation_intention?: {
    trigger: string; // "When/If [specific situational cue]..."
    action: string;  // "...then I will [specific goal-directed behavior]"
    category: "proactive" | "reactive" | "course_correction";
  };

  // ── Comprehensive provenance (Phase 4 of strategy rework) ──
  // Every tactic carries backlinks to the upstream reasoning it serves. These
  // fields are populated by the strategy LLM when comprehensive mode is on
  // (mandated by the system prompt) and validated against the upstream axiom /
  // convergence / gap / inversion lists before being persisted.
  /** Axiom IDs (A1, A2, ...) this tactic honors — must not violate these */
  axiom_ids_respected?: string[];
  /** Axiom IDs this tactic deliberately tests or challenges */
  axiom_ids_challenged?: string[];
  /** Insight convergence cluster IDs (conv:1, ...) this tactic addresses */
  convergence_ids_addressed?: string[];
  /** Coverage gap IDs from strategy_coverage.gaps this tactic closes */
  coverage_gap_ids_closed?: string[];
  /** Assumption-inversion indices (inv0, inv1, ...) this tactic tests */
  inversion_ids_tested?: string[];
  /** Short slugs of hidden_signals this tactic addresses */
  hidden_signal_refs?: string[];
  /** Subsystem IDs this tactic activates / influences. Drawn from
   *  synthesis_data.subsystems. When subsystems are present, every tactic
   *  must target at least one. Empty when subsystems are unavailable. */
  subsystem_ids_targeted?: string[];
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
    /**
     * Experimental-design role. Leading indicators are typically
     * "dependent" (what you measure to predict the lagging outcome),
     * but the LLM may classify a particular indicator as "independent"
     * when it represents a manipulable input the strategy is gating
     * the lagging outcome on.
     */
    variable_role?:
      | "independent"
      | "dependent"
      | "controlled"
      | "confounding"
      | "outcome"
      | "mediator"
      | "modifier"
      | "instrument"
      | "condition";
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
  /**
   * Phase 1 Step 11 — the plain-language action the user should take.
   * One short sentence, present-tense, imperative. No jargon, no entity
   * codes, no rigor machinery. This is what renders as the strategy
   * card's top line; the rigorous reasoning lives in `reasoning_chain`
   * behind an expand affordance.
   *
   * Example: "Ship a single retention intervention before adding
   * acquisition spend."
   */
  headline?: string;
  /**
   * Phase 1 Step 11 — the rigorous expansion. 2-4 sentences that
   * reference specific entity codes, edge dynamics, evidence confidence,
   * and any simulation outputs. Tucked into an expandable section so
   * the strategy card stays scannable for users who want the action
   * first and the reasoning on demand.
   *
   * Example: "Tighten the C3 (Customer Churn) → C7 (MRR) loop — the
   * edge is causal, negative-polarity, compounding dynamics at 0.82
   * confidence, and C3 is flagged as the master bottleneck. Evidence
   * from user interviews (empirical, 0.9 conf) indicates the pricing
   * change on 2026-03-01 triggered the spike. Reversibility=costly,
   * so a targeted intervention is lower-risk than new acquisition."
   */
  reasoning_chain?: string;
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

  /**
   * E3 — layer-stratified variant marker. Patched onto the recommendation by
   * `strategy-engine` (see `GenerateStrategyParams.layerFocus`) when this is a
   * single-layer variant; `null` for the comprehensive variant. Downstream
   * consumers — the strategy-hero chip, the variants column, and the
   * twin-proposal GET flattener — read `layer_id`/`label`/`color` to render the
   * focus chip. `cascade` is the cross-layer cascade-prediction enrichment
   * (soft-fail; absent when that hop is skipped or degraded).
   */
  layer_focus?: {
    layer_id: string;
    label: string;
    color: string;
    rationale: string;
    cascade?: unknown;
  } | null;

  /**
   * Names of pipeline steps that hit a fallback path during generation
   * (`"diagnosis" | "synthesis" | "verification" | "final"`). Empty/unset
   * when the run was clean. The UI uses this to surface a degraded-run
   * banner so users can tell a successful strategy apart from one whose
   * confidence number was synthesized from a failed step.
   */
  degraded_steps?: string[];

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

  // ── Comprehensive provenance aggregate (Phase 4 of strategy rework) ──
  // Computed at strategy-engine time from the union of per-tactic + per-perspective
  // provenance fields. Lets UI render a "provenance health" badge without walking
  // every tactic, and lets downstream (generate-apps) inherit the backlinks.
  provenance?: {
    /** Union of axiom_ids_respected across all tactics + perspectives */
    axioms_respected: string[];
    /** Union of axiom_ids_challenged across all tactics */
    axioms_challenged: string[];
    /** Union of convergence_ids_addressed across all tactics + perspectives */
    convergences_addressed: string[];
    /** Union of coverage_gap_ids_closed across all tactics */
    coverage_gaps_closed: string[];
    /** Union of inversion_ids_tested across all tactics */
    inversions_considered: string[];
    /** Union of hidden_signal_refs across all tactics */
    hidden_signals_addressed: string[];
    /** Coverage % at the time this strategy was generated (snapshot) */
    coverage_pct_at_generation?: number;
    /** Critical axioms that exist in upstream but are NOT in axioms_respected — a red flag */
    critical_axioms_missed: string[];
    /** Hidden axioms not acknowledged anywhere in the strategy */
    hidden_axioms_missed: string[];
    /** Strong convergences (≥ 4 signal types) NOT reflected in the strategy */
    strong_convergences_missed: string[];
    /**
     * Overall provenance score 0-100 combining:
     *  - 50%: critical axioms respected vs. total critical axioms
     *  - 30%: strong convergences addressed vs. total strong convergences
     *  - 20%: coverage gaps closed vs. total coverage gaps
     */
    overall_provenance_score: number;
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
 * Mechanism hints — **widget-routing tags**, NOT executable mechanisms.
 *
 * Each hint selects a category of widget to inject onto the linked
 * app's manifest via the `HINT_TO_CAPABILITY` map in
 * `src/lib/pipeline/app-manifest-builder.ts`. The row materialized
 * into `public.mechanisms` from these hints is a declarative record —
 * it does NOT itself run anything.
 *
 * Where the actual work happens:
 *   simulation         → src/lib/simulation/monte-carlo.ts (seeded MC)
 *   prediction         → writes to prediction_ledger; resolved later
 *                        by src/lib/twin/resolve-predictions.ts
 *   validation         → src/lib/pipeline/reality-calibration.ts +
 *                        numerical-calibration.ts (Tier 3/4 audit)
 *   baseline_tracking  → metric_trackers + metric_observations tables
 *   deviation_capture  → prediction_ledger.deviation_tag + UI feed
 *   game               → no runtime yet
 *   ml_personalization → no runtime yet
 *
 * If code or UI seems to claim a mechanism row "runs" anything, follow
 * the path above to the module that actually does the work. Calling
 * these "mechanisms" is historical; "widget_hints" would be more
 * precise. See docs/COMPUTATIONAL_SUBSTANCE_ROADMAP.md §R4 and
 * migration 20260601_mechanisms_honest_comments.sql.
 */
export type MechanismHint =
  | "simulation"            // surfaces a simulation-lab widget
  | "prediction"            // surfaces a prediction-panel widget
  | "validation"            // surfaces a validation-lab widget
  | "baseline_tracking"     // surfaces a baseline-tracker widget
  | "deviation_capture"     // surfaces a deviation-feed widget
  | "game"                  // surfaces a game-mechanics widget
  | "ml_personalization";   // surfaces a personalization widget

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
  /**
   * Sprint W5.5 — per-app IV/DV/control/mediator/moderator contract the
   * LLM proposes alongside this app. Each entry maps to one
   * variable_proposals row (source_field='infrastructure_proposal.
   * app_variable'). Reviewed in the same surface as perspective and
   * learning_loop variable proposals, then materialized into the
   * partition that derive-app-variables consumes.
   *
   * Optional + backward-compatible: strategies generated before W5.5
   * have this absent; the app-generator treats absence as "fall back
   * to perspective + learning-loop derivation only."
   */
  app_variables?: AppVariableProposal[];
}

/**
 * Sprint W5.5 — variable contract entry on an InfrastructureProposal.
 * The LLM produces these per-app; the extractor maps them into
 * variable_proposals rows for the user to review/approve.
 */
export interface AppVariableProposal {
  /** Plain-language name. Same shape as VariableMetricDefinition.name. */
  name: string;
  /** Optional 1-sentence description of what this variable represents. */
  description?: string;
  /** Role assignment from the LLM. Same VariableRole enum the partition uses. */
  role:
    | "independent"
    | "dependent"
    | "controlled"
    | "confounding"
    | "outcome"
    | "mediator"
    | "modifier"
    | "instrument"
    | "condition"
    | "unclassified";
  /** Optional measurable definition — unit, cadence, threshold bands, etc. */
  metric_definition?: {
    name: string;
    current?: string | null;
    target?: string | null;
    unit?: string | null;
    measurement_method?: string | null;
    cadence?: "daily" | "weekly" | "biweekly" | "monthly" | string | null;
    threshold_green?: string | null;
    threshold_yellow?: string | null;
    threshold_red?: string | null;
  };
  /** Why this variable belongs in this app's contract. */
  justification?: string;
  /** 0..1 — LLM confidence in the role/relevance pairing. */
  confidence?: number;
  /** Entity codes (e.g. "C3") this variable depends on or is measured against. */
  depends_on_entity_ids?: string[];
}

// ── Mechanisms (first-class, PR1) ──────────────────────────────────────
//
// Mirrors the `mechanisms` table created in 20260509_mechanisms.sql.
// A mechanism is a cyclical sub-process attached to a twin (= space). Apps
// reference a mechanism via apps.parent_mechanism_id. The MechanismHint enum
// above remains the closed kind taxonomy; the table keeps it as `kind text`.

export type MechanismStatus = "proposed" | "approved" | "active" | "paused" | "retired";

export interface MechanismRow {
  id: string;
  space_id: string;
  user_id: string;
  name: string;
  description: string | null;
  kind: MechanismHint;
  /** Free-text slug describing the loop, e.g. "experiment_score_reprompt". */
  cycle_pattern: string | null;
  /** Why this mechanism is the right fit — surfaced in the twin proposal review. */
  rationale: string | null;
  source_infrastructure_proposal_id: string | null;
  source_strategy_version: number | null;
  /** Denormalized AgentSpec[] copied from the originating InfrastructureProposal. */
  agent_assignments: AgentSpec[];
  status: MechanismStatus;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ── TwinProposalJustification (structured rationale, PR1 type-only) ─────
//
// Generated alongside a twin proposal so the user can see *why* this workflow
// is the most optimal for their objective. Type lives here now; persistence
// (column on spaces / new twin_proposals table) lands in PR3.

export interface TwinTradeoff {
  /** What the tradeoff is, e.g. "speed vs. coverage". */
  tradeoff: string;
  /** Which side this twin chose, e.g. "speed". */
  chosen_side: string;
  /** One sentence: why we chose that side for this objective. */
  why: string;
}

export interface TwinAlternativeRejected {
  /** Short name of the alternative workflow we considered, e.g. "broad_research_then_synthesize". */
  name: string;
  /** One paragraph: what this alternative would have done. */
  description: string;
  /** Why we rejected it for this user / objective. */
  why_rejected: string;
}

/**
 * Snapshot of the reality-calibration state at the moment a proposal was
 * wired. Stamped into the twin_proposal justification so the review panel
 * can render the gate banner (and the approve route can re-check it)
 * without a cross-table join on every read.
 *
 * The LIVE status is still the authoritative source — this snapshot is a
 * cache for display. The approve route re-queries `reality_calibrations`
 * to avoid honoring a stale pass when the user reran capture and failed.
 */
export interface CalibrationGateSnapshot {
  /** Mirrors RealityCalibration["status"]. */
  status: "unknown" | "uncalibrated" | "partial" | "calibrated" | "bypassed";
  reproduced_count: number;
  total_count: number;
  /** 0..1 — unverifiable attempts count as 0.5. */
  aggregate_score: number;
  /** Which strategy_baseline the calibration was computed against. */
  strategy_baseline_id: string | null;
  /** When this snapshot was captured (ISO). */
  checked_at: string;
  /** Set when the user explicitly chose to run without calibration. */
  bypassed_at: string | null;
}

export interface TwinProposalJustification {
  /** One paragraph: the chosen approach in plain terms. */
  chosen_approach: string;
  /** Tradeoffs the user should know we made. Order: most important first. */
  key_tradeoffs: TwinTradeoff[];
  /** Other workflows we considered and why we passed. 2-3 entries ideal. */
  alternatives_rejected: TwinAlternativeRejected[];
  /** Confidence in this twin being optimal for the stated objective (0-100). */
  confidence: number;
  /** Mechanisms this twin commits to building. References MechanismRow.id once persisted. */
  mechanism_ids?: string[];
  /** When this proposal was generated (ISO timestamp). */
  generated_at: string;
  /**
   * Reality-calibration snapshot captured at wire-time. Optional because
   * legacy proposals (pre-Gap-B) won't have one — the review panel treats
   * `undefined` as "unknown; no baselines to reproduce" rather than a
   * blocking gate. See CalibrationGateSnapshot.
   */
  calibration_gate?: CalibrationGateSnapshot;
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
  /** Optional stable ID reference for precise apply/match semantics. When the
   *  LLM emits this, the apply handler uses it; otherwise falls back to
   *  fuzzy-matching `target` against the recommendation's tactic/perspective
   *  names. Added in Arc 3 so the change-proposals UI can round-trip safely. */
  target_id?: string;
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
