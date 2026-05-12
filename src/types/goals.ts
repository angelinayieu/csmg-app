// Goal system types — mirrors improvement_goals, goal_progress, goal_recommendations tables

// ── Objective benchmarks & evaluation criteria ──

export interface BenchmarkCriterion {
  /** What must be true for this objective to be considered successful */
  criterion: string;
  /** Specific measurable threshold (e.g., ">80%", "≤2 days", "3+ active channels") */
  threshold: string;
  /** How to measure or observe this */
  measurement: string;
  /** Priority classification */
  priority: "must_have" | "should_have" | "nice_to_have";
}

export interface LeadingIndicator {
  /** What to measure as an early signal */
  metric: string;
  /** Value/state that means "on track" */
  on_track: string;
  /** Value/state that means "at risk" */
  at_risk: string;
  /** Value/state that means "off track" */
  off_track: string;
  /** How often to check this indicator */
  check_frequency: "daily" | "weekly" | "biweekly" | "monthly";
}

export interface FailureSignal {
  /** Observable condition that suggests the objective may fail */
  signal: string;
  /** What to do if this signal fires */
  response: "investigate" | "adjust_target" | "pivot" | "abandon";
  /** How long to wait before this signal is actionable (e.g., "2 weeks", "3 data points") */
  deadline: string;
}

export interface ObjectiveMilestone {
  /** Milestone name */
  name: string;
  /** Target value or state to reach */
  target_value: string;
  /** When this should be achieved (relative, e.g., "week 2", "month 1", "25% through timeline") */
  expected_by: string;
}

export interface ObjectiveBenchmark {
  /** Success criteria — what "achieved" looks like, in measurable terms */
  success_criteria: BenchmarkCriterion[];
  /** Leading indicators — early signals that predict progress before the lagging metric moves */
  leading_indicators: LeadingIndicator[];
  /** Failure signals — pre-committed conditions for reconsidering this objective */
  failure_signals: FailureSignal[];
  /** Milestone checkpoints along the path to completion */
  milestones: ObjectiveMilestone[];
  /** Overall evaluation approach summary */
  evaluation_approach: string;
}

export type GoalStatus = "active" | "achieved" | "abandoned" | "paused";
export type ProgressSource = "manual" | "ai_estimated" | "integration";
export type RecommendationSourceType =
  | "leverage_point"
  | "action_item"
  | "risk_mitigation"
  | "ai_generated";
export type ImpactEstimate = "high" | "medium" | "low";
export type RecommendationStatus = "pending" | "in_progress" | "completed" | "dismissed";

// ── Objective types (auto-detected from synthesis) ──

export type ObjectiveType = "maximize" | "minimize" | "maintain" | "explore" | "avoid";

export type ObjectiveSourceType =
  | "leverage_point"
  | "risk_point"
  | "feedback_loop"
  | "scenario"
  | "open_question"
  | "bottleneck"
  | "external_insight"
  | "cross_context"
  | "worth_considering";

/**
 * Pre-acceptance proposal extracted from synthesis data.
 * Shown to the user for review — accepting converts it into an ImprovementGoal.
 */
export interface SuggestedObjective {
  /** Unique key for React lists — generated client-side or from synthesis */
  key: string;
  title: string;
  objective_type: ObjectiveType;
  description: string;
  metric_name: string;
  metric_unit: string | null;
  baseline_estimate: number | null;
  target_estimate: number | null;
  /** Evidence from user input or graph data justifying the baseline number */
  baseline_evidence?: string | null;
  /** Reasoning for why this specific target is appropriate for this user */
  target_evidence?: string | null;
  rationale: string;
  source_entity_id: string | null;
  source_type: ObjectiveSourceType;
  confidence: "high" | "moderate" | "low";
  priority: number; // 1 = highest
  /** When detected as a sub-objective of an existing goal */
  parent_goal_id?: string | null;
  /** External evidence supporting this objective (from domain research) */
  external_evidence?: {
    type: "validates" | "challenges" | "informs" | "precedent";
    source: string; // e.g., "Competitor X's growth pattern", "Porter's Five Forces"
    detail: string; // brief explanation of how external knowledge supports this
  } | null;

