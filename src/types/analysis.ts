// ── Intent capture types ──

export type UserRole =
  | "solo_founder" | "founding_team" | "investor" | "advisor"
  | "researcher" | "student" | "operator" | "executive";

export type PrimaryGoal =
  | "make_decision" | "understand_system" | "build_plan"
  | "evaluate_risk" | "explore_options" | "validate_assumptions";

export type ContextType =
  | "startup" | "research" | "career" | "strategy"
  | "operations" | "investment" | "education";

export interface UserIntent {
  user_role?: UserRole | null;
  primary_goal?: PrimaryGoal | null;
  context_type?: ContextType | null;
}

// Analysis phases for the state machine
export type AnalysisPhase =
  | "idle"
  | "streaming"
  | "structuring"
  | "synthesizing"
  | "complete"
  | "error";

// SSE event types from the API
export type SSEEventType = "delta" | "phase" | "complete" | "error";

// Keep backward compat alias
export type DecompositionPhase = AnalysisPhase;

// Pass 2 structured output schema
export interface StructuredDecomposition {
  metadata: {
    name: string;
    description: string;
    space_prefix: string;
    entity_count: number;
    edge_count: number;
    orphan_count: number;
    cycle_count: number;
    maturity:
      | "actionable_now"
      | "waiting_on_dependency"
      | "theoretical"
      | "blocked";
    activation_dependencies?: string[];
    synthesis_text: string;
  };
  entities: StructuredEntity[];
  edges: StructuredEdge[];
  cycles: StructuredCycle[];
  propositions: StructuredProposition[];
  novel_connections: StructuredNovelConnection[];
  contradictions: StructuredContradiction[];
  scenarios: StructuredScenario[];
  action_items: StructuredActionItem[];
  open_questions: {
    question: string;
    why_it_matters: string;
    what_would_change?: string;
    related_entity_ids?: string[];
  }[];
  leverage_points: {
    entity_id: string;
    summary?: string;
    reasoning?: string[];
    how_it_works?: string[];
    when_matters?: { situation: string; impact: string; intensity: string }[];
    action?: string | { primary: string; alternatives?: { when: string; approach: string; tradeoff: string }[] };
    connections?: string[];
    reason?: string;
    // D7 — mechanism_grounding: phenomenology + mechanism_explanation +
    // literature_grounding + evidence_strength + falsifiable_prediction.
    // See src/types/mechanism-grounding.ts. Optional during rollout —
    // pre-D7 synthesis runs lack the field; the synthesis prompt now
    // requires it for new runs.
    mechanism_grounding?: import("./mechanism-grounding").MechanismGrounding | null;
  }[];
  risk_points: {
    entity_id: string;
    blast_radius: number;
    summary?: string;
    reasoning?: string[];
    how_it_fails?: string[];
    when_matters?: { situation: string; impact: string; intensity: string }[];
    mitigation?: string | { primary: string; alternatives?: { when: string; approach: string; tradeoff: string }[] };
    connections?: string[];
    reason?: string;
    // D7 — mechanism_grounding using `failure_mechanism` instead of
    // `mechanism_explanation`. Same shape, semantic distinction.
    mechanism_grounding?: import("./mechanism-grounding").MechanismGrounding | null;
  }[];
  master_bottleneck: {
    entity_id: string;
    blast_radius: number;
    summary?: string;
    reasoning?: string[];
    when_matters?: { situation: string; impact: string; intensity: string }[];
    reason?: string;
    // D7 — same mechanism_grounding shape as leverage_points.
    mechanism_grounding?: import("./mechanism-grounding").MechanismGrounding | null;
  } | null;
  shared_variables: {
    entity_id: string;
    shared_variable_name: string;
    potential_bridge_spaces: string[];
  }[];
}

