// ── Per-app agent runtime types (Tier 5) ───────────────────────────────
//
// Backs the app_agent_runs table (migration 20260421_app_agent_runs.sql).
// Distinct from the legacy public.agent_runs table which is used by the
// deep-research coordinator — this module only deals with the per-app
// predictor/measurer/validator/critic/reasoner agents declared in
// InfrastructureProposal.agent_specs (Item 1) and refined by sub-strategy
// agent_role_refinements (Tier 3).

import type { Database, Json } from "./database.types";
import type { AgentRoleKind } from "./strategy";

// ── Row aliases ────────────────────────────────────────────────────────

export type AppAgentRunRow = Database["public"]["Tables"]["app_agent_runs"]["Row"];
export type AppAgentRunInsert = Database["public"]["Tables"]["app_agent_runs"]["Insert"];
export type AppAgentRunUpdate = Database["public"]["Tables"]["app_agent_runs"]["Update"];

export type AppAgentRunStatus = AppAgentRunRow["status"];

// ── Output shapes (the `output` JSONB column) ──────────────────────────
//
// Each agent role produces a structurally different output. Kept as a
// discriminated union on a hypothetical `kind` field; in practice the
// output shape matches the row's agent_role, so the consumer already
// knows which variant to expect.

export interface PredictorOutput {
  kind: "predictor";
  /** FK into prediction_ledger for the prediction this run emitted. */
  prediction_id: string;
  /** The metric the prediction covers — denormalized for debugging. */
  metric_label: string;
  /** Days from run start to horizon — matches predictions_ledger.horizon_at diff. */
  horizon_days: number;
  /** Method used to produce the prediction (for provenance + future A/B). */
  method: "linear_extrapolation" | "last_value_hold" | "llm_forecast";
}

export interface MeasurerOutput {
  kind: "measurer";
  observation_id: string;
  tracker_id: string;
  value: number | null;
  value_text: string | null;
}

export interface ValidatorOutput {
  kind: "validator";
  /** Prediction that got resolved by this validator pass. */
  resolved_prediction_id: string;
  tag: "expected" | "regime_shift" | "surprise" | "qualitative";
}

export interface CriticOutput {
  kind: "critic";
  /** The agent_run this critic flagged. */
  flagged_agent_run_id: string;
  severity: "low" | "medium" | "high";
  reason: string;
}

export interface ReasonerOutput {
  kind: "reasoner";
  signal_ids: string[];
}

export type AgentRunOutput =
  | PredictorOutput
  | MeasurerOutput
  | ValidatorOutput
  | CriticOutput
  | ReasonerOutput;

// ── Domain wrapper ─────────────────────────────────────────────────────

export interface AppAgentRun extends Omit<AppAgentRunRow, "output"> {
  output: AgentRunOutput | null;
  /** Narrowed role — AgentRoleKind from strategy.ts, not the loose DB string. */
  agent_role: AgentRoleKind | string;
}

// ── Narrowing helpers ──────────────────────────────────────────────────

function asObject<T>(v: Json | null | undefined, fallback: T | null): T | null {
  if (!v) return fallback;
  if (typeof v !== "object" || Array.isArray(v)) return fallback;
  return v as unknown as T;
}

export function hydrateAppAgentRun(row: AppAgentRunRow): AppAgentRun {
  return {
    ...row,
    output: asObject<AgentRunOutput>(row.output, null),
  };
}