  // ── Deep Graph Reasoning Fields ──

  /**
   * How deep in the causal structure this objective lives:
   * - "surface": Directly maps to a single finding (leverage point → maximize)
   * - "structural": Emerges from pattern of connected findings
   * - "fundamental": Convergence point where multiple causal chains meet — the REAL underlying goal
   */
  depth?: "surface" | "structural" | "fundamental";

  /**
   * How many independent causal chains converge on this objective.
   * Higher = more fundamental. A score of 4+ means almost everything in the system
   * ultimately serves or blocks this objective.
   */
  convergence_score?: number;

  /**
   * The causal chain from surface findings to this objective.
   * Entity IDs tracing backward: [surface_entity, ..., this_objective_entity]
   */
  causal_chain?: string[];

  /**
   * Non-obvious benefits that pursuing this objective also creates.
   * Discovered by tracing forward through the graph from the objective's
   * intervention points and finding positive effects the user didn't intend.
   */
  side_benefits?: Array<{
    title: string;
    description: string;
    /** Entity this benefit flows through */
    entity_id?: string;
    /** If this side benefit connects to another detected objective */
    connected_objective_key?: string;
  }>;

  /**
   * The single highest-leverage intervention that propels progress toward this objective.
   * Not just "what to do" but "what one thing, if done, makes everything else easier."
   */
  propellant?: {
    entity_id: string;
    entity_name: string;
    action: string;
    why: string;
    /** How this propellant connects through the graph */
    mechanism: "clears_bottleneck" | "starts_loop" | "amplifies_leverage" | "removes_risk" | "creates_bridge";
  } | null;

  /**
   * Benchmarks & evaluation criteria — how to measure progress toward this objective.
   * Generated alongside the objective so that success is pre-defined, not retrofitted.
   */
  benchmark?: ObjectiveBenchmark;
}

export type GoalSource = "manual" | "auto_detected";

/**
 * Ultimate goal proposal — the single umbrella outcome that rolls up all
 * approved sub-objectives. Produced by `/api/goals/synthesize-ultimate` and
 * then shown to the user for review/edit before being persisted as the
 * parent `ImprovementGoal`.
 */
export interface UltimateGoalProposal {
  title: string;
  description: string;
  objective_type: ObjectiveType;
  metric_name: string;
  metric_unit: string | null;
  baseline_value: number;
  target_value: number;
  rationale: string;
  /** Keys of approved sub-objectives that become children of this ultimate goal. */
  child_keys: string[];
}

export interface ImprovementGoal {
  id: string;
  space_id: string;
  user_id: string;
  parent_goal_id: string | null;
  objective_type: ObjectiveType;
  source: GoalSource;
  title: string;
  description: string | null;
  metric_name: string;
  metric_unit: string | null;
  /**
   * Sprint W5.7b — FK to entities.id. The canonical DV (outcome) this
   * goal measures. Consumed by partition-variables-by-role (DV-set
   * construction for backdoor/mediator walks) and derive-app-variables
   * (per-app DV filter). NULL when the goal has not yet been anchored
   * to a graph entity — code paths null-guard and degrade to "all
   * dependents" / "empty DV set."
   */
  metric_entity_id: string | null;
  target_value: number;
  baseline_value: number;
  current_value: number;
  deadline: string | null;
  status: GoalStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Goal with its children resolved — used for tree rendering.
 * Not stored in DB, computed client-side from flat goal list.
 */
export interface GoalTreeNode extends ImprovementGoal {
  children: GoalTreeNode[];
}

export interface GoalProgress {
  id: string;
  goal_id: string;
  recorded_at: string;
  value: number;
  note: string | null;
  source: ProgressSource;
}

export type OutcomeVerdict = "effective" | "ineffective" | "partial" | "not_tested";

export interface GoalRecommendation {
  id: string;
  goal_id: string;
  rank: number;
  title: string;
  reasoning: string;
  source_type: RecommendationSourceType;
  source_entity_id: string | null;
  impact_estimate: ImpactEstimate | null;
  status: RecommendationStatus;
  outcome?: OutcomeVerdict | null;
  outcome_notes?: string | null;
  outcome_recorded_at?: string | null;
  created_at: string;
}
