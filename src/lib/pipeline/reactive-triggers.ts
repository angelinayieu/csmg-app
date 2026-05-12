/**
 * Reactive Trigger Chain
 *
 * Auto-chain pipeline stages: research -> synthesis -> strategy -> goal-proposals.
 * Each stage evaluates whether the next stage should auto-fire based on what changed.
 *
 * Safety: Chain is strictly LINEAR (never loops back). Hard-capped at depth 3.
 * Cooldown of 5 minutes between chains for the same space.
 */

import type { EpistemicClassification } from "@/types/epistemic";

// ── Types ──

export type ChainStage = "research" | "synthesis" | "strategy" | "goals";

export interface ChainDecision {
  should_trigger_next: boolean;
  next_stage: ChainStage | null;
  conditions_met: Array<{ condition: string; met: boolean; value?: string }>;
  reason: string;
  chain_depth: number;
  max_chain_depth: number;
}

export interface ChainContext {
  chain_depth: number;
  last_chain_at?: string; // ISO timestamp
  credits_remaining?: number;
}

// ── Constants ──

const MAX_CHAIN_DEPTH = 3;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// ── Global Circuit Breakers ──

function checkGlobalBreakers(ctx: ChainContext): { halt: boolean; reason: string } {
  // 1. Chain depth cap
  if (ctx.chain_depth >= MAX_CHAIN_DEPTH) {
    return { halt: true, reason: `Chain depth cap reached (${ctx.chain_depth}/${MAX_CHAIN_DEPTH})` };
  }

  // 2. Cooldown
  if (ctx.last_chain_at) {
    const elapsed = Date.now() - new Date(ctx.last_chain_at).getTime();
    if (elapsed < COOLDOWN_MS) {
      const remainingSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      return { halt: true, reason: `Cooldown active (${remainingSec}s remaining)` };
    }
  }

  // 3. Budget guard
  if (typeof ctx.credits_remaining === "number" && ctx.credits_remaining <= 0) {
    return { halt: true, reason: "No credits remaining" };
  }

  return { halt: false, reason: "" };
}

function haltDecision(reason: string, ctx: ChainContext): ChainDecision {
  return {
    should_trigger_next: false,
    next_stage: null,
    conditions_met: [],
    reason,
    chain_depth: ctx.chain_depth,
    max_chain_depth: MAX_CHAIN_DEPTH,
  };
}

// ── shouldAutoSynthesize ──

export interface SynthesizeTriggerInput {
  entitiesCreated: number;
  bridgesCreated: number;
  embeddedCount: number;
  materializedEntities: number;
  signalsDetected: number;
  highSeveritySignals: number;
}

/**
 * After research completes, should we auto-trigger synthesis?
 * Fires if ANY condition is met (after global breakers pass).
 */
export function shouldAutoSynthesize(
  input: SynthesizeTriggerInput,
  existingSynthesis: Record<string, unknown> | null,
  ctx: ChainContext
): ChainDecision {
  const global = checkGlobalBreakers(ctx);
  if (global.halt) return haltDecision(global.reason, ctx);

  // Thresholds are intentionally low — a single meaningful research finding
  // should be enough to justify re-synthesizing with new context.
  const conditions: ChainDecision["conditions_met"] = [
    {
      condition: "embeddedCount >= 1",
      met: input.embeddedCount >= 1,
      value: String(input.embeddedCount),
    },
    {
      condition: "bridgesCreated >= 2",
      met: input.bridgesCreated >= 2,
      value: String(input.bridgesCreated),
    },
    {
      condition: "materializedEntities >= 1",
      met: input.materializedEntities >= 1,
      value: String(input.materializedEntities),
    },
    {
      condition: "highSeveritySignals >= 1",
      met: input.highSeveritySignals >= 1,
      value: String(input.highSeveritySignals),
    },
    {
      condition: "entitiesCreated >= 3",
      met: input.entitiesCreated >= 3,
      value: String(input.entitiesCreated),
    },
  ];

  const anyMet = conditions.some((c) => c.met);
  const metReasons = conditions
    .filter((c) => c.met)
    .map((c) => `${c.condition} (=${c.value})`)
    .join("; ");

  return {
    should_trigger_next: anyMet,
    next_stage: anyMet ? "synthesis" : null,
    conditions_met: conditions,
    reason: anyMet
      ? `Auto-synthesis triggered: ${metReasons}`
      : "No synthesis trigger conditions met",
    chain_depth: ctx.chain_depth,
    max_chain_depth: MAX_CHAIN_DEPTH,
  };
}

