// ── Environment Definition (the formal MDP for a space) ─────────────────
//
// The EnvironmentDefinition is the canonical, hashable, editable
// description of the Markov Decision Process that the simulator is
// modeling on behalf of the user. It exists to make explicit what is
// today implicit — every Monte Carlo run, strategy proposal, and
// prediction depends on a specific reading of:
//
//   - which variables count as state vs action vs reward
//   - which observable variables proxy which latent ones
//   - what the transition dynamics are (effect sizes + temporal pools)
//   - what counts as success and how much we discount delays
//   - the user's specific starting conditions
//
// Today these live across six tables (entities, edges, improvement_goals,
// subjects.conditions, kg_generation_plans.scope_and_objectives,
// situation_baselines) and the simulator stitches them together at run
// time without ever materializing the unified picture. This makes it
// impossible to:
//
//   - Show the user "what environment is being simulated for me?"
//   - Audit which components the simulator actually uses vs ignores
//   - Detect when the environment has drifted since a prediction was
//     made (the predicted_at value used a different environment)
//   - Pin a strategy to its environment of optimization
//   - Apply standard RL machinery (policy search, value iteration,
//     active learning) which all require a defined MDP
//
// The EnvironmentDefinition is the read-side artifact produced by
// `aggregateEnvironmentDefinition(space_id, subject_id?)`. It's
// pure-derived from existing tables + a small number of override tables
// (see "Schema dependencies" below). It is content-addressed by hash;
// any change to source data produces a new hash, and predictions
// stamp the hash so we can detect drift.
//
// Schema dependencies (must land before aggregator can populate fully):
//
//   1. entities.observability ENUM
//      ('directly_observable' | 'latent' | 'inferable_via_proxy')
//      → drives state_space.observable vs latent split
//
//   2. entities.proxy_for UUID + proxy_quality NUMERIC
//      → drives StateVariable.proxy_for + observation noise model
//
//   3. entities.measurement_value_kind ENUM
//      ('count' | 'rate' | 'concentration' | 'probability' | 'score' |
//       'duration' | 'boolean' | 'categorical')
//      → drives simulator bound enforcement + UI formatting
//
//   4. entities.value_directionality ENUM
//      ('higher_better' | 'lower_better' | 'bidirectional')
//      → drives reward direction without parsing free-text thresholds
//
//   5. edges.causal_status ENUM
//      ('established_causal' | 'plausible_causal' | 'correlational_only')
//      → drives transition trust weight (correlational edges contribute
//        with stiff downweight, surface a UI warning)
//
//   6. improvement_goals.discount_per_week NUMERIC DEFAULT 0.95
//      improvement_goals.weight NUMERIC DEFAULT 1.0
//      → drives DiscountFactor + RewardFunction.goal_weights
//
//   7. environment_overrides table — append-only audit trail of user
//      edits to the LLM-derived environment. See EnvironmentOverride.
//
//   8. condition_modulators table — per-(condition_key, target_edge_id)
//      effect-size multipliers from literature, applied at simulation
//      time when the active subject's conditions match. See section
//      InitialStateDistribution.applied_modulators.
//
// Until those land, the aggregator returns the corresponding fields as
// null OR falls back to sensible defaults (documented per-field below)
// and surfaces the gap in confidence_breakdown so the user can see
// "transition coverage 0.25 — most edges still sparse" without being
// surprised by silent low-fidelity behavior.
//
// Related files:
//   - src/types/kg-generation-plan.ts (where the boundary lives)
//   - src/types/situation.ts (where knowns/unknowns + uncertainty live)
//   - src/types/goals.ts (where rewards live)
//   - src/types/database.types.ts (entities + edges)
//   - src/lib/simulation/monte-carlo.ts (consumer — runs the MDP)
//   - src/lib/strategy/* (consumer — optimizes policy in this MDP)
//
// Build status: SPEC ONLY — implement the aggregator at
// src/lib/environment/aggregate-environment-definition.ts after
// schema deps land. The page at /app/space/[id]/environment renders
// this object directly.

