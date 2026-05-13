// ── Preflight view — A1 type definition ──────────────────────────────
//
// The full data shape that backs the Preflight page at
// `/app/space/[id]/preflight`. This is the SCIENTIST'S CONTRACT before
// the downstream pipeline fires: a single object that captures
//   - what we understood from intake
//   - which variables we'll model and in what roles
//   - how they'll connect (causal map preview)
//   - what success looks like (goals + γ)
//   - where the user starts from (initial state)
//   - what gets generated, what could, what won't
// with per-section confidence and evidentiary trails for every claim.
//
// Relationship to EnvironmentDefinition:
//   EnvironmentDefinition uses RL/MDP vocabulary (S/A/T/R/γ/P(s₀)) and
//   is the audit/deep-dive surface. PreflightView uses experimental-
//   design vocabulary (IV/DV/Controls/Confounders/Mediators/Moderators)
//   and is the steering surface — the user negotiates the pipeline
//   contract before generation. Both types read the same underlying
//   tables; both edits land in `environment_overrides`. Single source
//   of truth, two views.
//
// Hash semantics:
//   preflight_hash = SHA-256 of the canonicalized fields that affect
//   downstream generation: question, variables-by-role, goals,
//   discount, opt-in toggles. UI presentation fields (descriptions,
//   evidence quotes) are excluded so cosmetic changes don't bust the
//   hash. Two PreflightViews with the same hash represent the same
//   downstream contract.
//
// Editability:
//   Every section is editable in place. Edits write to
//   environment_overrides (the same table EnvironmentDefinition uses)
//   so changes propagate to the simulator + appear on the audit
//   surface immediately. Approval (POST /preflight/approve) locks the
//   preflight, fires the pipeline, and stamps the resulting artifacts
//   with the approved preflight_hash for diff-against-plan auditing.

import type { ValidationVerdict } from "@/lib/prompts/mediator-validator";

// ── Top-level shape ─────────────────────────────────────────────────

export interface PreflightView {
  /** SHA-256 prefix; hash inputs documented in PREFLIGHT_HASH_INPUTS. */
  preflight_hash: string;
  space_id: string;
  /** Optional — when null, the preflight is for the space's default
   *  persona / no-persona context. */
  subject_id: string | null;
  computed_at: string;

  /** ① The Question — what we understood from the user's intake. */
  question: PreflightQuestion;

  /** ② Variables — six-role partition of entities. */
  variables: PreflightVariables;

  /** ③ Causal Map Preview — what we know about how variables connect,
   *     plus what the Mediator Proposal Engine (M1-M2 in preview mode)
   *     suggests adding. */
  causal_map: PreflightCausalMap;

  /** ④ Goals & Success — the reward function being negotiated. */
  goals: PreflightGoals;

  /** ⑤ Initial State — where the user starts from. */
  initial_state: PreflightInitialState;

  /** ⑥ Downstream Plan — what gets generated, what could, what won't. */
  downstream: PreflightDownstreamPlan;

  /** Composite 0-1 confidence with per-section decomposition. */
  confidence_overall: number;
  confidence_breakdown: PreflightConfidenceBreakdown;

  /** Append-only audit trail of user edits applied to this view. */
  overrides_applied: PreflightOverride[];
}

// ── ① Question ──────────────────────────────────────────────────────

export interface PreflightQuestion {
  /** The user's prompt as-typed, possibly truncated. */
  prompt_verbatim: string;
  /** Whether prompt_verbatim was truncated. */
  prompt_truncated: boolean;

  /** LLM-parsed primary objective (1 sentence). */
  primary_objective: string;
  /** Verbatim sentence(s) from the prompt that drove the primary
   *  objective. Null when synthesized rather than directly quoted. */
  primary_objective_source_quote: string | null;

  /** 2-5 sub-objectives extracted from the prompt + assets. */
  sub_objectives: SubObjective[];

  /** Domain classification with confidence. */
  domain: {
    label: string;
    confidence: number;
    rationale: string | null;
  };

  /** When the user wants an answer. Null = unspecified. */
  decision_horizon_weeks: number | null;
  decision_horizon_source: "prompt" | "template_default" | "user_override" | null;

  /** Things explicitly NOT being modeled. */
  out_of_scope: string[];

  /** What "done" looks like — drives the reward + downstream evaluation. */
  success_criteria: SuccessCriterion[];
}

