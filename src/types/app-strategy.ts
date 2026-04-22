// ── Per-app sub-strategy domain types (Tier 3) ─────────────────────────
//
// Backs two tables (migration 20260420_app_strategies.sql):
//   - app_strategies         — versioned per-app sub-strategies
//   - app_strategy_versions  — append-only change log
//
// What a sub-strategy IS:
//   A focused refinement of one global-strategy `infrastructure_proposal`,
//   expanded into actionable specs the app needs to do real work — what
//   to predict, validate, simulate, and how the per-app agents are
//   refined for this app's domain.
//
// What a sub-strategy is NOT:
//   - A replacement for the global strategy (it's a child of one)
//   - A UI manifest (lives in app.config.manifest, separate concern)
//   - A list of interventions (those live in the interventions table)
//   - An LLM transcript (the rationale fields are summaries, not raw output)

import type { Database, Json } from "./database.types";
import type { AgentSpec, MechanismHint } from "./strategy";

// ── Row aliases ─────────────────────────────────────────────────────────

export type AppStrategyRow = Database["public"]["Tables"]["app_strategies"]["Row"];
export type AppStrategyInsert = Database["public"]["Tables"]["app_strategies"]["Insert"];
export type AppStrategyUpdate = Database["public"]["Tables"]["app_strategies"]["Update"];

export type AppStrategyVersionRow = Database["public"]["Tables"]["app_strategy_versions"]["Row"];
export type AppStrategyVersionInsert = Database["public"]["Tables"]["app_strategy_versions"]["Insert"];

export type AppStrategyStatus = AppStrategyRow["status"];
export type AppStrategyChangeType = AppStrategyVersionRow["change_type"];

// ── Structured spec shape (the JSONB payload) ──────────────────────────

/**
 * The single "what is this app optimizing for" anchor. A sub-strategy can
 * inherit its parent objective wholesale OR narrow it (e.g. parent says
 * "reduce churn"; sub-strategy says "reduce churn for at-risk paid users
 * with <14d account age" — same direction, narrower scope).
 */
export interface AppFocusedObjective {
  /** Human-readable objective for THIS app, narrower than the parent goal. */
  metric: string;
  /** What the value is at sub-strategy generation time. */
  baseline: string | number | null;
  /** What the app should drive the metric toward. */
  target: string | number | null;
  /** Optional unit ("%", "bps", "users/week"). */
  unit?: string;
  /** Days from generation_at to evaluate progress. */
  horizon_days: number;
  /** 1-2 sentences: why this scope makes sense for this app specifically. */
  rationale: string;
}

/**
 * Prediction discipline for the app: which metrics to forecast, at what
 * default horizons + confidences, and what deviation thresholds matter
 * for THIS app (overrides the global tagDeviation defaults when set).
 *
 * Predictor agents read this when emitting `log_prediction` actions.
 */
export interface AppPredictionSpec {
  /**
   * Metrics this app's predictor agents should forecast. Each entry maps
   * to a metric_trackers row when one exists; otherwise the predictor
   * uses the label directly.
   */
  metrics_to_track: Array<{
    label: string;
    /** FK to metric_trackers when known. */
    tracker_id?: string;
    unit?: string;
    /** Per-metric horizon override (defaults to default_horizon_days). */
    horizon_days?: number;
    /** Why this metric matters for the app's focused_objective. */
    rationale: string;
  }>;
  /** Default horizon in days for predictions emitted by this app's agents. */
  default_horizon_days: number;
  /** Calibration baseline — predictors shouldn't exceed this without justification. */
  default_confidence: number;
  /**
   * Per-app deviation tagging overrides. NULL means "use the global
   * EXPECTED_RELATIVE / REGIME_SHIFT_RELATIVE thresholds from
   * src/types/prediction.ts." Apps with high-volatility metrics
   * (e.g. early-stage growth %) often need looser thresholds.
   */
  deviation_thresholds?: {
    expected_relative: number;
    regime_shift_relative: number;
  } | null;
  rationale: string;
}