import type { ImprovementGoal } from "./goals";
import type { KgPlanScope } from "./kg-generation-plan";
import type { SituationBaseline } from "./situation";

// ────────────────────────────────────────────────────────────────────────
// Top-level
// ────────────────────────────────────────────────────────────────────────

export interface EnvironmentDefinition {
  /** SHA-256 of the canonical-JSON serialization of this object with
   *  computed_at zeroed and overrides sorted by created_at. Two reads
   *  producing the same hash describe the same MDP. Predictions
   *  stamp this hash so the trajectory chart can show "environment
   *  changed since this prediction — re-run?" when hashes diverge. */
  environment_hash: string;

  space_id: string;
  /** When null, the environment uses a generic "average user" persona
   *  with conditions = {} and baselines drawn from population means. */
  subject_id: string | null;

  /** Time the aggregator ran. Excluded from the hash so we can re-run
   *  the aggregator and get the same hash if no source data changed. */
  computed_at: string;

  // ── The six MDP components ────────────────────────────────────────────
  state_space: StateSpace;
  action_space: ActionSpace;
  transition_dynamics: TransitionDynamics;
  reward_function: RewardFunction;
  discount_factor: DiscountFactor;
  initial_state_distribution: InitialStateDistribution;

  // ── The meta layer ────────────────────────────────────────────────────
  boundary: SystemBoundary;

  /** 0-1 confidence that this environment definition faithfully
   *  describes the user's actual situation. Decomposed in
   *  confidence_breakdown so the user can see what's driving low
   *  confidence (e.g., "transition coverage 0.25 → most edges sparse"). */
  confidence: number;
  confidence_breakdown: ConfidenceBreakdown;

  // ── Audit trail ───────────────────────────────────────────────────────
  /** User-applied overrides on the LLM-derived environment. Each is
   *  an immutable event; the original definition is never destroyed.
   *  Read by aggregator and applied as the last step before hashing. */
  overrides: EnvironmentOverride[];
}

// ────────────────────────────────────────────────────────────────────────
// 1. State space S
// ────────────────────────────────────────────────────────────────────────
//
// Source: entities table for the active space.
// Membership rule: entity is in S if
//   provenance.stop_reason !== "user_controllable"
//   AND it has a layer assignment in the active ontology
//   AND it's not currently classified as an intervention
//
// POMDP-explicit: each state variable carries observability +
// (when latent) a proxy reference. The simulator can choose to
// apply observation-noise models when the user logs measurements
// against a proxy variable.

export interface StateSpace {
  variables: StateVariable[];

  /** Counts derived from `variables` — denormalized here so the page
   *  doesn't have to recompute on every render. */
  observable_count: number;
  latent_count: number;
  proxy_count: number;

  /** Layer-stratified counts: e.g. {Behaviors: 8, Biomarkers: 5, ...}.
   *  Drives the layered grid rendering. */
  per_layer_counts: Record<string, number>;
}

export interface StateVariable {
  entity_id: string;
  name: string;

  /** Layer slug from the active ontology (e.g. "biomarkers",
   *  "pathways", "cognitive"). Aligns with layers defined in
   *  kg_generation_plans.layer_ontology_proposal. */
  layer_slug: string;

  /** Where in the POMDP this variable sits. Schema dep #1. Until
   *  the column exists, aggregator falls back to:
   *    - observable=true → "directly_observable"
   *    - observable=false → "latent"
   *    - default → "directly_observable" */
  observability: "directly_observable" | "latent" | "inferable_via_proxy";

  /** When observability = "inferable_via_proxy", which entity is the
   *  upstream gold-standard. Schema dep #2. Null otherwise. */
  proxy_for: string | null;

  /** 0-1 quality score from surrogate-model fit (when ML calibration
   *  exists) OR literature confidence. Null when not yet calibrated. */
  proxy_quality: number | null;

  /** What kind of number this variable carries. Schema dep #3. Null
   *  when not yet classified — simulator falls back to continuous
   *  unbounded with stiff "review needed" warning. */
  measurement_value_kind: MeasurementValueKind | null;

