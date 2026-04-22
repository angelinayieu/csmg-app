// Domain types for the capability registry + acquisition plans.
//
// Backs migrations:
//   - 20260516_capability_registry.sql (schema)
//   - 20260517_capability_registry_seed.sql (15 system capabilities)
//
// Design ref: the action-driven strategy redesign. Every capability is a
// data-acquisition primitive; plans are DAGs of capability invocations;
// deviation between predicted and actual yield trains capability priors
// per (capability × context) so the project's world-model sharpens over
// time. People-contact is one category among nine — the planner must NOT
// privilege any of them.
//
// JSONB column shapes live here (yields, preconditions, predicted_return,
// actual_return, success_priors, etc.). DB layer treats them as Json; the
// planner + resolver validate at the boundary.

import type { Database, Json } from "./database.types";

// ── Row aliases ─────────────────────────────────────────────────────────

export type CapabilityRow = Database["public"]["Tables"]["capabilities"]["Row"];
export type CapabilityInsert = Database["public"]["Tables"]["capabilities"]["Insert"];
export type CapabilityUpdate = Database["public"]["Tables"]["capabilities"]["Update"];

export type DataNeedRow = Database["public"]["Tables"]["data_needs"]["Row"];
export type DataNeedInsert = Database["public"]["Tables"]["data_needs"]["Insert"];

export type AcquisitionPlanRow = Database["public"]["Tables"]["acquisition_plans"]["Row"];
export type AcquisitionPlanInsert = Database["public"]["Tables"]["acquisition_plans"]["Insert"];

export type PlanStepRow = Database["public"]["Tables"]["plan_steps"]["Row"];
export type PlanStepInsert = Database["public"]["Tables"]["plan_steps"]["Insert"];

export type PlanStepEdgeRow = Database["public"]["Tables"]["plan_step_edges"]["Row"];
export type PlanStepEdgeInsert = Database["public"]["Tables"]["plan_step_edges"]["Insert"];

export type CapabilityObservationRow = Database["public"]["Tables"]["capability_observations"]["Row"];

// ── Category + enum vocab ───────────────────────────────────────────────

/**
 * The 9-way category split. Kept intentionally broad — the attribute flags
 * (requires_human, perturbs_system, etc.) carry the nuance, not the category.
 */
export type CapabilityCategory =
  | "person_contact"
  | "community_inquiry"
  | "literature_research"
  | "dataset_acquisition"
  | "direct_observation"
  | "instrumentation"
  | "experiment"
  | "synthesis"
  | "temporal_capture";

export type CapabilityStatus = "active" | "proposed" | "deprecated";
export type RelationalCost = "none" | "low" | "medium" | "high";
export type LatencyKind = "sync" | "async" | "scheduled_event";

export type DataNeedStatus = "open" | "planning" | "in_flight" | "resolved" | "abandoned";
export type DataNeedSourceKind =
  | "prediction_spec"
  | "validation_spec"
  | "user_authored"
  | "planner_recursion"
  | "agent_detected";

export type PlanStatus =
  | "draft"
  | "proposed"
  | "approved"
  | "in_flight"
  | "resolved"
  | "abandoned"
  | "superseded";

export type PlanStepStatus = "blocked" | "ready" | "in_flight" | "resolved" | "skipped" | "failed";
export type PlanStepExecutor = "human" | "agent" | "instrument" | "external_service";

export type PlanEdgeKind = "sequential" | "parallel" | "fallback" | "branch" | "join";

/**
 * Deviation tags extend prediction_ledger's vocab with "failed" because
 * steps can fail outright (network error, target unreachable) in ways that
 * metric predictions can't.
 */
export type StepDeviationTag = "expected" | "regime_shift" | "surprise" | "qualitative" | "failed";

// ── Structured JSONB shapes ─────────────────────────────────────────────

/**
 * Attribute the capability expects to yield, with the planner's prior on
 * what its value will be. The resolver scores actual_return against this
 * per-attribute to assign per-step deviation tags.
 */
export interface CapabilityYieldAttribute {
  name: string;
  kind: "bool" | "int" | "float" | "enum" | "text";
  /** For int/float — [p10, p90] range the planner expects. */
  expected_range?: [number, number];
  /** For enum — allowed values. */
  enum_values?: string[];
  /** For bool — the expected boolean. */
  expected?: boolean;
  /** Planner's prior confidence in the expected value (0..1). */
  confidence: number;
}

/**
 * Full yield template stored on capabilities.yields. Plan_steps instantiate
 * it into predicted_return by filling in context-conditioned values.
 */
export interface CapabilityYields {
  attributes: CapabilityYieldAttribute[];
  /** Entity kinds this capability may surface as side-effects of running. */
  new_entities?: string[];
  /** sync = immediate; async = bounded wait; deferred = tied to future event. */
  response_shape: "sync" | "async" | "deferred";
}

/**
 * Precondition the planner must satisfy (or recurse to create a sub-need
 * for) before this capability can run. `soft: true` means the capability
 * runs with degraded yield rather than failing.
 */
export interface CapabilityPrecondition {
  kind:
    | "entity_exists"
    | "contact_info_available"
    | "budget"
    | "consent"
    | "instrument_installed"
    | "data_access";
  description: string;
  soft?: boolean;
}

