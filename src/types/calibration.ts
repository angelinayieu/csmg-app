// ── Reality-calibration types (Gap B stage) ─────────────────────────────
//
// Before the lab is allowed to simulate a PROPOSAL, we have to
// demonstrate the KG can reproduce the user's CURRENT reality. Claims
// the model can't back-calculate aren't calibration failures in a
// philosophical sense — they're bugs in the KG. Proposal predictions
// built on top of a KG that can't reproduce today's numbers are
// unverified castles.
//
// This module locks the persisted shapes before the stage is wired.
// Types land first so:
//   - the UI (CalibrationStatusStrip) has a concrete object to consume
//   - the agent prompt has a known JSON schema to emit
//   - the stage orchestrator has a stable storage contract
//
// Persistence target: one row per (space_id, strategy_baseline_id) in
// `reality_calibrations`. The row carries the summary + per-baseline
// ReproductionAttempt[]. See supabase/migrations/20260425_reality_calibration.sql.

import type { MetricBaseline } from "./prediction";
import type { CalibrationStatus } from "./simulation-mode";

// ── One baseline's reproduction attempt ────────────────────────────────

export interface ReproductionAttempt {
  /**
   * Which baseline this attempt is trying to reproduce. Carries the full
   * MetricBaseline (not just the id) because baselines can also live
   * only in strategy text and don't always have tracker_id to FK against.
   */
  baseline: MetricBaseline;

  /**
   * The KG's computed reproduction of this baseline. When reproducible
   * as a number, `computed_value` populates; when the graph only
   * supports a qualitative claim ("high"), `computed_value_text` carries
   * the qualitative match.
   */
  computed_value?: number;
  computed_value_text?: string;

  /**
   * Absolute relative error when both sides are numeric:
   *   |computed - stated| / max(|stated|, 1)
   * Undefined when either side is qualitative-only.
   */
  relative_error?: number;

  /**
   * Does the KG reproduce this baseline within tolerance?
   *   - reproduced: relative_error <= tolerance (or qualitative match)
   *   - off:        relative_error > tolerance
   *   - unverifiable: KG lacks enough structure to attempt reproduction
   *                   (missing edges / cycles / parameters on the
   *                   reachable subgraph). NOT a calibration failure per
   *                   se — but surfaces the same "we need more info
   *                   from you" UX.
   */
  verdict: "reproduced" | "off" | "unverifiable";

  /**
   * Tolerance applied to this baseline. Default 0.10 (10%) for metrics;
   * the agent may tighten it (e.g. for money-denominated baselines) or
   * loosen it (e.g. for high-variance engagement metrics).
   */
  tolerance: number;

  /**
   * One-sentence explanation from the agent: which edges / cycles /
   * parameters were traversed to produce `computed_value`. Primary
   * provenance anchor for the review-gaps drawer — when a baseline
   * fails, this rationale tells the user *why* the KG disagreed.
   */
  rationale: string;

  /**
   * Entities the user would need more information on (parameter values,
   * additional edges, missing relations) to close this gap. When
   * verdict === "unverifiable" this is the PRIMARY actionable output.
   * When verdict === "off" it's the list of nodes whose parameters are
   * most likely wrong. Empty array when verdict === "reproduced".
   */
  blocker_entity_ids: string[];

  /**
   * Provenance of the verdict — how was this baseline actually checked?
   *
   *   "numerical_recompute" — deterministic comparison of two numbers.
   *     For baselines with a `tracker_id`, the tracker's current_value
   *     (or latest metric_observations row) was compared to
   *     baseline.value within tolerance. For value-bearing baselines
   *     without a tracker, a matching entity parameter in the subgraph
   *     was compared. NO LLM involvement in the verdict.
   *
   *   "llm_audit" — the calibration agent read the subgraph + baseline
   *     and asserted whether the graph reproduces the baseline. Used
   *     when (a) the baseline is qualitative (value_text only, no
   *     numeric), or (b) no tracker + no matching parameter could be
   *     found for a numeric baseline. The verdict reflects LLM
   *     judgment, not numerical reconciliation — honest Tier 1.
   *
   * Optional so pre-migration rows in `reality_calibrations.attempts`
   * keep replaying; consumers default to "llm_audit" (the conservative
   * assumption) when absent.
   */
  verdict_provenance?: "numerical_recompute" | "llm_audit";
}