  /** Lower / upper bounds enforced by the simulator. Computed from
   *  measurement_value_kind defaults (probability ∈ [0,1], etc.) OR
   *  from explicit entities.hard_bounds JSONB when set. */
  bounds: { lower: number | null; upper: number | null };

  /** Healthy / normal range — distinct from hard bounds. UI uses
   *  this for color thresholds. From entities.healthy_range JSONB. */
  healthy_range: { min: number; max: number; unit: string } | null;

  /** Direction of "improvement". Schema dep #4. */
  value_directionality:
    | "higher_better"
    | "lower_better"
    | "bidirectional"
    | null;

  /** Current measured value if any observation exists. Null when
   *  the user hasn't logged or imported a measurement yet. */
  current_value: number | null;
  current_value_recorded_at: string | null;

  /** Evidence trail — why this variable is in S and not A or R.
   *  Drives the per-row drawer in the UI. */
  rationale: VariableRationale;
}

export type MeasurementValueKind =
  | "count"
  | "rate"
  | "concentration"
  | "probability"
  | "score"
  | "duration"
  | "boolean"
  | "categorical";

export interface VariableRationale {
  /** Whether the LLM, the template seed, or the user placed this
   *  entity in this bucket. */
  source: "prompt_extraction" | "template_seed" | "research" | "user_override";

  /** Verbatim quote from the prompt or asset that drove placement,
   *  when source = "prompt_extraction". */
  source_quote: string | null;

  /** Evidence IDs (rows in evidence_registries) supporting this
   *  classification, when source = "research". */
  evidence_ids: string[];

  /** Free-text explanation: "Working memory is in S because it's a
   *  Cognitive-layer outcome, observable via N-back, and not directly
   *  controllable." */
  explanation: string;
}

// ────────────────────────────────────────────────────────────────────────
// 2. Action space A
// ────────────────────────────────────────────────────────────────────────
//
// Source:
//   entities WHERE provenance.stop_reason = "user_controllable"
//   ∪ interventions table
//
// Each action carries a parameter shape (continuous dose, categorical
// choice, binary on/off) plus a published-research dose range. The
// policy-search subsystem treats the action space as the search domain.

export interface ActionSpace {
  actions: ActionVariable[];
  /** Total dimension of the action space — sum of degrees of freedom
   *  per action (continuous = 1, categorical = n_choices). Drives the
   *  cost estimate for downstream policy search (CMA-ES converges
   *  faster with smaller action spaces). */
  total_dimension: number;
}

export interface ActionVariable {
  entity_id: string;
  /** When the action also has a row in the interventions table. */
  intervention_id: string | null;
  name: string;

  /** What kind of lever this is. */
  parameter_shape: ActionParameterShape;

  /** Cost/effort indicators — from interventions.effort,
   *  interventions.timeframe etc. Used by policy search to favor
   *  cheap interventions when multiple plans tie on outcome. */
  effort: "low" | "medium" | "high" | null;
  timeframe: "now" | "short_term" | "medium_term" | "long_term" | null;

  /** Whether the user is currently doing this — drives UI rendering
   *  ("currently running" vs "candidate"). Computed from recent
   *  metric_observations against the action variable. */
  currently_active: boolean;
  current_dose: number | null;

  /** Evidence trail — why this is an action and not state. */
  rationale: VariableRationale;
}

export type ActionParameterShape =
  | { kind: "continuous"; min: number; max: number; default: number; unit: string | null }
  | { kind: "categorical"; choices: Array<{ value: string; label: string }> }
  | { kind: "binary"; default: boolean }
  | { kind: "schedule"; min_per_week: number; max_per_week: number };

// ────────────────────────────────────────────────────────────────────────
// 3. Transition dynamics T(s'|s,a)
// ────────────────────────────────────────────────────────────────────────
//
// Source: edges table — the full causal graph including effect sizes,
// polarity, temporal pool, and (when schema dep #5 lands) causal
// status. Aggregated counts give the user a quick read on coverage
// and quality without listing every edge.
//
// The full edge list is paginated in the page UI; this section only
// surfaces summary stats + a few sample edges per category. Click an
// edge → drawer with the per-edge evidence trail (evidence_registries
// rows that pooled into the strength + temporal estimates).

