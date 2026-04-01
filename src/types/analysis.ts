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
  leverage_points: {
    entity_id: string;
    reason: string;
    action: string;
  }[];
  risk_points: {
    entity_id: string;
    blast_radius: number;
    reason: string;
    mitigation: string;
  }[];
  master_bottleneck: {
    entity_id: string;
    blast_radius: number;
    reason: string;
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
    | "epistemic";
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
  knowledge_layer?: "internal" | "external" | "bridge";
  authority_level?: "high" | "moderate" | "low" | "unverified";
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
  knowledge_layer?: "internal" | "external" | "bridge";
  requires_user_approval?: boolean;
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
