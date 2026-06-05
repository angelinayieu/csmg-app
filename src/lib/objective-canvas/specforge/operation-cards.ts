// ── SpecForge · Operation Card System (CLIENT, tldraw-free) ──────────
//
// Per specforge_operation_card_system.md: a DISPLAY + INSPECTION layer,
// NOT a new LLM engine. Every field the spec's §18 prompt asks for is
// already in our data (engine_id → ENGINE_LABEL, critic → quality_gate,
// chain order → downstream_effects, accumulator → constraints, etc.), so
// this synthesizes operation cards deterministically — zero LLM cost.
//
// Reasoning card vs operation card (spec §9): the existing specforge-card
// shape IS the reasoning card. This module produces the parallel operation
// card that the Operation Lane renders. Both reference the same engineRunId
// for navigation + provenance.
//
// Server-and-client safe (no tldraw imports, no fetch).

import type {
  SpecForgeEngineId,
  PowerUpResult,
  TargetUserResult,
  ProblemTreeResult,
  DesiredResultResult,
  CrossAnalysisResult,
  QuestionExpansionResult,
  ConvergenceResult,
  DifferentiationResult,
  SolutionFamiliesResult,
  MvpVariationsResult,
  EvaluationResult,
  RecommendationResult,
  ComplexityAllocationResult,
  FeatureCardsResult,
  FeatureCard,
  FeatureMechanismsResult,
  DataPointsResult,
  LayerOptimizationResult,
  ValidationResult,
  DeepeningResult,
  SpecExportResult,
} from "./types";
import { SPECFORGE_CHAIN, ENGINE_LABEL, PHASE_OF_ENGINE } from "./types";
import type { QualityCriticResult } from "./quality-critic";
import type { Constraint } from "./constraints";

// ── Operation type (spec §6) ──
// Per-engine classification used by the lane to group + by actions to map.
export type OperationType =
  | "interpretation"
  | "depth_selection"
  | "modeling"
  | "causal_modeling"
  | "layering"
  | "cross_analysis"
  | "convergence"
  | "differentiation"
  | "divergence"
  | "mvp_generation"
  | "feature_generation"
  | "mechanism_generation"
  | "data_optimization"
  | "evaluation"
  | "validation"
  | "audit"
  | "complexity"
  | "summary"
  | "export";

export const OPERATION_TYPE_OF_ENGINE: Record<SpecForgeEngineId, OperationType> = {
  power_up: "interpretation",
  target_user: "layering",
  problem_tree: "causal_modeling",
  desired_result: "layering",
  cross_analysis: "cross_analysis",
  question_expansion: "modeling",
  convergence: "convergence",
  differentiation: "differentiation",
  solution_families: "divergence",
  mvp_variations: "mvp_generation",
  evaluation: "evaluation",
  recommendation: "evaluation",
  complexity_allocation: "complexity",
  feature_cards: "feature_generation",
  feature_mechanisms: "mechanism_generation",
  data_points: "data_optimization",
  layer_optimization: "audit",
  validation: "validation",
  deepening: "summary",
  spec_export: "export",
};

// ── Reasoning method (spec §12) ──
// One-line description of what each engine actually does. Concise enough
// to fit on a board card; specific enough to be useful (not generic).
export const REASONING_METHOD: Record<SpecForgeEngineId, string> = {
  power_up: "Promotes a raw idea into a clean summary with explicit assumptions.",
  target_user: "Layered user model: segment, core need, JTBD, constraints, anti-segments.",
  problem_tree: "Multifactor causal modeling: variables, loops, contradictions, root tournament.",
  desired_result: "Stacks functional, emotional, behavioral, and strategic results.",
  cross_analysis: "Audits user×problem×result fit, names cause→result blockages and weak links.",
  question_expansion: "Generates decision-changing questions ranked by impact and node-tied.",
  convergence: "Distills root constraint, first-principles need, and product thesis.",
  differentiation: "Compares alternatives, names a defensible differentiation thesis.",
  solution_families: "Generates 3–5 solution families with distinct theories of change.",
  mvp_variations: "Shapes top MVP directions with scored tradeoffs per family.",
  evaluation: "Weighted rubric over MVPs; per-criterion scores + flip-the-decision assumptions.",
  recommendation: "Picks the first build with constraint citation + assumptions to test.",
  complexity_allocation: "Allocates a 100-point complexity budget across 6 buckets + scope rules.",
  feature_cards: "Decomposes the MVP into 3–5 traceable feature cards with priorities.",
  feature_mechanisms: "Designs trigger → process → output for each top feature; rejects alternatives.",
  data_points: "Specifies per-mechanism data with friction/privacy/proxy analysis.",
  layer_optimization: "Walks macro → micro → mechanism and audits vertical alignment.",
  validation: "Designs 2–4 ranked experiments tied to flip-the-decision assumptions.",
  deepening: "Snapshots iteration baselines and names the next high-leverage iteration.",
  spec_export: "Synthesizes the build spec + coding-agent prompt with full provenance.",
};

