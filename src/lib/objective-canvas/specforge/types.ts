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
  | "questions" // question expansion: decision-changing questions (amethyst)
  | "convergence" // root constraint · first-principles need · thesis (graphite)
  | "alternatives" // what exists today (amber)
  | "differentiation" // differentiation thesis (indigo)
  | "families" // solution families — the diverge lead-in (bronze-gold)
  | "mvp" // top MVP variations (warm gold)
  | "evaluation" // narrowing rubric over MVPs (slate-blue)
  | "recommendation" // recommended first build (green)
  | "features" // feature card system (forest-green)
  | "mechanisms" // feature mechanism generator (sage-green)
  | "data" // data point optimization model (jade-teal)
  | "validation" // experimentation / validation lab (rose-red)
  | "deepening" // iteration timeline / situation-model deepening (deep purple)
  | "export" // spec exporter / build instruction generator (graphite-blue)
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
  questions: { label: "Decision questions", color: "#A05FCC" },
  convergence: { label: "Convergence", color: "#566273" },
  alternatives: { label: "Alternatives today", color: "#D7993A" },
  differentiation: { label: "Differentiation", color: "#6366D6" },
  families: { label: "Solution families", color: "#A8762F" },
  mvp: { label: "MVP variation", color: "#C8923A" },
  evaluation: { label: "Evaluation rubric", color: "#4F6B8C" },
  recommendation: { label: "Recommended first build", color: "#2FA968" },
  features: { label: "Feature card", color: "#3C8B5A" },
  mechanisms: { label: "Feature mechanism", color: "#5A9E70" },
  data: { label: "Data point", color: "#2E9B8C" },
  validation: { label: "Validation plan", color: "#D9486F" },
  deepening: { label: "Iteration deepening", color: "#7C4DFF" },
  export: { label: "Build spec export", color: "#2F455E" },
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
  | "question_expansion"
  | "convergence"
  | "differentiation"
  | "solution_families"
  | "mvp_variations"
  | "evaluation"
  | "recommendation"
  | "feature_cards"
  | "feature_mechanisms"
  | "data_points"
  | "validation"
  | "deepening"
  | "spec_export";

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
  "question_expansion",
  "convergence",
  "differentiation",
  "solution_families",
  "mvp_variations",
  "evaluation",
  "recommendation",
  "feature_cards",
  "feature_mechanisms",
  "data_points",
  "validation",
  "deepening",
  "spec_export",
];