// ── shouldAutoStrategyRefresh ──

export interface StrategyTriggerInput {
  leverage_changed: boolean;
  bottleneck_changed: boolean;
  new_contradictions: number;
  quality_delta: number;
  new_embedded_bridges: number;
  /** Number of STRONG-strength insight convergence clusters (4+ signal types converging). */
  strong_convergences?: number;
  /** Number of convergences with HIDDEN axioms involved — highest trust + highest leverage */
  hidden_axiom_convergences?: number;
  /** Strategy coverage %. Low coverage = strategy is incomplete vs. findings */
  coverage_pct?: number;
}

/**
 * After synthesis completes, should we auto-trigger strategy refresh?
 * Fires if ANY condition is met.
 *
 * Phase 8: Classification-aware thresholds:
 * - research_paper with counterfactual claims → lower quality_delta threshold (evidence updates matter more)
 * - chaotic Cynefin domain → suppress auto-strategy (stabilize first, don't strategize)
 */
export function shouldAutoStrategyRefresh(
  input: StrategyTriggerInput,
  existingStrategy: Record<string, unknown> | null,
  ctx: ChainContext,
  classification?: EpistemicClassification | null,
): ChainDecision {
  const global = checkGlobalBreakers(ctx);
  if (global.halt) return haltDecision(global.reason, ctx);

  // Phase 8: Suppress strategy refresh for chaotic domains — act-sense-respond, not strategize
  if (classification?.cynefin_domain === "chaotic") {
    return haltDecision(
      "Strategy refresh suppressed: Cynefin chaotic domain — stabilize first, strategy premature",
      ctx,
    );
  }

  // Phase 8: Lower quality threshold for research papers with strong causal claims
  const qualityThreshold =
    classification?.input_type === "research_paper" &&
    classification.causal_depth !== "association"
      ? 3 // Evidence-heavy inputs — smaller quality deltas matter
      : 5;

  // Any structural change to the graph should justify strategy re-evaluation.
  const conditions: ChainDecision["conditions_met"] = [
    // Sprint A2 — first-strategy guarantee.
    //
    // Bug fixed: every other condition below is delta-based — they
    // compare current state against a prior strategy. On a brand-new
    // space (existingStrategy === null), leverage_changed /
    // bottleneck_changed / coverage_pct all derive from a null
    // changeDetection, and quality_delta equals newQuality (oldQuality
    // is 0), which only fires if newQuality > 5. The user can
    // plausibly hit "no condition met" → chain stops dead at
    // synthesize → strategy stage never runs → no event, no card, no
    // feedback. The framing work from Phase 1 conditions strategy
    // generation, but if strategy never fires, Phase 1's effect is
    // invisible.
    //
    // Fix: the FIRST strategy run for any space is always justified —
    // there is nothing to compare against, but the user has uploaded a
    // prompt and decomposed a KG, so producing a strategy is the
    // pipeline's whole point. This condition fires before any delta
    // comparison can be evaluated.
    {
      condition: "no_existing_strategy",
      met: !existingStrategy,
      value: existingStrategy ? "has-strategy" : "fresh",
    },
    {
      condition: "leverage_changed",
      met: input.leverage_changed,
      value: String(input.leverage_changed),
    },
    {
      condition: "bottleneck_changed",
      met: input.bottleneck_changed,
      value: String(input.bottleneck_changed),
    },
    {
      condition: "new_contradictions >= 1",
      met: input.new_contradictions >= 1,
      value: String(input.new_contradictions),
    },
    {
      condition: `quality_delta > ${qualityThreshold}`,
      met: input.quality_delta > qualityThreshold,
      value: String(input.quality_delta),
    },
    {
      condition: "new_embedded_bridges >= 1",
      met: input.new_embedded_bridges >= 1,
      value: String(input.new_embedded_bridges),
    },
    // New: cross-mechanism convergence signals are high-trust findings; a new strong
    // convergence changes what the strategy should prioritize.
    {
      condition: "strong_convergences >= 1",
      met: (input.strong_convergences ?? 0) >= 1,
      value: String(input.strong_convergences ?? 0),
    },
    // New: a convergence involving a HIDDEN axiom is the highest-leverage finding
    // possible — it indicates multiple independent mechanisms confirm an unstated
    // assumption is load-bearing. Strategy absolutely needs refresh.
    {
      condition: "hidden_axiom_convergences >= 1",
      met: (input.hidden_axiom_convergences ?? 0) >= 1,
      value: String(input.hidden_axiom_convergences ?? 0),
    },
    // New: low coverage means strategy doesn't address the analysis. Refresh.
    {
      condition: "coverage_pct < 60",
      met: typeof input.coverage_pct === "number" && input.coverage_pct < 60,
      value: typeof input.coverage_pct === "number" ? `${input.coverage_pct}%` : "n/a",
    },
  ];

  const anyMet = conditions.some((c) => c.met);
  const metReasons = conditions
    .filter((c) => c.met)
    .map((c) => `${c.condition} (=${c.value})`)
    .join("; ");

  return {
    should_trigger_next: anyMet,
    next_stage: anyMet ? "strategy" : null,
    conditions_met: conditions,
    reason: anyMet
      ? `Auto-strategy triggered: ${metReasons}`
      : "No strategy trigger conditions met",
    chain_depth: ctx.chain_depth,
    max_chain_depth: MAX_CHAIN_DEPTH,
  };
}

