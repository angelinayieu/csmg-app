// Digital Twin state model
// Computed from existing Space + Entity + Edge + Cycle + SynthesisData
// Represents the current understanding of the user's analytical subject

import type { ImprovementGoal, GoalProgress, GoalRecommendation } from "./goals";

// ── Macro-level computed state ──

export interface TwinCoverage {
  entities_modeled: number;
  edges_mapped: number;
  cycles_detected: number;
  orphan_count: number;
  orphan_ratio: number; // orphans / entities
  open_questions: number;
  contradictions: number;
  confidence_distribution: {
    high: number;   // confidence >= 0.7
    medium: number; // 0.4 <= confidence < 0.7
    low: number;    // confidence < 0.4
  };
  source_distribution: {
    explicit: number;  // stated by user
    implicit: number;  // inferred by agents
    assumed: number;   // assumed, needs validation
  };
}

export interface TwinRiskExposure {
  total_risk_points: number;
  aggregate_blast_radius: number; // sum of all risk point blast_radius
  max_blast_radius: number;       // highest single risk
  critical_risks: number;         // risk points with blast_radius > 50% of entity count
  bottleneck_name: string | null;
  bottleneck_blast_radius: number;
  bottleneck_system_share: number; // blast_radius / entity_count as percentage

  // ── Tier 6: live deviation signal ───────────────────────────────
  // Computed from recent resolved predictions (optional param to
  // computeTwinState). Absent when the caller didn't pass predictions.
  // When present, the health-score computation bakes this in so the
  // twin breathes with reality instead of sitting frozen at synthesis time.
  /** Count of predictions resolved in the observation window. */
  recent_predictions_resolved?: number;
  /** Count tagged "surprise" or "regime_shift" in the same window. */
  recent_surprises?: number;
  /** Ratio = recent_surprises / recent_predictions_resolved, 0..1. */
  surprise_rate?: number;
}

export interface TwinDynamics {
  total_loops: number;
  reinforcing_positive: number;   // growth/compounding loops
  reinforcing_negative: number;   // vicious/degrading loops
  balancing: number;              // stabilizing loops
  leverage_points: number;
  top_leverage_name: string | null;
  scenarios_modeled: number;
}

export interface TwinMacroState {
  // Computed score 0-100
  health_score: number;
  health_label: "strong" | "developing" | "fragile" | "critical";

  // Sub-dimensions
  coverage: TwinCoverage;
  risk_exposure: TwinRiskExposure;
  dynamics: TwinDynamics;

  // From Space directly
  maturity: "actionable_now" | "waiting_on_dependency" | "theoretical" | "blocked";
  analysis_tier: string;
  last_updated: string;

  // Domain expertise available
  external_entities: number;
  worth_considering_count: number;
  cross_context_insights: number;
}

// ── Goal overlay (optional, layered on macro) ──

export interface TwinGoalOverlay {
  goal: ImprovementGoal;
  progress_pct: number;       // (current - baseline) / (target - baseline) * 100
  gap_remaining: number;      // target - current
  trajectory?: {
    estimated_weeks: number;
    confidence: "high" | "moderate" | "low";
    critical_path: string[];
  };
  top_recommendation: GoalRecommendation | null;
  recommendation_count: number;
}

// ── Change detection ──

export type ChangeMagnitude = "minor" | "moderate" | "significant";

export interface SynthesisDelta {
  /** Leverage points added/removed/changed */
  leverage_added: string[];
  leverage_removed: string[];

  /** Risk points added/removed */
  risk_added: string[];
  risk_removed: string[];

  /** Bottleneck shift */
  bottleneck_changed: boolean;
  bottleneck_old: string | null;
  bottleneck_new: string | null;

  /** Feedback loop changes */
  loops_added: string[];
  loops_removed: string[];

  /** Open questions resolved or new ones surfaced */
  questions_new: string[];
  questions_resolved: string[];

  /** Contradiction changes */
  contradictions_new: number;
  contradictions_resolved: number;

  /** Scenarios shifted */
  scenarios_changed: number;
}