/** Human label per engine — used for progress copy ("Forging target user…"). */
export const ENGINE_LABEL: Record<SpecForgeEngineId, string> = {
  power_up: "Clarifying the idea",
  target_user: "Modeling the target user",
  problem_tree: "Modeling the causal system",
  desired_result: "Layering the desired result",
  cross_analysis: "Interweaving user, problem, result",
  question_expansion: "Surfacing decision-changing questions",
  convergence: "Converging on the product thesis",
  differentiation: "Comparing the alternatives",
  solution_families: "Generating solution families",
  mvp_variations: "Shaping MVP variations",
  evaluation: "Scoring against the rubric",
  recommendation: "Choosing the first build",
  feature_cards: "Decomposing the build into features",
  feature_mechanisms: "Designing the feature mechanisms",
  data_points: "Optimizing the data points",
  validation: "Designing the validation plan",
  deepening: "Recording the iteration baseline",
  spec_export: "Exporting the build spec",
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

/** Question Expansion Engine: sits between cross_analysis and convergence.
 *  Generates a small ranked list of questions whose answers would CHANGE a
 *  downstream SpecForge decision (target user, root constraint, desired result,
 *  differentiation, MVP direction, feature mechanism, evaluation criteria, or a
 *  hidden assumption). Per spec §5: questions must be optimization tools, not
 *  filler. Every question references a node from the upstream models and lists
 *  ≥1 change_trigger. Output is advisory — convergence remains the deepest-
 *  thesis selector. */
export type QuestionLayer =
  | "user"
  | "problem"
  | "result"
  | "differentiation"
  | "mvp"
  | "mechanism"
  | "evaluation"
  | "validation"
  | "constraint"
  | "macro";

export type QuestionChangeTrigger =
  | "mvp_direction"
  | "target_user"
  | "root_constraint"
  | "desired_result"
  | "differentiation_thesis"
  | "feature_mechanism"
  | "evaluation_criteria"
  | "hidden_assumption";

export type QuestionImpact = "high" | "medium" | "low";

export type QuestionAnswerSource =
  | "user"
  | "agent_reasoning"
  | "research"
  | "experiment";

export interface QuestionReference {
  /** Which upstream model this question hooks into. */
  layer: QuestionLayer;
  /** Concrete node name copied verbatim from that model (e.g., variable name,
   *  user variant, success metric, weak link). */
  node: string;
}

export interface ExpandedQuestion {
  question: string;
  layer: QuestionLayer;
  references: QuestionReference;
  change_triggers: QuestionChangeTrigger[];
  why_it_matters: string;
  expected_answer_format: string;
  expected_decision_impact: QuestionImpact;
  answer_source: QuestionAnswerSource;
}

export interface QuestionExpansionResult {
  questions: ExpandedQuestion[];
  top_critical_questions: string[];
  hidden_low_value_questions: string[];
  recommended_next_action: string;
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

/** Feature Card System — per specforge_feature_card_system.md.
 *  Sits between recommendation and validation. Expands the SINGLE recommended
 *  first build into 3–5 traceable feature cards, each grounded in the upstream
 *  causal chain (root_cause_attacked, micro_objective) with a mechanism summary,
 *  inputs/outputs, a rejected alternative, and a build priority. Each must_have
 *  card with a risk becomes a testable assumption for the Validation Lab.
 *
 *  Anti-duplication rules (enforced by the prompt + the quality critic):
 *   - Does NOT pick the MVP (recommendation's job)
 *   - Does NOT design experiments (validation's job)
 *   - Does NOT deepen the mechanism flow (Feature Mechanism Generator's job)
 *   - Does NOT decide data shape (Data Point Optimization's job)
 *   - mechanism_summary is 1–2 sentences only — depth lives downstream */
export type FeatureBuildPriority =
  | "must_have"
  | "should_have"
  | "nice_to_have"
  | "delay";

export interface FeatureCard {
  name: string;
  function: string;
  /** Citation back to problem_tree — keeps causal traceability honest. */
  root_cause_attacked: string;
  /** The user behavior change this feature unlocks. */
  micro_objective: string;
  /** 1–2 sentence mechanism summary. Deep flow lives in Feature Mechanism Generator. */
  mechanism_summary: string;
  inputs: string[];
  outputs: string[];
  /** One sentence: why this mechanism beat the rejected alternative. */
  why_this_mechanism: string;
  /** Rejected mechanism(s) with one-line reason. */
  rejected_alternatives: string[];
  /** Top risk / failure mode. */
  risks: string[];
  /** How we'll know the feature is working. */
  evaluation_metric: string;
  /** Suggested validation experiment type (validation lab will design it). */
  validation_method: ValidationExperimentType;
  build_priority: FeatureBuildPriority;
}

export interface FeatureCardsResult {
  /** The MVP this set is decomposing — must echo recommendation.recommendation. */
  selected_mvp: string;
  features: FeatureCard[];
  /** Sequence of features that must ship together to enable the first user flow. */
  first_user_flow: string[];
  /** Features delayed past v1, with one-line reason each. */
  delayed_features: string[];
  /** Notes on what could NOT be decomposed (will need clarification). */
  open_gaps: string[];
  confidence: number; // 0..100
}

/** Feature Mechanism Generator — per specforge_feature_mechanism_generator.md.
 *  Sits AFTER feature_cards, BEFORE validation. Takes each feature's shallow
 *  `mechanism` field and deepens it into a full input → process → output spec
 *  with alternatives compared. Does NOT generate features (feature_cards's job),
 *  does NOT design experiments (validation's job — though each mechanism's
 *  test_method is lifted as a candidate), does NOT pick the recommendation
 *  (recommendation's job). Hard rule from spec §19: every mechanism MUST link
 *  to a feature in the feature_cards list by name and MUST transform inputs
 *  into outputs with explicit ordered processing steps. */
export interface MechanismAlternative {
  name: string;
  why_rejected: string;
}

export interface FeatureMechanism {
  /** Must match a feature_cards.features[i].name — linkage guard. */
  feature_name: string;
  mechanism_name: string;
  mechanism_thesis: string;
  /** What starts the mechanism (per spec §7 Trigger Layer). */
  trigger: string;
  /** Per spec §8 Input Layer. */
  inputs: string[];
  /** Per spec §10 Processing Layer — ordered, explicit steps. */
  system_process: string[];
  /** Per spec §12 Output Layer — structured artifacts created. */
  outputs: string[];
  /** Per spec §13 User Behavior Layer — what changes for the user. */
  user_behavior_changed: string;
  /** Per spec §11 Transformation Layer — input → output shape changes. */
  data_transformations: string[];
  /** Downstream effects on later mechanisms or artifacts. */
  downstream_effects: string[];
  /** Per spec §16 — 2–3 alternative mechanisms compared. */
  alternatives: MechanismAlternative[];
  selected_mechanism_reason: string;
  /** Per spec §15 Failure / Repair Layer. */
  failure_modes: string[];
  /** Per spec §15 — repair paths for failures. */
  risk_controls: string[];
  /** How to test that the mechanism works. */
  test_method: string;
  implementation_difficulty: "low" | "medium" | "high";
  /** Which accumulated constraints this mechanism satisfies. */
  constraints_satisfied: string[];
}

export interface FeatureMechanismsResult {
  /** The MVP this mechanism set serves — must echo recommendation.recommendation. */
  selected_mvp: string;
  mechanisms: FeatureMechanism[];
  /** Features from feature_cards that couldn't be mechanized yet, with reason. */
  features_not_mechanized: string[];
  /** Cross-mechanism dependencies (mechanism A's output feeds mechanism B's input). */
  cross_mechanism_dependencies: string[];
  confidence: number; // 0..100
}

/** Data Point Optimization Model — per specforge_data_point_optimization_model.md.
 *  Sits AFTER feature_mechanisms, BEFORE validation. Each mechanism declared
 *  `inputs` (raw data names). This engine deepens those into optimization
 *  objects: concept definition, variable decomposition, collection methods,
 *  friction/reliability/privacy risk, downstream uses, lower-friction proxies,
 *  selected handling, and constraints. Does NOT regenerate features
 *  (feature_cards's job), NOT regenerate mechanisms (feature_mechanisms's job),
 *  NOT design experiments (validation's job). */
export type DataPointSource =
  | "user_input"
  | "inferred"
  | "integration"
  | "system_generated"
  | "research"
  | "analytics";

export type DataPointDisposition =
  | "required"
  | "optional"
  | "inferred"
  | "progressive"
  | "proxy"
  | "removed";

export type RiskLevel = "low" | "medium" | "high";

export interface DataPoint {
  /** Short stable id used for cross-references (kebab-case). */
  data_point_id: string;
  name: string;
  /** What concept does this data represent? */
  concept_definition: string;
  /** The decomposed variables inside the concept. */
  variables: string[];
  /** Which feature/mechanism needs it. */
  used_by_feature: string;
  used_by_mechanism: string;
  /** Why it exists — must reference a downstream decision/mechanism/eval/validation. */
  why_it_exists: string;
  when_needed: string;
  source: DataPointSource;
  collection_methods: string[];
  collection_friction: RiskLevel;
  reliability_risk: RiskLevel;
  privacy_risk: RiskLevel;
  /** Which downstream consumer(s) use this. */
  downstream_uses: string[];
  /** How raw collection becomes the form the mechanism consumes. */
  transformation_process: string;
  /** Lower-friction substitutes considered. */
  alternative_proxies: string[];
  /** The chosen approach (required / optional / inferred / progressive / proxy). */
  disposition: DataPointDisposition;
  selected_handling_method: string;
  why_selected: string;
  /** Where this data point could fail (missing, wrong, sensitive). */
  failure_modes: string[];
  /** What needs to be validated about this data point. */
  validation_needed: string[];
  /** Constraints this data point imposes downstream. */
  constraints_created: string[];
}

export interface DataPointsResult {
  /** Echoes recommendation.recommendation for traceability. */
  selected_mvp: string;
  /** All data points, including removed ones. */
  data_points: DataPoint[];
  /** Data points removed from the spec (privacy/friction/no-downstream-value), with reason. */
  removed_data: { name: string; reason: string }[];
  /** Free-text summary: upstream → collection → transform → mechanism → downstream. */
  data_flow_summary: string;
  /** Overall data risks: privacy, reliability, friction, unavailability. */
  risks: string[];
  confidence: number; // 0..100
}

/** Experimentation / Validation Lab — per specforge_experimentation_validation_lab.md.
 *  Sits AFTER recommendation, BEFORE constraints. Consumes recommendation.
 *  assumptions_to_test + evaluation.assumptions_that_could_reverse_decision +
 *  question_expansion.questions to produce 2–4 concrete, ranked experiments
 *  with hypothesis + success/failure criteria. Does NOT generate new questions
 *  (question_expansion's job), NOT redo structural checks (quality_critic's
 *  job), NOT override the recommendation (it tests it). */
export type ValidationExperimentType =
  | "interview"
  | "usability"
  | "concept"
  | "concierge"
  | "prototype"
  | "ab"
  | "fake_door"
  | "analytics";

export interface ValidationAssumption {
  text: string;
  decision_affected: string;
  why_matters: string;
  category:
    | "target_user"
    | "problem"
    | "desired_result"
    | "differentiation"
    | "mvp_direction"
    | "feature_mechanism"
    | "data_point"
    | "business";
}

export interface ValidationExperiment {
  name: string;
  experiment_type: ValidationExperimentType;
  assumption_tested: string;
  hypothesis: string;
  method: string;
  success_criteria: string[];
  failure_criteria: string[];
  metrics: string[];
  effort_level: "low" | "medium" | "high";
  confidence_gain: "low" | "medium" | "high";
  decision_that_result_will_change: string;
  priority_rank: number;
}

export interface ValidationResult {
  critical_assumptions: ValidationAssumption[];
  experiments: ValidationExperiment[];
  hard_prioritization_notes: string;
  model_update_rules: string[];
  confidence: number; // 0..100
}

/** Iteration Timeline / Situation Model Deepening — runs last in the chain.
 *  Per specforge_iteration_timeline_situation_model_deepening.md: this is the
 *  meta-engine that snapshots the run as iteration #1 (or N), summarizes
 *  baseline + value added, names what uncertainty remains (orthogonal to
 *  question_expansion's questions — these are scalar uncertainties), and
 *  recommends the SINGLE highest-leverage next refinement. Does NOT redo
 *  experiments, questions, structural checks, or constraint extraction. */
export type DeepeningDimension =
  | "target_user"
  | "problem_causal"
  | "desired_result"
  | "differentiation"
  | "mvp_direction"
  | "feature_mechanism"
  | "data_model"
  | "evaluation_rigor"
  | "validation_evidence"
  | "build_readiness";

export interface DeepeningBaseline {
  /** The dimension the baseline captures. */
  dimension: DeepeningDimension;
  /** Compact baseline value (e.g. "solo technical founders"). */
  value: string;
  /** Current depth/confidence on that dimension. */
  depth: "shallow" | "medium" | "deep";
}

export interface DeepeningUncertainty {
  /** The dimension that still carries uncertainty. */
  dimension: DeepeningDimension;
  /** What specifically is uncertain (not a question — a scalar). */
  uncertainty: string;
  /** Why it matters for the recommendation. */
  impact_on_recommendation: string;
}

export interface DeepeningNextIteration {
  /** Concrete action ("refine target user variant scoring"). */
  action: string;
  /** Which dimension this would deepen. */
  dimension: DeepeningDimension;
  /** Why this is the highest-leverage next step. */
  why_highest_leverage: string;
  /** Expected value: depth_increased / uncertainty_reduced / constraint_clarified /
   *  recommendation_improved / weak_option_removed / mechanism_improved /
   *  evidence_added / scope_simplified / differentiation_strengthened /
   *  buildability_improved (per spec §7). */
  expected_value_category: string;
}

export interface DeepeningResult {
  iteration_number: number;
  trigger: "initial_run" | "user_edit" | "repair" | "validation_result" | "re_evaluation" | "research_update" | "manual_rerun";
  summary: string;
  baselines: DeepeningBaseline[];
  /** What this run concretely added (per spec §7 — narrative, not a list of nodes). */
  value_added: string;
  uncertainties_remaining: DeepeningUncertainty[];
  next_recommended_iteration: DeepeningNextIteration;
  confidence: number; // 0..100
}

/** Spec Exporter / Build Instruction Generator — per
 *  specforge_spec_exporter_build_instruction_generator.md. Terminal engine:
 *  consumes target_user + problem_tree + desired_result + convergence +
 *  differentiation + recommendation + feature_cards + feature_mechanisms +
 *  data_points + evaluation + validation, restates the causal chain with
 *  build implications, and produces the two genuinely new outputs:
 *  implementation_tasks (with provenance back to features/mechanisms) and
 *  coding_agent_prompt (a synthesized prompt for an external coding agent).
 *  Does NOT regenerate anything upstream — pure synthesis. */
export interface SpecExportProductSummary {
  product_name: string;
  one_liner: string;
  primary_target_user: string;
  core_user_problem: string;
  root_constraint: string;
  first_principles_need: string;
  selected_mvp: string;
  core_product_loop: string;
  primary_desired_result: string;
  differentiation_thesis: string;
}

/** One row in the causal trace table — restates an upstream reasoning artifact
 *  with the decision it supports + the build implication that falls out. */
export interface SpecExportCausalTraceRow {
  /** The reasoning artifact name (e.g. "Root constraint"). */
  artifact: string;
  /** What the artifact said in one line. */
  finding: string;
  /** The decision downstream of that finding (e.g. "MVP must include …"). */
  decision_supported: string;
  /** What the build must include / avoid because of that decision. */
  build_implication: string;
}

export interface SpecExportFirstBuildScope {
  must_build_now: string[];
  should_build_if_simple: string[];
  must_delay: string[];
  must_not_build: string[];
}

/** One feature requirement — lifted from feature_cards + cross-referenced
 *  with the mechanism. Does NOT redo feature_cards work; provides the build
 *  spec's required-fields view (spec §12). */
export interface SpecExportFeatureRequirement {
  feature_name: string;
  function: string;
  macro_objective_served: string;
  micro_objective_served: string;
  root_cause_attacked: string;
  recommended_mechanism: string;
  top_acceptance_criterion: string;
}

/** One mechanism requirement — lifted from feature_mechanisms, condensed to
 *  the spec §13 required-fields view. */
export interface SpecExportMechanismRequirement {
  mechanism_name: string;
  feature: string;
  trigger: string;
  inputs_summary: string;
  process_summary: string;
  outputs_summary: string;
  top_test_method: string;
}

/** One data requirement — lifted from data_points. */
export interface SpecExportDataRequirement {
  data_point: string;
  source: string;
  disposition: string;
  why_it_exists: string;
  top_constraint: string;
}

/** One implementation task — the GENUINELY NEW output. Every task MUST link
 *  back to a feature_cards.features[].name OR feature_mechanisms.mechanisms[].
 *  mechanism_name (provenance — spec §18). */
export interface SpecExportImplementationTask {
  task_name: string;
  description: string;
  /** Provenance — either a feature card name or a mechanism name. Required. */
  source: string;
  /** "feature" | "mechanism" — narrows the source. */
  source_kind: "feature" | "mechanism";
  user_value: string;
  components: string[];
  acceptance_criteria: string[];
  dependencies: string[];
}

/** Validation plan summary — lifted from validation, NOT regenerated. */
export interface SpecExportValidationSummary {
  top_assumption: string;
  top_experiment: string;
  success_marker: string;
  failure_marker: string;
}

export interface SpecExportResult {
  product_summary: SpecExportProductSummary;
  /** The causal chain restated as a 6–10 row provenance table. */
  causal_trace: SpecExportCausalTraceRow[];
  first_build_scope: SpecExportFirstBuildScope;
  user_flow: string[];
  feature_requirements: SpecExportFeatureRequirement[];
  mechanism_requirements: SpecExportMechanismRequirement[];
  data_requirements: SpecExportDataRequirement[];
  validation_plan_summary: SpecExportValidationSummary;
  /** The genuinely new output #1: implementation tasks with provenance. */
  implementation_tasks: SpecExportImplementationTask[];
  /** Top-level (product-wide) acceptance criteria — NOT per-task. */
  acceptance_criteria: string[];
  /** The genuinely new output #2: the synthesized prompt for an external
   *  coding agent. Per spec §19: must explicitly forbid generic cards, must
   *  preserve the causal chain, must enumerate non-goals. */
  coding_agent_prompt: string;
  /** Sections the engine could NOT fill because the upstream input was
   *  missing or too thin. Per spec §5: required-input failures must be
   *  visible, not silently dropped. */
  missing_inputs: string[];
  /** Confidence the spec is buildable end-to-end (0–100). */
  confidence: number;
}

/** Discriminated map id → result type, for the normalizer. */
export interface EngineResultMap {
  power_up: PowerUpResult;
  target_user: TargetUserResult;
  problem_tree: ProblemTreeResult;
  desired_result: DesiredResultResult;
  cross_analysis: CrossAnalysisResult;
  question_expansion: QuestionExpansionResult;
  convergence: ConvergenceResult;
  differentiation: DifferentiationResult;
  solution_families: SolutionFamiliesResult;
  mvp_variations: MvpVariationsResult;
  evaluation: EvaluationResult;
  recommendation: RecommendationResult;
  feature_cards: FeatureCardsResult;
  feature_mechanisms: FeatureMechanismsResult;
  data_points: DataPointsResult;
  validation: ValidationResult;
  deepening: DeepeningResult;
  spec_export: SpecExportResult;
}
