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
  | "convergence" // root constraint · first-principles need · thesis (graphite)
  | "alternatives" // what exists today (amber)
  | "differentiation" // differentiation thesis (indigo)
  | "families" // solution families — the diverge lead-in (bronze-gold)
  | "mvp" // top MVP variations (warm gold)
  | "recommendation"; // recommended first build (green)

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
  problem: { label: "Problem cause tree", color: "#EE6B6E" },
  result: { label: "Desired result", color: "#8E7BEA" },
  convergence: { label: "Convergence", color: "#566273" },
  alternatives: { label: "Alternatives today", color: "#D7993A" },
  differentiation: { label: "Differentiation", color: "#6366D6" },
  families: { label: "Solution families", color: "#A8762F" },
  mvp: { label: "MVP variation", color: "#C8923A" },
  recommendation: { label: "Recommended first build", color: "#2FA968" },
};

/** Stable engine ids — also the dispatch key for the route + prompt registry. */
export type SpecForgeEngineId =
  | "power_up"
  | "target_user"
  | "problem_tree"
  | "desired_result"
  | "convergence"
  | "differentiation"
  | "solution_families"
  | "mvp_variations"
  | "recommendation";

/** The chain the runner executes, in causal order (converge → diverge →
 *  converge). Each engine receives the accumulated context of the ones before
 *  it. Ordering is faithful to the spec's Minimal Vertical Slice (§7). */
export const SPECFORGE_CHAIN: SpecForgeEngineId[] = [
  "power_up",
  "target_user",
  "problem_tree",
  "desired_result",
  "convergence",
  "differentiation",
  "solution_families",
  "mvp_variations",
  "recommendation",
];

/** Human label per engine — used for progress copy ("Forging target user…"). */
export const ENGINE_LABEL: Record<SpecForgeEngineId, string> = {
  power_up: "Clarifying the idea",
  target_user: "Modeling the target user",
  problem_tree: "Tracing the problem to its root",
  desired_result: "Layering the desired result",
  convergence: "Converging on the product thesis",
  differentiation: "Comparing the alternatives",
  solution_families: "Generating solution families",
  mvp_variations: "Shaping MVP variations",
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

export interface ProblemTreeResult {
  surface_problem: string;
  cause_tree: CauseNode[];
  root_constraint: string;
  first_principles_need: string;
  highest_leverage_cause: string;
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
  convergence: ConvergenceResult;
  differentiation: DifferentiationResult;
  solution_families: SolutionFamiliesResult;
  mvp_variations: MvpVariationsResult;
  recommendation: RecommendationResult;
}
