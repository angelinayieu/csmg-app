// Causal Chains + Calculation Trace — provenance-linked trajectory from
// L4 invariants in synthesis → measurable goal contribution.
//
// Pipeline:
//   Synthesis → Causal Chain Propagator → CausalChain[]
//   CausalChain → Effect Propagator → CalculationTrace
//                 (if baseline missing → generates BaselineQuestion[])
//
// Storage: both are persisted under `synthesis_data`:
//   synthesis_data.causal_chains: CausalChain[]
//   synthesis_data.calculation_traces: Record<chain_id, CalculationTrace>
//   synthesis_data.baseline_questions: Record<chain_id, BaselineQuestion[]>

// ── Causal Chain (the row in your Causal Chains page) ──

export type CausalStageKind =
  | "concept"      // stage 1: L4 invariant (science says…)
  | "research"     // stage 2: evidence proves…
  | "deliverable"  // stage 3: therefore rule…
  | "application"  // stage 4: applied to asset
  | "outcome"      // stage 5: measured result
  | "goal";        // stage 6: master objective contribution

export interface CausalStage {
  kind: CausalStageKind;
  title: string;              // short label for the node (e.g., "WM ≈ 4 chunks")
  meta: string;               // sub-label (e.g., "cowan invariant", "Rule R-001")
  entity_id?: string | null;  // KG entity backing this stage, if any
  confidence?: number;        // 0-1
  verified?: boolean;         // web-verified or training-only
  source_url?: string;        // for research / framework stages
  value_label?: string;       // e.g., "+23%", "42 templates" — display-ready
}

export interface CausalChain {
  id: string;                        // stable id, e.g., `chain-${l4_convergence_index}`
  rank: number;                      // 1-indexed, sorted by goal_contribution_pct desc
  name: string;                      // chain name (e.g., "Working memory")
  stages: [CausalStage, CausalStage, CausalStage, CausalStage, CausalStage, CausalStage];
  // Always 6 stages in order: concept, research, deliverable, application, outcome, goal

  // Ranking metrics
  goal_contribution_pct: number;     // +5.8 (on your template)
  l4_structural_value: number;       // 0-1 from the convergence
  confidence: number;                // 0-1, composite
  generated_at: string;              // ISO timestamp

  // Traceability
  l4_convergence_id?: string;        // which convergence this chain came from
  primary_goal_id: string;           // ImprovementGoal.id this chain propagates to
  micro_tactic_ids: string[];        // which tactics implement the deliverable
  entity_ids: string[];              // all KG entities touched

  // Linkage
  calculation_trace_id?: string;     // if trace has been computed
  needs_baseline?: boolean;          // true if Effect Propagator needs user input
}

// ── Calculation Trace (the "show your work" page) ──

export type StepKind = "input" | "transform" | "result";

export type GraphPrimitive =
  | "distribution"     // histogram
  | "density"          // density curve with mean marker
  | "number_line"      // scale bar with marker
  | "scatter"          // scatter + trend line
  | "overlap"          // two-circle Venn
  | "comparison";      // side-by-side bars

export type SourceKind = "user" | "research" | "model" | "history" | "llm_estimate";

export interface TraceSource {
  kind: SourceKind;
  label: string;                     // e.g., "Your audit · n=2,847"
  reliability: 1 | 2 | 3 | 4 | 5;    // filled bars (5 = fully verified)
  href?: string;                     // clickthrough URL (entity detail, paper, etc.)
  entity_id?: string;                // if backed by a KG entity
  /** evidence_registries.id values backing this step. REQUIRED when kind === "research"
   *  (the validator rejects research steps with empty evidence_ids and triggers retry). */
  evidence_ids?: string[];
  /** Pooled metadata from edge-strength-pooler when evidence_ids non-empty.
   *  Lets the UI render real CI bounds + study count instead of LLM-guessed reliability. */
  pooled_metadata?: {
    n_studies: number;
    pooled_effect: number;
    pooled_ci_lower: number;
    pooled_ci_upper: number;
    tau_squared: number;
    effect_metric: string;           // "cohens_d" | "or" | "mixed" | ...
  };
}