export interface TransitionDynamics {
  edge_count: number;

  /** Counts by edges.status — "sparse" means seed-defaulted with no
   *  research backing yet; "mixed" means some evidence; "confirmed"
   *  means well-pooled. */
  by_status: { sparse: number; mixed: number; confirmed: number };

  /** Counts by edges.causal_status. Schema dep #5. Until landed,
   *  every edge falls into "established_causal" (the simulator's
   *  current implicit assumption — which is the bug). */
  by_causal_status: {
    established_causal: number;
    plausible_causal: number;
    correlational_only: number;
  };

  /** Average edge confidence across the graph. Drives the
   *  transition_coverage component of confidence_breakdown. */
  avg_confidence: number;

  /** % of edges with non-null pooled temporal data
   *  (onset_days_p50 IS NOT NULL). Below 0.3 indicates the engine
   *  is using generic 10-step horizons for most edges. */
  temporal_coverage: number;

  /** Aggregate heterogeneity across edges with multiple evidence
   *  rows (mean of edges.temporal_heterogeneity_i2). High values
   *  (> 0.7) indicate research disagreement — UI should warn. */
  avg_heterogeneity_i2: number | null;

  /** Top-N most-uncertain edges — where research would help most.
   *  Drives the "research these next" affordance on the page. */
  top_uncertain_edges: TransitionEdgeSummary[];

  /** Top-N most-leveraged edges — high effect size × high in-degree
   *  to nodes with high reward weight. Drives the "these are the
   *  ones that matter most" callout. */
  top_leverage_edges: TransitionEdgeSummary[];
}

export interface TransitionEdgeSummary {
  edge_id: string;
  source_entity_id: string;
  source_name: string;
  target_entity_id: string;
  target_name: string;
  strength: number;
  standard_error: number;
  polarity: "positive" | "negative" | "conditional" | "neutral";
  causal_status:
    | "established_causal"
    | "plausible_causal"
    | "correlational_only"
    | null;
  temporal: {
    onset_days_p50: number | null;
    peak_days_p50: number | null;
    persistence_days_p50: number | null;
    decay_kinetics_modal: string | null;
  };
  evidence_count: number;
}

// ────────────────────────────────────────────────────────────────────────
// 4. Reward function R(s, a, s')
// ────────────────────────────────────────────────────────────────────────
//
// Source: improvement_goals table.
//
// Definition:
//   R(s, a, s') = Σ_g w_g × normalized_progress(s'_target_g, baseline_g, target_g)
//
// where normalized_progress is in [0, 1] (fraction of gap closed)
// and w_g is the goal weight (uniform when not set).
//
// Sub-objectives become additional terms with smaller weights.
// Costs (time, money, side-effects) become negative-weighted terms
// when present.

export interface RewardFunction {
  /** The primary improvement_goal for this space. The "what we're
   *  actually optimizing for." */
  primary_goal: GoalTerm;

  /** Sub-objectives (improvement_goals.parent_goal_id = primary). */
  sub_goals: GoalTerm[];

  /** Cost terms (negative weight) — interventions or states the user
   *  wants to MINIMIZE. From improvement_goals where
   *  objective_type = "cost" (when supported). */
  cost_terms: GoalTerm[];

  /** Whether weights sum to 1.0 (normalized) — UI flag for "your
   *  reward function isn't normalized" warning. */
  weights_normalized: boolean;
}

export interface GoalTerm {
  goal_id: string;
  metric_name: string;
  metric_unit: string | null;
  baseline_value: number;
  target_value: number;
  current_value: number;

  /** Direction of improvement. Should match
   *  state_space.variables[target_entity].value_directionality. */
  direction: "higher_better" | "lower_better";

  /** Weight in the reward function. Schema dep #6. Defaults to 1.0
   *  when not set; UI surfaces "weights are uniform — refine?" */
  weight: number;

  /** When deadline is set, used by policy search to penalize plans
   *  that don't reach target by the deadline. Null = open-ended. */
  deadline: string | null;