// ── Full calibration record for a space ─────────────────────────────────

export interface RealityCalibration {
  /** FK to strategy_baselines.id — calibration is re-run each time the baseline is re-captured. */
  strategy_baseline_id: string;
  /** Denormalized for convenience; read from the parent baseline row. */
  space_id: string;

  status: CalibrationStatus;
  reproduced_count: number;
  total_count: number;

  attempts: ReproductionAttempt[];

  /**
   * Aggregate calibration score across ALL attempts:
   *   1.0 when everything reproduces.
   *   Mean of per-attempt scores (1.0 reproduced / 0.5 unverifiable /
   *   0.0 off) otherwise. UI renders this as a ring/gauge in the
   *   "review gaps" drawer; strategy synthesis can gate on it.
   */
  aggregate_score: number;

  /**
   * Set when the user clicked "run anyway" past a failing gate. The
   * CalibrationStatusStrip renders dashed-amber in this state so the
   * warning never fully disappears. Nulled when a fresh calibration
   * comes in that flips the gate to `calibrated`.
   */
  bypassed_at?: string;
  bypassed_by?: string; // user id

  /**
   * Which agent version produced this record. Bump on prompt changes
   * so downstream consumers can invalidate cached summaries when the
   * contract shifts.
   */
  agent_version: number;
  computed_at: string;
}

// ── Agent input + output shapes ─────────────────────────────────────────
//
// Two sides of the calibration contract:
//   - Input:  the subset of the KG the agent is allowed to see +
//             the baselines it's being asked to reproduce. We don't
//             feed the entire graph; the agent sees only entities
//             reachable from the metric tracker / baseline entity.
//   - Output: a strict JSON object matching `CalibrationAgentResponse`.

export interface CalibrationAgentInput {
  space_id: string;
  baselines: MetricBaseline[];
  /**
   * Subgraph the agent walks. Entities carry parameters (numeric
   * properties) + description; edges carry strength/polarity/direction.
   * Pre-filtered by `loadCalibrationContext` to the baseline-relevant
   * neighborhood — typically 2-hop around any tracker entity.
   */
  subgraph: {
    entities: Array<{
      entity_id: string;
      name: string;
      description: string | null;
      entity_category: string | null;
      parameters: Record<string, number | string | null>;
    }>;
    edges: Array<{
      source_entity_id: string;
      target_entity_id: string;
      relationship_type: string;
      dimension: string;
      polarity: string | null;
      strength: number | null;
    }>;
  };
}

export interface CalibrationAgentResponse {
  attempts: Array<
    Pick<
      ReproductionAttempt,
      | "computed_value"
      | "computed_value_text"
      | "relative_error"
      | "verdict"
      | "tolerance"
      | "rationale"
      | "blocker_entity_ids"
    > & { baseline_label: string } // agent returns by label, orchestrator re-joins to MetricBaseline
  >;
}

// ── Aggregation helper ──────────────────────────────────────────────────

export function aggregateCalibration(
  attempts: ReproductionAttempt[],
): Pick<
  RealityCalibration,
  "status" | "reproduced_count" | "total_count" | "aggregate_score"
> {
  const total = attempts.length;
  if (total === 0) {
    return {
      status: "unknown",
      reproduced_count: 0,
      total_count: 0,
      aggregate_score: 1.0, // vacuously calibrated; UI reads total === 0 as unknown
    };
  }
  const reproduced = attempts.filter((a) => a.verdict === "reproduced").length;
  const off = attempts.filter((a) => a.verdict === "off").length;
  const unverifiable = attempts.filter((a) => a.verdict === "unverifiable").length;
  // unverifiable counts as half-credit: not a model error, but not calibrated either
  const score = (reproduced * 1 + unverifiable * 0.5) / total;
  let status: CalibrationStatus;
  if (reproduced === total) status = "calibrated";
  else if (reproduced === 0 && off > 0) status = "uncalibrated";
  else status = "partial";
  return {
    status,
    reproduced_count: reproduced,
    total_count: total,
    aggregate_score: score,
  };
}
