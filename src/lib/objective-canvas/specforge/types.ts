// ── SpecForge · shared types + stage semantics (tldraw-free) ──
//
// SpecForge turns a single raw idea on the Objective Canvas into a causal
// product-decision spec: idea → clean summary → target user → problem cause
// tree → root constraint → first-principles need → desired result → product
// thesis → alternatives → differentiation → solution families → top MVPs →
// recommended first build. Each stage is one engine (an LLM call with a strict
// JSON schema) and unfurls one or more decision cards below the source.
//
// This module is the SINGLE source of truth for the stage palette + the engine
// chain order, shared by the server (prompts/schemas), the client runner, and
// the card shape. It imports nothing heavy so every surface can read it.

/** The nine causal stages, colored per specforge_final_whiteboard_unfurling_
 *  spec.md §21. Color is used ONLY as an accent (eyebrow + soft glow + dot) —
 *  the cards themselves stay white/near-white, Apple-minimal. */
export type SpecForgeStage =
  | "input" // raw idea → clean summary (soft blue)
  | "user" // target user model (mint)
  | "problem" // problem cause tree (coral / rose)
  | "result" // desired result stack (violet)
  | "depth" // depth selection controller (blue-cyan)
  | "analysis" // cross-analysis: user×problem×result fit + blockages (teal)
  | "convergence" // root constraint · first-principles need · thesis (graphite)
  | "alternatives" // what exists today (amber)
  | "differentiation" // differentiation thesis (indigo)
  | "families" // solution families — the diverge lead-in (bronze-gold)
  | "mvp" // top MVP variations (warm gold)
  | "evaluation" // narrowing rubric over MVPs (slate-blue)
  | "recommendation" // recommended first build (green)
  | "constraints" // accumulated constraint strip (warm amber)
  | "quality"; // causal quality critic / repair report (cyan)

export interface StageMeta {
  /** Eyebrow label shown on the card. */
  label: string;
  /** Accent hex — eyebrow chip + soft drop-shadow glow + stage dot. */
  color: string;
}

/** Muted, Apple-quality accents. Each is used as a glow + chip tint only. */
export const STAGE_META: Record<SpecForgeStage, StageMeta> = {
  input: { label: "Clean summary", color: "#5A8DEE" },
  user: { label: "Target user", color: "#23B197" },
  problem: { label: "Causal model", color: "#EE6B6E" },
  result: { label: "Desired result", color: "#8E7BEA" },
  depth: { label: "Depth selection", color: "#0E9BD8" },
  analysis: { label: "Cross-analysis", color: "#2BAA98" },
  convergence: { label: "Convergence", color: "#566273" },
  alternatives: { label: "Alternatives today", color: "#D7993A" },
  differentiation: { label: "Differentiation", color: "#6366D6" },
  families: { label: "Solution families", color: "#A8762F" },
  mvp: { label: "MVP variation", color: "#C8923A" },
  evaluation: { label: "Evaluation rubric", color: "#4F6B8C" },
  recommendation: { label: "Recommended first build", color: "#2FA968" },
  constraints: { label: "Constraint accumulation", color: "#B5743B" },
  quality: { label: "Quality gate", color: "#0EA5A4" },
};

/** Stable engine ids — also the dispatch key for the route + prompt registry. */
export type SpecForgeEngineId =
  | "power_up"
  | "target_user"
  | "problem_tree"
  | "desired_result"
  | "cross_analysis"
  | "convergence"
  | "differentiation"
  | "solution_families"
  | "mvp_variations"
  | "evaluation"
  | "recommendation";

/** The chain the runner executes, in causal order (converge → diverge →
 *  converge). Each engine receives the accumulated context of the ones before
 *  it. Ordering is faithful to the spec's Minimal Vertical Slice (§7). The
 *  Cross-Analysis Engine sits between layered modeling and convergence: it
 *  interweaves user×problem×result before a single thesis is chosen. */
export const SPECFORGE_CHAIN: SpecForgeEngineId[] = [
  "power_up",
  "target_user",
  "problem_tree",
  "desired_result",
  "cross_analysis",
  "convergence",
  "differentiation",
  "solution_families",
  "mvp_variations",
  "evaluation",
  "recommendation",
];

/** Human label per engine — used for progress copy ("Forging target user…"). */
export const ENGINE_LABEL: Record<SpecForgeEngineId, string> = {
  power_up: "Clarifying the idea",
  target_user: "Modeling the target user",
  problem_tree: "Modeling the causal system",
  desired_result: "Layering the desired result",
  cross_analysis: "Interweaving user, problem, result",
  convergence: "Converging on the product thesis",
  differentiation: "Comparing the alternatives",
  solution_families: "Generating solution families",
  mvp_variations: "Shaping MVP variations",
  evaluation: "Scoring against the rubric",
  recommendation: "Choosing the first build",
};