  /** Per-goal evidence trail. */
  rationale: VariableRationale;
}

// ────────────────────────────────────────────────────────────────────────
// 5. Discount factor γ
// ────────────────────────────────────────────────────────────────────────
//
// Source: improvement_goals.discount_per_week (schema dep #6).
// When unset, defaults to 0.95 per week (~50% horizon at 14 weeks).
//
// Single value per environment (not per-goal) — multi-goal envs use
// the primary goal's γ. This is a simplification; future work could
// support per-goal γ if users have very different time-preferences
// across sub-goals.

export interface DiscountFactor {
  /** γ per week. Range [0.7, 1.0] enforced. Default 0.95. */
  per_week: number;

  /** Effective horizon: weeks until reward weight drops to 0.5.
   *  Computed as log(0.5) / log(per_week). UI shows this directly
   *  ("you'll value gains in the first ~14 weeks") since it's more
   *  intuitive than the raw γ. */
  effective_half_life_weeks: number;

  /** Whether the user explicitly set this or it's at default. UI
   *  shows "(default)" badge when unset. */
  is_user_set: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// 6. Initial state distribution P(s₀)
// ────────────────────────────────────────────────────────────────────────
//
// Source: subjects.conditions JSONB (the qualitative/quantitative
// per-persona context) + recent metric_observations (the measured
// baselines).
//
// This is also where condition_modulators light up: when a subject
// has condition X and the modulator library has a multiplier for
// (X, edge_e), the simulator applies it. The page shows "of your
// 5 conditions, 3 have published modulators applied, 2 don't"
// so the user knows which parts of their persona are calibrated.

export interface InitialStateDistribution {
  subject_id: string | null;
  subject_name: string;

  /** Persona conditions (e.g., {sleep_h: 0, stress_0_10: 7,
   *  caffeine_mg: 200}). From subjects.conditions JSONB. */
  conditions: Array<{
    key: string;
    value: string | number | boolean;
    unit: string | null;
    rationale: VariableRationale;
  }>;

  /** Per-condition modulators applied at simulation time. Schema
   *  dep #8. Empty array until condition_modulators table lands. */
  applied_modulators: ConditionModulatorBinding[];

  /** Conditions that have NO matching modulator — these are the
   *  ones whose effect on simulation is unknown. UI surfaces these
   *  as "uncalibrated — predictions for X may overestimate effect
   *  by ~30%." */
  uncalibrated_conditions: string[];

  /** Measured baselines from metric_observations. */
  baselines: Array<{
    entity_id: string;
    entity_name: string;
    value: number;
    unit: string | null;
    recorded_at: string;
    /** True when the value was inferred (e.g., from a proxy + the
     *  surrogate model) rather than directly measured. */
    is_inferred: boolean;
  }>;
}

export interface ConditionModulatorBinding {
  condition_key: string;
  target_edge_id: string;
  target_edge_label: string; // human-readable "Aerobic Exercise → BDNF"
  multiplier_p50: number;
  multiplier_p10: number;
  multiplier_p90: number;
  source_evidence_ids: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Boundary
// ────────────────────────────────────────────────────────────────────────
//
// Source: kg_generation_plans.scope_and_objectives.

export interface SystemBoundary {
  /** Verbatim from kg_generation_plans.scope_and_objectives.goal_verbatim. */
  goal_verbatim: string;

  /** Parsed primary objective. */
  primary_objective: string;

  /** Domain label + classification confidence. */
  domain_label: string;
  domain_confidence: number;

  /** Decision horizon in weeks. Derived from
   *  scope_and_objectives.decision_horizon free text. */
  decision_horizon_weeks: number | null;

  /** Explicit out-of-scope items from the plan. These define what
   *  the environment EXCLUDES — important for the user to verify. */
  out_of_scope: string[];

  /** Success criteria from the plan. Tied to RewardFunction.
   *  primary_goal but kept separately because criteria can be
   *  qualitative ("decisive enough to commit") while goals are
   *  quantitative. */
  success_criteria: string[];

