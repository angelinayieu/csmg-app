/**
 * Phase 7: Multi-Step Strategy Engine
 *
 * Generates strategy through a 3-step reasoning chain:
 *   Step 1: DIAGNOSIS — structural analysis using graph metrics + probability spaces
 *   Step 2: SYNTHESIS — generate strategic options with reasoning traces
 *   Step 3: VERIFICATION — stress-test options against failure modes
 *   Step 4: FINAL OUTPUT — produce StrategicRecommendation (backward-compatible)
 *
 * Used by both strategy-refresh/route.ts and synthesize/route.ts
 * to eliminate the duplicated single-shot strategy generation.
 */

import { llmJSON } from "@/lib/llm";
import { getDiagnosisPrompt, getSynthesisPrompt, getVerificationPrompt } from "@/lib/prompts/strategy-steps";
import { getStrategicRecommendationPrompt } from "@/lib/prompts/strategic-recommendation";
import type { StrategyPipelineContext } from "@/lib/prompts/strategic-recommendation";
import { buildProbabilitySpacesForGraph } from "@/lib/pipeline/probability-space-engine";
import { detectIntersections } from "@/lib/pipeline/intersection-detector";
import { computeGraphStructure } from "@/lib/pipeline/graph-structure";
import type { GraphStructure } from "@/lib/pipeline/graph-structure";
import { classifyAllSpacesAndIntersections, extractObjectiveEntityIds } from "@/lib/pipeline/strategy-layer-classifier";
import { getL4InsightPrompt, getL3ReasoningPrompt, getL2MethodPrompt, getL1OutcomePrompt } from "@/lib/prompts/strategy-layer-prompts";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { StrategicRecommendation, StrategyLayers, RankedStrategy, StrategyChangeProposal, L4AtomicInsight, L3ReasoningUnit, L2MethodChain, L1Outcome } from "@/types/strategy";
import type { ImprovementGoal, SuggestedObjective, ObjectiveBenchmark } from "@/types/goals";
import type {
  StrategicDiagnosis,
  StrategySynthesisResult,
  StrategyVerification,
  StrategyReasoningTrace,
  ProbabilitySpaceSummary,
} from "@/types/strategy-reasoning";
import type { ProbabilitySpace, SpaceIntersection, FailurePoint, SharedNode } from "@/types/probability-space";
import { validateRankedStrategies } from "@/lib/validation/strategy-validation";
import type { StrategyValidationIssue } from "@/lib/validation/strategy-validation";

// ── Input params ──

export interface MultiStepStrategyParams {
  synthesis: SynthesisData;
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  entityNameMap: Map<string, string>;
  pipelineCtx: StrategyPipelineContext;
  activeGoal?: ImprovementGoal | null;
  confirmedStrategy?: StrategicRecommendation | null;
  suggestedObjectives?: SuggestedObjective[];
  benchmark?: ObjectiveBenchmark | null;
  /** Pre-fetched expansion data keyed by entity_id */
  expansionsMap?: Map<string, { sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }>;
  /** Wave D L0.2 — pre-formatted user baseline block (persona_tags +
   *  behavior_summary + goal_preferences) to prepend to the final
   *  strategy LLM call. Caller builds this via
   *  `formatBaselineForPrompt(loadUserBaselineForPrompt(db, userId))`.
   *  Empty string when user has no digest yet. */
  userBaselineBlock?: string;
  /**
   * Prior-run context block (Phase 1 Step 8 extension). Rendered from
   * `formatPriorContextPrompt(readRunContext(...))`, it inlines the
   * stage digests, entities/edges/proposals already produced upstream
   * so the strategy LLM treats them as ground truth instead of
   * re-deriving them. Empty string when this is the first pipeline
   * stage in a run or no run context exists.
   */
  priorRunContextBlock?: string;
  /**
   * Disciplined KG richness block (Phase 1 Step 9). Replaces the
   * legacy name+id+centrality-only view with ranked top entities
   * carrying causal_role, manifold dimensions, temporal decay,
   * high-confidence edges with dynamics/polarity/conditions, and
   * top evidence claims. Hard-capped + default-suppressed so it adds
   * signal without bloating the prompt. Empty string when the KG
   * has nothing worth grounding against.
   */
  richKgContextBlock?: string;
  /**
   * Cross-space similar-patterns block (Phase 1 Step 10). Retrieved
   * via pgvector from the user's broader `memory_items` store,
   * filtered to exclude the current space so it truly reflects prior
   * work. Empty string for first-time users or when no hits clear
   * the similarity floor — the prompt stays clean in both cases.
   */
  similarPatternsBlock?: string;
  /**
   * Phase 2I — domain proficiency preface. Rendered from
   * `formatLearningContext(db, userId, domain)`, tells the LLM how
   * deep the user already is in this domain (coverage, calibration,
   * novelty, citation density + trend). Empty string on first visit
   * to a domain. Lets the model skip re-explaining basics when the
   * user is already fluent.
   */
  learningContextBlock?: string;
  /** Wave D L0.3 — Wave A entity_objectives junction for activeGoal.
   *  The caller resolves via active-objectives.ts and passes the top-N
   *  entities (by LLM-tagger confidence) that serve this goal. The
   *  strategy engine injects them into the final recommendation prompt
   *  so the LLM can name actual KG entities in its output. */
  activeGoalServedByEntities?: Array<{
    entity_id: string;
    name: string;
    entity_category: string | null;
    confidence: number;
    rationale: string | null;
  }>;
}

// ── Output ──

export interface MultiStepStrategyResult {
  recommendation: StrategicRecommendation;
  rankedStrategies: RankedStrategy[];
  changeProposals: StrategyChangeProposal[] | null;
  reasoningTrace: StrategyReasoningTrace;
  probabilitySpaceSummary: ProbabilitySpaceSummary;
  /** Full computed probability spaces (persisted so the /probability page can hydrate without recomputing) */
  probabilitySpaces: ProbabilitySpace[];
  /** Full computed space intersections */
  spaceIntersections: SpaceIntersection[];
  /** Post-generation validation of entity/cycle references */
  strategyValidation: import("@/lib/validation/strategy-validation").StrategyValidationResult;
}

// ── Serializers (convert rich objects to prompt-friendly summaries) ──

function serializeProbabilitySpaces(spaces: ProbabilitySpace[]): Array<{
  edge_label: string;
  total_probability: number;
  failure_points: Array<{ name: string; mode: string; probability: number; blast_radius: string }>;
  critical_path: string[];
}> {
  return spaces.slice(0, 24).map((s) => ({
    edge_label: `${s.source_entity_name} → ${s.target_entity_name}`,
    total_probability: s.total_pathway_probability ?? 0,
    failure_points: (s.failure_points ?? []).slice(0, 4).map((fp: FailurePoint) => ({
      name: fp.node_name ?? fp.node_id,
      mode: fp.failure_mode ?? "unknown",
      probability: fp.failure_probability ?? 0,
      blast_radius: fp.blast_radius ?? "local",
    })),
    critical_path: s.critical_path ?? [],
  }));
}

