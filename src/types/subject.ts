// ── Subject types ────────────────────────────────────────────────
//
// Mirrors the `subjects`, `subject_experiments`, and `lab_scaffolds`
// rows. See:
//   - supabase/migrations/20260608_subjects_and_lab_scaffolds.sql (schema)
//   - src/lib/subjects/modulators.ts (condition vocabulary)
//   - src/app/api/spaces/[id]/subjects/* (CRUD)
//
// Subject = a NAMED COMPOSITION of existing things, NOT a new
// sandbox engine. It wraps:
//   1. A baseline twin_snapshot (the frozen "save game" of the KG)
//   2. A system_id scope (which ingredients are inside the walls)
//   3. A conditions JSONB bag (modulator key-value pairs)
//   4. Per-subject entity parameter overrides (don't clobber globals)
//   5. An append-only experiment log
//
// "Center of focus we want to manipulate" — a person, paper,
// product, essay topic, environment, etc.

/** Drives the icon + UX language. Closed enum. */
export type SubjectFocusKind =
  | "person"
  | "document"
  | "product"
  | "topic"
  | "environment"
  | "system"
  | "data"
  | "reaction"
  | "other";

/** How aggressively the KG-growth loop should run for this subject.
 *  bare_topic        → generate freely
 *  partial_artifact  → anchor on existing, find gaps
 *  complete_artifact → critique + simulate only
 */
export type SubjectArtifactState =
  | "bare_topic"
  | "partial_artifact"
  | "complete_artifact";

export type SubjectStatus = "active" | "archived";

export type SubjectSourceKind =
  | "initial_prompt"
  | "added_prompt"
  | "uploaded_file"
  | "research_paper"
  | "lasso_selection"
  | "pipeline_proposed"
  | "manual";

/** UI labels — kept here so every surface uses the same strings. */
export const SUBJECT_FOCUS_LABEL: Record<SubjectFocusKind, string> = {
  person: "Person",
  document: "Document",
  product: "Product",
  topic: "Topic",
  environment: "Environment",
  system: "System",
  data: "Dataset",
  reaction: "Reaction",
  other: "Other",
};

export const SUBJECT_SOURCE_LABEL: Record<SubjectSourceKind, string> = {
  initial_prompt: "Initial prompt",
  added_prompt: "Added prompt",
  uploaded_file: "Uploaded file",
  research_paper: "Research paper",
  lasso_selection: "Selected from canvas",
  pipeline_proposed: "Lab proposal",
  manual: "Hand-crafted",
};

/** Per-entity parameter overrides, layered atop entities.parameters
 *  at lab read-time. Same shape as the entity-level
 *  InstrumentParameters in src/lib/lab-formulas.ts. */
export interface EntityParamOverride {
  K?: number;
  tau?: number;
  rho?: number;
  alpha?: number;
}

export type EntityParamOverrides = Record<string, EntityParamOverride>;

/** The Subject row, as it lives in the DB. */
export interface Subject {
  id: string;
  space_id: string;
  user_id: string;

  name: string;
  description: string | null;

  focus_kind: SubjectFocusKind;
  focus_label: string;

  artifact_state: SubjectArtifactState;

  /** Optional pointers to existing primitives that compose this subject. */
  baseline_snapshot_id: string | null;
  scope_system_id: string | null;

  /** Modulator bag — `{ key: numericValue }`. */
  conditions: Record<string, number>;

  entity_param_overrides: EntityParamOverrides;

  source_kind: SubjectSourceKind | null;
  source_ref: Record<string, unknown> | null;