// ── Downstream effects (spec §15) ──
// "If this operation changes, these downstream modules may become stale."
// Derived from chain order: every engine AFTER this one in SPECFORGE_CHAIN
// is potentially affected. Pre-computed once; cheap to read.
export const DOWNSTREAM_OF_ENGINE: Record<SpecForgeEngineId, SpecForgeEngineId[]> = (() => {
  const out = {} as Record<SpecForgeEngineId, SpecForgeEngineId[]>;
  for (let i = 0; i < SPECFORGE_CHAIN.length; i++) {
    const engine = SPECFORGE_CHAIN[i];
    out[engine] = SPECFORGE_CHAIN.slice(i + 1);
  }
  return out;
})();

// ── Operation status (spec §7.1, §14, §21) ──
export type OperationStatus =
  | "not_started"
  | "running"
  | "passed"
  | "failed"
  | "repaired"
  | "stale";

// ── Actions (spec §16, §17) ──
// Generic actions common to every operation, plus engine-specific overrides.
const COMMON_ACTIONS: readonly string[] = [
  "inspect",
  "rerun",
  "show inputs",
  "show outputs",
  "show downstream effects",
];

const ENGINE_SPECIFIC_ACTIONS: Partial<Record<SpecForgeEngineId, readonly string[]>> = {
  power_up: ["edit interpretation", "separate explicit vs inferred", "mark assumption critical"],
  problem_tree: ["add variables", "generate loops", "rerun root tournament", "repair shallow model"],
  desired_result: ["add result", "deepen stack", "mark stale"],
  cross_analysis: ["surface drift", "deepen blockage analysis"],
  question_expansion: ["filter by impact", "tie to node", "answer question"],
  convergence: ["challenge root constraint", "show rejected interpretations", "rerun tournament"],
  differentiation: ["add alternative", "run research", "generate deeper gap"],
  solution_families: ["generate another family", "compare theories of change"],
  mvp_variations: ["generate another candidate", "rescore", "select winner"],
  evaluation: ["change weights", "run stricter evaluation", "show why this won"],
  recommendation: ["accept", "override winner", "view evaluation chain"],
  complexity_allocation: ["edit budget", "delay scope", "remove scope"],
  feature_cards: ["generate mechanism", "convert to task", "split feature", "delay feature"],
  feature_mechanisms: ["show data flow", "compare alternatives", "convert to task"],
  data_points: ["replace with proxy", "remove data point", "mark required"],
  layer_optimization: ["jump to broken alignment", "trigger repair", "mark accepted"],
  validation: ["mark experiment running", "record evidence", "reprioritize"],
  deepening: ["start next iteration", "compare versions"],
  spec_export: ["copy build spec", "copy agent prompt", "export to file"],
};

export function actionsForEngine(engine: SpecForgeEngineId): readonly string[] {
  const specific = ENGINE_SPECIFIC_ACTIONS[engine];
  if (!specific) return COMMON_ACTIONS;
  return [...specific, ...COMMON_ACTIONS];
}

// ── OperationCard — the spec's §5 schema, kept tight ──
export interface OperationCard {
  /** Stable id for the operation card itself — derived, not persisted. */
  operationCardId: string;
  /** FK to specforge_engine_runs.id (Phase A persistence). Empty when the
   *  engine hasn't run yet. */
  engineRunId: string;
  engine: SpecForgeEngineId;
  operationName: string;
  operationType: OperationType;
  /** Why this operation runs — short prose, matches ENGINE_LABEL prose. */
  purpose: string;
  /** What this operation consumed (compact summary, NOT full JSON — §11). */
  inputSummary: string;
  /** How this operation thinks (1-line method — §12). */
  reasoningMethod: string;
  /** What this operation produced (1-line, fact-bearing — §13). */
  outputSummary: string;
  /** Constraint texts consumed from accumulated set. */
  constraintsUsed: string[];
  /** Constraint texts CREATED by this operation. */
  constraintsCreated: string[];
  /** Gate status from the critic. */
  status: OperationStatus;
  /** 0..100 — engine's self-reported confidence when available. */
  confidence: number | null;
  /** Issue count from the quality critic (0 = clean). */
  issueCount: number;
  /** Downstream engines that depend on this output (chain successors). */
  downstreamEffects: SpecForgeEngineId[];
  /** Actions surfaced in the side panel; mostly UI hints (spec §16). */
  actions: readonly string[];
  /** ISO timestamp the engine returned; empty when not run. */
  completedAt: string;
}