export interface SubObjective {
  /** Short imperative phrasing. */
  text: string;
  /** Verbatim source — null when synthesized. */
  source_quote: string | null;
  /** FK to evidence_registries when the sub-objective came from an
   *  asset rather than the prompt. */
  evidence_ids: string[];
  /** 0-1 — proposer's confidence that this sub-objective belongs. */
  confidence: number;
}

export interface SuccessCriterion {
  /** What's measured. */
  criterion: string;
  /** Threshold for "success" if specified. */
  threshold: string | null;
  /** Priority within the criterion list. */
  priority: "primary" | "secondary";
}

// ── ② Variables (six-role partition) ────────────────────────────────

export interface PreflightVariables {
  /** Manipulable variables — what the user can change. */
  independent: VariableEntry[];
  /** Outcomes — what the user wants to influence. */
  dependent: VariableEntry[];
  /** Held constant during analysis to isolate the IV→DV signal. */
  controls: VariableEntry[];
  /** Common causes of both IV and DV — must adjust for to estimate
   *  causal effects. Auto-detected from backdoor walker. */
  confounders: VariableEntry[];
  /** On the causal path between IV and DV — adjusting for them
   *  estimates direct (vs total) effects. Auto-detected from edge
   *  paths. */
  mediators: VariableEntry[];
  /** Change the strength of the IV→DV relationship without being on
   *  the path themselves. Auto-detected from synergy/interaction
   *  discovery. */
  moderators: VariableEntry[];

  /** Entities that don't fit any role yet — TBD. The presence of
   *  unclassifieds is honest signaling that synthesis hasn't yet
   *  reasoned over them. */
  unclassified: VariableEntry[];

  /** Per-role notes about what's known/unknown. The page renders
   *  these inline as "TBD because synthesis hasn't run" or "TBD —
   *  needs research" prompts. */
  role_inference_notes: RoleInferenceNote[];
}

export interface RoleInferenceNote {
  /** Which role bucket this note applies to. */
  role:
    | "independent"
    | "dependent"
    | "controls"
    | "confounders"
    | "mediators"
    | "moderators";
  /** Why this role bucket is empty/sparse. */
  reason: string;
  /** What downstream stage will populate it. */
  resolved_by: string;
  /** Severity: 'info' (expected to fill in), 'warn' (concerning gap). */
  severity: "info" | "warn";
}

export interface VariableEntry {
  entity_id: string;
  name: string;
  description: string | null;
  layer: string | null;
  /** Whether the variable can be measured directly (observable),
   *  is unobservable but inferable (latent), or is a stand-in for a
   *  harder-to-measure variable (proxy). */
  observability: "directly_observable" | "latent" | "inferable_via_proxy" | "unknown";
  /** When observability = "inferable_via_proxy", the entity this is a
   *  proxy for. */
  proxy_for: { entity_id: string; entity_name: string } | null;
  /** Most recent observed value, if measured. */
  current_value: string | null;
  unit: string | null;
  importance: "fundamental" | "critical" | "important" | "moderate" | null;
  /** Audit trail — why this entity is in this role bucket. */
  rationale: VariableRationale;
  /**
   * Sprint W6.8 — Tier 1 canonical concept link. Populated by
   * partition-variables-by-role from the source entity's
   * canonical_concept_id column. NULL when the entity is not yet
   * linked (legacy entity pre-W6.7 backfill, name that fails to
   * normalize, etc.). UI surfaces render a CanonicalConceptBadge
   * when present.
   */
  canonical_concept_id?: string | null;
  /**
   * The canonical_code that resolved this entity to its concept.
   * Read-only convenience for the badge component (it's the URL
   * param for GET /api/canonical-concepts/[code]). Derived from
   * the entity → canonical_concepts join at partition time.
   */
  canonical_code?: string | null;
}

export interface VariableRationale {
  source:
    | "prompt_extraction"      // pulled directly from the user's prompt
    | "template_seed"          // came from the template's pre-baked seed
    | "research"               // discovered during research pipeline
    | "synthesis_inference"    // inferred during synthesis
    | "user_override"          // user manually classified
    | "auto_classifier";       // auto-classifier (e.g. backdoor walker)
  /** Verbatim quote when source allows. */
  source_quote: string | null;
  /** FKs to evidence_registries for research-sourced variables. */
  evidence_ids: string[];
  /** 0-1 — confidence the variable belongs in THIS role (not just in
   *  the graph at all). */
  confidence: number;
  /** Human-readable reason for the role assignment. */
  reason: string;
}