/**
 * Prior bucket on capabilities.success_priors. Key = context descriptor
 * string ("default" | "actor_type=pi;familiarity=cold" | ...).
 */
export interface CapabilityPriorBucket {
  success_rate: number;
  sample_n: number;
  updated_at?: string;
}

export type CapabilitySuccessPriors = Record<string, CapabilityPriorBucket>;

export interface CapabilityYieldPriors {
  /** Median yield_completeness among successful runs (0..1). */
  yield_completeness_p50?: number;
  yield_completeness_p90?: number;
}

// ── Shape for data_needs.expected_answer_shape ──────────────────────────

export interface ExpectedAnswerShape {
  kind: "bool" | "int" | "float" | "enum" | "text" | "distribution";
  expected_range?: [number, number];
  enum_values?: string[];
}

// ── Shape for plan_steps.predicted_return / actual_return ───────────────

/**
 * Per-invocation predicted return. Instantiated from the capability's
 * CapabilityYields template with context-conditioned priors baked in.
 */
export interface PredictedReturn {
  /** Context-conditioned success probability the planner used for scoring. */
  success_probability: number;
  /** For async capabilities — [p10, p90] response window in days. */
  response_window_days?: [number, number];
  /** Per-attribute predictions (subset of the capability's yields). */
  expected_attributes: CapabilityYieldAttribute[];
  /** Entities this step is expected to surface. */
  expected_new_entities?: string[];
  /** Context descriptor string — also used as the key into success_priors. */
  context_key?: string;
}

export interface ActualReturn {
  /** Did the capability invocation succeed at all (network/access level)? */
  succeeded: boolean;
  /** Per-attribute actuals, keyed by attribute name. */
  attributes: Record<string, boolean | number | string | null>;
  /** Overall yield completeness (0..1) — resolver computes from attribute coverage. */
  yield_completeness?: number;
  /** Free-form notes from the user / agent logging the outcome. */
  notes?: string;
  /** When the actual landed. */
  resolved_at: string;
}

// ── Shape for plan_step_edges.branch_predicate ──────────────────────────

/**
 * Predicate evaluated against a step's actual_return. Kept intentionally
 * small — the planner composes complex conditions via multiple branch
 * edges rather than a rich expression language.
 */
export type BranchPredicate =
  | { attribute: string; equals: boolean | number | string }
  | { attribute: string; gt: number }
  | { attribute: string; lt: number }
  | { attribute: string; in: Array<boolean | number | string> };

// ── Shape for data_needs.source_ref ─────────────────────────────────────

export interface DataNeedSourceRef {
  strategy_snapshot_id?: string;
  app_id?: string;
  spec_path?: string;           // e.g. "prediction_spec.metrics[0]"
  agent_run_id?: string;
  generated_by?: string;
}

// ── Convenience composites ──────────────────────────────────────────────

/**
 * Fully-hydrated plan ready for UI render. The fetch layer joins plans →
 * steps → edges → capabilities once; downstream code doesn't re-query.
 */
export interface HydratedAcquisitionPlan {
  plan: AcquisitionPlanRow;
  steps: Array<
    PlanStepRow & {
      capability: CapabilityRow;
      predicted_return: PredictedReturn;
      actual_return: ActualReturn | null;
    }
  >;
  edges: PlanStepEdgeRow[];
  /** Data needs this plan closes (joined for convenience). */
  closes: DataNeedRow[];
}

/**
 * Slim shape the ranker operates on. Strips heavy JSONB to keep scoring
 * loops cheap when enumerating many candidate plans.
 */
export interface PlanRankingInput {
  plan_id: string;
  expected_info_gain: number;
  expected_compound_success: number;
  expected_cost_user_minutes: number;
  expected_cost_money_usd: number;
  expected_calendar_latency_days: number;
  novelty_score: number;
  contains_perturbing_step: boolean;
  contains_one_shot_step: boolean;
}

// ── Runtime guards ──────────────────────────────────────────────────────

/**
 * Narrow a capability row's yields JSONB to the typed shape. Returns null
 * if malformed — callers decide whether to skip the capability or throw.
 */
export function parseCapabilityYields(raw: Json): CapabilityYields | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.attributes)) return null;
  if (typeof obj.response_shape !== "string") return null;
  return obj as unknown as CapabilityYields;
}

export function parsePreconditions(raw: Json): CapabilityPrecondition[] {
  if (!Array.isArray(raw)) return [];
  return raw as unknown as CapabilityPrecondition[];
}

export function parseSuccessPriors(raw: Json): CapabilitySuccessPriors {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as unknown as CapabilitySuccessPriors;
}

export function parsePredictedReturn(raw: Json): PredictedReturn | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.success_probability !== "number") return null;
  if (!Array.isArray(obj.expected_attributes)) return null;
  return obj as unknown as PredictedReturn;
}

export function parseActualReturn(raw: Json | null): ActualReturn | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.succeeded !== "boolean") return null;
  if (!obj.attributes || typeof obj.attributes !== "object") return null;
  return obj as unknown as ActualReturn;
}