export interface TraceGraphData {
  primitive: GraphPrimitive;
  // Shape-specific payload; the renderer knows how to draw each primitive.
  // Using unknown so each primitive can define its own schema.
  data: Record<string, unknown>;
}

export interface TraceStep {
  num: number;                       // 1-indexed
  kind: StepKind;
  name: string;                      // "Baseline error rate"
  description: string;               // one-sentence explanation
  source: TraceSource;
  graph: TraceGraphData;
  value_display: string;             // "14.2%" — pre-formatted
  value_unit?: string;               // "%", "pp", etc.
  value_numeric?: number;            // machine-readable
  is_factor?: boolean;               // true for multipliers like ×0.60
}

export interface SensitivityRow {
  perturbation: string;              // "If adherence drops to 70%"
  result_display: string;            // "−4.4"
  result_numeric: number;
  delta_from_base: number;           // signed delta
  direction: "worse" | "better" | "same";
}

export interface AlternativeConsidered {
  name: string;                      // "Miller 1956 (7±2)"
  rejected_reason: string;           // one sentence
}

export interface CalculationTrace {
  id: string;                        // same as chain.calculation_trace_id
  chain_id: string;                  // back-link
  generated_at: string;
  agent_name: string;                // e.g., "ATLAS-04" — cosmetic label for UI
  method_label: string;              // "Bayesian effect propagation v3.2"

  // Final result
  final_value: number;               // -5.8
  final_display: string;             // "−5.8"
  final_unit: string;                // "pp"
  ci_lower: number;                  // -4.2
  ci_upper: number;                  // -7.4
  confidence: number;                // 0-1

  // Steps (typically 5 inputs + 1 result = 6 rows)
  steps: TraceStep[];

  // Compact formula string, safe for inline rendering.
  // Use {{input:N}} / {{factor:N}} / {{result}} tokens so the renderer can
  // highlight variables — decouples formatting from numbers.
  formula_compact: string;           // "{{input:1}} × (1 − {{input:2}} × {{factor:3}} × {{factor:4}} × {{factor:5}}) + 2.7pp = {{result}}"

  // Diagnostics
  sensitivity: SensitivityRow[];
  alternatives_considered: AlternativeConsidered[];
  narrative: string;                 // agent's prose explanation

  // Data readiness
  missing_inputs: string[];          // human-readable list, empty if fully grounded
  baseline_source: "user_audit" | "goal_baseline" | "llm_estimated" | "needs_input";
}

// ── Baseline Question (when Effect Propagator needs user input) ──

export type QuestionType =
  | "numeric"          // "What is your current error rate? (%)"
  | "choice"           // "Which best describes your domain complexity?"
  | "yes_no"           // "Have you measured this before?"
  | "short_text";      // "Describe how you currently track this"

export interface BaselineQuestion {
  id: string;                        // stable id per chain
  chain_id: string;
  step_num: number;                  // which trace step needs this input
  question: string;                  // the question text
  why: string;                       // why this number matters for the chain
  type: QuestionType;
  // Type-specific hints
  choices?: string[];                // for "choice" type
  unit?: string;                     // for "numeric" type
  min?: number;
  max?: number;
  placeholder?: string;
  default_estimate?: number | string; // LLM's best guess (if user skips)
  required: boolean;                 // if false, user can skip & we use default_estimate
  // Filled by user
  answer?: number | string | boolean;
  answered_at?: string;
}

// ── Propagator response envelopes ──

export interface CausalChainResponse {
  chains: CausalChain[];
  generated_at: string;
  source_counts: {
    l4_convergences: number;
    leverage_points: number;
    micro_tactics: number;
  };
}

export interface EffectPropagatorResponse {
  status: "completed" | "needs_baseline";
  trace?: CalculationTrace;
  questions?: BaselineQuestion[];
  chain_id: string;
}
