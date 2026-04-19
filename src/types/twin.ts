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