// ── One unfurled card ──────────────────────────────────────────────
/** A normalized decision card. `body` may carry bullet lines separated by
 *  "\n" (the shape renders each as a row). `layout` lets the runner place
 *  spine cards in a centered column and MVP cards three-across. */
export interface SpecForgeCard {
  stage: SpecForgeStage;
  /** Optional eyebrow override (defaults to STAGE_META[stage].label). */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  body?: string;
  /** Full causal model JSON for lazy panel rendering; only populated by the
   *  upgraded problem_tree engine's summary card. */
  modelJson?: string;
  /** "spine" = full-width centered column; "diverge" = part of a 3-across row;
   *  "hero" = the wide recommendation card. */
  layout: "spine" | "diverge" | "hero";
}

// ── Engine result shapes (loose — for the client normalizer) ───────
// The route returns the raw engine JSON; the client reads these fields. Only
// the fields actually rendered or threaded as context are typed here.

export interface PowerUpResult {
  clean_summary: string;
  root_intent: string;
  desired_result_guess: string;
  target_user_guess: string;
  core_problem_guess: string;
  ambiguities: string[];
  powered_up_prompt: string;
}

export interface TargetUserResult {
  primary_segment: string;
  core_need: string;
  context: string;
  behavior_patterns: string[];
  motivations: string[];
  constraints: string[];
  user_variants: string[];
  implications_for_product: string[];
}

export interface CauseNode {
  layer: string;
  failing: string;
}

export interface ProblemPhenomenon {
  phenomenon_statement: string;
  observable_behaviors: string[];
  symptoms: string[];
  initial_problem_frame: string;
}

export interface StakeholderVariant {
  name: string;
  experience: string;
  urgency: string;
  benefit_or_resistance: string;
}

export interface CausalVariable {
  id: string;
  name: string;
  category: string;
  definition: string;
  current_state: string;
}

export interface CausalLink {
  source_id: string;
  target_id: string;
  polarity: "positive" | "negative" | "mixed";
  strength: "low" | "medium" | "high";
  uncertainty: "low" | "medium" | "high";
  mechanism: string;
  assumption: string;
}

export interface FeedbackLoop {
  id: string;
  name: string;
  kind: "reinforcing" | "balancing";
  variable_ids: string[];
  mechanism: string;
  effect_on_problem: string;
}

export interface CausalContradiction {
  tension: string;
  tradeoff: string;
  resolution_principle: string;
}

export interface RepresentationLayer {
  current_value_representations: string[];
  behavior_created_by_current_representation: string[];
  alternative_value_representations: string[];
  solution_implications: string[];
}

export interface WorldviewLayer {
  dominant_worldview: string;
  underlying_metaphors: string[];
  cultural_assumptions: string[];
  alternative_worldviews: string[];
  product_thesis_implications: string[];
}

export interface Counterfactual {
  world: string;
  what_changes: string;
  solution_principle: string;
}

export interface RootConstraintCandidate {
  constraint: string;
  score: number;
  why: string;
  weakness: string;
}

export interface RootConstraintTournament {
  candidates: RootConstraintCandidate[];
  selected_root_constraint: string;
  why_selected: string;
  rejected_candidates: string[];
}

export interface FirstPrinciplesNeed {
  candidates: string[];
  selected: string;
  why_selected: string;
  solution_implications: string[];
}

export interface LeveragePoint {
  name: string;
  variable_ids: string[];
  downstream_impact: string;
  buildability: string;
  differentiation: string;
  risk: string;
  evidence_confidence: string;
  rank: number;
}

export interface QualityGate {
  passes: boolean;
  depth_score: number;
  causal_specificity_score: number;
  non_obviousness_score: number;
  solution_constraint_strength: number;
  issues: string[];
}

export interface ProblemTreeResult {
  phenomenon: ProblemPhenomenon;
  stakeholder_variants: StakeholderVariant[];
  variables: CausalVariable[];
  causal_links: CausalLink[];
  feedback_loops: FeedbackLoop[];
  contradictions: CausalContradiction[];
  system_incentives: string[];
  representation_layer: RepresentationLayer;
  worldview_layer: WorldviewLayer;
  counterfactuals: Counterfactual[];
  root_constraint_tournament: RootConstraintTournament;
  first_principles_need: FirstPrinciplesNeed;
  leverage_points: LeveragePoint[];
  solution_constraints: string[];
  evidence_needed: string[];
  quality_gate: QualityGate;
  /** Compatibility fields for older saved results / simplified tree views. */
  surface_problem?: string;
  cause_tree?: CauseNode[];
  root_constraint?: string;
  highest_leverage_cause?: string;
}

export interface DesiredResultResult {
  functional_result: string;
  decision_result: string;
  behavior_change: string;
  measurable_success: string;
  strategic_outcome: string;
  first_principles_result: string;
  success_metrics: string[];
  failure_conditions: string[];
}

export interface ConvergenceResult {
  root_constraint: string;
  first_principles_need: string;
  highest_leverage_intervention: string;
  distilled_product_thesis: string;
  why_this_is_deeper_than_the_surface_problem: string;
  what_this_rules_out: string[];
  what_this_implies_for_solution_design: string[];
}