  /** Pointer to the SituationBaseline this boundary inherits from.
   *  When the situation_baseline updates, the environment_hash
   *  changes — drives the "environment drift" detector. */
  situation_baseline_snapshot: SituationBaseline | null;

  /** Pointer to the KgPlanScope. Same drift semantics. */
  scope_snapshot: KgPlanScope | null;
}

// ────────────────────────────────────────────────────────────────────────
// Confidence
// ────────────────────────────────────────────────────────────────────────
//
// Top-level `confidence` is a weighted average of the components
// below, with weights chosen so that the most impactful gaps drive
// the score most. The breakdown is exposed so the user can see
// exactly what's driving low confidence and what to address.
//
// Defaults / weights:
//   boundary_confidence       — weight 0.10
//   state_coverage            — weight 0.20
//   action_calibration        — weight 0.15
//   transition_coverage       — weight 0.30  ← biggest lever
//   reward_clarity            — weight 0.10
//   initial_state_calibration — weight 0.15

export interface ConfidenceBreakdown {
  /** From kg_generation_plans.scope_and_objectives.goal_parsed
   *  .domain_classification.confidence. */
  boundary_confidence: number;

  /** Ratio of state variables that are explicit-from-prompt or
   *  explicit-from-asset vs inferred-from-template. Higher = better
   *  grounded in the user's actual situation. */
  state_coverage: number;

  /** Ratio of actions that have measured current_dose vs candidates
   *  with no usage data. Higher = simulator knows the user's
   *  starting point. */
  action_calibration: number;

  /** Ratio of edges with status='confirmed' or causal_status=
   *  'established_causal'. The simulator treats correlational
   *  edges with stiff downweight, but coverage of well-evidenced
   *  causal edges remains the dominant driver of prediction
   *  trustworthiness. */
  transition_coverage: number;

  /** Ratio of goals with explicit baseline + target vs goals with
   *  one or both missing. */
  reward_clarity: number;

  /** Ratio of subject conditions with applied modulators vs total
   *  conditions. When 0/5 conditions are calibrated, predictions
   *  use uncalibrated population averages — UI must warn. */
  initial_state_calibration: number;

  /** Weighted average producing top-level confidence. Stored
   *  explicitly so we can re-display the math without recomputing. */
  weighted_score: number;

  /** Human-readable callouts produced by the aggregator —
   *  "transition_coverage 0.25 — most edges still sparse. Run
   *  research on top_uncertain_edges to raise this." Shown directly
   *  in the page header so the user has a clear next action. */
  callouts: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Overrides
// ────────────────────────────────────────────────────────────────────────
//
// Schema dep #7. Append-only. Aggregator reads all overrides for the
// space, applies them in created_at order to the LLM-derived
// environment, and includes them in the hash. The original LLM-
// derived definition is never destroyed, so the audit can always
// show "the system inferred X from your prompt; you overrode it on
// date Y to be Z."
//
// Override application is type-specific — see EnvironmentOverrideKind.
// Each kind has its own apply() helper in the aggregator.

export interface EnvironmentOverride {
  id: string;
  space_id: string;
  user_id: string;

  kind: EnvironmentOverrideKind;
  target_id: string; // entity_id or edge_id or goal_id

  /** Type-discriminated payload. JSONB at storage. */
  payload: EnvironmentOverridePayload;

  /** User's free-text reasoning. Required for any override that
   *  affects predictions, so the audit trail isn't just "user
   *  changed X." */
  reasoning: string;

  /** Pre-commit estimate of the override's impact on key
   *  predictions, stored at commit time. Lets us detect later
   *  "this override changed your working_memory prediction by 23%
   *  on March 4 — is that what you intended?" */
  pre_commit_impact_estimate: {
    prediction_id: string;
    delta_p50: number;
    delta_p90_minus_p10: number;
  }[];