export interface StructuredEntity {
  entity_id: string;
  name: string;
  description: string;
  source_tag: "explicit" | "implicit" | "assumed";
  entity_type: string;
  entity_category:
    | "concrete"
    | "abstract"
    | "process"
    | "relational"
    | "epistemic"
    | "fault";
  layer: string | null;
  importance: "fundamental" | "critical" | "important" | "moderate";
  confidence: number;
  is_leverage_point: boolean;
  is_risk_point: boolean;
  is_master_bottleneck: boolean;
  blast_radius: number;
  centrality_rank: number | null;
  is_shared_variable: boolean;
  is_decomposable: boolean;
  knowledge_layer?: "internal" | "conceptual" | "external" | "bridge";
  authority_level?: "high" | "moderate" | "low" | "unverified";
  ambiguity_type?: "harmful" | "premature" | "strategic" | null;
  // Phase 8: Epistemic routing framework extensions
  epistemic_status?: import("./epistemic").EpistemicStatus;
  toulmin_role?: "claim" | "ground" | "warrant" | "backing" | "qualifier" | "rebuttal";
  marr_level?: import("./epistemic").MarrLevel;
  temporal_validity?: {
    valid_from?: string | null;
    valid_until?: string | null;
    decay_rate?: "none" | "slow" | "moderate" | "fast" | "immediate";
    temporal_scope?: string | null;
  } | null;
  manifold?: {
    strategic?: {
      alignment_to_goal?: "high" | "moderate" | "low" | "unknown";
      optionality_value?: "high" | "moderate" | "low";
      reversibility?: "easily_reversible" | "costly_to_reverse" | "irreversible";
    };
    operational?: {
      maturity?: "proven" | "experimental" | "theoretical" | "unknown";
      resource_intensity?: "high" | "moderate" | "low";
      dependency_count?: number;
      // ── D3 (docs/KG_DEPTH_CRITIQUE.md §9): controllability gradients ──
      // Lives under operational because cost / time-to-effect /
      // modulation are operational concerns. Reversibility echoes the
      // existing manifold.strategic.reversibility for ergonomic
      // single-branch reads. All optional; missing fields stay absent
      // rather than getting fabricated defaults — the LLM populates
      // what it actually knows.
      controllability?: import("./controllability").ControllabilityProfile;
    };
    epistemic?: {
      evidence_strength?: "empirical" | "theoretical" | "anecdotal" | "assumed";
      consensus_level?: "established" | "emerging" | "contested" | "unknown";
      falsifiability?: "testable" | "partially_testable" | "unfalsifiable";
    };
  } | null;
  // Phase 9: Entity enrichment — evidence chains + causal roles
  causal_role?: "truth" | "evidence" | "deliverable" | "application" | "outcome" | "goal";
  evidence_basis?: Array<{
    claim: string;
    claim_type: "mechanism" | "assertion" | "prediction" | "assumption" | "finding";
    confidence: number;
    reasoning: string;
  }> | null;
  // D1 (docs/KG_DEPTH_CRITIQUE.md): measurement spec. Required for
  // fundamental/critical entities in concrete/abstract/process
  // categories; null for relational/epistemic. The shape mirrors
  // src/types/measurement.ts MeasurementSpec.
  measurement?: import("./measurement").MeasurementSpec | null;
}

export interface StructuredEdge {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  dimension:
    | "structural"
    | "functional"
    | "temporal"
    | "causal"
    | "correlational"
    | "logical"
    | "epistemic"
    | "comparative"
    | "agentive";
  source_tag: "stated" | "inferred" | "predicted";
  strength: number;
  polarity: "positive" | "negative" | "neutral" | "conditional";
  confidence: number;
  conditions: string | null;
  is_tradeoff: boolean;
  resolved_by_entity_id: string | null;
  is_part_of_cycle: boolean;
  cycle_id: string | null;
  // Phase 8: Pearl's causal hierarchy classification
  pearl_level?: import("./epistemic").CausalDepth;
  dynamics?:
    | "threshold"
    | "linear"
    | "compounding"
    | "exponential"
    | "logarithmic"
    | "decay"
    | "step_function"
    | "delayed";
  dynamics_properties?: Record<string, unknown>;
  utility?: {
    failure_consequence?: "catastrophic" | "degrading" | "recoverable" | "negligible";
    propagation_speed?: "immediate" | "days" | "weeks" | "months" | "years";
    actionability?: "directly_controllable" | "indirectly_influenceable" | "observable_only" | "fixed_constraint";
    information_value?: "decision_critical" | "high" | "moderate" | "low";
    decision_question?: string;
  };
  knowledge_layer?: "internal" | "conceptual" | "external" | "bridge";
  requires_user_approval?: boolean;
  temporal_validity?: {
    valid_from?: string | null;
    valid_until?: string | null;
    decay_rate?: "none" | "slow" | "moderate" | "fast" | "immediate";
    temporal_scope?: string | null;
  } | null;
  // Set-theoretic topology — orthogonal to semantic relationship_type.
  // Optional; filled in by the LLM when obvious, otherwise derived from
  // relationship_type server-side. Enables cheap logical consistency checks.
  topology?:
    | "inside"
    | "overlap"
    | "meets"
    | "disjoint"
    | "composes"
    | "cover"
    | "equal"
    | null;
}

export interface StructuredCycle {
  cycle_id: string;
  name: string;
  classification:
    | "reinforcing_positive"
    | "reinforcing_negative"
    | "balancing";
  entity_ids: string[];
  intervention_point: string;
  intervention_description: string;
  description: string;
  growth_type?: "additive" | "multiplicative" | "accelerating" | "decelerating";
  cycle_time?: string;
  estimated_multiplier?: number;
}

export interface StructuredProposition {
  proposition_id: string;
  statement: string;
  proposition_type:
    | "certain"
    | "probable"
    | "possible"
    | "speculative"
    | "irreducible";
  confidence: number;
  depends_on: string[];
  entity_ids: string[];
}

export interface StructuredNovelConnection {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  strength: "strong" | "moderate" | "speculative";
  reasoning: string;
}

export interface StructuredContradiction {
  assumption_text: string;
  conclusion_text: string;
  severity: "critical" | "moderate" | "minor";
  description: string;
  // Optional: IDs of entities the contradiction implicates. When present, the
  // decompose route materializes the contradiction as a "fault" entity with
  // edges (relationship_type=contradicts, topology=disjoint) to these entities.
  involved_entity_ids?: string[];
}

export interface StructuredScenario {
  name: string;
  conditions: string;
  outcome_label: string;
  outcome_value: string;
  probability: "likely" | "possible" | "unlikely";
}

export interface StructuredActionItem {
  timeframe: "today" | "this_week" | "this_month" | "after_validation";
  path_label?: string;
  action_text: string;
  why_text?: string;
  derived_from_entity_id: string | null;
  tags?: { t: string; c: string }[];
}