  status: SubjectStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateSubjectInput {
  name: string;
  description?: string | null;
  focus_kind: SubjectFocusKind;
  focus_label: string;
  artifact_state?: SubjectArtifactState;
  baseline_snapshot_id?: string | null;
  scope_system_id?: string | null;
  conditions?: Record<string, number>;
  entity_param_overrides?: EntityParamOverrides;
  source_kind?: SubjectSourceKind | null;
  source_ref?: Record<string, unknown> | null;
}

export interface UpdateSubjectInput {
  name?: string;
  description?: string | null;
  focus_kind?: SubjectFocusKind;
  focus_label?: string;
  artifact_state?: SubjectArtifactState;
  baseline_snapshot_id?: string | null;
  scope_system_id?: string | null;
  conditions?: Record<string, number>;
  entity_param_overrides?: EntityParamOverrides;
  status?: SubjectStatus;
}

// ── Experiments (append-only audit log) ─────────────────────────

export type ExperimentRunKind =
  | "what_if"
  | "monte_carlo"
  | "bootstrap"
  | "deterministic_replay"
  | "calibration";

export interface SubjectExperiment {
  id: string;
  subject_id: string;
  user_id: string;
  scenario_id: string | null;
  /** Conditions bag frozen at the moment of the run — history-stable. */
  conditions_at_run: Record<string, number>;
  run_kind: ExperimentRunKind;
  /** Free-form input payload — target_entity_id, direction, magnitude, … */
  run_params: Record<string, unknown> | null;
  /** Compact summary — `{ p10, p50, p90, mean, stddev, verdict, … }`. */
  outcome_summary: Record<string, unknown> | null;
  /** Optional full-fidelity distribution payload. */
  outcome_distribution: Record<string, unknown> | null;
  ran_at: string;
}

export interface LogExperimentInput {
  scenario_id?: string | null;
  conditions_at_run?: Record<string, number>;
  run_kind: ExperimentRunKind;
  run_params?: Record<string, unknown> | null;
  outcome_summary?: Record<string, unknown> | null;
  outcome_distribution?: Record<string, unknown> | null;
}

// ── Lab scaffolds (the pre-flight checklist) ────────────────────

export type LabScaffoldStatus =
  | "proposed"
  | "approved"
  | "scaffolded"
  | "rejected"
  | "superseded";

/** One proposed subject in the wizard payload. The scaffold-approve
 *  endpoint materializes each into a real Subject row. */
export interface ProposedSubject {
  focus_kind: SubjectFocusKind;
  focus_label: string;
  name?: string;
  description?: string;
  artifact_state?: SubjectArtifactState;
  /** When set, the new Subject scopes to this saved system. */
  suggested_scope_system_id?: string | null;
  suggested_baseline_snapshot_id?: string | null;
  /** Suggested starting condition values (the slider defaults). */
  suggested_conditions?: Record<string, number>;
  rationale?: string;
}

/** One proposed lab feature in the wizard payload. v1 features map
 *  to existing lab capabilities (no new modes invented). */
export interface ProposedFeature {
  /** Stable feature id. v1: monte_carlo | what_if | ab_compare | deepen_kg */
  id: "monte_carlo" | "what_if" | "ab_compare" | "deepen_kg";
  default_on: boolean;
  rationale?: string;
}

export interface LabScaffold {
  id: string;
  space_id: string;
  user_id: string;
  proposed_subjects: ProposedSubject[];
  proposed_features: ProposedFeature[];
  proposed_parameters: Record<string, unknown>;
  source_strategy_snapshot_id: string | null;
  pipeline_run_id: string | null;
  status: LabScaffoldStatus;
  approved_at: string | null;
  approved_by: string | null;
  materialized_subject_ids: string[];
  created_at: string;
  updated_at: string;
}

/** What the wizard POSTs back when the user approves the checklist. */
export interface ApproveScaffoldInput {
  /** Subjects the user kept (with any edits applied). Must be a
   *  subset/derivative of `proposed_subjects` after user edits. */
  subjects: ProposedSubject[];
  /** Feature toggles after user edits. */
  features: ProposedFeature[];
  /** Override values for proposed_parameters. */
  parameters?: Record<string, unknown>;
}

// ── List response shapes ────────────────────────────────────────

export interface ListSubjectsResponse {
  subjects: Subject[];
  computed_at: string;
}

export interface SubjectDetailResponse {
  subject: Subject;
  /** Most-recent experiments (capped at 20 server-side). */
  recent_experiments: SubjectExperiment[];
  /** Hydrated baseline snapshot meta (id + reason + captured_at) so
   *  the detail page can label the baseline without a second fetch. */
  baseline_snapshot_meta: {
    id: string;
    reason: string;
    captured_at: string;
  } | null;
  /** Hydrated scope system summary (name + counts) so the detail
   *  page renders the wall context without a second fetch. */
  scope_system_summary: {
    id: string;
    name: string;
    entity_count: number;
    edge_count: number;
  } | null;
}