// ── shouldAutoProposGoals ──

export interface GoalTriggerInput {
  new_perspectives: number;
  new_tactics: number;
  infrastructure_gaps: number;
  critical_needs: number;
}

export interface ExistingGoal {
  title: string;
  fitness?: number;
  status?: string;
}

/**
 * After strategy completes, should we auto-propose goals?
 * ALL conditions must be true (more conservative — goals are user-facing).
 *
 * Phase 8: Classification-aware adjustments:
 * - question input type → suppress auto-goal proposals (user is exploring, not committing)
 * - High-confidence preliminary objectives → lower threshold (classification already suggested goals)
 */
export function shouldAutoProposGoals(
  input: GoalTriggerInput,
  existingGoals: ExistingGoal[],
  ctx: ChainContext,
  classification?: EpistemicClassification | null,
): ChainDecision {
  const global = checkGlobalBreakers(ctx);
  if (global.halt) return haltDecision(global.reason, ctx);

  // Phase 8: Suppress goal proposals for pure questions — user is exploring, not committing
  if (classification?.input_type === "question") {
    return haltDecision(
      "Goal proposals suppressed: input is a question — exploring, not goal-setting",
      ctx,
    );
  }

  const activeGoal = existingGoals.find(
    (g) => g.status === "active" || g.status === "in_progress"
  );
  const noActiveOrLowFitness =
    !activeGoal || (typeof activeGoal.fitness === "number" && activeGoal.fitness < 40);

  // Phase 8: Lower threshold when classification produced high-confidence preliminary objectives
  const hasStrongPreliminary = (classification?.preliminary_objectives ?? []).some(
    (o) => o.confidence === "high",
  );
  const perspectiveThreshold = hasStrongPreliminary ? 0 : 1;
  const tacticThreshold = hasStrongPreliminary ? 1 : 2;

  const hasNewPerspectives =
    input.new_perspectives >= perspectiveThreshold || input.new_tactics >= tacticThreshold;
  const hasGaps = input.infrastructure_gaps >= 1 || input.critical_needs >= 1;

  const conditions: ChainDecision["conditions_met"] = [
    {
      condition: "no active goal or fitness < 40",
      met: noActiveOrLowFitness,
      value: activeGoal ? `fitness=${activeGoal.fitness}` : "no active goal",
    },
    {
      condition: hasStrongPreliminary
        ? "new_perspectives >= 0 OR new_tactics >= 1 (lowered: strong preliminary objectives)"
        : "new_perspectives >= 1 OR new_tactics >= 2",
      met: hasNewPerspectives,
      value: `perspectives=${input.new_perspectives}, tactics=${input.new_tactics}`,
    },
    {
      condition: "infrastructure_gaps >= 1 OR critical_needs >= 1",
      met: hasGaps,
      value: `gaps=${input.infrastructure_gaps}, critical=${input.critical_needs}`,
    },
  ];

  const allMet = conditions.every((c) => c.met);

  return {
    should_trigger_next: allMet,
    next_stage: allMet ? "goals" : null,
    conditions_met: conditions,
    reason: allMet
      ? "Auto-goal-proposals triggered: all conditions met"
      : `Goal proposal blocked: ${conditions.filter((c) => !c.met).map((c) => c.condition).join(", ")} not met`,
    chain_depth: ctx.chain_depth,
    max_chain_depth: MAX_CHAIN_DEPTH,
  };
}