// ── ③ Causal Map Preview ────────────────────────────────────────────

export interface PreflightCausalMap {
  /** Current entity count in the space. */
  current_entities: number;
  /** Current edge count. */
  current_edges: number;
  /** Edge breakdown by status (confirmed = high evidence, mixed =
   *  contested, sparse = waiting for research). */
  edge_status_counts: {
    confirmed: number;
    mixed: number;
    sparse: number;
  };
  /** Edge breakdown by causal_status when migration has run. */
  edge_causal_status_counts: {
    established_causal: number;
    plausible_causal: number;
    correlational_only: number;
    unknown: number;
  };
  /** Edges originally extracted from the user's prompt (vs seeded
   *  vs researched). Tracks how much of the map is the user's own
   *  knowledge. */
  explicit_relations_from_prompt: number;
  template_seed_relations: number;
  research_added_relations: number;

  /**
   * Preview bridges from the Mediator Proposal Engine (M1+M2).
   * Run in preview mode — no persistence — so the user can curate
   * before the pipeline fires. Approving a preview bridge here
   * causes M4 persistence on pipeline run.
   */
  preview_bridges: PreviewBridge[];
  /** Total orphan clusters detected by M1 (whether or not a bridge
   *  was proposable for them). */
  orphan_clusters_count: number;

  /**
   * How deep mechanism decomposition will run for each edge:
   *   1 = no decomposition, edges stay direct
   *   2 = one mechanism step inserted between cause and effect
   *   3 = full chain decomposition (e.g., exercise → lactate →
   *        PGC-1α → FNDC5 → BDNF)
   */
  depth_setting: 1 | 2 | 3;
}

export interface PreviewBridge {
  /** Stable id from M1; survives re-runs on unchanged data. */
  cluster_id: string;
  /** Proposed bridging entity. */
  proposed_entity_name: string;
  proposed_entity_layer: string;
  proposed_entity_category: string;
  /** Names of the orphan members this bridge would connect. */
  bridges_member_names: string[];
  /** Number of new edges this bridge would add. */
  proposed_edge_count: number;
  /** Final confidence after validation. */
  confidence: number;
  /** True when the validator marked this speculative — shows a
   *  warning chip instead of approve-by-default. */
  speculative: boolean;
  /** From M2 — why this bridge mechanistically connects. */
  mechanism_explanation: string;
  /** From M3 — full validator output for the audit drawer. */
  verdict: ValidationVerdict;
  /** User's pre-approval decision in the preflight. When the user
   *  approves the whole preflight, only "preview_approved" bridges
   *  are persisted. */
  preview_decision: "preview_approved" | "preview_rejected" | "pending";
}

// ── ④ Goals & Success ───────────────────────────────────────────────

export interface PreflightGoals {
  /** The single primary goal — drives the reward function. Null
   *  when no goal has been declared. */
  primary: GoalSpec | null;
  /** Up to 3 sub-goals with weights summing to 1.0. */
  sub_goals: GoalSpec[];
  /** Cost terms (negative reward) — what to PENALIZE in optimization. */
  cost_terms: CostTerm[];

  /** Discount factor γ per week. Drives optimization's preference for
   *  near vs far rewards. */
  discount_per_week: number;
  /** Pre-computed semantic label for the discount setting. */
  discount_label: "urgent" | "balanced" | "patient";
  /** Effective half-life in weeks given the discount. Shown in UI. */
  effective_half_life_weeks: number;

  /** Stop conditions — abandon the strategy if X happens. */
  stop_conditions: StopCondition[];

  /** Whether the goal weights have been explicitly normalized to 1.0. */
  weights_normalized: boolean;
}

export interface GoalSpec {
  goal_id: string;
  title: string;
  metric_name: string;
  metric_entity_id: string | null;
  baseline_value: number | null;
  target_value: number | null;
  unit: string | null;
  /** Direction of "better" — auto-inferred from baseline vs target. */
  direction: "increase" | "decrease" | "stabilize";
  /** Goal weight in [0,1]; sum across primary + sub-goals = 1.0
   *  when weights_normalized. */
  weight: number;
  horizon_weeks: number | null;
  /** Whether the baseline has been measured (vs assumed/inferred).
   *  When false, downstream simulation uses an estimate flagged with
   *  uncertainty. */
  baseline_measured: boolean;
  /** Whether the target value is user-set (high-confidence) vs
   *  template-default (lower confidence). */
  target_user_set: boolean;
}

