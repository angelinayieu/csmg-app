/**
 * Multi-Pass Research Depth Engine
 *
 * Orchestrates iterative research passes instead of single-shot LLM calls.
 * Each depth level gets a budget of passes and searches, with circuit breakers
 * to prevent runaway costs or diminishing returns.
 *
 * Pass types:
 * - "discovery": Initial landscape scan (always pass 1)
 * - "validation": Verify contradictions or uncertain findings
 * - "deepening": Investigate high-impact gaps found in prior passes
 */

import type { ResearchDepth } from "@/lib/web-search";
import type { Entity, Edge, Cycle } from "@/types";

// ── Types ──

export interface ContinuationSignal {
  type:
    | "critical_bridge_found"
    | "contradiction_detected"
    | "high_impact_gap"
    | "validation_needed"
    // Phase 3 — new signal types emitted by triangulation /
    // adversarial passes so shouldContinueResearch can route the
    // next pass intelligently instead of always defaulting to
    // breadth.
    | "triangulation_gap_detected"
    | "contradiction_found_via_adversarial"
    // Phase 4 — cycle_close + boundary_condition passes. Cycle
    // closures rarely chain into more passes (the cycle is either
    // closed or it isn't); boundary findings can chain into another
    // adversarial sweep on the now-conditional claims.
    | "cycle_closed"
    | "boundary_condition_found";
  description: string;
  follow_up_queries: string[];
  priority: "critical" | "high" | "medium";
}

/**
 * Phase 3 — first-class pass-kind enum. Each kind is a different
 * research strategy, dispatched via pass-kind-dispatcher.ts.
 *
 *   • outcome_breadth — outcome-anchored landscape scan; one LLM call
 *     with web_search; produces external entities + edges + signals.
 *     Equivalent to the legacy "discovery"/"deepening" passes.
 *
 *   • triangulation   — post-hoc DB scan; flags claims with <N
 *     independent supporters as gaps; emits triangulation_gap events.
 *     No LLM, no DB writes; cheap.
 *
 *   • adversarial     — counter-evidence search on top-N supported
 *     claims; persists support_type='contradicts' evidence; demotes
 *     claim confidence via the existing posterior recompute.
 *
 *   • cycle_close     — Phase 4a. Detects 3-edge near-cycles in the
 *     KG (A→B→C with no C→A) and runs targeted web search to find
 *     literature evidence for the closing edge. Persists confirmed
 *     edges + promotes complete cycles into the `cycles` table.
 *
 *   • boundary_condition — Phase 4b. For each top leverage point,
 *     searches for peer-reviewed failure modes (specific conditions
 *     under which the leverage point fails to produce its expected
 *     effect). Persists each failure mode as an entity + conditional
 *     edge.
 *
 * Future phases will add: drill. It is intentionally NOT in the union
 * yet — adding it before an implementation exists would create
 * dangling enum values that shouldContinueResearch couldn't return.
 */
export type PassKind =
  | "outcome_breadth"
  | "triangulation"
  | "adversarial"
  | "cycle_close"
  | "boundary_condition";

/**
 * Map legacy `pass_type` to the new `pass_kind`. The 3-value legacy
 * vocabulary collapses into the new vocabulary as follows:
 *   - discovery / deepening → outcome_breadth (they're both "produce
 *     entities anchored to a topic"; the new name is more honest about
 *     the anchoring being outcome-driven)
 *   - validation → triangulation (legacy validation chased contradictions
 *     and uncertain findings; that's exactly what triangulation does
 *     by checking source counts)
 *
 * Used during the transition period so the old `pass_type` field on
 * persisted ResearchPass rows can still be read meaningfully.
 */
export function legacyPassTypeToKind(
  pt: "discovery" | "validation" | "deepening",
): PassKind {
  if (pt === "validation") return "triangulation";
  return "outcome_breadth";
}

export interface ResearchPass {
  pass_number: number;
  /** @deprecated Use pass_kind. Kept for compat with persisted rows + legacy
   *  consumers that read this field. New code should write pass_kind. */
  pass_type: "discovery" | "validation" | "deepening";
  /** Phase 3 — first-class pass kind. Always populated on new rows.
   *  Optional for replayed historical passes that only have pass_type. */
  pass_kind?: PassKind;
  focus_queries: string[];
  entities_discovered: number;
  signals_found: number;
  should_continue: boolean;
  continuation_reason?: string;
}

export interface ResearchDepthPlan {
  depth: ResearchDepth;
  max_passes: number;
  search_budget_per_pass: number;
  total_search_budget: number;
  searches_used: number;
  passes_completed: ResearchPass[];
  circuit_breaker_triggered: boolean;
  circuit_breaker_reason?: string;
}

/** Minimal interface for what we need from LLM output to decide continuation */
export interface PassResult {
  external_entities: Array<{ name: string; entity_id?: string }>;
  hidden_signals?: Array<{ trajectory_impact: number }>;
  continuation_signals?: ContinuationSignal[];
}

