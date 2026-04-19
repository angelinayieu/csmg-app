// ── Execution Brief Types ──
// Transforms generic recommendations into rich, expandable execution briefs
// with research backing, multiple options, context-aware proposals, and execution steps.

// Quick synthesis snapshot — captured before deep pipeline overwrites
export interface QuickSynthesisSnapshot {
  leverage_point_ids: string[];
  risk_point_ids: string[];
  bottleneck_entity_id: string | null;
  action_count: number;
  captured_at: string;
}

// Perspective delta between quick and deep analysis
export interface PerspectiveDelta {
  insights_only_in_deep: DeltaInsight[];
  insights_contradicted: DeltaContradiction[];
  insights_strengthened: DeltaStrengthened[];
  deep_added_count: number;
  deep_removed_count: number;
  computed_at: string;
}

export interface DeltaInsight {
  type:
    | "leverage"
    | "risk"
    | "bottleneck"
    | "feedback_loop"
    | "connection"
    | "strategy";
  entity_id?: string;
  entity_name?: string;
  summary: string;
  source_agent: string;
}

export interface DeltaContradiction {
  quick_claim: string;
  deep_claim: string;
  entity_id?: string;
  entity_name?: string;
  resolution: string;
}

export interface DeltaStrengthened {
  entity_id: string;
  entity_name?: string;
  quick_confidence: string;
  deep_confidence: string;
  additional_evidence: string;
}

// Full execution brief for a recommendation
export interface ExecutionBrief {
  recommendation_id: string;
  recommendation_title: string;
  generated_at: string;

  research_backing: {
    evidence_sources: EvidenceSource[];
    causal_chain: string;
    confidence: "high" | "moderate" | "low";
  };

  alternative_approaches: AlternativeApproach[];

  context_detection?: ContextDetection;

  execution_steps: ExecutionStep[];

  test_lab?: TestLabResult;
}

export type ContextType =
  | "prompt"
  | "entity"
  | "strategy"
  | "research"
  | "process";

export interface ContextDetection {
  context_type: ContextType;
  detected_reference: string;
  current_state: string;
  proposed_changes: string;
  before_after?: { before: string; after: string };
  related_entity_ids: string[];
}

export interface AlternativeApproach {
  title: string;
  description: string;
  tradeoffs: { pro: string; con: string }[];
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  confidence: "high" | "moderate" | "low";
}

export interface EvidenceSource {
  type: "entity" | "edge" | "cycle" | "external" | "research" | "intersection";
  reference_id: string;
  reference_name: string;
  description: string;
  strength: "strong" | "moderate" | "weak";
}

export interface ExecutionStep {
  order: number;
  action: string;
  detail: string;
  entity_id?: string;
  depends_on: number[];
  estimated_effort: string;
  infrastructure_note?: string;
}

export interface TestLabResult {
  test_type:
    | "prompt_comparison"
    | "strategy_comparison"
    | "scenario_simulation";
  variants: TestVariant[];
  generated_at: string;
  preferred_variant_index?: number | null;
}

export interface TestVariant {
  label: string;
  description: string;
  sample_output: string;
  pros: string[];
  cons: string[];
  estimated_improvement: string;
  prompt_diff?: string;
  risk_assessment?: string;
  dependencies?: string[];
  timeline?: string;
}