export interface CostTerm {
  /** What's being penalized — e.g. "effort hours / week", "side effects". */
  label: string;
  /** Weight in [0,1] relative to other cost terms. */
  weight: number;
  description: string;
}

export interface StopCondition {
  /** What triggers the stop — e.g. "biomarker X drops 20% below baseline". */
  signal: string;
  /** Action when triggered — e.g. "abandon strategy", "alert user". */
  response: "abandon" | "alert" | "pivot";
}

// ── ⑤ Initial State ─────────────────────────────────────────────────

export interface PreflightInitialState {
  persona_id: string | null;
  persona_name: string | null;
  /** Per-condition status. */
  conditions: ConditionEntry[];
  /** Counts derived from conditions. */
  calibrated_count: number;
  uncalibrated_count: number;
  /** Per-baseline status. */
  baselines: BaselineEntry[];
  baselines_measured: number;
  baselines_pending: number;
  /** Names of baselines the system suggests measuring before strategy
   *  generation, sorted by impact on prediction precision. */
  pending_baselines_to_measure: string[];
}

export interface ConditionEntry {
  /** Stable key — e.g. "sleep_h_avg_24h", "post_chemo_24mo". */
  key: string;
  /** Human-readable display label. */
  label: string;
  /** The user's actual value for this condition. */
  value: string | number | boolean | null;
  /** Whether a literature-validated modulator exists in this domain
   *  for this condition. When false, predictions for this user use
   *  population-average effects (flagged in downstream output). */
  is_calibrated: boolean;
  /** Number of edges in the graph the modulator would adjust. */
  modulator_count: number;
  /** Source of the condition value (prompt vs template default vs
   *  user-set). */
  source: "prompt" | "template_default" | "user_override";
  source_quote: string | null;
}

export interface BaselineEntry {
  metric_entity_id: string;
  metric_name: string;
  /** The baseline value used by the simulator. */
  value: string | null;
  unit: string | null;
  /** When the value was last measured (vs assumed). */
  measured_at: string | null;
  /** Whether the value is user-measured vs template-default vs
   *  population-average. */
  source: "measured" | "template_default" | "population_average" | "user_inferred";
  /** Suggested next action — usually null (no-op) or
   *  "measure_now" for high-impact unmeasured baselines. */
  suggested_action: "measure_now" | null;
  /** Estimated reduction in prediction variance if this baseline
   *  were measured. Drives the "measure first" recommendation
   *  ranking. */
  variance_reduction_if_measured: number;
}

// ── ⑥ Downstream Plan ───────────────────────────────────────────────

export interface PreflightDownstreamPlan {
  /** What the pipeline WILL generate by default. Each item runs
   *  unless explicitly disabled. */
  will_generate: PlanItem[];
  /** Items the user can OPT IN to before running. Defaults off. */
  could_generate: PlanItem[];
  /** Items deliberately not running, with rationale. */
  will_not_generate: ExclusionItem[];

  /** Aggregates over will_generate + opt-ins the user has toggled on.
   *  Recompute live as the user toggles. */
  estimated_total_seconds: number;
  estimated_total_cost_usd: number;
  estimated_entities_added: number;
  estimated_edges_added: number;
  estimated_artifacts_added: { kind: string; count: number }[];
}

export interface PlanItem {
  /** Stable id — e.g. "kg_decompose", "deep_research_pass",
   *  "mediator_proposal_engine". Lets toggles persist across
   *  reloads. */
  id: string;
  /** Display label. */
  label: string;
  /** 1-2 sentence description for the tooltip. */
  description: string;
  /** Will-generate items have this true; could-generate false. */
  default_enabled: boolean;
  /** True for could-generate items the user has opted in to. Always
   *  true for will-generate. */
  enabled: boolean;
  /** Whether the user can toggle this on/off in the UI. Some core
   *  items (like KG decompose) are always-on. */
  toggleable: boolean;
  /** Rough seconds estimate. Derived from telemetry of past runs. */
  estimated_seconds: number;
  /** Rough USD cost from token estimation. */
  estimated_cost_usd: number;
  /** What artifacts this item produces. */
  estimated_artifacts: { kind: string; count: number }[];
  /** What this item depends on — used to resolve toggle ordering. */
  depends_on: string[];
  /** Order within the will/could lists. */
  order: number;
}

