// ── Strategy composite ranker — Tier 1 → Tier 3 bridge ────────────────
//
// Problem: today `ranked_strategies[*].rank` is whatever order the LLM
// decided to return its array in. The LLM's preference IS information,
// but calling it a "rank" implies a computed quantity. A top-tier
// system computes a composite score from existing signals and orders
// by that number, keeping the LLM's ordering as `llm_rank` for audit.
//
// This module builds on the same pattern that already works for the
// space-strategizer (src/lib/pipeline/space-strategizer/ranker.ts): a
// weighted sum of normalized [0,1] signals, with explicit weights that
// sum to 1, that asserts at module load so tuning mistakes surface
// early.
//
// Signals used (all [0,1] normalized; null when unavailable, weight is
// redistributed across non-null signals so a strategy with incomplete
// coverage isn't penalized for fields the LLM didn't populate):
//
//   • confidence                — LLM self-reported 0-100 → 0-1 (small
//                                 weight because it's self-reported;
//                                 still useful as a tie-breaker)
//   • coverage_gap_closure_pct  — fraction of strategy_coverage.gaps
//                                 this strategy's tactics close
//   • convergence_addressed_pct — fraction of convergence clusters this
//                                 strategy addresses via its
//                                 tactics/core_move
//   • axiom_support_pct         — fraction of CRITICAL axioms respected
//                                 (provenance field on tactics)
//   • evidence_grounding        — has_reasoning_chain_with_entity_codes
//                                 + MC_distribution_present (honest
//                                 proxy for "rigor packed into this")
//   • mc_p50_normalized         — if MC distribution present, the
//                                 target-entity p50 rescaled to [0,1]
//                                 across the candidate set (empirical
//                                 "this actually moves the needle")
//   • mc_confidence             — 1/(1+stddev) when MC ran, else null
//   • complexity_penalty        — more tactics × more components → more
//                                 execution risk. SUBTRACTS from the
//                                 composite.
//   • risk_balance              — 1 − (failure_modes / tactics). Low
//                                 = poorly-hedged.
//
// Weights sum to 1.0 (plus the complexity penalty as a subtraction);
// asserted at module load.

import type { StructuralEvent } from "@/types/pipeline-events";

export type RankedStrategyShape = {
  rank?: number;
  recommendation?: Record<string, unknown>;
  ranking_rationale?: string;
  infrastructure_proposals?: unknown[];
  tradeoff_vs_top?: string | null;
};

export interface CompositeSignals {
  confidence: number | null;
  coverage_gap_closure_pct: number | null;
  convergence_addressed_pct: number | null;
  axiom_support_pct: number | null;
  evidence_grounding: number | null;
  mc_p50_normalized: number | null;
  mc_confidence: number | null;
  complexity_penalty: number; // [0,1]; always defined (0 = simple)
  risk_balance: number | null;
}

export interface CompositeWeights {
  confidence: number;
  coverage_gap_closure_pct: number;
  convergence_addressed_pct: number;
  axiom_support_pct: number;
  evidence_grounding: number;
  mc_p50_normalized: number;
  mc_confidence: number;
  risk_balance: number;
}

export const DEFAULT_COMPOSITE_WEIGHTS: CompositeWeights = {
  confidence: 0.08,                   // self-reported — small weight
  coverage_gap_closure_pct: 0.17,     // real structural alignment
  convergence_addressed_pct: 0.18,    // highest-weighted structural signal
  axiom_support_pct: 0.14,            // respects axioms
  evidence_grounding: 0.12,           // reasoning + entity-code density
  mc_p50_normalized: 0.15,            // MC-computed when present
  mc_confidence: 0.08,                // MC stddev → confidence
  risk_balance: 0.08,                 // failure-mode hedging
};

// Complexity weight applied as a separate subtraction; kept out of the
// normalization sum so simpler strategies can still score high on the
// positive signals without being indirectly penalized twice.
export const COMPLEXITY_PENALTY_WEIGHT = 0.10;

// Sanity: positive weights sum to 1.0.
(function assertWeightsSum() {
  const sum = Object.values(DEFAULT_COMPOSITE_WEIGHTS).reduce(
    (a, b) => a + b,
    0,
  );
  if (Math.abs(sum - 1) > 0.001) {
    throw new Error(
      `[strategy-composite-ranker] DEFAULT_COMPOSITE_WEIGHTS must sum to 1.0, got ${sum}`,
    );
  }
})();

/**
 * Re-normalize the positive weights so only the non-null signals count
 * (a strategy missing MC data isn't penalized for that null).
 */
