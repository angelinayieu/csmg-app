// ── Strategy batch (Tier 2) ─────────────────────────────────────────────
//
// A "batch" is the set of focused strategies generated in one refresh —
// one per active objective — that together cover the user's full
// objective hierarchy. Replaces the implicit "one strategy per space"
// model without breaking the existing single-strategy code paths.
//
// Storage shape: lives inside SynthesisData.strategy_batch. The legacy
// SynthesisData.strategic_recommendation field is kept as a backward-
// compat alias to strategy_batch.strategies[0] so every existing reader
// (UI view models, validators, app-generator pre-Tier-2) keeps working
// against rank 1.
//
// Per-strategy entry mirrors the legacy StrategicRecommendationData but
// adds the objective FK so apps generated from this strategy can carry
// the right serves_goal_id / serves_sub_objective_ids.

import type {
  StrategicRecommendation,
  RankedStrategy,
  StrategyChangeProposal,
  StrategyStatus,
} from "./strategy";

/**
 * One focused strategy targeting a single objective. Carries everything
 * the existing single-strategy reader expects, plus objective metadata
 * so downstream (apps, baselines, deviation feeds) can attribute output
 * to the right goal.
 */
export interface StrategyBatchEntry {
  // ── Objective scope ─────────────────────────────────────────────
  /** improvement_goals.id when source === "goal_hierarchy"; null for suggestion-sourced strategies */
  objective_id: string | null;
  /** Human label — "Reduce churn", "Expand to mid-market", etc. */
  objective_title: string;
  /** Where the objective came from at batch-generation time */
  objective_source: "goal_hierarchy" | "suggestion";
  /** Top-level goal this objective belongs to (equals objective_id for the root) */
  parent_goal_id: string | null;
  /** Stable ordering within the batch; 0 = primary */
  rank: number;
  is_primary: boolean;

  // ── Strategy content (mirrors StrategicRecommendationData) ──────
  recommendation: StrategicRecommendation;
  ranked_strategies?: RankedStrategy[];
  status: StrategyStatus;
  change_proposals?: StrategyChangeProposal[];
  /** ISO timestamp this entry was generated. */
  generated_at: string;
  /** When the user confirmed this specific strategy entry, if confirmed. */
  confirmed_at?: string;
  /** Quality score from validateRankedStrategies for this entry (0-100). */
  validation_score?: number;
  validation_issues_count?: number;
  /**
   * Optional reasoning trace + probability spaces, mirroring the legacy
   * StrategicRecommendationData fields. JSON-shape only — typed loosely
   * to avoid pulling reasoning types into this module.
   */
  reasoning_trace?: unknown;
  probability_space_summary?: unknown;
  probability_spaces?: unknown[];
  space_intersections?: unknown[];
}

/**
 * The full batch. One row in synthesis_data.strategy_batch.
 *
 * batch_id is a stable UUID so per-batch baselines / per-batch app
 * generation logs can correlate. Regenerating the batch produces a new
 * batch_id; the prior batch lives on as a strategy_snapshots row keyed
 * by version (existing audit trail unchanged).
 */
export interface StrategyBatch {
  batch_id: string;
  generated_at: string;
  /** Pipeline version that produced this batch — bump when shape changes. */
  pipeline_version: number;
  /** Where the objectives came from at generation time. */
  objective_source: "goal_hierarchy" | "suggestions" | "none";
  /** Total objectives the resolver found, before any cap was applied. */
  total_candidates: number;
  /** The actual fan-out — one entry per objective targeted in this batch. */
  strategies: StrategyBatchEntry[];
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Read the primary strategy entry from a batch (or null when empty).
 * Used by UI surfaces that don't yet support multi-strategy switching;
 * they get the rank-0 entry to preserve single-strategy behavior.
 */
export function primaryStrategy(batch: StrategyBatch | null | undefined): StrategyBatchEntry | null {
  if (!batch || batch.strategies.length === 0) return null;
  return batch.strategies.find((s) => s.is_primary) ?? batch.strategies[0];
}

/**
 * Find a specific entry by goal_id. Used by per-objective deliverables
 * grouping (Tier 2.5) and per-app strategy lookup (Tier 3).
 */
export function entryForGoal(
  batch: StrategyBatch | null | undefined,
  goalId: string | null | undefined,
): StrategyBatchEntry | null {
  if (!batch || !goalId) return null;
  return batch.strategies.find((s) => s.objective_id === goalId) ?? null;
}