  created_at: string;
}

export type EnvironmentOverrideKind =
  /** Move an entity between buckets (S ↔ A ↔ excluded). */
  | "reclassify_variable"
  /** Override an edge's strength or temporal estimate based on
   *  user's own response (e.g., "for me, exercise → BDNF takes 3
   *  weeks not 8"). Persisted as entity_param_override row. */
  | "override_edge_parameters"
  /** Adjust a goal's weight, target, deadline, or discount. */
  | "adjust_goal"
  /** Set or correct a subject condition. */
  | "set_condition"
  /** Mark a baseline measurement as needed → spawns metric tracker. */
  | "request_baseline_measurement"
  /** Add/remove an entity from action_space candidates. */
  | "toggle_action_candidate";

export type EnvironmentOverridePayload =
  | { kind: "reclassify_variable"; from_bucket: VariableBucket; to_bucket: VariableBucket }
  | { kind: "override_edge_parameters"; field: string; value: number | string }
  | { kind: "adjust_goal"; field: "weight" | "target_value" | "deadline" | "discount_per_week"; value: number | string }
  | { kind: "set_condition"; condition_key: string; value: string | number | boolean }
  | { kind: "request_baseline_measurement"; entity_id: string; cadence: string }
  | { kind: "toggle_action_candidate"; intent: "add" | "remove" };

export type VariableBucket = "state" | "action" | "reward" | "excluded";

// ────────────────────────────────────────────────────────────────────────
// Aggregator function signature
// ────────────────────────────────────────────────────────────────────────
//
// Implementation lives at:
//   src/lib/environment/aggregate-environment-definition.ts
//
// The aggregator is a pure read — joins existing tables, applies
// overrides, computes hash, returns. No mutations. The page calls
// it on mount + on any data-change SSE event. The simulator calls
// it before each Monte Carlo run + stamps prediction_ledger with
// the resulting environment_hash.
//
// Performance target: <300ms p95 for spaces with up to 200
// entities + 500 edges. Beyond that, the page should show a
// loading state and the aggregator should stream sections rather
// than block on the full result.

export interface AggregatorInput {
  space_id: string;
  /** When omitted, uses the space's default subject. When the space
   *  has no subject, returns an environment with subject_id=null
   *  and conditions={} (the "average user" baseline). */
  subject_id?: string | null;
  /** When set, the aggregator skips override application — useful
   *  for showing "what did the LLM originally infer?" alongside
   *  the user-overridden version. */
  ignore_overrides?: boolean;
}

export type AggregatorResult =
  | { ok: true; environment: EnvironmentDefinition }
  | { ok: false; reason: AggregatorFailureReason; partial: Partial<EnvironmentDefinition> | null };

export type AggregatorFailureReason =
  | "space_not_found"
  | "no_kg_generation_plan"
  | "no_entities"
  | "subject_not_in_space"
  | "internal_error";

// ────────────────────────────────────────────────────────────────────────
// Hash spec
// ────────────────────────────────────────────────────────────────────────
//
// The environment_hash is a SHA-256 of the canonical-JSON
// serialization of the EnvironmentDefinition with these fields
// excluded (to keep the hash stable across no-op re-reads):
//
//   - environment_hash (self)
//   - computed_at (timestamp)
//   - confidence_breakdown.callouts (free-text, may rephrase)
//
// And these fields normalized before hashing:
//
//   - overrides[]: sorted by created_at ASC
//   - state_space.variables[]: sorted by entity_id
//   - action_space.actions[]: sorted by entity_id
//   - transition_dynamics.top_uncertain_edges[]: sorted by edge_id
//   - reward_function.sub_goals[]: sorted by goal_id
//   - initial_state_distribution.conditions[]: sorted by key
//
// Implementation: src/lib/environment/hash-environment.ts.
//
// Drift detection: prediction_ledger.environment_definition_hash
// records the hash at prediction time. The trajectory chart
// compares against the current aggregator output and shows a
// "environment changed since this prediction — re-run?" badge
// when they differ. The diff drawer shows which components
// changed (state added X, edge Y strength changed by 0.1, etc.).

/** Excluded from hash (timestamps, derived text). */
export const HASH_EXCLUDED_PATHS = [
  "environment_hash",
  "computed_at",
  "confidence_breakdown.callouts",
] as const;
