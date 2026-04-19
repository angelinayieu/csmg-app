// Phase 7: Strategy Reasoning Types
// Multi-step strategy generation: diagnose → synthesize → verify

/**
 * Step 1 output: Structural diagnosis of the system.
 * Analyzes graph structure, probability spaces, and hidden signals
 * to identify the REAL problem (not surface symptoms).
 */
export interface StrategicDiagnosis {
  /** The real structural problem in 1-2 sentences */
  core_problem_statement: string;

  /** Insights from graph topology */
  graph_insights: {
    /** Highest-centrality entities that control information flow */
    hub_entities: Array<{
      entity_id: string;
      name: string;
      degree: number;
      betweenness: number;
      why_critical: string;
    }>;
    /** Edges that constrain the system — bottlenecks */
    bottleneck_edges: Array<{
      source: string;
      target: string;
      constraint: string;
    }>;
    /** Feedback loops with identified leverage points */
    critical_cycles: Array<{
      name: string;
      entity_ids: string[];
      leverage_point: string;
      type: "reinforcing" | "balancing";
    }>;
    /** Disconnected clusters that should be connected */
    isolated_clusters: string[];
  };

  /** Insights from probability space analysis */
  probability_insights: {
    /** Failure points with highest blast radius */
    high_risk_failure_points: Array<{
      edge_label: string;
      failure_mode: string;
      blast_radius: number;
      probability: number;
    }>;
    /** Critical paths with weak links */
    critical_path_weaknesses: Array<{
      path: string;
      weakest_link: string;
      probability: number;
    }>;
    /** Cross-space intersections that create novel opportunities */
    intersection_opportunities: Array<{
      shared_variable: string;
      spaces_involved: string[];
      innovation_potential: string;
      insight: string;
    }>;
  };

  /** Synthesis of hidden signals and intelligence */
  signal_synthesis: {
    /** Signals that converge on same implication */
    converging_signals: Array<{
      signals: string[];
      implication: string;
    }>;
    /** Signals that contradict each other */
    contradictory_signals: Array<{
      signal_a: string;
      signal_b: string;
      resolution: string;
    }>;
    /** Areas the user's analysis doesn't cover */
    blind_spots: string[];
  };

  confidence: number;
  /** Step-by-step reasoning that led to this diagnosis */
  reasoning_trace: string[];
}

/**
 * Step 2 output: Strategic options with reasoning.
 * Given diagnosis + external landscape + intersections,
 * generates 2-3 strategic options plus rejected alternatives.
 */
export interface StrategySynthesisResult {
  /** Viable strategic options (2-3) */
  options: Array<{
    title: string;
    strategic_posture: string;
    /** The core logic: why this works given the diagnosis */
    core_logic: string;
    /** Which probability space intersection this leverages (if any) */
    leverages_intersection?: string;
    /** How probability space data validates/challenges this option */
    probability_space_validation: string;
    estimated_confidence: number;
    /** What you give up by choosing this */
    key_tradeoff: string;
    reasoning_trace: string[];
  }>;
  /** Options that were considered and rejected */
  rejected_options: Array<{
    title: string;
    rejection_reason: string;
    /** Which failure mode from probability spaces killed this */
    failure_mode_exposed: string;
  }>;
}

/**
 * Step 3 output: Stress-test each option against reality.
 * Checks failure modes, assumptions, and policy coherence.
 */
export interface StrategyVerification {
  /** Per-option verification results */
  verifications: Array<{
    option_title: string;
    /** Failure modes from probability spaces that affect this strategy */
    failure_mode_exposure: Array<{
      mode: string;
      mitigation: string;
      residual_risk: string;
    }>;
    /** Assumptions that must hold for this strategy to work */
    critical_assumptions: Array<{
      assumption: string;
      probability: number;
      what_if_wrong: string;
    }>;
    /** Does this strategy cohere with its own guiding policy? */
    policy_coherence: {
      coherent: boolean;
      issues: string[];
    };
    /** Confidence after stress-testing (may differ from Step 2 estimate) */
    verified_confidence: number;
    reasoning_trace: string[];
  }>;
  /** Final ranking after verification (may reorder from Step 2) */
  final_ranking: Array<{
    title: string;
    rank: number;
    adjustment_reason: string;
  }>;
}

/**
 * Complete reasoning trace wrapping all 3 steps + timing.
 * Stored in synthesis_data.strategic_recommendation.reasoning_trace
 */
export interface StrategyReasoningTrace {
  diagnosis: StrategicDiagnosis;
  synthesis: StrategySynthesisResult;
  verification: StrategyVerification;
  total_duration_ms: number;
  step_timings: {
    diagnosis_ms: number;
    synthesis_ms: number;
    verification_ms: number;
    /** Bottom-up layer generation (L4→L3→L2→L1) */
    layer_generation_ms?: number;
    final_ms: number;
  };
}

/**
 * Summary of probability space data that fed into strategy.
 */
export interface ProbabilitySpaceSummary {
  spaces_analyzed: number;
  intersections_found: number;
  high_risk_points: number;
  key_insights: string[];
}