export interface ContinuationDecision {
  continue: boolean;
  reason: string;
  /** @deprecated Use next_pass_kind. Kept so existing call sites compile. */
  next_pass_type: "validation" | "deepening";
  /** Phase 3 — what pass-kind to run next. Always populated by
   *  shouldContinueResearch. */
  next_pass_kind: PassKind;
  focus_queries: string[];
}

// ── Depth budget configuration ──

const DEPTH_BUDGETS: Record<
  ResearchDepth,
  { max_passes: number; search_per_pass: number; total_cap: number }
> = {
  training: { max_passes: 1, search_per_pass: 0, total_cap: 0 },
  light: { max_passes: 1, search_per_pass: 5, total_cap: 5 },
  standard: { max_passes: 2, search_per_pass: 8, total_cap: 15 },
  deep: { max_passes: 3, search_per_pass: 10, total_cap: 25 },
};

// ── KG-Builder Assessment ──

export interface KGBuilderAssessment {
  is_minimal_context: boolean;
  internal_entity_count: number;
  internal_edge_count: number;
  has_leverage_points: boolean;
  has_cycles: boolean;
  recommendation: "standard_research" | "kg_builder_research";
  reasoning: string;
}

export function assessKGBuilderMode(
  internalEntities: Entity[],
  internalEdges: Edge[],
  cycles: Cycle[],
  inputTextLength: number
): KGBuilderAssessment {
  const entityCount = internalEntities.length;
  const edgeCount = internalEdges.length;
  const hasLeverage = internalEntities.some(
    (e) => e.is_leverage_point || e.is_risk_point || e.is_master_bottleneck
  );
  const hasCycles = cycles.length > 0;

  const isMinimal =
    (entityCount < 5 && edgeCount < 3 && !hasLeverage && !hasCycles) ||
    inputTextLength < 200;

  const parts: string[] = [];
  if (entityCount < 5) parts.push(`only ${entityCount} entities`);
  if (edgeCount < 3) parts.push(`only ${edgeCount} edges`);
  if (!hasLeverage) parts.push("no leverage/risk points");
  if (!hasCycles) parts.push("no cycles");
  if (inputTextLength < 200) parts.push(`short input (${inputTextLength} chars)`);

  return {
    is_minimal_context: isMinimal,
    internal_entity_count: entityCount,
    internal_edge_count: edgeCount,
    has_leverage_points: hasLeverage,
    has_cycles: hasCycles,
    recommendation: isMinimal ? "kg_builder_research" : "standard_research",
    reasoning: isMinimal
      ? `Minimal context detected: ${parts.join(", ")}. KG-builder mode will propose core entities.`
      : `Sufficient context (${entityCount} entities, ${edgeCount} edges). Standard research mode.`,
  };
}

// ── Core Functions ──

/**
 * Create a depth plan with budget constraints for the given research depth.
 */
export function createDepthPlan(depth: ResearchDepth): ResearchDepthPlan {
  const budget = DEPTH_BUDGETS[depth];
  return {
    depth,
    max_passes: budget.max_passes,
    search_budget_per_pass: budget.search_per_pass,
    total_search_budget: budget.total_cap,
    searches_used: 0,
    passes_completed: [],
    circuit_breaker_triggered: false,
    circuit_breaker_reason: undefined,
  };
}

/**
 * Evaluate whether research should continue with another pass.
 * Called after each pass completes.
 */
