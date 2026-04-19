// ── Epistemic Routing Layer Types ──
// Phase 8: Input classification + framework-conditioned analysis

// ── Input Classification ──

export type InputType =
  | "research_paper"
  | "business_problem"
  | "technical_spec"
  | "question"
  | "argument"
  | "narrative"
  | "data_analysis"
  | "strategic_plan"
  | "creative_brief"
  | "hybrid";

export type CynefinDomain =
  | "simple"
  | "complicated"
  | "complex"
  | "chaotic"
  | "disorder";

export type CausalDepth =
  | "association"
  | "intervention"
  | "counterfactual";

export type MarrLevel =
  | "computational"
  | "algorithmic"
  | "implementational";

export type EpistemicLandscape =
  | "mostly_observed"
  | "mostly_inferred"
  | "mostly_theorized"
  | "mixed";

export type EpistemicStatus =
  | "observed"
  | "inferred"
  | "theorized"
  | "speculated"
  | "contested";

// ── Toulmin Argument Structure ──

export interface ToulminStructure {
  has_argument: boolean;
  claim_count: number;
  primary_claim?: string;
  evidence_quality: "strong" | "moderate" | "weak" | "absent";
  warrant_explicit: boolean;
  qualifier_present: boolean;
  rebuttal_present: boolean;
}

// ── Preliminary Objectives (pre-decomposition) ──

export interface PreliminaryObjective {
  title: string;
  objective_type:
    | "maximize"
    | "minimize"
    | "maintain"
    | "explore"
    | "avoid"
    | "validate"
    | "build"
    | "defend";
  rationale: string;
  confidence: "high" | "moderate" | "low";
  input_type_basis: string;
}

// ── Decomposition Routing Decisions ──

export interface DecompositionStrategy {
  use_toulmin_layer: boolean;
  use_pearl_causal_layer: boolean;
  use_marr_decomposition: boolean;
  cynefin_guidance: string;
  entity_emphasis: string[];
  edge_emphasis: string[];
  expected_evidence_density: "high" | "moderate" | "low";
  expected_actionability: "high" | "moderate" | "low";
  expected_specificity: "high" | "moderate" | "low";
}

// ── Master Classification Result ──

export interface EpistemicClassification {
  // Core classifications
  input_type: InputType;
  input_type_confidence: number; // 0-1
  input_type_signals: string[];

  cynefin_domain: CynefinDomain;
  cynefin_rationale: string;

  causal_depth: CausalDepth;
  causal_depth_rationale: string;

  marr_levels: MarrLevel[];
  marr_rationale: string;

  epistemic_landscape: EpistemicLandscape;
  evidence_distribution: {
    observed: number; // 0-1 proportion
    inferred: number;
    theorized: number;
    speculated: number;
  };

  toulmin: ToulminStructure;

  // Early objectives (detected before decomposition)
  preliminary_objectives: PreliminaryObjective[];

  // Routing decisions (computed from classifications)
  decomposition_strategy: DecompositionStrategy;

  // Metadata
  classified_at: string; // ISO timestamp
  model_used: string;
}
