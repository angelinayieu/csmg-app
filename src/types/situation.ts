// ── Situation baseline types ─────────────────────────────────────────
//
// The user's CURRENT-state snapshot, derived by the situation analyzer
// from intake_text + uploaded assets + data_presence tags. Acts as the
// canvas's "here's where you are today" anchor before any landscape
// generation or proposal forks happen.
//
// Persisted to spaces.situation_baseline. Schema-stable across the
// pipeline; updates are full-document upserts (no patch operations).
//
// Branching: only populated when twin_mode is "observational" or
// "simulation" — i.e., the user gave us enough data to model their
// reality. Vague inputs (twin_mode = "structural") skip this layer
// entirely and the column stays null. The frame-extractor downstream
// reads situation_baseline.uncertainty_score to decide whether to
// open more axes (fill more gaps) or fewer (focused on what's known).
//
// See supabase/migrations/20260605_assets_and_situation_baseline.sql.

/**
 * One input the user has identified — a resource, constraint, or
 * upstream signal feeding into their process. value is free-form
 * (could be a number, label, or short phrase); unit is optional and
 * mostly used for numeric values.
 */
export interface SituationInput {
  name: string;
  value: string | number;
  unit?: string;
}

/**
 * The user's described workflow — what happens between inputs and
 * outputs. steps is a short ordered list (target 3-7 lines); constraints
 * are hard limits / boundary conditions the LLM identifies.
 */
export interface SituationProcess {
  steps: string[];
  constraints: string[];
}

/**
 * One observed or target metric on the output side. Always carries
 * unit + numeric value when possible — the gap math below depends on
 * having two comparable readings.
 */
export interface SituationMetric {
  metric: string;
  value: number;
  unit: string;
}

/**
 * Computed delta between current and target for a metric. direction
 * is the user's intended movement ("up" = increase target, "down" =
 * decrease target). delta is signed in the user's intended direction
 * (positive = more progress needed).
 */
export interface SituationGap {
  metric: string;
  delta: number;
  direction: "up" | "down";
}

export interface SituationOutputs {
  current: SituationMetric[];
  target: SituationMetric[];
  gap: SituationGap[];
}

export type SituationSkippedReason =
  | "twin_mode_structural"
  | "no_assets_no_richness"
  | "analyzer_failed";

export interface SituationBaseline {
  /** Resources / inputs feeding into the user's process. */
  inputs: SituationInput[];
  /** The user's process / workflow. */
  process: SituationProcess;
  /** Current observations + targets + gap math. */
  outputs: SituationOutputs;
  /** Facts the user explicitly stated or assets contained. Short
   *  declarative sentences; LLM-extracted. */
  knowns: string[];
  /** Questions the user raised + LLM-detected gaps in the data the
   *  user provided. Drives the research planner downstream. */
  unknowns: string[];
  /** 0..1. Higher = bigger gap between what's known vs needed.
   *  Drives downstream branching: high uncertainty triggers more
   *  axes / deeper research. */
  uncertainty_score: number;
  /** ISO-8601 when the analyzer wrote this row. */
  analyzed_at: string;
  /** Set when the analyzer ran but didn't build a meaningful baseline.
   *  Null on successful analyses. */
  skipped_reason: SituationSkippedReason | null;
}

/**
 * Subset of the baseline used by the canvas situation-card shape and
 * the analyzer's "is the baseline thin?" check. Keeps the prop schema
 * compact (counts only) so the shape stays performant.
 */
export interface SituationBaselineSummary {
  inputs_count: number;
  process_steps_count: number;
  outputs_current_count: number;
  outputs_target_count: number;
  knowns_count: number;
  unknowns_count: number;
  uncertainty_score: number;
}

export function summarizeBaseline(b: SituationBaseline): SituationBaselineSummary {
  return {
    inputs_count: b.inputs.length,
    process_steps_count: b.process.steps.length,
    outputs_current_count: b.outputs.current.length,
    outputs_target_count: b.outputs.target.length,
    knowns_count: b.knowns.length,
    unknowns_count: b.unknowns.length,
    uncertainty_score: b.uncertainty_score,
  };
}