export function computeCompositeScore(
  signals: CompositeSignals,
  weights: CompositeWeights = DEFAULT_COMPOSITE_WEIGHTS,
): number {
  let weighted = 0;
  let applicableWeightSum = 0;
  const keys: Array<keyof CompositeWeights> = [
    "confidence",
    "coverage_gap_closure_pct",
    "convergence_addressed_pct",
    "axiom_support_pct",
    "evidence_grounding",
    "mc_p50_normalized",
    "mc_confidence",
    "risk_balance",
  ];
  for (const k of keys) {
    const sig = signals[k];
    if (sig === null || sig === undefined) continue;
    if (!Number.isFinite(sig)) continue;
    weighted += weights[k] * Math.max(0, Math.min(1, sig));
    applicableWeightSum += weights[k];
  }
  if (applicableWeightSum === 0) return 0;
  const base = weighted / applicableWeightSum;
  // Subtract complexity penalty — doesn't participate in renormalization.
  return Math.max(
    0,
    Math.min(1, base - COMPLEXITY_PENALTY_WEIGHT * signals.complexity_penalty),
  );
}

/**
 * Extract signals from a single ranked_strategies[] entry. All reads
 * are defensive — the LLM frequently omits fields the schema suggests.
 * Null signals fall out of the composite cleanly.
 */
export function signalsForRankedStrategy(
  r: RankedStrategyShape,
  ctx: {
    totalCoverageGaps: number;
    totalConvergenceClusters: number;
    totalCriticalAxioms: number;
    mcP50Distribution?: { min: number; max: number };
    distribution?: {
      p50: number;
      stddev?: number;
      provenance?: string;
    };
  },
): CompositeSignals {
  const rec = (r.recommendation ?? {}) as Record<string, unknown>;

  // Confidence: LLM self-reported 0-100.
  const rawConf = typeof rec.confidence === "number" ? rec.confidence : null;
  const confidence =
    rawConf !== null && Number.isFinite(rawConf)
      ? Math.max(0, Math.min(1, rawConf / 100))
      : null;

  // Tactic-level provenance aggregation. Each tactic may carry
  // coverage_gap_ids_closed + convergence_ids_addressed + axiom_ids_respected.
  const tactics = Array.isArray(rec.tactics)
    ? (rec.tactics as Array<Record<string, unknown>>)
    : [];
  const perspectives = Array.isArray(rec.perspectives)
    ? (rec.perspectives as Array<Record<string, unknown>>)
    : [];
  const all = [...tactics, ...perspectives];

  const gapsClosed = new Set<string>();
  const convergenceClosed = new Set<string>();
  const axiomsRespected = new Set<string>();
  for (const t of all) {
    if (Array.isArray(t.coverage_gap_ids_closed)) {
      for (const g of t.coverage_gap_ids_closed as string[]) gapsClosed.add(g);
    }
    if (Array.isArray(t.convergence_ids_addressed)) {
      for (const c of t.convergence_ids_addressed as string[]) convergenceClosed.add(c);
    }
    if (Array.isArray(t.axiom_ids_respected)) {
      for (const a of t.axiom_ids_respected as string[]) axiomsRespected.add(a);
    }
  }

  const coverage_gap_closure_pct =
    ctx.totalCoverageGaps > 0
      ? gapsClosed.size / ctx.totalCoverageGaps
      : null;
  const convergence_addressed_pct =
    ctx.totalConvergenceClusters > 0
      ? convergenceClosed.size / ctx.totalConvergenceClusters
      : null;
  const axiom_support_pct =
    ctx.totalCriticalAxioms > 0
      ? axiomsRespected.size / ctx.totalCriticalAxioms
      : null;

  // Evidence grounding: does the reasoning chain cite entity codes?
  // Does it mention cycle/dynamics/polarity? Proxy for "rigor density."
  const reasoning =
    typeof rec.reasoning_chain === "string" ? rec.reasoning_chain : "";
  const entityCodeMatches = reasoning.match(/\b[CX]\d+\b/g)?.length ?? 0;
  const rigorKeywordMatches = (
    reasoning.toLowerCase().match(/\b(causal|cycle|compounding|threshold|polarity|conf(idence)?\s+\d|feedback|bottleneck)\b/g)
    ?? []
  ).length;
  // Normalize: 3+ entity codes AND 2+ rigor keywords → 1.0; scales
  // linearly below.
  const evidence_grounding = Math.max(
    0,
    Math.min(
      1,
      (Math.min(entityCodeMatches, 6) / 6) * 0.6 +
        (Math.min(rigorKeywordMatches, 4) / 4) * 0.4,
    ),
  );

  // MC signals — only when the caller passed a distribution AND it's
  // from a real simulator.
  let mc_p50_normalized: number | null = null;
  let mc_confidence: number | null = null;
  if (
    ctx.distribution &&
    (ctx.distribution.provenance === "mc_simulation" ||
      ctx.distribution.provenance === "bootstrap" ||
      ctx.distribution.provenance === "ode_rk4") &&
    ctx.mcP50Distribution &&
    ctx.mcP50Distribution.max > ctx.mcP50Distribution.min
  ) {
    const range = ctx.mcP50Distribution.max - ctx.mcP50Distribution.min;
    mc_p50_normalized = Math.max(
      0,
      Math.min(
        1,
        (ctx.distribution.p50 - ctx.mcP50Distribution.min) / range,
      ),
    );
    if (
      typeof ctx.distribution.stddev === "number" &&
      Number.isFinite(ctx.distribution.stddev)
    ) {
      mc_confidence = 1 / (1 + Math.abs(ctx.distribution.stddev));
    }
  }

  // Complexity: more tactics + more core_components = more to execute.
  const componentsCount = Array.isArray(
    (rec.infrastructure_map as Record<string, unknown> | undefined)
      ?.core_components,
  )
    ? ((rec.infrastructure_map as Record<string, unknown>)
        .core_components as unknown[]).length
    : 0;
  // Tanh-shaped; 5+5 items saturate to ~0.75, 10+10 to ~0.95.
  const complexity_penalty = Math.tanh((tactics.length + componentsCount) / 10);

  // Risk balance: strategies that name failure modes hedge better than
  // those that don't. failure_modes lives under rec.risk_model.failures[]
  const riskModel = (rec.risk_model as Record<string, unknown> | undefined) ?? {};
  const failures = Array.isArray(riskModel.failures)
    ? (riskModel.failures as unknown[])
    : [];
  const risk_balance =
    tactics.length > 0
      ? Math.max(0, Math.min(1, failures.length / Math.max(1, tactics.length)))
      : null;

  return {
    confidence,
    coverage_gap_closure_pct,
    convergence_addressed_pct,
    axiom_support_pct,
    evidence_grounding,
    mc_p50_normalized,
    mc_confidence,
    complexity_penalty,
    risk_balance,
  };
}

