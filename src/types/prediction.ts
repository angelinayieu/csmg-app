// Domain types for baseline snapshots + the prediction ledger.
//
// Backs two tables (migration 20260508_baseline_prediction_ledger.sql):
//   - strategy_baselines — one row per strategy_snapshot, immutable T0 state
//   - prediction_ledger  — append-only ledger of forecasts that later get
//                          resolved against actuals to produce deviation
//                          signals (highest-value training data we have)
//
// The JSONB columns in those tables (kg_snapshot, twin_state,
// metric_baselines, predicted_outcomes, predicted_distribution) are
// structured — their shape is owned by this file. The DB layer treats them
// as Json and the capture/resolve functions validate at the boundary.

import type { Database, Json } from "./database.types";
import type { TwinState } from "./twin";

// ── Row aliases ─────────────────────────────────────────────────────────

export type StrategyBaselineRow = Database["public"]["Tables"]["strategy_baselines"]["Row"];
export type StrategyBaselineInsert = Database["public"]["Tables"]["strategy_baselines"]["Insert"];

export type PredictionLedgerRow = Database["public"]["Tables"]["prediction_ledger"]["Row"];
export type PredictionLedgerInsert = Database["public"]["Tables"]["prediction_ledger"]["Insert"];
export type PredictionLedgerUpdate = Database["public"]["Tables"]["prediction_ledger"]["Update"];

export type PredictionStatus = PredictionLedgerRow["status"];
export type DeviationTag = NonNullable<PredictionLedgerRow["deviation_tag"]>;

/**
 * Discriminant on prediction_ledger rows (migration 20260518). Kept here
 * rather than derived from the row type so code can reference it without
 * DB-types regen for seeded developers.
 *
 *   "metric"        — legacy path, forecast of a metric_tracker value
 *   "step_outcome"  — forecast of a plan_step actual_return (capability
 *                     registry era)
 *   "action_return" — reserved: direct capability invocation outside a
 *                     plan (e.g. an app-initiated one-off action). Not
 *                     emitted today.
 */
export type PredictionSubjectKind = "metric" | "step_outcome" | "action_return";

// ── Structured JSONB shapes for strategy_baselines ──────────────────────

/**
 * Knowledge-graph metrics at T0. Cheap to compute from the entities/edges/
 * cycles arrays already in hand during strategy generation. Enough to
 * answer "has the graph grown since this strategy was written?" without
 * re-running the full twin computation.
 */
export interface KgSnapshot {
  entity_count: number;
  edge_count: number;
  cycle_count: number;
  /** Count of bridge edges (single points of failure in graph terms). */
  bridge_count: number;
  /** Fraction of entities with zero edges (0..1). */
  orphan_ratio: number;
  /** Mean confidence across entities (0..1). */
  avg_confidence: number;
  /** TwinState.health_score at capture time — redundant with twin_state but convenient. */
  health_score: number;
}

/**
 * One baseline entry per tracked metric. Prefer tracker_id when an
 * existing metric_tracker row matches; otherwise the strategy text is the
 * only source of truth and we record that via captured_from.
 */
export interface MetricBaseline {
  /** FK to metric_trackers.id when a tracker row exists. */
  tracker_id?: string;
  /** Human label — always set, matches metric_trackers.label when tracker_id is present. */
  label: string;
  /** Numeric value at T0, when quantitative. */
  value?: number;
  /** Qualitative baseline, when value is a description ("high churn rate"). */
  value_text?: string;
  unit?: string;
  source_kind:
    | "goal"
    | "target_objective"
    | "perspective_key_metric"
    | "micro_tactic_metric"
    | "leading_indicator"
    | "lagging_indicator";
  /**
   * "tracker"       — pulled current_value from metric_trackers
   * "strategy_text" — tracker absent; parsed from strategy.perspectives[].key_metric.current etc.
   * "manual"        — user-supplied override at capture time
   */
  captured_from: "tracker" | "strategy_text" | "manual";
}

/**
 * A forecast derived from the strategy structure at capture time, used to
 * both (a) seed prediction_ledger rows and (b) preserve the strategy's
 * own expectations denormalized on the baseline row. An agent-emitted
 * prediction is not represented here — it goes straight into the ledger.
 */
export interface PredictedOutcome {
  metric_label: string;
  /**
   * ISO timestamp of when this prediction should be evaluated. Derived from
   * the micro_tactic/perspective timeframe ("now" | "short_term" | etc.)
   * via a horizon table in capture-baseline.ts.
   */
  horizon_at: string;
  predicted_value?: number;
  predicted_text?: string;
  unit?: string;
  /** 0..1 — cascaded from StrategicRecommendation.confidence / perspective.confidence. */
  confidence: number;
  rationale: string;
  /**
   * Where in the strategy this prediction came from — used for both audit
   * and for downstream widgets that filter by origin.
   */
  source:
    | "target_objective"
    | "perspective_key_metric"
    | "micro_tactic_metric"
    | "leading_indicator"
    | "lagging_indicator";
  /** Originating element id when stable (e.g. micro_tactic.id, perspective.id). */
  source_id?: string;
}

// ── Structured JSONB shapes for prediction_ledger ───────────────────────

/**
 * Optional calibrated-uncertainty envelope an agent may emit alongside a
 * point prediction. Keeps the table schema lean — most predictions will
 * be point-only — while letting predictor agents write distributions
 * when they have them.
 */
export interface PredictionDistribution {
  p10?: number;
  p50?: number;
  p90?: number;
  /** Free-form tag for the distribution family (e.g. "normal", "lognormal"). */
  family?: string;
  /** Standard deviation, when the predictor can emit one. */
  stddev?: number;
}