export function shouldContinueResearch(
  plan: ResearchDepthPlan,
  lastPassResult: PassResult
): ContinuationDecision {
  const passCount = plan.passes_completed.length;
  const halt = (reason: string): ContinuationDecision => ({
    continue: false,
    reason,
    next_pass_type: "deepening",
    next_pass_kind: "outcome_breadth",
    focus_queries: [],
  });

  // ── Circuit breakers ──

  // 1. Max passes reached
  if (passCount >= plan.max_passes) {
    plan.circuit_breaker_triggered = true;
    plan.circuit_breaker_reason = `Max passes reached (${plan.max_passes})`;
    return halt(plan.circuit_breaker_reason);
  }

  // 2. Search budget exhausted
  if (plan.searches_used >= plan.total_search_budget) {
    plan.circuit_breaker_triggered = true;
    plan.circuit_breaker_reason = `Search budget exhausted (${plan.searches_used}/${plan.total_search_budget})`;
    return halt(plan.circuit_breaker_reason);
  }

  // 3. No new entities AND no critical/high continuation signals
  const continuationSignals = lastPassResult.continuation_signals ?? [];
  const criticalOrHigh = continuationSignals.filter(
    (s) => s.priority === "critical" || s.priority === "high"
  );
  const newEntityCount = lastPassResult.external_entities.length;

  if (newEntityCount === 0 && criticalOrHigh.length === 0) {
    plan.circuit_breaker_triggered = true;
    plan.circuit_breaker_reason = "No new entities and no critical/high continuation signals";
    return halt(plan.circuit_breaker_reason);
  }

  // 4. Total entities across all passes exceeds 100
  // This is an iteration safety cap — we don't limit how much data each pass produces,
  // only how many total research iterations we run
  const totalEntities =
    plan.passes_completed.reduce((sum, p) => sum + p.entities_discovered, 0) +
    newEntityCount;
  if (totalEntities > 100) {
    plan.circuit_breaker_triggered = true;
    plan.circuit_breaker_reason = `Entity iteration cap reached (${totalEntities} > 100)`;
    return halt(plan.circuit_breaker_reason);
  }

  // 5. Diminishing returns — last pass duplicated > 50% of prior entities
  if (passCount > 0) {
    const priorNames = new Set<string>();
    for (const p of plan.passes_completed) {
      // We don't have the actual names in the pass record, so we check the count heuristic:
      // If last pass found fewer new entities than 50% of what it discovered, it's duplicating
      // (This is a simplified check — the actual dedup happens in the research route accumulator)
    }
    // The research route handles dedup before calling this function,
    // so newEntityCount already reflects only truly new entities
  }

  // ── Continuation signals evaluation ──

  // After pass 1: continue if any critical or high signal.
  //
  // Phase 3 routing:
  //   - contradiction_detected by the LLM → triangulation pass first
  //     (verify whether the contradiction has independent support
  //     before chasing more breadth)
  //   - everything else → another outcome_breadth pass to deepen
  //     coverage on critical signals
  if (passCount === 0 && criticalOrHigh.length > 0) {
    const hasContradiction = continuationSignals.some(
      (s) => s.type === "contradiction_detected"
    );
    return {
      continue: true,
      reason: `Pass 1 found ${criticalOrHigh.length} critical/high signals`,
      next_pass_type: hasContradiction ? "validation" : "deepening",
      next_pass_kind: hasContradiction ? "triangulation" : "outcome_breadth",
      focus_queries: criticalOrHigh.flatMap((s) => s.follow_up_queries).slice(0, 5),
    };
  }

  // After pass 2: continue ONLY if depth is "deep" AND at least 1
  // critical signal — but on deep, also schedule an adversarial pass
  // when prior passes produced lots of high-confidence claims (the
  // adversarial gain is highest there). The dispatcher handles either
  // kind without an extra pass-budget cost.
  if (passCount === 1) {
    const criticalOnly = continuationSignals.filter((s) => s.priority === "critical");
    if (plan.depth === "deep" && criticalOnly.length > 0) {
      const hasGap = continuationSignals.some(
        (s) => s.type === "triangulation_gap_detected"
      );
      return {
        continue: true,
        reason: `Pass 2 found ${criticalOnly.length} critical signals (deep mode)`,
        next_pass_type: "deepening",
        // If a triangulation gap was flagged on pass 2, fill the gap on
        // pass 3 before claiming "deep coverage". Otherwise hunt for
        // counter-evidence on the strongest claims.
        next_pass_kind: hasGap ? "outcome_breadth" : "adversarial",
        focus_queries: criticalOnly.flatMap((s) => s.follow_up_queries).slice(0, 3),
      };
    }
    return halt(
      plan.depth !== "deep"
        ? "Standard depth: max 2 passes"
        : "No critical signals after pass 2"
    );
  }

  // After pass 3+: never continue
  return halt("Maximum research depth reached");
}

/**
 * Build context string for subsequent research passes.
 * Tells the LLM what was already found and what to focus on.
 */
export function buildPassContext(
  passNumber: number,
  passType: string,
  priorEntities: Array<{ name: string; entity_id?: string }>,
  priorBridges: Array<{ external_entity_id: string; likely_internal_concept: string; reasoning: string }>,
  continuationSignals: ContinuationSignal[]
): string {
  const entityNames = priorEntities.map((e) => e.name).join(", ");
  const bridgeDescs = priorBridges
    .slice(0, 8)
    .map((b) => `${b.external_entity_id} → ${b.likely_internal_concept}: ${b.reasoning.slice(0, 80)}`)
    .join("\n  ");

  const signalDescs = continuationSignals
    .filter((s) => s.priority === "critical" || s.priority === "high")
    .map((s) => `- [${s.priority.toUpperCase()}] ${s.description}`)
    .join("\n");

  const focusQueries = continuationSignals
    .flatMap((s) => s.follow_up_queries)
    .slice(0, 5)
    .map((q) => `- "${q}"`)
    .join("\n");

  return `

PRIOR RESEARCH (Pass ${passNumber - 1}) — DO NOT rediscover these:
Entities already found: ${entityNames || "none"}
Bridges established:
  ${bridgeDescs || "none"}

FOCUS FOR THIS PASS (${passType}):
${signalDescs || "No specific signals — broaden search."}

Suggested search queries for this pass:
${focusQueries || "Use your judgment based on gaps."}

INSTRUCTIONS FOR PASS ${passNumber}:
- Do NOT repeat entities already discovered above
- Focus on NEW information that fills the gaps identified
- If you find more critical gaps, include them in continuation_signals
- Prioritize depth over breadth — fewer high-quality entities are better than many shallow ones`;
}