/**
 * Re-rank an LLM-ordered `ranked_strategies[]` by the composite score.
 * Returns the re-ordered list with each entry augmented by:
 *   • llm_rank       — original position in LLM output
 *   • rank           — new position after composite sort
 *   • rank_score     — [0,1] computed composite
 *   • rank_source    — always "composite_computed" in this path
 *   • rank_signals   — per-signal breakdown for audit
 *
 * Preserves every original field so no downstream consumer loses data.
 * Ties break on LLM's original order.
 */
export function rerankStrategiesByComposite(
  ranked: RankedStrategyShape[],
  ctx: {
    totalCoverageGaps: number;
    totalConvergenceClusters: number;
    totalCriticalAxioms: number;
    distributionsByLlmRank?: Map<
      number,
      { p50: number; stddev?: number; provenance?: string }
    >;
  },
): Array<
  RankedStrategyShape & {
    llm_rank: number;
    rank_score: number;
    rank_source: "composite_computed";
    rank_signals: CompositeSignals;
  }
> {
  // First pass: collect all MC p50 values so we can normalize
  // mc_p50_normalized across the candidate set.
  const p50Values: number[] = [];
  if (ctx.distributionsByLlmRank) {
    for (const d of ctx.distributionsByLlmRank.values()) {
      if (
        (d.provenance === "mc_simulation" ||
          d.provenance === "bootstrap" ||
          d.provenance === "ode_rk4") &&
        typeof d.p50 === "number" &&
        Number.isFinite(d.p50)
      ) {
        p50Values.push(d.p50);
      }
    }
  }
  const mcP50Distribution =
    p50Values.length >= 2
      ? {
          min: Math.min(...p50Values),
          max: Math.max(...p50Values),
        }
      : undefined;

  const scored = ranked.map((r, idx) => {
    const llmRank = typeof r.rank === "number" ? r.rank : idx + 1;
    const distribution = ctx.distributionsByLlmRank?.get(llmRank);
    const signals = signalsForRankedStrategy(r, {
      totalCoverageGaps: ctx.totalCoverageGaps,
      totalConvergenceClusters: ctx.totalConvergenceClusters,
      totalCriticalAxioms: ctx.totalCriticalAxioms,
      mcP50Distribution,
      distribution,
    });
    const score = computeCompositeScore(signals);
    return {
      ...r,
      llm_rank: llmRank,
      rank_score: score,
      rank_source: "composite_computed" as const,
      rank_signals: signals,
    };
  });

  // Sort by composite score DESC; tiebreak by original LLM rank ASC so
  // ties surface the LLM's preference.
  scored.sort((a, b) => {
    if (Math.abs(a.rank_score - b.rank_score) < 1e-6) {
      return a.llm_rank - b.llm_rank;
    }
    return b.rank_score - a.rank_score;
  });

  // Re-number rank starting at 1.
  return scored.map((r, i) => ({ ...r, rank: i + 1 }));
}

// Minimal re-export so routes don't need to know the event union.
export type { StructuralEvent };