function serializeIntersections(intersections: SpaceIntersection[]): Array<{
  label_a: string;
  label_b: string;
  shared_variables: string[];
  novelty: number;
  impact: number;
  innovation_potential: string;
  insight: string;
}> {
  return intersections.slice(0, 16).map((i) => ({
    label_a: i.space_a_label ?? i.space_a_id,
    label_b: i.space_b_label ?? i.space_b_id,
    shared_variables: (i.shared_nodes ?? []).map((n: SharedNode) => n.name ?? n.node_a_id),
    novelty: i.novelty_score ?? 0,
    impact: i.impact_score ?? 0,
    innovation_potential: i.innovation_potential ?? "unknown",
    insight: i.insight ?? "",
  }));
}

function extractHiddenSignals(synthData: SynthesisData): Array<{
  name: string;
  type: string;
  impact: number;
  description: string;
}> {
  const raw = (synthData as unknown as Record<string, unknown>).hidden_signals;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s: Record<string, unknown>) => (s.trajectory_impact as number ?? 0) >= 5)
    .slice(0, 10)
    .map((s: Record<string, unknown>) => ({
      name: (s.signal_name as string) ?? "unknown",
      type: (s.signal_type as string) ?? "unknown",
      impact: (s.trajectory_impact as number) ?? 0,
      description: (s.description as string) ?? "",
    }));
}

function deriveGoalEntityIds(params: MultiStepStrategyParams): string[] {
  const ids = new Set<string>();
  const suggested = params.suggestedObjectives ?? [];

  if (params.activeGoal) {
    const goalTitle = params.activeGoal.title.trim().toLowerCase();
    const matched = suggested.find((s) => s.title.trim().toLowerCase() === goalTitle);
    if (matched?.source_entity_id) ids.add(matched.source_entity_id);
  }

  if (ids.size === 0) {
    for (const s of suggested.slice(0, 3)) {
      if (s.source_entity_id) ids.add(s.source_entity_id);
    }
  }

  return Array.from(ids);
}

// ── Layer cross-ref strip audit ───────────────────────────────────────
//
// The strategy_layers sub-graph uses internal IDs (L1_1, L2_1, L3_1, L4_1)
// that the LLM sometimes emits inconsistently — e.g. L2_1.serves_l1 points
// at L1_9 when no L1_9 exists. The normalization pass used to silently
// `.filter()` those refs out, which hid generator drift from the validation
// result. Now we collect each drop as a StrategyValidationIssue so
// downstream surfaces (quality score, UI warnings, eval dashboards) can see
// the audit trail.
//
// Usage:
//   const audit: StrategyValidationIssue[] = [];
//   arr = stripInvalidRefs(arr, validIdSet, audit, { field, ownerId, context });
//   // ...at end: push audit into strategyValidation.issues
function stripInvalidRefs(
  refs: string[],
  validIds: Set<string>,
  audit: StrategyValidationIssue[],
  ctx: { field: string; ownerId: string; context: string; strategyRank?: number },
): string[] {
  const kept: string[] = [];
  for (const id of refs) {
    if (validIds.has(id)) {
      kept.push(id);
    } else {
      audit.push({
        type: "stripped_layer_reference",
        severity: "warning",
        message: `${ctx.context}: ${ctx.ownerId}.${ctx.field} referenced "${id}" which does not exist in the strategy layers${ctx.strategyRank !== undefined ? ` (rank ${ctx.strategyRank})` : ""}`,
        entity_id: id,
        context: ctx.context,
      });
    }
  }
  return kept;
}

// ── Main engine ──

