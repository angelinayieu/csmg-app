// Variable proposals — first-class persistence for variables proposed by
// the LLM during strategy synthesis or by users via the +Variable button.
//
// Why this exists: until this layer, LLM-proposed variables only lived as
// strings inside synthesis_data.strategic_recommendation JSONB and were
// never queryable / approvable / cross-linkable. This type matches the
// `variable_proposals` table from migration 20260706.

/**
 * Two role taxonomies fused into one enum:
 *
 * Experimental-design roles (preferred when proposing for labs):
 *   - independent  — what we manipulate
 *   - dependent    — what we measure / observe
 *   - controlled   — what we hold constant
 *   - confounding  — uncontrolled but influences DV
 *
 * Causal-modeling roles (used when the variable maps onto a causal graph):
 *   - outcome     — terminal causal endpoint
 *   - mediator    — causal intermediary
 *   - modifier    — interaction term
 *   - instrument  — measurement tool
 *   - condition   — boundary constraint
 *
 * Special: "unclassified" when the source data didn't commit to a role.
 */
export type VariableRole =
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

/**
 * Sprint W5.8a — runtime-checkable set of all valid VariableRole
 * strings. Used by the tune_variable action handler to validate
 * user-supplied role values before writing an override. Keep this in
 * lockstep with the VariableRole union above; if you add a new role
 * to the union, add it here too.
 */
export const VALID_VARIABLE_ROLES: ReadonlySet<VariableRole> = new Set<VariableRole>([
  "independent",
  "dependent",
  "controlled",
  "confounding",
  "outcome",
  "mediator",
  "modifier",
  "instrument",
  "condition",
  "unclassified",
]);

/**
 * Where a proposal came from. `llm` = synthesis-extracted; `manual` =
 * authored via the +Variable button.
 */
export type VariableProposalSource = "llm" | "manual";

/**
 * Source field within the strategic_recommendation that an LLM proposal
 * was extracted from. Used to group the review panel by stage and to
 * supersede stale proposals on strategy regen.
 */
export type VariableSourceField =
  | "perspective.key_metric"
  | "micro_tactic.metric"
  | "learning_loop.leading_indicator"
  | "learning_loop.lagging_indicator"
  // Sprint W5.5 — per-app variable contract from infrastructure_proposals.
  // Distinguished from perspective/learning_loop sources so review UIs can
  // group "app-scoped" variable proposals separately from "strategy-level."
  | "infrastructure_proposal.app_variable"
  | "manual";

export type VariableProposalStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "superseded";

/**
 * Concrete shape of a variable's measurable definition. Mirrors the
 * fields the LLM emits for key_metric / micro_tactic.metric — kept
 * generous so manual-authoring forms can write a subset and the
 * proposal panel renders gracefully when fields are missing.
 */
export interface VariableMetricDefinition {
  name: string;
  current?: string | null;
  target?: string | null;
  unit?: string | null;
  measurement_method?: string | null;
  cadence?: "daily" | "weekly" | "biweekly" | "monthly" | string | null;
  threshold_green?: string | null;
  threshold_yellow?: string | null;
  threshold_red?: string | null;
}

export interface VariableProposal {
  id: string;
  space_id: string;
  user_id: string;
  proposed_by: VariableProposalSource;
  source_strategy_version: number | null;
  source_field: VariableSourceField | null;
  source_perspective_id: string | null;
  proposed_name: string;
  proposed_description: string | null;
  variable_role: VariableRole;
  metric_definition: VariableMetricDefinition | null;
  justification: string | null;
  confidence: number | null;
  depends_on_entity_ids: string[];
  materialized_entity_id: string | null;
  user_status: VariableProposalStatus;
  generated_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The shape `extractVariableProposals` produces — one entry per variable
 * the recommendation surfaces. `id` and timestamps are filled by the DB
 * on insert.
 */
export type VariableProposalDraft = Omit<
  VariableProposal,
  | "id"
  | "user_id"
  | "materialized_entity_id"
  | "user_status"
  | "approved_at"
  | "rejected_at"
  | "rejection_reason"
  | "generated_at"
  | "created_at"
  | "updated_at"
>;