// ── Engine-specific output summarizers ──
// One-line, fact-bearing summary per engine. Falls through to a generic
// "Produced N decision keys" if a switch branch hasn't been written yet.
const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** Public — the runner calls this per-engine to pre-compute the lane
 *  summary at the moment of placement, so the Operation Lane stays
 *  render-cheap. */
export function outputSummaryFor(
  engine: SpecForgeEngineId,
  result: unknown,
): string {
  return outputSummary(engine, result);
}

function outputSummary(engine: SpecForgeEngineId, result: unknown): string {
  if (!result || typeof result !== "object") return "(no output)";
  switch (engine) {
    case "power_up": {
      const r = result as PowerUpResult;
      return clean(r.clean_summary) || "Clean summary produced";
    }
    case "target_user": {
      const r = result as TargetUserResult;
      const seg = clean(r.primary_segment);
      const need = clean(r.core_need);
      return seg && need ? `${seg} · need: ${need}` : seg || need || "Target user modeled";
    }
    case "problem_tree": {
      const r = result as ProblemTreeResult;
      const vars = len(r.variables);
      const loops = len(r.feedback_loops);
      const roots = len(r.root_constraint_tournament?.candidates);
      return `${vars} variables · ${loops} loops · ${roots} root candidates`;
    }
    case "desired_result": {
      const r = result as DesiredResultResult;
      return clean(r.functional_result) || "Desired result stacked";
    }
    case "cross_analysis": {
      const r = result as CrossAnalysisResult;
      const blockages = len(r.cause_result_blockages);
      const contradictions = len(r.cross_model_contradictions);
      return `${blockages} blockages · ${contradictions} contradictions`;
    }
    case "question_expansion": {
      const r = result as QuestionExpansionResult;
      const n = len(r.questions);
      return `${n} decision-changing question${n === 1 ? "" : "s"}`;
    }
    case "convergence": {
      const r = result as ConvergenceResult;
      return clean(r.distilled_product_thesis) || "Product thesis distilled";
    }
    case "differentiation": {
      const r = result as DifferentiationResult;
      return clean(r.differentiation_thesis) || "Differentiation thesis named";
    }
    case "solution_families": {
      const r = result as SolutionFamiliesResult;
      return `${len(r.solution_families)} solution famil${len(r.solution_families) === 1 ? "y" : "ies"}`;
    }
    case "mvp_variations": {
      const r = result as MvpVariationsResult;
      return `${len(r.mvp_variations)} MVP variation${len(r.mvp_variations) === 1 ? "" : "s"}`;
    }
    case "evaluation": {
      const r = result as EvaluationResult;
      const winner = clean(r.winner);
      return winner ? `Rubric winner: ${winner}` : "Rubric scored";
    }
    case "recommendation": {
      const r = result as RecommendationResult;
      return clean(r.recommendation) || "First build chosen";
    }
    case "complexity_allocation": {
      const r = result as ComplexityAllocationResult;
      const total = r.budget?.total ?? 0;
      const philosophy = clean(r.budget?.philosophy);
      return philosophy
        ? `Budget ${total}/100 · ${philosophy}`
        : `Budget allocated (${total}/100)`;
    }
    case "feature_cards": {
      const r = result as FeatureCardsResult;
      const must = (r.features ?? []).filter(
        (f: FeatureCard) => clean(f?.build_priority) === "must_have",
      ).length;
      return `${len(r.features)} feature${len(r.features) === 1 ? "" : "s"} · ${must} must-have`;
    }
    case "feature_mechanisms": {
      const r = result as FeatureMechanismsResult;
      return `${len(r.mechanisms)} mechanism${len(r.mechanisms) === 1 ? "" : "s"} designed`;
    }
    case "data_points": {
      const r = result as DataPointsResult;
      const kept = (r.data_points ?? []).filter((p) => clean(p?.disposition) !== "removed").length;
      const removed = len(r.removed_data);
      return `${kept} kept · ${removed} removed`;
    }
    case "layer_optimization": {
      const r = result as LayerOptimizationResult;
      const broken = (r.alignment_checks ?? []).filter((c) => c?.verdict === "broken").length;
      const drifted = (r.alignment_checks ?? []).filter((c) => c?.verdict === "drifted").length;
      return broken + drifted === 0
        ? "All layers aligned"
        : `${broken} broken · ${drifted} drifted`;
    }
    case "validation": {
      const r = result as ValidationResult;
      return `${len(r.experiments)} experiment${len(r.experiments) === 1 ? "" : "s"} · ${len(r.critical_assumptions)} assumption${len(r.critical_assumptions) === 1 ? "" : "s"}`;
    }
    case "deepening": {
      const r = result as DeepeningResult;
      return `Iteration v${r.iteration_number ?? 1} baseline recorded`;
    }
    case "spec_export": {
      const r = result as SpecExportResult;
      return clean(r.product_summary?.product_name) || "Build spec exported";
    }
  }
}