export interface ChangeDetection {
  /** When this change was detected */
  detected_at: string;
  /** Overall magnitude of change */
  magnitude: ChangeMagnitude;
  /** Health score before → after */
  health_before: number;
  health_after: number;
  health_delta: number;
  /** What specifically changed in synthesis */
  synthesis_delta: SynthesisDelta;
  /** Human-readable summary */
  summary: string;
  /** Which objectives are affected */
  affected_objective_ids: string[];
  /** Whether objectives need re-evaluation */
  objectives_stale: boolean;
}

// ── Full twin state ──

export interface TwinState {
  macro: TwinMacroState;
  goal_overlay: TwinGoalOverlay | null;
}

// ── Proposed-vs-actual contract ──
//
// `ProposedTwinSpec` is a snapshot taken at the moment the user approves a twin
// proposal. It captures what the strategy CLAIMED would happen so that the
// materialized twin can be diffed against the promise later. Without this,
// the "1 new · 2 amplified · 1 baseline" pill on the workflow display reads
// from the latest strategy's infrastructure_map status — which is honest
// about what the strategy proposes, but loses the audit trail when the
// strategy is regenerated or partially materialized.

export type EntityIntentStatus =
  | "needs_building"
  | "needs_strengthening"
  | "exists";

export interface ProposedEntityIntent {
  entity_id: string;
  entity_name: string;
  intended_status: EntityIntentStatus;
  role: string;
  priority: "critical" | "important" | "supporting";
}

export interface ProposedChannelIntent {
  from: string;
  to: string;
  channel_type: string;
  strength_needed: "strong" | "moderate";
  /** Whether the strategy expected this channel to already exist at proposal time. */
  expected_at_proposal: boolean;
}

export interface ProposedLoopIntent {
  loop_name: string;
  activation_phase: string;
}

export interface ProposedAppIntent {
  proposal_id: string;
  name: string;
  type: string;
  optimization_target: string;
  metrics_tracked: string[];
}

export interface ProposedTwinSpec {
  /** Matches twin_proposals.generated_at. */
  proposed_at: string;
  source_strategy_version: number | null;
  /** Per-entity intent — what the strategy said about each entity. */
  entity_intents: ProposedEntityIntent[];
  channel_intents: ProposedChannelIntent[];
  loop_intents: ProposedLoopIntent[];
  app_intents: ProposedAppIntent[];
  /** Goal anchor at proposal time, if any. */
  goal_anchor: {
    macro: string;
    target_metric: string;
    current: string;
    target: string;
  } | null;
  /** Denormalized counts for fast diff rendering without re-walking the arrays. */
  promised_counts: {
    new_entities: number;
    strengthened_entities: number;
    existing_baseline: number;
    new_channels: number;
    activated_loops: number;
    total_apps: number;
  };
  /** Twin state at proposal time — the baseline against which the future-state delta is computed. */
  twin_state_at_proposal: {
    health_score: number;
    entities_modeled: number;
    edges_mapped: number;
    cycles_detected: number;
    total_loops: number;
    leverage_points: number;
    critical_risks: number;
  };
}

export type TwinProposalChipKind =
  | "as_proposed"   // promised X, got X — green
  | "amplified"     // got more than promised — blue
  | "baseline"      // existed before, unchanged — gray
  | "missing"       // promised but didn't materialize — amber
  | "extra";        // emerged that wasn't promised — purple

export interface TwinProposalChip {
  kind: TwinProposalChipKind;
  count: number;
  label: string;
  tooltip: string;
}

export interface TwinProposalDiff {
  /** Whether the materialized state broadly matches the proposal. */
  fidelity: "high" | "medium" | "low" | "no_proposal";
  /** Health-score delta since proposal time. Positive = improved. */
  health_delta: number;
  /** Chips for the strip renderer — sorted by display importance. */
  chips: TwinProposalChip[];
  /** Raw counts so callers can format alternative views. */
  counts: {
    promised_new: number;
    materialized_new: number;
    missing_new: number;
    extra_new: number;
    promised_strengthened: number;
    materialized_strengthened: number;
    baseline: number;
  };
}