export async function generateMultiStepStrategy(
  params: MultiStepStrategyParams
): Promise<MultiStepStrategyResult> {
  const startTime = Date.now();
  const stepTimings = { diagnosis_ms: 0, synthesis_ms: 0, verification_ms: 0, layer_generation_ms: 0, final_ms: 0 };

  // ── Pre-compute: graph structure + probability spaces ──
  const graphStructure: GraphStructure = computeGraphStructure(
    params.entities, params.edges, params.cycles
  );

  let probabilitySpaces: ProbabilitySpace[] = [];
  let spaceIntersections: SpaceIntersection[] = [];
  const goalEntityIds = deriveGoalEntityIds(params);

  try {
    probabilitySpaces = buildProbabilitySpacesForGraph(
      params.edges, params.entities, params.expansionsMap, goalEntityIds
    );
    if (probabilitySpaces.length > 0) {
      spaceIntersections = detectIntersections(
        probabilitySpaces, params.entities, params.edges, 40
      );
    }
  } catch (err) {
    console.warn("[strategy-engine] Probability space computation failed (non-fatal):", err);
  }

  // ── Classify spaces and intersections by strategy layer (L1-L4) ──
  const objectiveEntityIds = extractObjectiveEntityIds(params.suggestedObjectives);
  const hubEntityIds = graphStructure.centrality_rankings.slice(0, 10).map((h) => h.entity_id);
  const layerClassification = classifyAllSpacesAndIntersections({
    spaces: probabilitySpaces,
    intersections: spaceIntersections,
    goalEntityIds,
    objectiveEntityIds,
    hubEntityIds,
  });

  const serializedSpaces = serializeProbabilitySpaces(probabilitySpaces);
  const serializedIntersections = serializeIntersections(spaceIntersections);
  const hiddenSignals = extractHiddenSignals(params.synthesis);

  console.log(`[strategy-engine] Pre-compute complete: ${probabilitySpaces.length} spaces, ${spaceIntersections.length} intersections, ${graphStructure.centrality_rankings.length} hub entities, layer distribution: L1=${layerClassification.byLayer.L1.length} L2=${layerClassification.byLayer.L2.length} L3=${layerClassification.byLayer.L3.length} L4=${layerClassification.byLayer.L4.length}`);

  // ── Step 1: Diagnosis ──
  const diagStart = Date.now();
  console.log("[strategy-engine] Step 1: Diagnosis...");

  let diagnosis: StrategicDiagnosis;
  try {
    const diagPrompt = getDiagnosisPrompt({
      graphStructure,
      probabilitySpaces: serializedSpaces,
      intersections: serializedIntersections,
      synthesis: params.synthesis,
      hiddenSignals,
      convergences: params.pipelineCtx?.convergences,
      entityCount: params.entities.length,
      edgeCount: params.edges.length,
    });

    diagnosis = await llmJSON<StrategicDiagnosis>({
      system: diagPrompt.system,
      user: diagPrompt.user,
      maxTokens: 6144,
      temperature: 0.2,
    });
    // Guard against LLM returning partial/malformed diagnosis
    // The LLM may return a valid JSON object but miss nested fields that
    // downstream code accesses unconditionally — deep-default everything.
    diagnosis.core_problem_statement = diagnosis.core_problem_statement
      || "Structural diagnosis completed without explicit problem statement.";
    diagnosis.confidence = typeof diagnosis.confidence === "number" ? diagnosis.confidence : 30;
    diagnosis.reasoning_trace = Array.isArray(diagnosis.reasoning_trace) ? diagnosis.reasoning_trace : [];

    if (!diagnosis.graph_insights || typeof diagnosis.graph_insights !== "object") {
      diagnosis.graph_insights = { hub_entities: [], bottleneck_edges: [], critical_cycles: [], isolated_clusters: [] };
    } else {
      diagnosis.graph_insights.hub_entities = Array.isArray(diagnosis.graph_insights.hub_entities) ? diagnosis.graph_insights.hub_entities : [];
      diagnosis.graph_insights.bottleneck_edges = Array.isArray(diagnosis.graph_insights.bottleneck_edges) ? diagnosis.graph_insights.bottleneck_edges : [];
      diagnosis.graph_insights.critical_cycles = Array.isArray(diagnosis.graph_insights.critical_cycles) ? diagnosis.graph_insights.critical_cycles : [];
      diagnosis.graph_insights.isolated_clusters = Array.isArray(diagnosis.graph_insights.isolated_clusters) ? diagnosis.graph_insights.isolated_clusters : [];
    }

    if (!diagnosis.probability_insights || typeof diagnosis.probability_insights !== "object") {
      diagnosis.probability_insights = { high_risk_failure_points: [], critical_path_weaknesses: [], intersection_opportunities: [] };
    } else {
      diagnosis.probability_insights.high_risk_failure_points = Array.isArray(diagnosis.probability_insights.high_risk_failure_points) ? diagnosis.probability_insights.high_risk_failure_points : [];
      diagnosis.probability_insights.critical_path_weaknesses = Array.isArray(diagnosis.probability_insights.critical_path_weaknesses) ? diagnosis.probability_insights.critical_path_weaknesses : [];
      diagnosis.probability_insights.intersection_opportunities = Array.isArray(diagnosis.probability_insights.intersection_opportunities) ? diagnosis.probability_insights.intersection_opportunities : [];
    }

    if (!diagnosis.signal_synthesis || typeof diagnosis.signal_synthesis !== "object") {
      diagnosis.signal_synthesis = { converging_signals: [], contradictory_signals: [], blind_spots: [] };
    } else {
      diagnosis.signal_synthesis.converging_signals = Array.isArray(diagnosis.signal_synthesis.converging_signals) ? diagnosis.signal_synthesis.converging_signals : [];
      diagnosis.signal_synthesis.contradictory_signals = Array.isArray(diagnosis.signal_synthesis.contradictory_signals) ? diagnosis.signal_synthesis.contradictory_signals : [];
      diagnosis.signal_synthesis.blind_spots = Array.isArray(diagnosis.signal_synthesis.blind_spots) ? diagnosis.signal_synthesis.blind_spots : [];
    }
  } catch (err) {
    console.warn("[strategy-engine] Diagnosis failed, using fallback:", err);
    diagnosis = {
      core_problem_statement: "Unable to complete structural diagnosis — proceeding with synthesis findings only.",
      graph_insights: {
        hub_entities: graphStructure.centrality_rankings.slice(0, 5).map((h) => ({
          ...h,
          why_critical: `High centrality (degree=${h.degree}, betweenness=${h.betweenness})`,
        })),
        bottleneck_edges: [],
        critical_cycles: [],
        isolated_clusters: [],
      },
      probability_insights: {
        high_risk_failure_points: [],
        critical_path_weaknesses: [],
        intersection_opportunities: [],
      },
      signal_synthesis: { converging_signals: [], contradictory_signals: [], blind_spots: [] },
      confidence: 30,
      reasoning_trace: ["Diagnosis step failed — using graph metrics only"],
    };
  }
  stepTimings.diagnosis_ms = Date.now() - diagStart;
  const diagSummary = diagnosis.core_problem_statement ?? "No problem statement returned";
  console.log(`[strategy-engine] Step 1 complete (${stepTimings.diagnosis_ms}ms): "${diagSummary.slice(0, 80)}..."`);

  // ── Step 2: Synthesis ──
  const synthStart = Date.now();
  console.log("[strategy-engine] Step 2: Strategy Synthesis...");

  let synthesisResult: StrategySynthesisResult;
  try {
    const synthPrompt = getSynthesisPrompt({
      diagnosis,
      synthesis: params.synthesis,
      intersections: serializedIntersections,
      goal: params.activeGoal,
      confirmedStrategy: params.confirmedStrategy,
    });

    synthesisResult = await llmJSON<StrategySynthesisResult>({
      system: synthPrompt.system,
      user: synthPrompt.user,
      maxTokens: 8192,
      temperature: 0.3,
    });
    // Guard against partial LLM response
    if (!Array.isArray(synthesisResult.options)) synthesisResult.options = [];
    if (!Array.isArray(synthesisResult.rejected_options)) synthesisResult.rejected_options = [];
    // Ensure at least one option exists
    if (synthesisResult.options.length === 0) {
      synthesisResult.options = [{
        title: "Auto-Generated Strategy",
        strategic_posture: "cautious_validation",
        core_logic: diagnosis.core_problem_statement,
        probability_space_validation: "Generated from graph structure",
        estimated_confidence: 35,
        key_tradeoff: "Single option — synthesis returned empty options",
        reasoning_trace: ["LLM synthesis returned no options — generated fallback"],
      }];
    }
  } catch (err) {
    console.warn("[strategy-engine] Synthesis failed, using single-option fallback:", err);
    synthesisResult = {
      options: [{
        title: "Diagnostic-Guided Strategy",
        strategic_posture: "cautious_validation",
        core_logic: diagnosis.core_problem_statement,
        probability_space_validation: "Unable to validate against probability spaces",
        estimated_confidence: 40,
        key_tradeoff: "Single option generated due to synthesis step failure",
        reasoning_trace: ["Synthesis step failed — generated single option from diagnosis"],
      }],
      rejected_options: [],
    };
  }
  stepTimings.synthesis_ms = Date.now() - synthStart;
  console.log(`[strategy-engine] Step 2 complete (${stepTimings.synthesis_ms}ms): ${synthesisResult.options.length} options, ${synthesisResult.rejected_options.length} rejected`);

  // ── Step 3: Verification ──
  const verifyStart = Date.now();
  console.log("[strategy-engine] Step 3: Verification...");

  let verification: StrategyVerification;
  try {
    const verifyPrompt = getVerificationPrompt({
      synthesisResult,
      diagnosis,
      probabilitySpaces: serializedSpaces,
    });

    verification = await llmJSON<StrategyVerification>({
      system: verifyPrompt.system,
      user: verifyPrompt.user,
      maxTokens: 6144,
      temperature: 0.2,
    });
    // Guard against partial LLM response
    if (!Array.isArray(verification.verifications)) verification.verifications = [];
    if (!Array.isArray(verification.final_ranking)) {
      verification.final_ranking = synthesisResult.options.map((opt, i) => ({
        title: opt.title,
        rank: i + 1,
        adjustment_reason: "Default ranking — verification returned no ranking",
      }));
    }
  } catch (err) {
    console.warn("[strategy-engine] Verification failed, using unverified ranking:", err);
    verification = {
      verifications: synthesisResult.options.map((opt) => ({
        option_title: opt.title,
        failure_mode_exposure: [],
        critical_assumptions: [],
        policy_coherence: { coherent: true, issues: [] },
        verified_confidence: opt.estimated_confidence,
        reasoning_trace: ["Verification step failed — using unverified confidence"],
      })),
      final_ranking: synthesisResult.options.map((opt, i) => ({
        title: opt.title,
        rank: i + 1,
        adjustment_reason: "Unverified — original order preserved",
      })),
    };
  }
  stepTimings.verification_ms = Date.now() - verifyStart;
  console.log(`[strategy-engine] Step 3 complete (${stepTimings.verification_ms}ms): final ranking = [${verification.final_ranking.map((r) => `#${r.rank} ${r.title}`).join(", ")}]`);

  // ── Step 4: Bottom-Up Layer Generation (L4→L3→L2→L1) ──
  const layerStart = Date.now();
  console.log("[strategy-engine] Step 4: Bottom-up layer generation (L4→L3→L2→L1)...");

  // Determine winning option from verification ranking
  const winningOptionTitle = verification.final_ranking[0]?.title ?? synthesisResult.options[0]?.title ?? "Strategy";
  const winningOption = synthesisResult.options.find((o) => o.title === winningOptionTitle) ?? synthesisResult.options[0];

  // Audit sink for the bottom-up pass — merged into strategyValidation
  // after validateRankedStrategies runs, so all strip events surface in
  // the same place instead of vanishing into logs.
  const preBuiltLayerAudit: StrategyValidationIssue[] = [];
  let preBuiltLayers: StrategyLayers | null = null;
  try {
    preBuiltLayers = await generateLayersBottomUp({
      stripAudit: preBuiltLayerAudit,
      layerClassification,
      diagnosis,
      hiddenSignals,
      winningOption: {
        title: winningOption.title,
        core_logic: winningOption.core_logic,
        strategic_posture: winningOption.strategic_posture,
      },
      intersections: spaceIntersections,
      entityNameMap: params.entityNameMap,
      goal: params.activeGoal,
      suggestedObjectives: params.suggestedObjectives,
      synthesis: params.synthesis,
      allSpaces: probabilitySpaces,
      entityCount: params.entities.length,
      graphStructure,
    });
    console.log(`[strategy-engine] Step 4 complete: L4=${preBuiltLayers.l4_insights.length}, L3=${preBuiltLayers.l3_reasoning.length}, L2=${preBuiltLayers.l2_methods.length}, L1=${preBuiltLayers.l1_outcomes.length}`);
  } catch (err) {
    console.warn("[strategy-engine] Bottom-up layer generation failed (non-fatal), final output will generate layers:", err);
  }
  stepTimings.layer_generation_ms = Date.now() - layerStart;

  // ── Step 5: Final output (backward-compatible StrategicRecommendation) ──
  const finalStart = Date.now();
  console.log("[strategy-engine] Step 5: Final strategy generation...");

  // Enrich pipeline context with reasoning results
  const enrichedCtx: StrategyPipelineContext = {
    ...params.pipelineCtx,
  };

  // Inject graph structure
  (enrichedCtx as Record<string, unknown>).graphStructure = {
    hub_entities: graphStructure.centrality_rankings.slice(0, 5),
    bridge_edges: graphStructure.bridge_edges.slice(0, 5),
    density: graphStructure.metrics.density,
    component_count: graphStructure.metrics.component_count,
  };

  // Inject probability spaces
  if (serializedSpaces.length > 0 || serializedIntersections.length > 0) {
    (enrichedCtx as Record<string, unknown>).probabilitySpaces = {
      spaces: serializedSpaces.slice(0, 6),
      intersections: serializedIntersections.slice(0, 4),
    };
  }

  // Inject diagnosis + verification as strategic context
  (enrichedCtx as Record<string, unknown>).strategicDiagnosis = {
    core_problem: diagnosis.core_problem_statement,
    confidence: diagnosis.confidence,
    blind_spots: diagnosis.signal_synthesis.blind_spots,
  };
  (enrichedCtx as Record<string, unknown>).verifiedOptions = verification.final_ranking.map((r) => {
    const v = verification.verifications.find((vv) => vv.option_title === r.title);
    return {
      title: r.title,
      rank: r.rank,
      verified_confidence: v?.verified_confidence ?? 50,
      key_assumptions: (v?.critical_assumptions ?? []).slice(0, 3).map((a) => a.assumption),
      failure_risks: (v?.failure_mode_exposure ?? []).slice(0, 2).map((f) => f.mode),
    };
  });

  // Inject pre-built layers if available
  if (preBuiltLayers) {
    (enrichedCtx as Record<string, unknown>).preBuiltStrategyLayers = preBuiltLayers;
  }

  const stratPrompt = getStrategicRecommendationPrompt(
    params.synthesis,
    params.activeGoal ?? null,
    params.entityNameMap,
    params.suggestedObjectives,
    enrichedCtx,
    params.confirmedStrategy ?? null,
    params.benchmark ?? null
  );

  // The final 16k-token LLM call is the highest-risk step in the engine:
  // rate-limits, JSON-parse failures, or credit-exhaustion previously
  // propagated as an unhandled throw → per-objective Promise.allSettled
  // demoted it → if it was the primary objective, the whole route returned
  // 500. Wrap in try/catch so empty ranked_strategies falls through to the
  // existing fallback assembly below, which constructs a minimal
  // StrategicRecommendation from the diagnosis + synthesis + verification
  // steps that already succeeded. Degraded output is better than a 500.
  type StratResponseShape = {
    ranked_strategies: Array<{
      rank: number;
      recommendation: StrategicRecommendation;
      ranking_rationale: string;
      infrastructure_proposals: import("@/types/strategy").InfrastructureProposal[];
      tradeoff_vs_top: string | null;
    }>;
    change_proposals?: StrategyChangeProposal[];
  };

  // Wave D L0.2 — prepend user baseline (persona_tags +
  // behavior_summary + goal_preferences) when supplied by the caller,
  // so strategy recommendations respect the user's lean.
  // Wave D L0.3 — also prepend the active goal's served_by_entities so
  // the LLM can name actual KG entities in its recommendation.
  const servedByBlock =
    params.activeGoalServedByEntities && params.activeGoalServedByEntities.length > 0
      ? `## Entities this goal is served by (from your KG, ranked by confidence)\n${params.activeGoalServedByEntities
          .map(
            (e) =>
              `- **${e.name}**${e.entity_category ? ` (${e.entity_category})` : ""} — confidence ${Math.round(e.confidence * 100)}%${e.rationale ? `. ${e.rationale}` : ""}`,
          )
          .join("\n")}\n\nReference these entities by name in your recommendation where relevant. They are the concrete KG objects the goal depends on — grounding recommendations in them makes the output actionable.\n\n`
      : "";

  const priorCtxBlock = params.priorRunContextBlock
    ? `${params.priorRunContextBlock}\n\n`
    : "";

  // Phase 1 Step 9 — rich KG block prepended *after* user baseline but
  // *before* the core strategy prompt so the LLM reads:
  //   1. who the user is + prior-run context (framing)
  //   2. similar-pattern hits from the user's past spaces (analogy)
  //   3. the actual KG facts for the current space (grounding)
  //   4. the strategy instructions (task)
  //
  // The leading directive pins the LLM on USING the facts rather than
  // restating them back — this is the anti-noise discipline lever.
  const richKgBlock = params.richKgContextBlock
    ? `${params.richKgContextBlock}\n\nUse the entities, relationships, and evidence above to justify tradeoffs and name specific levers. Do not echo field names back in your output — readers see the strategy, not the prompt.\n\n`
    : "";

  // Phase 1 Step 10 — cross-space pattern analogies. Sits between
  // prior-run context and the current-space KG block so the LLM
  // reads "here's what you've seen before" right before "here's
  // what's in front of you." If empty it collapses out cleanly.
  const patternsBlock = params.similarPatternsBlock
    ? `${params.similarPatternsBlock}\n\n`
    : "";

  // Phase 2I — domain proficiency preface. Sits right after the
  // user baseline (persona/goal prefs) so it reads as "this is you,
  // and this is what you already know" before the analogy + KG
  // grounding blocks land.
  const learningBlock = params.learningContextBlock
    ? `${params.learningContextBlock}\n\n`
    : "";

  const stratUserWithBaseline = [
    priorCtxBlock,
    params.userBaselineBlock ?? "",
    learningBlock,
    patternsBlock,
    richKgBlock,
    servedByBlock,
    stratPrompt.user,
  ].join("");

  let stratResponse: StratResponseShape;
  let finalCallFailed = false;
  try {
    stratResponse = await llmJSON<StratResponseShape>({
      system: stratPrompt.system,
      user: stratUserWithBaseline,
      maxTokens: 16384,
      temperature: 0.3,
    });
  } catch (err) {
    finalCallFailed = true;
    console.warn(
      "[strategy-engine] Final strategy LLM call failed — using degraded fallback from prior steps:",
      err instanceof Error ? err.message : err,
    );
    stratResponse = { ranked_strategies: [] };
  }

  stepTimings.final_ms = Date.now() - finalStart;
  const totalDuration = Date.now() - startTime;
  console.log(
    `[strategy-engine] Step 5 ${finalCallFailed ? "FELL BACK" : "complete"} (${stepTimings.final_ms}ms). Total: ${totalDuration}ms`,
  );

  // ── Assemble output ──
  let recommendation: StrategicRecommendation;
  let rankedStrategies: RankedStrategy[];
  let changeProposals: StrategyChangeProposal[] | null = null;

  if (stratResponse.ranked_strategies?.length) {
    const sorted = [...stratResponse.ranked_strategies].sort((a, b) => a.rank - b.rank);
    rankedStrategies = sorted;
    recommendation = sorted[0].recommendation;
    changeProposals = stratResponse.change_proposals ?? null;
  } else {
    // Fallback
    const fallback = stratResponse as unknown as StrategicRecommendation;
    recommendation = fallback.title && fallback.perspectives
      ? fallback
      : {
          title: synthesisResult.options[0]?.title ?? "Strategy",
          strategic_posture: "cautious_validation" as const,
          confidence: verification.verifications[0]?.verified_confidence ?? 50,
          summary: synthesisResult.options[0]?.core_logic ?? "",
          key_decision: {
            question: diagnosis.core_problem_statement,
            recommended: synthesisResult.options[0]?.title ?? "",
            reasoning: synthesisResult.options[0]?.core_logic ?? "",
            alternatives: [],
            supporting_entities: [],
          },
          perspectives: [],
          micro_tactics: [],
          temporal_phases: [],
          entity_references: [],
          external_evidence_count: 0,
          quality_signals: {
            grounded_in_data: true,
            temporal_aware: false,
            risk_addressed: verification.verifications.length > 0,
            external_validated: false,
          },
        };
    rankedStrategies = [{
      rank: 1,
      recommendation,
      ranking_rationale: "Single strategy from multi-step engine",
      infrastructure_proposals: [],
      tradeoff_vs_top: null,
    }];
  }

  // Override the rank-1 strategy's layers with pre-built precision layers
  if (preBuiltLayers && rankedStrategies.length > 0) {
    rankedStrategies[0].recommendation.strategy_layers = preBuiltLayers;
    recommendation = rankedStrategies[0].recommendation;
    console.log("[strategy-engine] Injected pre-built L4→L1 layers into rank-1 strategy");
  }

  const reasoningTrace: StrategyReasoningTrace = {
    diagnosis,
    synthesis: synthesisResult,
    verification,
    total_duration_ms: totalDuration,
    step_timings: stepTimings,
  };

  const probabilitySpaceSummary: ProbabilitySpaceSummary = {
    spaces_analyzed: probabilitySpaces.length,
    intersections_found: spaceIntersections.length,
    high_risk_points: serializedSpaces.reduce((sum, s) => sum + s.failure_points.length, 0),
    key_insights: [
      ...serializedIntersections.slice(0, 3).map((i) => i.insight),
      ...diagnosis.probability_insights.critical_path_weaknesses.slice(0, 2).map((w) => `Weak link: ${w.weakest_link} on path ${w.path}`),
    ].filter(Boolean),
  };

  // ── Validate & strip broken entity references ──
  const strategyValidation = validateRankedStrategies(
    rankedStrategies,
    params.entities,
    params.edges,
    params.cycles,
    { strip: true }
  );

  // Fold in the bottom-up layer strip audit (collected during Step 4).
  // This is separate from the post-LLM normalization pass below; both sets
  // of strip events end up in strategyValidation.issues so nothing is silent.
  if (preBuiltLayerAudit.length > 0) {
    strategyValidation.issues.push(...preBuiltLayerAudit);
    strategyValidation.stripped_count += preBuiltLayerAudit.length;
    strategyValidation.broken_references += preBuiltLayerAudit.length;
    strategyValidation.score = Math.max(0, strategyValidation.score - preBuiltLayerAudit.length);
    if (preBuiltLayerAudit.length >= 5) strategyValidation.passed = false;
    console.warn(
      `[strategy-engine] Bottom-up layer audit: ${preBuiltLayerAudit.length} refs stripped during Step 4 (score -${preBuiltLayerAudit.length})`,
    );
  }

  if (strategyValidation.issues.length > 0) {
    console.warn(
      `[strategy-engine] Strategy validation: ${strategyValidation.score}/100 — ${strategyValidation.broken_references} broken refs, ${strategyValidation.stripped_count} stripped. Issues: ${strategyValidation.issues.slice(0, 5).map((i) => i.message).join("; ")}`
    );
  }

  // Re-extract recommendation from rank 1 after strip (mutations applied in-place)
  recommendation = rankedStrategies[0]?.recommendation ?? recommendation;

  // ── Default-guard strategy_layers + cross-reference normalization ──
  for (const ranked of rankedStrategies) {
    const rec = ranked.recommendation;
    if (rec.strategy_layers) {
      const sl = rec.strategy_layers;
      sl.l1_outcomes = sl.l1_outcomes ?? [];
      sl.l2_methods = sl.l2_methods ?? [];
      sl.l3_reasoning = sl.l3_reasoning ?? [];
      sl.l4_insights = sl.l4_insights ?? [];
      sl.architecture_summary = sl.architecture_summary ?? "";

      // Normalize pillar_sources defaults
      for (const l1 of sl.l1_outcomes) {
        l1.served_by_l2 = l1.served_by_l2 ?? [];
        l1.pillar_sources = l1.pillar_sources ?? [];
      }
      for (const l2 of sl.l2_methods) {
        l2.causal_chain = l2.causal_chain ?? [];
        l2.serves_l1 = l2.serves_l1 ?? [];
        l2.justified_by_l3 = l2.justified_by_l3 ?? [];
        l2.pillar_sources = l2.pillar_sources ?? [];
      }
      for (const l3 of sl.l3_reasoning) {
        l3.evidence = l3.evidence ?? [];
        l3.justifies_l2 = l3.justifies_l2 ?? [];
        l3.enhanced_by_l4 = l3.enhanced_by_l4 ?? [];
        l3.pillar_sources = l3.pillar_sources ?? [];
      }
      for (const l4 of sl.l4_insights) {
        l4.enhances_l3 = l4.enhances_l3 ?? [];
        l4.pillar_sources = l4.pillar_sources ?? [];
      }

      // Ensure bidirectional cross-references
      const l1Ids = new Set(sl.l1_outcomes.map((o) => o.id));
      const l2Ids = new Set(sl.l2_methods.map((m) => m.id));
      const l3Ids = new Set(sl.l3_reasoning.map((r) => r.id));
      const l4Ids = new Set(sl.l4_insights.map((i) => i.id));

      for (const l2 of sl.l2_methods) {
        for (const l1Id of l2.serves_l1) {
          const l1 = sl.l1_outcomes.find((o) => o.id === l1Id);
          if (l1 && !l1.served_by_l2.includes(l2.id)) l1.served_by_l2.push(l2.id);
        }
        for (const l3Id of l2.justified_by_l3) {
          const l3 = sl.l3_reasoning.find((r) => r.id === l3Id);
          if (l3 && !l3.justifies_l2.includes(l2.id)) l3.justifies_l2.push(l2.id);
        }
      }
      for (const l1 of sl.l1_outcomes) {
        for (const l2Id of l1.served_by_l2) {
          const l2 = sl.l2_methods.find((m) => m.id === l2Id);
          if (l2 && !l2.serves_l1.includes(l1.id)) l2.serves_l1.push(l1.id);
        }
      }
      for (const l4 of sl.l4_insights) {
        for (const l3Id of l4.enhances_l3) {
          const l3 = sl.l3_reasoning.find((r) => r.id === l3Id);
          if (l3 && !l3.enhanced_by_l4.includes(l4.id)) l3.enhanced_by_l4.push(l4.id);
        }
      }
      for (const l3 of sl.l3_reasoning) {
        for (const l4Id of l3.enhanced_by_l4) {
          const l4 = sl.l4_insights.find((i) => i.id === l4Id);
          if (l4 && !l4.enhances_l3.includes(l3.id)) l4.enhances_l3.push(l3.id);
        }
      }

      // Strip invalid cross-refs (IDs that don't exist) — audit each drop
      // into strategyValidation.issues so silent loss is surfaced.
      const rank = ranked.rank;
      const ctxBase = "strategy_layers.normalization";
      for (const l1 of sl.l1_outcomes) {
        l1.served_by_l2 = stripInvalidRefs(l1.served_by_l2, l2Ids, strategyValidation.issues, {
          field: "served_by_l2", ownerId: l1.id, context: ctxBase, strategyRank: rank,
        });
      }
      for (const l2 of sl.l2_methods) {
        l2.serves_l1 = stripInvalidRefs(l2.serves_l1, l1Ids, strategyValidation.issues, {
          field: "serves_l1", ownerId: l2.id, context: ctxBase, strategyRank: rank,
        });
        l2.justified_by_l3 = stripInvalidRefs(l2.justified_by_l3, l3Ids, strategyValidation.issues, {
          field: "justified_by_l3", ownerId: l2.id, context: ctxBase, strategyRank: rank,
        });
      }
      for (const l3 of sl.l3_reasoning) {
        l3.justifies_l2 = stripInvalidRefs(l3.justifies_l2, l2Ids, strategyValidation.issues, {
          field: "justifies_l2", ownerId: l3.id, context: ctxBase, strategyRank: rank,
        });
        l3.enhanced_by_l4 = stripInvalidRefs(l3.enhanced_by_l4, l4Ids, strategyValidation.issues, {
          field: "enhanced_by_l4", ownerId: l3.id, context: ctxBase, strategyRank: rank,
        });
      }
      for (const l4 of sl.l4_insights) {
        l4.enhances_l3 = stripInvalidRefs(l4.enhances_l3, l3Ids, strategyValidation.issues, {
          field: "enhances_l3", ownerId: l4.id, context: ctxBase, strategyRank: rank,
        });
      }
    }
  }

  // Re-derive top-level validation counters so score/broken_references reflect
  // the newly appended layer-strip issues. Without this, the audit would
  // surface in .issues but not in the summary numbers.
  const stripIssueCount = strategyValidation.issues.filter(
    (i) => i.type === "stripped_layer_reference",
  ).length;
  if (stripIssueCount > 0) {
    strategyValidation.stripped_count += stripIssueCount;
    strategyValidation.broken_references += stripIssueCount;
    // Mild score penalty — stripping is a soft failure, not a hard one.
    // -1 per stripped ref, floored at 0, so a strategy with 20+ drops
    // becomes visibly low-quality instead of passing silently.
    strategyValidation.score = Math.max(0, strategyValidation.score - stripIssueCount);
    if (stripIssueCount >= 5) strategyValidation.passed = false;
    console.warn(
      `[strategy-engine] Layer cross-ref audit: ${stripIssueCount} refs stripped across ${rankedStrategies.length} ranked strategies (score -${stripIssueCount})`,
    );
  }

  return {
    recommendation,
    rankedStrategies,
    changeProposals,
    reasoningTrace,
    probabilitySpaceSummary,
    probabilitySpaces,
    spaceIntersections,
    strategyValidation,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Bottom-Up Layer Generation Engine (L4→L3→L2→L1)
// ═══════════════════════════════════════════════════════════════════

async function generateLayersBottomUp(params: {
  layerClassification: ReturnType<typeof classifyAllSpacesAndIntersections>;
  diagnosis: StrategicDiagnosis;
  hiddenSignals: Array<{ name: string; type: string; impact: number; description: string }>;
  winningOption: { title: string; core_logic: string; strategic_posture: string };
  intersections: SpaceIntersection[];
  entityNameMap: Map<string, string>;
  goal?: ImprovementGoal | null;
  suggestedObjectives?: SuggestedObjective[];
  synthesis: SynthesisData;
  allSpaces: ProbabilitySpace[];
  entityCount: number;
  graphStructure: GraphStructure;
  /**
   * Optional audit sink — when provided, each invalid cross-ref dropped
   * during normalization is appended as a "stripped_layer_reference"
   * issue for later inclusion in the strategy's validation report.
   */
  stripAudit?: StrategyValidationIssue[];
}): Promise<StrategyLayers> {
  const { layerClassification, diagnosis, hiddenSignals } = params;

  // ── Step 4a: L4 Insight Extraction ──
  console.log("[strategy-engine] Step 4a: L4 insight extraction...");
  const l4Start = Date.now();

  const highNoveltyIntersections = params.intersections
    .filter((i) => i.novelty_score > 0.3 || i.innovation_potential === "high")
    .sort((a, b) => b.novelty_score * b.impact_score - a.novelty_score * a.impact_score)
    .slice(0, 12);

  const l4Prompt = getL4InsightPrompt({
    l4Spaces: layerClassification.byLayer.L4.slice(0, 15),
    highNoveltyIntersections,
    hiddenSignals,
    blindSpots: diagnosis.signal_synthesis.blind_spots,
    convergingSignals: diagnosis.signal_synthesis.converging_signals,
    contradictorySignals: diagnosis.signal_synthesis.contradictory_signals,
    allSpaces: params.allSpaces,
    entityCount: params.entityCount,
  });

  let l4Insights: L4AtomicInsight[] = [];
  try {
    const l4Response = await llmJSON<{ l4_insights: L4AtomicInsight[] }>({
      system: l4Prompt.system,
      user: l4Prompt.user,
      maxTokens: 4096,
      temperature: 0.4,
    });
    l4Insights = Array.isArray(l4Response.l4_insights) ? l4Response.l4_insights : [];
    // Default missing fields
    for (const insight of l4Insights) {
      insight.enhances_l3 = insight.enhances_l3 ?? [];
      insight.pillar_sources = insight.pillar_sources ?? [];
      insight.confidence = insight.confidence ?? "moderate";
    }
  } catch (err) {
    console.warn("[strategy-engine] L4 generation failed:", err);
    l4Insights = [{
      id: "L4_1",
      insight: "L4 generation failed — using diagnosis blind spots as fallback insights",
      scale: "macro",
      insight_type: "blind_spot",
      enhances_l3: [],
      pillar_sources: [],
      confidence: "low",
    }];
  }
  console.log(`[strategy-engine] Step 4a complete (${Date.now() - l4Start}ms): ${l4Insights.length} L4 insights`);

  // ── Step 4b: L3 Reasoning Construction ──
  console.log("[strategy-engine] Step 4b: L3 reasoning construction...");
  const l3Start = Date.now();

  // Extract systemic failure points for L3
  const systemicFailurePoints: Array<{ edge_label: string; node_name: string; failure_mode: string; blast_radius: string }> = [];
  for (const space of layerClassification.byLayer.L3) {
    for (const fp of space.failure_points) {
      if (fp.blast_radius === "systemic" || fp.blast_radius === "cascading") {
        systemicFailurePoints.push({
          edge_label: `${space.source_entity_name} → ${space.target_entity_name}`,
          node_name: fp.node_name,
          failure_mode: fp.failure_mode,
          blast_radius: fp.blast_radius,
        });
      }
    }
  }

  const l3Prompt = getL3ReasoningPrompt({
    l4Insights,
    l3Spaces: layerClassification.byLayer.L3.slice(0, 15),
    diagnosis,
    hubEntities: diagnosis.graph_insights.hub_entities.slice(0, 7),
    criticalCycles: diagnosis.graph_insights.critical_cycles.slice(0, 5),
    systemicFailurePoints: systemicFailurePoints.slice(0, 10),
  });

  let l3Reasoning: L3ReasoningUnit[] = [];
  try {
    const l3Response = await llmJSON<{ l3_reasoning: L3ReasoningUnit[] }>({
      system: l3Prompt.system,
      user: l3Prompt.user,
      maxTokens: 5120,
      temperature: 0.3,
    });
    l3Reasoning = Array.isArray(l3Response.l3_reasoning) ? l3Response.l3_reasoning : [];
    for (const unit of l3Reasoning) {
      unit.evidence = unit.evidence ?? [];
      unit.justifies_l2 = unit.justifies_l2 ?? [];
      unit.enhanced_by_l4 = unit.enhanced_by_l4 ?? [];
      unit.pillar_sources = unit.pillar_sources ?? [];
    }
  } catch (err) {
    console.warn("[strategy-engine] L3 generation failed:", err);
    l3Reasoning = [{
      id: "L3_1",
      logic_statement: diagnosis.core_problem_statement,
      reasoning_type: "structural_leverage",
      evidence: diagnosis.reasoning_trace.slice(0, 3),
      justifies_l2: [],
      enhanced_by_l4: l4Insights.length > 0 ? [l4Insights[0].id] : [],
      pillar_sources: [],
    }];
  }
  console.log(`[strategy-engine] Step 4b complete (${Date.now() - l3Start}ms): ${l3Reasoning.length} L3 reasoning units`);

  // ── Step 4c: L2 Method Composition ──
  console.log("[strategy-engine] Step 4c: L2 method composition...");
  const l2Start = Date.now();

  const l2Prompt = getL2MethodPrompt({
    l3Reasoning,
    l2Spaces: layerClassification.byLayer.L2.slice(0, 12),
    winningOption: params.winningOption,
    intersections: params.intersections,
    entityNameMap: params.entityNameMap,
  });

  let l2Methods: L2MethodChain[] = [];
  try {
    const l2Response = await llmJSON<{ l2_methods: L2MethodChain[] }>({
      system: l2Prompt.system,
      user: l2Prompt.user,
      maxTokens: 6144,
      temperature: 0.3,
    });
    l2Methods = Array.isArray(l2Response.l2_methods) ? l2Response.l2_methods : [];
    for (const method of l2Methods) {
      method.causal_chain = method.causal_chain ?? [];
      method.serves_l1 = method.serves_l1 ?? [];
      method.justified_by_l3 = method.justified_by_l3 ?? [];
      method.pillar_sources = method.pillar_sources ?? [];
    }
  } catch (err) {
    console.warn("[strategy-engine] L2 generation failed:", err);
    l2Methods = [{
      id: "L2_1",
      title: params.winningOption.title,
      causal_chain: [{ step: params.winningOption.core_logic, entity_refs: [], mechanism: "derived from winning option" }],
      optimality_rationale: l3Reasoning.length > 0 ? `Justified by ${l3Reasoning[0].id}` : "Fallback method",
      serves_l1: [],
      justified_by_l3: l3Reasoning.length > 0 ? [l3Reasoning[0].id] : [],
      pillar_sources: [],
    }];
  }
  console.log(`[strategy-engine] Step 4c complete (${Date.now() - l2Start}ms): ${l2Methods.length} L2 method chains`);

  // ── Step 4d: L1 Outcome Selection ──
  console.log("[strategy-engine] Step 4d: L1 outcome selection...");
  const l1Start = Date.now();

  const masterBottleneck = params.synthesis.master_bottleneck
    ? {
        entity_id: (params.synthesis.master_bottleneck as unknown as Record<string, unknown>).entity_id as string ?? "unknown",
        reasoning: (params.synthesis.master_bottleneck as unknown as Record<string, unknown>).reasoning as string
          ?? (params.synthesis.master_bottleneck as unknown as Record<string, unknown>).description as string
          ?? "",
      }
    : null;

  const l1Prompt = getL1OutcomePrompt({
    l2Methods,
    l1Spaces: layerClassification.byLayer.L1.slice(0, 10),
    goal: params.goal,
    suggestedObjectives: params.suggestedObjectives,
    masterBottleneck,
    diagnosisProblem: diagnosis.core_problem_statement,
  });

  let l1Outcomes: L1Outcome[] = [];
  try {
    const l1Response = await llmJSON<{ l1_outcomes: L1Outcome[] }>({
      system: l1Prompt.system,
      user: l1Prompt.user,
      maxTokens: 3072,
      temperature: 0.2,
    });
    l1Outcomes = Array.isArray(l1Response.l1_outcomes) ? l1Response.l1_outcomes : [];
    for (const outcome of l1Outcomes) {
      outcome.served_by_l2 = outcome.served_by_l2 ?? [];
      outcome.pillar_sources = outcome.pillar_sources ?? [];
    }
  } catch (err) {
    console.warn("[strategy-engine] L1 generation failed:", err);
    l1Outcomes = [{
      id: "L1_1",
      outcome: params.goal?.title ?? params.suggestedObjectives?.[0]?.title ?? "Primary objective achieved",
      sequence_position: 1,
      sequence_rationale: "Single outcome from fallback generation",
      target_metric: params.goal?.metric_name,
      served_by_l2: l2Methods.length > 0 ? [l2Methods[0].id] : [],
      pillar_sources: [],
    }];
  }
  console.log(`[strategy-engine] Step 4d complete (${Date.now() - l1Start}ms): ${l1Outcomes.length} L1 outcomes`);

  // ── Cross-reference normalization ──
  // Ensure bidirectional refs and strip invalid IDs
  const l1Ids = new Set(l1Outcomes.map((o) => o.id));
  const l2Ids = new Set(l2Methods.map((m) => m.id));
  const l3Ids = new Set(l3Reasoning.map((r) => r.id));
  const l4Ids = new Set(l4Insights.map((i) => i.id));

  // Use a local sink when no external audit is provided so we still get
  // warning logs even if the caller doesn't care about the audit trail.
  const audit: StrategyValidationIssue[] = params.stripAudit ?? [];
  const auditCtx = "strategy_layers.bottom_up";

  // Forward refs: L2→L1, L2→L3
  for (const l2 of l2Methods) {
    l2.serves_l1 = stripInvalidRefs(l2.serves_l1, l1Ids, audit, {
      field: "serves_l1", ownerId: l2.id, context: auditCtx,
    });
    l2.justified_by_l3 = stripInvalidRefs(l2.justified_by_l3, l3Ids, audit, {
      field: "justified_by_l3", ownerId: l2.id, context: auditCtx,
    });
    for (const l1Id of l2.serves_l1) {
      const l1 = l1Outcomes.find((o) => o.id === l1Id);
      if (l1 && !l1.served_by_l2.includes(l2.id)) l1.served_by_l2.push(l2.id);
    }
    for (const l3Id of l2.justified_by_l3) {
      const l3 = l3Reasoning.find((r) => r.id === l3Id);
      if (l3 && !l3.justifies_l2.includes(l2.id)) l3.justifies_l2.push(l2.id);
    }
  }
  // Forward refs: L4→L3
  for (const l4 of l4Insights) {
    l4.enhances_l3 = stripInvalidRefs(l4.enhances_l3, l3Ids, audit, {
      field: "enhances_l3", ownerId: l4.id, context: auditCtx,
    });
    for (const l3Id of l4.enhances_l3) {
      const l3 = l3Reasoning.find((r) => r.id === l3Id);
      if (l3 && !l3.enhanced_by_l4.includes(l4.id)) l3.enhanced_by_l4.push(l4.id);
    }
  }
  // Backward refs: L1→L2
  for (const l1 of l1Outcomes) {
    l1.served_by_l2 = stripInvalidRefs(l1.served_by_l2, l2Ids, audit, {
      field: "served_by_l2", ownerId: l1.id, context: auditCtx,
    });
    for (const l2Id of l1.served_by_l2) {
      const l2 = l2Methods.find((m) => m.id === l2Id);
      if (l2 && !l2.serves_l1.includes(l1.id)) l2.serves_l1.push(l1.id);
    }
  }
  // Backward refs: L3→L4
  for (const l3 of l3Reasoning) {
    l3.justifies_l2 = stripInvalidRefs(l3.justifies_l2, l2Ids, audit, {
      field: "justifies_l2", ownerId: l3.id, context: auditCtx,
    });
    l3.enhanced_by_l4 = stripInvalidRefs(l3.enhanced_by_l4, l4Ids, audit, {
      field: "enhanced_by_l4", ownerId: l3.id, context: auditCtx,
    });
    for (const l4Id of l3.enhanced_by_l4) {
      const l4 = l4Insights.find((i) => i.id === l4Id);
      if (l4 && !l4.enhances_l3.includes(l3.id)) l4.enhances_l3.push(l3.id);
    }
  }

  // If L2 methods have no L1 connections, connect them to L1 outcomes based on position
  for (const l2 of l2Methods) {
    if (l2.serves_l1.length === 0 && l1Outcomes.length > 0) {
      l2.serves_l1.push(l1Outcomes[0].id);
      if (!l1Outcomes[0].served_by_l2.includes(l2.id)) {
        l1Outcomes[0].served_by_l2.push(l2.id);
      }
    }
  }

  // If L3 reasoning has no L2 connections, connect based on reasoning type match
  for (const l3 of l3Reasoning) {
    if (l3.justifies_l2.length === 0 && l2Methods.length > 0) {
      l3.justifies_l2.push(l2Methods[0].id);
      if (!l2Methods[0].justified_by_l3.includes(l3.id)) {
        l2Methods[0].justified_by_l3.push(l3.id);
      }
    }
  }

  // If L4 insights have no L3 connections, connect to first L3
  for (const l4 of l4Insights) {
    if (l4.enhances_l3.length === 0 && l3Reasoning.length > 0) {
      l4.enhances_l3.push(l3Reasoning[0].id);
      if (!l3Reasoning[0].enhanced_by_l4.includes(l4.id)) {
        l3Reasoning[0].enhanced_by_l4.push(l4.id);
      }
    }
  }

  const architectureSummary = [
    `${l4Insights.length} atomic insights feed ${l3Reasoning.length} reasoning units,`,
    `which justify ${l2Methods.length} method chains`,
    `serving ${l1Outcomes.length} sequenced outcomes.`,
    l4Insights.filter((i) => i.insight_type === "hidden_variable").length > 0
      ? `Hidden variables identified: ${l4Insights.filter((i) => i.insight_type === "hidden_variable").map((i) => i.insight.slice(0, 60)).join("; ")}.`
      : "",
  ].filter(Boolean).join(" ");

  return {
    l1_outcomes: l1Outcomes,
    l2_methods: l2Methods,
    l3_reasoning: l3Reasoning,
    l4_insights: l4Insights,
    architecture_summary: architectureSummary,
  };
}