// ── Input summary ──
// Derived from chain position: which engines feed this one. Compact prose
// without exposing prompt detail (spec §11 rule).
function inputSummary(engine: SpecForgeEngineId): string {
  const idx = SPECFORGE_CHAIN.indexOf(engine);
  if (idx <= 0) return "Raw idea + (optional) prior round.";
  const upstream = SPECFORGE_CHAIN.slice(Math.max(0, idx - 4), idx)
    .map((e) => ENGINE_LABEL[e])
    .join(", ");
  return `Upstream context: ${upstream}.`;
}

// ── Status derivation ──
function deriveStatus(critic: QualityCriticResult | null): OperationStatus {
  if (!critic) return "passed";
  if (critic.repaired) return "repaired";
  if (critic.passed) return "passed";
  return "failed";
}

function deriveConfidence(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { confidence?: unknown; confidence_level?: unknown };
  const v = r.confidence;
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.min(100, Math.round(v)));
  if (typeof r.confidence_level === "string") {
    const s = r.confidence_level.toLowerCase();
    if (s === "high") return 80;
    if (s === "medium") return 55;
    if (s === "low") return 25;
  }
  return null;
}

// ── Build one operation card ──
export interface BuildOperationCardInput {
  engine: SpecForgeEngineId;
  result: unknown;
  critic: QualityCriticResult | null;
  /** Full constraint set AT the moment this engine returned. Used for
   *  constraintsUsed (everything from earlier engines) + constraintsCreated
   *  (rows where source === engine). */
  constraintsAtTime: readonly Constraint[];
  engineRunId?: string;
  completedAt?: string;
}

export function buildOperationCard(input: BuildOperationCardInput): OperationCard {
  const { engine, result, critic, constraintsAtTime } = input;
  const used = constraintsAtTime
    .filter((c) => c.source !== engine)
    .map((c) => c.text)
    .slice(0, 6);
  const created = constraintsAtTime
    .filter((c) => c.source === engine)
    .map((c) => c.text)
    .slice(0, 6);
  return {
    operationCardId: `op-${engine}-${input.completedAt ?? "now"}`,
    engineRunId: input.engineRunId ?? "",
    engine,
    operationName: ENGINE_LABEL[engine],
    operationType: OPERATION_TYPE_OF_ENGINE[engine],
    purpose: ENGINE_LABEL[engine],
    inputSummary: inputSummary(engine),
    reasoningMethod: REASONING_METHOD[engine],
    outputSummary: outputSummary(engine, result),
    constraintsUsed: used,
    constraintsCreated: created,
    status: deriveStatus(critic),
    confidence: deriveConfidence(result),
    issueCount: critic?.issues.length ?? 0,
    downstreamEffects: DOWNSTREAM_OF_ENGINE[engine],
    actions: actionsForEngine(engine),
    completedAt: input.completedAt ?? new Date().toISOString(),
  };
}

// ── Placeholder for not-yet-run engines ──
// The Operation Lane uses this so every engine has a card from the start;
// the status flips from "not_started" → "running" → "passed/failed" as the
// chain proceeds.
export function defaultOperationCard(engine: SpecForgeEngineId): OperationCard {
  return {
    operationCardId: `op-${engine}-default`,
    engineRunId: "",
    engine,
    operationName: ENGINE_LABEL[engine],
    operationType: OPERATION_TYPE_OF_ENGINE[engine],
    purpose: ENGINE_LABEL[engine],
    inputSummary: inputSummary(engine),
    reasoningMethod: REASONING_METHOD[engine],
    outputSummary: "—",
    constraintsUsed: [],
    constraintsCreated: [],
    status: "not_started",
    confidence: null,
    issueCount: 0,
    downstreamEffects: DOWNSTREAM_OF_ENGINE[engine],
    actions: actionsForEngine(engine),
    completedAt: "",
  };
}

/** Phase of an engine — re-export for the lane so it can group by act. */
export { PHASE_OF_ENGINE };