/** Cross-Analysis Engine: interweaves user × problem × result models BEFORE
 *  convergence picks a thesis. Outputs fit assessments + cause→result blockages
 *  + cross-model contradictions + weak links + a leverage candidate for
 *  convergence to consider. Intentionally complementary to problem_tree
 *  (intra-model) and convergence (final pick). */
export interface CrossAnalysisFit {
  score: number; // 0..100
  reason: string;
  blockers: string[];
}

export interface CauseResultBlockage {
  cause: string;
  blocks_result: string;
  mechanism: string;
}

export interface CrossAnalysisResult {
  user_problem_fit: CrossAnalysisFit;
  user_result_fit: CrossAnalysisFit;
  problem_result_fit: CrossAnalysisFit;
  cause_result_blockages: CauseResultBlockage[];
  cross_model_contradictions: string[];
  weak_links: string[];
  highest_leverage_intervention_candidate: string;
  convergence_inputs: string[];
  confidence: number; // 0..100
}

export interface AlternativeItem {
  name: string;
  solves: string;
  gap: string;
}

export interface DifferentiationResult {
  direct_alternatives: AlternativeItem[];
  indirect_workarounds: string[];
  deeper_problem_not_solved: string;
  proposed_product_advantage: string;
  differentiation_thesis: string;
  final_positioning_options: string[];
}

export interface SolutionFamily {
  name: string;
  attacks: string;
  mechanism: string;
  user_behavior_change: string;
}

export interface SolutionFamiliesResult {
  solution_families: SolutionFamily[];
  recommended_family: string;
  risks: string[];
}

export interface MvpVariation {
  name: string;
  target_user: string;
  core_mechanism: string;
  simplest_version: string;
  why_valuable: string;
  build_difficulty: string;
  value_score: number;
}

export interface MvpVariationsResult {
  mvp_variations: MvpVariation[];
  ranking: string[];
  recommended_mvp: string;
}

/** Evaluation Lab / Narrowing Engine — structured rubric over MVP variations.
 *  Sits between mvp_variations (generate) and recommendation (final pick with
 *  build scope). Per specforge_evaluation_lab_narrowing_engine.md §5.6 (MVP App
 *  Direction Evaluation) + §6 (standard schema), narrowed to fields that change
 *  downstream behavior. Output gives recommendation an explicit winner-with-
 *  rationale prior; does NOT duplicate mvp_variations.value_score (those are
 *  generator-side gut estimates — this is a rubric pass). */
export interface EvaluationCriterion {
  /** Short label, e.g. "root_cause_attacked". */
  name: string;
  /** Weight 0–100; weights across criteria should sum to roughly 100. */
  weight: number;
  why_it_matters: string;
  /** "1–5: 1 = absent · 5 = clearly demonstrated by the candidate". */
  scoring_guidance: string;
}

export interface EvaluationCandidate {
  name: string;
  /** Map of criterion.name → score on the rubric's 0..5 scale. */
  scores: Record<string, number>;
  /** 0..100 — criterion weight × score, summed and normalized. */
  weighted_score: number;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  /** Honest read on how much real evidence backs this candidate. */
  evidence_strength: "low" | "medium" | "high";
  /** 0..100 — how confident the evaluator is in this candidate's score. */
  confidence: number;
}

export interface EvaluationLoss {
  candidate: string;
  reason: string;
}

export interface EvaluationResult {
  decision_context: string;
  criteria: EvaluationCriterion[];
  candidates: EvaluationCandidate[];
  /** Tensions across criteria that no single candidate dominates on. */
  tradeoffs: string[];
  /** Named candidate the rubric ranks highest; recommendation may confirm or
   *  override with build-scope reasoning. */
  winner: string;
  why_winner_won: string;
  why_others_lost: EvaluationLoss[];
  /** Assumptions that, if false, would flip the winner. */
  assumptions_that_could_reverse_decision: string[];
  /** Evidence the engine would need to raise its confidence. */
  evidence_needed: string[];
  /** Constraints the winner imposes on later stages (build, validation). */
  constraints_passed_downstream: string[];
  confidence_level: "low" | "medium" | "high";
}

export interface RecommendationResult {
  recommendation: string;
  why_this_won: string;
  why_others_lost: string[];
  assumptions_to_test: string[];
  confidence_level: string;
  next_best_action: string;
}

/** Discriminated map id → result type, for the normalizer. */
export interface EngineResultMap {
  power_up: PowerUpResult;
  target_user: TargetUserResult;
  problem_tree: ProblemTreeResult;
  desired_result: DesiredResultResult;
  cross_analysis: CrossAnalysisResult;
  convergence: ConvergenceResult;
  differentiation: DifferentiationResult;
  solution_families: SolutionFamiliesResult;
  mvp_variations: MvpVariationsResult;
  evaluation: EvaluationResult;
  recommendation: RecommendationResult;
}