/**
 * The hypothesis bank: experiments the app's validator agent can run.
 * Each hypothesis is a falsifiable claim with a metric + horizon. The
 * validator emits `start_experiment` from this bank and `end_experiment`
 * resolves it via the Item 4 action handlers.
 */
export interface AppValidationSpec {
  hypothesis_bank: Array<{
    /** Stable id within the spec — used to match user picks back to specs. */
    id: string;
    /** "If we do X, then metric Y will move by Z within horizon W." */
    statement: string;
    /** Which metric the experiment will resolve against. */
    metric_label: string;
    expected_direction: "increase" | "decrease" | "stable" | "either";
    /** Null when qualitative (resolved by validator agent text). */
    expected_magnitude?: number;
    /** Days from start_experiment to end_experiment. */
    horizon_days: number;
    /** Why this hypothesis matters — what it tests about the app's model of reality. */
    rationale: string;
  }>;
  /** Default horizon for ad-hoc experiments not in the bank. */
  experiment_horizon_days: number;
  /**
   * Sub-strategy success criteria — how the user knows the app's
   * validation work is paying off. Surfaces in app deliverables view.
   */
  success_criteria: string[];
  rationale: string;
}

/**
 * Simulation perturbation profiles — what scenarios make sense to run
 * for this app's domain. simulation_lab widget reads these as default
 * starting points (user can still ad-hoc).
 */
export interface AppSimulationSpec {
  perturbation_profiles: Array<{
    id: string;
    /** Human label for the simulation_lab dropdown. */
    label: string;
    /** Multiple metrics can move together in a single profile. */
    perturbations: Array<{
      metric_label: string;
      delta_pct: number;
      rationale?: string;
    }>;
    /** What the user should learn from running this scenario. */
    purpose: string;
  }>;
  /** Pre-canned scenarios the user can one-click run from the simulation_lab. */
  scenario_seeds: Array<{
    id: string;
    label: string;
    /** Reference into perturbation_profiles by id. */
    profile_id: string;
  }>;
  rationale: string;
}

/**
 * Per-agent overrides on top of the parent proposal's AgentSpec[]. When
 * a key matches an agent_id in the parent's agent_specs, those fields
 * REPLACE the parent's. When a key doesn't match, the override creates
 * a new ad-hoc agent role for this app only.
 *
 * Refinement examples:
 *   - measurer: tighten cadence from "weekly" to "daily" because this
 *     app's metric moves fast
 *   - predictor: change measurement_spec.compare_against from "baseline"
 *     to "prediction" because we now have enough history
 *   - critic: collaborates_with: ["predictor", "validator"] because the
 *     app has multi-agent traffic worth stress-testing
 */
export interface AppAgentRoleRefinement {
  /** Override the parent agent's responsibility text. */
  responsibility?: string;
  /** Override or augment measurement spec. */
  measurement_spec?: AgentSpec["measurement_spec"];
  /** Add new collaborators on top of the parent's list. */
  add_collaborators?: string[];
  /** 1-sentence: why this refinement was made. */
  rationale: string;
}

/**
 * Per-app learning loop — distinct from the global strategy's
 * StrategyLearningLoop, which describes the WHOLE strategy. This one
 * describes the app's local feedback discipline.
 */
export interface AppLearningLoop {
  leading_indicators: Array<{
    metric_label: string;
    /** What "on-track" looks like for THIS metric in THIS app. */
    green_reading: string;
    yellow_reading: string;
    red_reading: string;
    cadence: "daily" | "weekly" | "biweekly" | "monthly";
  }>;
  pivot_criteria: Array<{
    /** Observable signal that says "this app's strategy is wrong." */
    signal: string;
    /** What to do when the signal fires. */
    response:
      | "regenerate_substrategy"
      | "request_global_regen"
      | "archive_app"
      | "manual_review";
    rationale: string;
  }>;
  /** How often the agent loop should re-evaluate this app's sub-strategy. */
  review_cadence: "weekly" | "biweekly" | "monthly" | "on_deviation_only";
}