// ── Domain wrappers ─────────────────────────────────────────────────────

/**
 * Domain-shaped baseline record with JSONB columns typed instead of raw
 * Json. Use `hydrateBaseline(row)` to cross the DB → domain boundary.
 */
export interface StrategyBaseline
  extends Omit<StrategyBaselineRow, "kg_snapshot" | "twin_state" | "metric_baselines" | "predicted_outcomes"> {
  kg_snapshot: KgSnapshot;
  twin_state: TwinState;
  metric_baselines: MetricBaseline[];
  predicted_outcomes: PredictedOutcome[];
}

/**
 * Domain-shaped prediction with typed distribution. All other fields map
 * 1:1 to the row.
 */
export interface Prediction
  extends Omit<PredictionLedgerRow, "predicted_distribution"> {
  predicted_distribution: PredictionDistribution | null;
}

// ── Narrowing helpers (DB Json → typed) ─────────────────────────────────

function asObject<T>(v: Json | null | undefined, fallback: T): T {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fallback;
  return v as unknown as T;
}

function asArray<T>(v: Json | null | undefined): T[] {
  return Array.isArray(v) ? (v as unknown as T[]) : [];
}

export function hydrateBaseline(row: StrategyBaselineRow): StrategyBaseline {
  return {
    ...row,
    kg_snapshot: asObject<KgSnapshot>(row.kg_snapshot, {
      entity_count: 0,
      edge_count: 0,
      cycle_count: 0,
      bridge_count: 0,
      orphan_ratio: 0,
      avg_confidence: 0,
      health_score: 0,
    }),
    twin_state: asObject<TwinState>(row.twin_state, {} as TwinState),
    metric_baselines: asArray<MetricBaseline>(row.metric_baselines),
    predicted_outcomes: asArray<PredictedOutcome>(row.predicted_outcomes),
  };
}

export function hydratePrediction(row: PredictionLedgerRow): Prediction {
  return {
    ...row,
    predicted_distribution: row.predicted_distribution
      ? (asObject<PredictionDistribution>(row.predicted_distribution, {}))
      : null,
  };
}

// ── Deviation tagging thresholds ────────────────────────────────────────

/**
 * Shared with resolve-predictions.ts — centralized so the resolver and any
 * future UI filter agree on what "surprise" means.
 *
 * Given predicted P and actual A, where |P| > 0:
 *   rel = |A - P| / |P|
 *   sign_flip = sign(A) !== sign(P)   (only relevant when both nonzero)
 *
 *   rel <= EXPECTED_RELATIVE           → "expected"
 *   rel <= REGIME_SHIFT_RELATIVE       → "regime_shift" (but: if sign_flip → "surprise")
 *   rel >  REGIME_SHIFT_RELATIVE       → "surprise"
 *
 * Zero-predicted edge case: if P == 0 and A != 0, classify "surprise" (can't
 * normalize). P == 0 and A == 0 → "expected".
 *
 * Qualitative predictions (predicted_value_text only) are tagged "qualitative"
 * and bypass this math.
 */
export const EXPECTED_RELATIVE = 0.1;    // within +/-10%
export const REGIME_SHIFT_RELATIVE = 0.5; // within +/-50% and same sign

export function tagDeviation(predicted: number, actual: number): DeviationTag {
  if (predicted === 0 && actual === 0) return "expected";
  if (predicted === 0 && actual !== 0) return "surprise";
  const rel = Math.abs(actual - predicted) / Math.abs(predicted);
  const sameSign = predicted === 0 || actual === 0 || Math.sign(predicted) === Math.sign(actual);
  if (rel <= EXPECTED_RELATIVE) return "expected";
  if (rel <= REGIME_SHIFT_RELATIVE && sameSign) return "regime_shift";
  return "surprise";
}

// ── Step-outcome prediction helpers (migration 20260518) ────────────────

/**
 * Narrow a prediction_ledger row to the step-outcome variant. Returns null
 * if subject_kind is "metric" or if plan_step_id is missing (shouldn't
 * happen after migration 20260518's trigger, but we guard anyway so stale
 * clients don't throw).
 */
export interface StepOutcomePrediction extends PredictionLedgerRow {
  subject_kind: "step_outcome";
  plan_step_id: string;
  capability_id: string | null;
}

export function asStepOutcomePrediction(
  row: PredictionLedgerRow & { subject_kind?: string | null; plan_step_id?: string | null; capability_id?: string | null }
): StepOutcomePrediction | null {
  if (row.subject_kind !== "step_outcome") return null;
  if (!row.plan_step_id) return null;
  return row as StepOutcomePrediction;
}

/**
 * Deviation tag for step outcomes. Same math as tagDeviation when the
 * actual value is numeric, but adds "failed" when the capability did not
 * run at all (succeeded=false on the actual_return) — that's qualitatively
 * different from "ran but surprised us" and the learning loop treats it
 * differently (failed invocations don't update yield_priors, only
 * success_priors).
 *
 * Inputs:
 *   invocation_succeeded — did the capability call complete at all?
 *   predicted/actual     — when numeric comparison is possible. May be
 *                          null for qualitative attributes (enums, text).
 */
export type StepDeviationTag = DeviationTag | "failed";

export function tagStepDeviation(
  invocation_succeeded: boolean,
  predicted: number | null,
  actual: number | null
): StepDeviationTag {
  if (!invocation_succeeded) return "failed";
  if (predicted === null || actual === null) return "qualitative";
  return tagDeviation(predicted, actual);
}