export interface ExclusionItem {
  label: string;
  /** Why it's excluded. Plain language. */
  reason: string;
  /** What action the user could take to enable this. Null when
   *  unfixable in this product. */
  unlock_path: string | null;
}

// ── Confidence ──────────────────────────────────────────────────────

export interface PreflightConfidenceBreakdown {
  /** ① — How well we parsed the user's intent. */
  question_clarity: ConfidenceComponent;
  /** ② — Coverage of the variables-by-role partition. */
  variable_coverage: ConfidenceComponent;
  /** ③ — Edge density / proportion of well-evidenced edges. */
  causal_map_density: ConfidenceComponent;
  /** ④ — Goal targets, weights, baselines. */
  goal_specificity: ConfidenceComponent;
  /** ⑤ — Conditions calibrated; baselines measured. */
  initial_state_calibration: ConfidenceComponent;
  /** Honest callouts — which components are below their thresholds
   *  and what the user could do about it. */
  callouts: ConfidenceCallout[];
}

export interface ConfidenceComponent {
  /** Component score 0-1. */
  score: number;
  /** Weight in the composite confidence (sum across components = 1). */
  weight: number;
  /** Threshold below which the component triggers a callout. */
  warn_threshold: number;
  /** Plain-language label rendered in UI. */
  label: string;
}

export interface ConfidenceCallout {
  /** Which component triggered this. */
  component:
    | "question_clarity"
    | "variable_coverage"
    | "causal_map_density"
    | "goal_specificity"
    | "initial_state_calibration";
  severity: "info" | "warn" | "critical";
  /** What's wrong. */
  message: string;
  /** What the user can do about it. */
  suggested_action: string | null;
}

// ── Overrides ───────────────────────────────────────────────────────

export interface PreflightOverride {
  override_id: string;
  override_kind:
    | "reclassify_variable"      // moved entity between role columns
    | "add_variable"              // user-added variable
    | "remove_variable"           // user-removed variable
    | "set_observability"         // changed observability + proxy mapping
    | "adjust_goal"               // changed weight, target, or γ
    | "approve_preview_bridge"    // pre-approved a mediator preview
    | "reject_preview_bridge"     // pre-rejected a mediator preview
    | "toggle_plan_item"          // turned an opt-in plan item on/off
    | "set_condition"             // confirmed/corrected a condition
    | "request_baseline_measurement";
  /** What the override targets — entity_id, goal_id, plan_item_id, etc. */
  target_id: string;
  /** Override-kind-specific payload. */
  value: unknown;
  applied_at: string;
  applied_by: string;
  /** Optional reasoning string the user provided. */
  reasoning: string | null;
}

// ── Hash inputs (which fields participate in preflight_hash) ────────

/**
 * Documented for the hash helper at A2-time. Fields NOT in this list
 * are excluded from the SHA-256 (so cosmetic changes — descriptions,
 * source_quotes — don't bust the hash and trigger spurious diff
 * warnings on the audit page).
 */
export const PREFLIGHT_HASH_INPUTS = [
  "question.primary_objective",
  "question.sub_objectives[].text",
  "question.domain.label",
  "question.decision_horizon_weeks",
  "question.out_of_scope",
  "variables.independent[].entity_id",
  "variables.dependent[].entity_id",
  "variables.controls[].entity_id",
  "variables.confounders[].entity_id",
  "variables.mediators[].entity_id",
  "variables.moderators[].entity_id",
  "causal_map.depth_setting",
  "causal_map.preview_bridges[].cluster_id",
  "causal_map.preview_bridges[].preview_decision",
  "goals.primary.goal_id",
  "goals.primary.target_value",
  "goals.primary.weight",
  "goals.sub_goals[].goal_id",
  "goals.sub_goals[].target_value",
  "goals.sub_goals[].weight",
  "goals.cost_terms[]",
  "goals.discount_per_week",
  "initial_state.conditions[].key",
  "initial_state.conditions[].value",
  "downstream.could_generate[].id+enabled",
] as const;