/**
 * When sub-strategy regen was triggered by the deviation pipeline (via
 * `escalate_to_research`), this records the surprise signals that
 * informed the new spec. Lets the next regen reason about whether the
 * incorporated signals actually fixed the prediction error.
 */
export interface DeviationHistory {
  incorporated_signals: Array<{
    prediction_id: string;
    metric_label: string;
    predicted_value: number | null;
    actual_value: number | null;
    deviation_tag: "expected" | "regime_shift" | "surprise" | "qualitative" | null;
    incorporated_at: string;
  }>;
}

/**
 * The full sub-strategy spec — the `spec` JSONB column.
 *
 * Sections are independently optional so partial generation (e.g.
 * "regenerate just the simulation_spec") is possible without invalidating
 * the whole row. The generator writes all five top sections by default.
 */
export interface AppStrategySpec {
  focused_objective: AppFocusedObjective;
  prediction_spec: AppPredictionSpec;
  validation_spec: AppValidationSpec;
  simulation_spec: AppSimulationSpec;
  agent_role_refinements?: Record<string, AppAgentRoleRefinement>;
  learning_loop: AppLearningLoop;
  deviation_history?: DeviationHistory;

  // ── Provenance & cross-references ─────────────────────────────────
  /** Which mechanism_hints from the parent proposal this spec covers. */
  mechanism_hints_covered: MechanismHint[];
  /**
   * Free-form 2-3 sentences: how this sub-strategy connects to its
   * parent strategy + what makes it specific to this app.
   */
  rationale: string;
}

// ── Quality summary (the `quality` JSONB column) ───────────────────────

export interface AppStrategyQuality {
  /** LLM self-reported confidence in the sub-strategy, 0-1. */
  confidence: number;
  /** Validator warnings — non-fatal issues caught at generation time. */
  issues: Array<{
    severity: "error" | "warning" | "info";
    field: string;
    message: string;
  }>;
  /**
   * Whether every section of the spec is present + non-empty. False when
   * the LLM bailed on a section (e.g. couldn't think of any meaningful
   * simulation perturbations for the app's domain).
   */
  is_complete: boolean;
}

// ── Domain wrappers ─────────────────────────────────────────────────────

/**
 * Domain shape with typed JSONB columns. Use `hydrateAppStrategy(row)`
 * at the DB → domain boundary.
 */
export interface AppStrategy
  extends Omit<AppStrategyRow, "spec" | "quality" | "parent_proposal_snapshot"> {
  spec: AppStrategySpec;
  quality: AppStrategyQuality;
  parent_proposal_snapshot: Record<string, unknown> | null;
}

// ── Narrowing helpers ──────────────────────────────────────────────────

function asObject<T>(v: Json | null | undefined, fallback: T): T {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fallback;
  return v as unknown as T;
}

export function hydrateAppStrategy(row: AppStrategyRow): AppStrategy {
  return {
    ...row,
    spec: asObject<AppStrategySpec>(row.spec, {
      focused_objective: {
        metric: "(unspecified)",
        baseline: null,
        target: null,
        horizon_days: 30,
        rationale: "(missing)",
      },
      prediction_spec: {
        metrics_to_track: [],
        default_horizon_days: 30,
        default_confidence: 0.6,
        rationale: "(missing)",
      },
      validation_spec: {
        hypothesis_bank: [],
        experiment_horizon_days: 14,
        success_criteria: [],
        rationale: "(missing)",
      },
      simulation_spec: {
        perturbation_profiles: [],
        scenario_seeds: [],
        rationale: "(missing)",
      },
      learning_loop: {
        leading_indicators: [],
        pivot_criteria: [],
        review_cadence: "monthly",
      },
      mechanism_hints_covered: [],
      rationale: "(no spec)",
    }),
    quality: asObject<AppStrategyQuality>(row.quality, {
      confidence: 0,
      issues: [],
      is_complete: false,
    }),
    parent_proposal_snapshot: asObject<Record<string, unknown> | null>(
      row.parent_proposal_snapshot,
      null,
    ),
  };
}
