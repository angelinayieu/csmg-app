// ── Tier 3 Ensemble Scorer — multi-lens proxy-indicator grading ───
//
// Phase 11.3 — the most rigorous scoring tier short of running an
// actual experiment. Addresses three failure modes the Phase 11.2
// rubric scorer left open:
//
//   1. SINGLE LLM JUDGMENT — rubric used one perspective; ensemble
//      runs 5 (systems_analyst / skeptic / operator / engineer /
//      historian) so each indicator gets graded from epistemologies
//      that DISAGREE by design. Variance across lenses is the
//      confidence signal — when 5 lenses converge, the proxy is
//      well-formed; when they diverge, it's a Potemkin metric.
//
//   2. NO GOODHART RESISTANCE — pure-volume proxies are gameable
//      (volume × engagement always rises, regardless of value).
//      The ensemble call also asks for a COUNTER-INDICATOR per
//      outcome — an opposing proxy that should hold steady or
//      improve alongside the primary one. Following 2026 best
//      practice ("balanced scorecard", Goodhart mitigation literature)
//      — pair every yang with a yin.
//
//   3. NO MEDIATION CHECK — Prentice criterion (1989, extended by
//      Buyse 2000) says a valid surrogate must mediate the
//      intervention's effect on the true outcome. The ensemble
//      asks the LLM to classify each indicator as `necessary`
//      (in the causal chain), `indirect` (correlated but bypassable),
//      or `questionable` (might break under intervention).
//
// Why ONE LLM call instead of 5 parallel:
//   - 5 parallel calls = ~5x cost; one call with internal multi-lens
//     reasoning = ~1.5x rubric cost, single round-trip
//   - The lens prompts share substantial context (variations, room,
//     constraints) — sending it 5 times wastes tokens
//   - Variance signal is meaningful as long as the model treats each
//     lens as a distinct evaluator; we instruct it explicitly to do so
//     and validate the output for divergence
//
// Statistical follow-up: caller passes the per-variation indicator
// scores into pool-indicator-confidence.ts (REML τ²) to surface
// HETEROGENEITY across variations for each indicator. A proxy that's
// rated wildly differently across variations has high τ² → flag.

import { llmJSON } from "@/lib/llm";
import {
  buildConstraintsBlock,
  type OperationalConstraints,
} from "./constraints";
import type { ItemVariation } from "./expand-item-detail";

// ── Lens identifiers — mirror the 5 framing lenses ────────────────
//
// These match `ALL_LENS_IDS` in src/lib/prompts/framing-lenses.ts so
// the cross-system mental model stays consistent. The prompts here
// are scoped to indicator-validity evaluation (not the framing
// pipeline's cell-axis output), so we don't re-import their prompts —
// we restate the lens's evaluation stance in terms of THIS task.

export type EnsembleLensId =
  | "systems_analyst"
  | "skeptic"
  | "operator"
  | "engineer"
  | "historian";

export const ENSEMBLE_LENS_IDS: readonly EnsembleLensId[] = [
  "systems_analyst",
  "skeptic",
  "operator",
  "engineer",
  "historian",
];

const LENS_STANCE: Record<EnsembleLensId, string> = {
  systems_analyst:
    "Maps the system: does this proxy sit IN the causal chain between the intervention and the outcome, or is it a spurious correlate? Looks for feedback loops, mediation gaps, and side channels.",
  skeptic:
    "Challenges the framing: what's the load-bearing assumption tying this proxy to the outcome? What could break the link? If the assumption fails, does the variation's score collapse?",
  operator:
    "Ground truth: would a practitioner watching this metric day-to-day actually see the variation's effect? Vanity metrics that read clean in dashboards but don't reflect daily reality get low scores.",
  engineer:
    "Mechanism: is there a physical/material/computational reason the variation should move this indicator? If the engineering story is hand-wavy, the proxy is shaky regardless of correlation strength.",
  historian:
    "Precedent: what does prior practice say about this indicator-outcome pairing? Are there well-documented cases where this proxy held? Cases where it broke?",
};

// ── Public types ──────────────────────────────────────────────────

export interface LensScore {
  lens: EnsembleLensId;
  /** 0..1 — how much would THIS variation move THIS indicator,
   *  judged from this lens's stance. */
  score: number;
  /** 0..1 — how confident is THIS LENS that the proxy is valid
   *  (not whether the variation moves it). */
  confidence: number;
  /** One sentence — the lens's specific reasoning. */
  reason: string;
}

export type MediationCheck = "necessary" | "indirect" | "questionable";
export type GoodhartRisk = "low" | "medium" | "high";

export interface EnsembleIndicatorScore {
  indicator_text: string;
  outcome_id: string;
  outcome_name: string;
  /** Per-lens grades. Order matches ENSEMBLE_LENS_IDS. */
  lens_scores: LensScore[];
  /** Mean of lens scores — the consensus point estimate. */
  consensus_score: number;
  /** Mean of lens confidences — the consensus proxy-validity. */
  consensus_confidence: number;
  /** Stddev of lens scores — "how much did the lenses disagree on
   *  whether this variation moves this indicator." */
  disagreement_score: number;
  /** Stddev of lens confidences — "how much did the lenses disagree
   *  on whether the proxy is valid at all." */
  disagreement_confidence: number;
  /** How many lenses agree the proxy is valid (confidence ≥ 0.5).
   *  Renders as "4/5 ✓" in the UI. */
  lens_agreement_count: number;
  /** Prentice mediation check — consensus answer across lenses. */
  mediation_check: MediationCheck;
  /** Goodhart risk — how gameable is this proxy if you optimize for it. */
  goodhart_risk: GoodhartRisk;
}

export interface CounterIndicator {
  outcome_id: string;
  outcome_name: string;
  /** Verbatim text of the suggested opposing proxy. */
  counter_indicator: string;
  /** One sentence — why this counter-indicator pairs well. */
  rationale: string;
}

export interface EnsembleVariationScore {
  variation_id: string;
  /** Same 5-criteria rubric as the Tier 2 scorer (we keep it because
   *  it composes into the headline score everywhere). Computed as
   *  the mean of per-lens criterion scores when those are emitted;
   *  otherwise the LLM emits a single consensus value. */
  composite_score: number;
  indicator_scores: EnsembleIndicatorScore[];
  evaluation_method: "ensemble";
  scored_at: string;
}

export interface EnsembleScoreEnvelope {
  evaluation_method: "ensemble";
  variation_scores: EnsembleVariationScore[];
  /** Per-outcome Goodhart antidotes. One counter per outcome that
   *  carried indicators. UI surfaces as "Counter: [X]" chip below
   *  the indicator strip. */
  counter_indicators: CounterIndicator[];
  scored_at: string;
  status: "ok" | "no_variations" | "no_indicators" | "llm_failed";
  status_detail: string | null;
}

export interface EnsembleContext {
  feature: {
    name: string;
    positive_outcome?: string;
    first_principles?: string[];
  };
  room_pains: Array<{
    name: string;
    negative_outcome?: string;
  }>;
  room_outcomes: Array<{
    id: string;
    name: string;
    indicators: string[];
    /** Phase 11.6 — user-grounded baseline + target per indicator,
     *  keyed by indicator name. When present, the prompt renders a
     *  per-indicator BASELINE → TARGET annotation so the 5 lenses
     *  grade projected movement toward measurable goals rather than
     *  abstract effectiveness. Undefined when no baselines set. */
    indicator_baselines?: Record<
      string,
      {
        baseline_value?: string;
        target_value?: string;
        unit?: string;
        measurement_method?: string;
        source?: "user" | "llm";
      }
    >;
  }>;
  sub_objective_title: string;
  core_objective_text: string;
  constraints: OperationalConstraints | null;
  variations: ItemVariation[];
}

// ── Prompt construction ───────────────────────────────────────────

/** Indicator cap matches the rubric scorer's cap so the two tiers
 *  compare apples-to-apples when the UI flips between them. */
const MAX_INDICATORS = 6;

function flattenIndicators(
  outcomes: EnsembleContext["room_outcomes"],
): Array<{ indicator_text: string; outcome_id: string; outcome_name: string }> {
  const flat: Array<{
    indicator_text: string;
    outcome_id: string;
    outcome_name: string;
  }> = [];
  for (const o of outcomes) {
    for (const ind of o.indicators ?? []) {
      if (typeof ind !== "string" || ind.trim().length === 0) continue;
      flat.push({
        indicator_text: ind.trim(),
        outcome_id: o.id,
        outcome_name: o.name,
      });
      if (flat.length >= MAX_INDICATORS) break;
    }
    if (flat.length >= MAX_INDICATORS) break;
  }
  return flat;
}

const SYSTEM_PROMPT = `You are an ensemble evaluator. Five distinct lenses will independently grade each variation against each proxy indicator. The lenses are:

systems_analyst — Maps the system. Asks: does this proxy sit IN the causal chain between the intervention and the outcome, or is it a spurious correlate? Looks for feedback loops, mediation gaps, side channels.

skeptic — Challenges the framing. Asks: what's the load-bearing assumption tying this proxy to the outcome? What could break the link?

operator — Ground truth. Asks: would a practitioner watching this metric day-to-day see the variation's effect? Penalizes vanity metrics.

engineer — Mechanism. Asks: is there a physical/material/computational reason the variation should move this indicator? Penalizes hand-wavy stories.

historian — Precedent. Asks: what does prior practice say? Is there documented evidence of this indicator-outcome pairing holding (or breaking)?

For EACH variation × EACH indicator, produce 5 lens_scores rows — one per lens, in this exact order: systems_analyst, skeptic, operator, engineer, historian. Each row carries:
  - score (0..1): how much this variation moves this specific indicator, FROM THIS LENS'S STANCE
  - confidence (0..1): how confident this lens is that the indicator is a VALID PROXY for the outcome (NOT confidence in the score)
  - reason: ONE sentence in this lens's voice

The lenses MUST disagree where their epistemology differs. If all 5 produce identical numbers, you're hand-waving — diverge intentionally.

Per indicator (across variations), also classify:
  - mediation_check: "necessary" (proxy is in the causal chain, intervention must move it to move the outcome), "indirect" (correlated but the intervention could bypass it), or "questionable" (proxy might break or invert under intervention)
  - goodhart_risk: "low" (proxy resists gaming), "medium" (game-able with effort), "high" (pure-volume / vanity / easily Goodharted)

Per outcome, propose ONE counter_indicator — an OPPOSING proxy that should hold steady or improve alongside the primary indicators. Goodhart's law mitigation: pair every yang with a yin. Example: if outcome is "user engagement," primary indicators measure activity (sessions, time) → counter_indicator might be "session quality / value-per-session." Don't pick another activity metric — pick the OPPOSITE axis.

Also score each variation on the 5-criteria rubric composite (plausibility, addresses_pain, constraint_fit, novelty, risk — same scale 0..1 each) and return composite_score as their unweighted mean.

Return JSON matching the response schema. No prose outside the JSON.`;

function buildUserPrompt(
  ctx: EnsembleContext,
  flat: ReturnType<typeof flattenIndicators>,
): string {
  const painsBlock = ctx.room_pains.length > 0
    ? ctx.room_pains
        .slice(0, 6)
        .map(
          (p) =>
            `  • ${p.name}${p.negative_outcome ? ` — ${p.negative_outcome}` : ""}`,
        )
        .join("\n")
    : "  [No pain entities provided.]";

  const outcomesBlock = ctx.room_outcomes.length > 0
    ? ctx.room_outcomes
        .slice(0, 6)
        .map((o) => `  • [${o.id}] ${o.name}`)
        .join("\n")
    : "  [No outcome entities provided.]";

  // Phase 11.6 — surface user-set baselines + targets inline so the
  // 5 lenses grade movement toward measurable goals rather than
  // abstract effectiveness. Same pattern as the rubric scorer:
  // append "[BASELINE x → TARGET y (unit) · method: m]" suffix when
  // present. Case-insensitive lookup for LLM paraphrase tolerance.
  type BaselineEntry = {
    baseline_value?: string;
    target_value?: string;
    unit?: string;
    measurement_method?: string;
  };
  const baselinesByOutcomeId = new Map<
    string,
    Record<string, BaselineEntry> | undefined
  >();
  for (const o of ctx.room_outcomes) {
    baselinesByOutcomeId.set(o.id, o.indicator_baselines);
  }
  function baselineSuffix(
    outcomeId: string,
    indicatorText: string,
  ): string {
    const map = baselinesByOutcomeId.get(outcomeId);
    if (!map) return "";
    let entry = map[indicatorText];
    if (!entry) {
      const lower = indicatorText.toLowerCase();
      for (const [k, v] of Object.entries(map)) {
        if (k.toLowerCase() === lower) {
          entry = v;
          break;
        }
      }
    }
    if (!entry) return "";
    const parts: string[] = [];
    if (entry.baseline_value)
      parts.push(`BASELINE ${entry.baseline_value}`);
    if (entry.target_value) parts.push(`→ TARGET ${entry.target_value}`);
    if (entry.unit) parts.push(`(${entry.unit})`);
    if (entry.measurement_method)
      parts.push(`· method: ${entry.measurement_method}`);
    return parts.length === 0 ? "" : ` [${parts.join(" ")}]`;
  }
  const indicatorsBlock = flat.length > 0
    ? flat
        .map(
          (ind, i) =>
            `  [${i + 1}] (under outcome "${ind.outcome_name}" id=${ind.outcome_id}) ${ind.indicator_text}${baselineSuffix(ind.outcome_id, ind.indicator_text)}`,
        )
        .join("\n")
    : "  [No proxy indicators on the room's outcomes — return status=no_indicators.]";

  const principlesBlock =
    ctx.feature.first_principles && ctx.feature.first_principles.length > 0
      ? `\n  first_principles: ${ctx.feature.first_principles.slice(0, 5).join(" · ")}`
      : "";

  const constraintsBlock = ctx.constraints
    ? `\n${buildConstraintsBlock(ctx.constraints)}\n`
    : "\n[No explicit constraints.]\n";

  const variationsBlock = ctx.variations
    .map(
      (v, i) =>
        `[VARIATION ${i + 1} — id=${v.id}]
  name: ${v.name}
  description: ${v.description}
  tradeoff: ${v.tradeoff}
  kind: ${v.kind}`,
    )
    .join("\n\n");

  return `PARENT OBJECTIVE:
"""
${ctx.core_objective_text.slice(0, 1000)}
"""

SUB-OBJECTIVE (room scope):
"""
${ctx.sub_objective_title}
"""

FEATURE BEING EVALUATED:
  Name: ${ctx.feature.name}${ctx.feature.positive_outcome ? `\n  positive_outcome: ${ctx.feature.positive_outcome}` : ""}${principlesBlock}

ROOM PAINS (what these variations should address):
${painsBlock}

ROOM OUTCOMES (positive change being sought):
${outcomesBlock}

ROOM PROXY INDICATORS (each will be graded by all 5 lenses):
${indicatorsBlock}
${constraintsBlock}
VARIATIONS TO SCORE (${ctx.variations.length} total):

${variationsBlock}

Grade each variation × each indicator from each of the 5 lenses. Also propose ONE counter_indicator per outcome that had indicators. Return one variation_score entry per variation.`;
}

// ── Schema ────────────────────────────────────────────────────────

const LENS_SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lens: {
      type: "string",
      enum: ENSEMBLE_LENS_IDS as readonly string[],
    },
    score: { type: "number" },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["lens", "score", "confidence", "reason"],
} as const;

const INDICATOR_SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    indicator_text: { type: "string" },
    outcome_id: { type: "string" },
    outcome_name: { type: "string" },
    lens_scores: { type: "array", items: LENS_SCORE_SCHEMA },
    mediation_check: {
      type: "string",
      enum: ["necessary", "indirect", "questionable"],
    },
    goodhart_risk: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
  },
  required: [
    "indicator_text",
    "outcome_id",
    "outcome_name",
    "lens_scores",
    "mediation_check",
    "goodhart_risk",
  ],
} as const;

const VARIATION_SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    variation_id: { type: "string" },
    composite_score: { type: "number" },
    indicator_scores: { type: "array", items: INDICATOR_SCORE_SCHEMA },
  },
  required: ["variation_id", "composite_score", "indicator_scores"],
} as const;

const COUNTER_INDICATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    outcome_id: { type: "string" },
    outcome_name: { type: "string" },
    counter_indicator: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["outcome_id", "outcome_name", "counter_indicator", "rationale"],
} as const;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    variation_scores: { type: "array", items: VARIATION_SCORE_SCHEMA },
    counter_indicators: { type: "array", items: COUNTER_INDICATOR_SCHEMA },
  },
  required: ["variation_scores", "counter_indicators"],
} as const;

// ── Aggregation helpers ───────────────────────────────────────────

function meanAndStddev(xs: number[]): { mean: number; stddev: number } {
  if (xs.length === 0) return { mean: 0, stddev: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (xs.length === 1) return { mean, stddev: 0 };
  const variance =
    xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (xs.length - 1);
  return { mean, stddev: Math.sqrt(variance) };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ── Public scorer ─────────────────────────────────────────────────

export async function scoreVariationsWithEnsemble(
  ctx: EnsembleContext,
): Promise<EnsembleScoreEnvelope> {
  const now = new Date().toISOString();

  if (ctx.variations.length === 0) {
    return {
      evaluation_method: "ensemble",
      variation_scores: [],
      counter_indicators: [],
      scored_at: now,
      status: "no_variations",
      status_detail: "Feature has no variations to score.",
    };
  }

  const flat = flattenIndicators(ctx.room_outcomes);
  if (flat.length === 0) {
    return {
      evaluation_method: "ensemble",
      variation_scores: [],
      counter_indicators: [],
      scored_at: now,
      status: "no_indicators",
      status_detail:
        "No proxy indicators on the room's outcomes — ensemble scoring requires indicators to evaluate.",
    };
  }

  let raw: {
    variation_scores?: Array<{
      variation_id?: unknown;
      composite_score?: unknown;
      indicator_scores?: Array<{
        indicator_text?: unknown;
        outcome_id?: unknown;
        outcome_name?: unknown;
        lens_scores?: Array<{
          lens?: unknown;
          score?: unknown;
          confidence?: unknown;
          reason?: unknown;
        }>;
        mediation_check?: unknown;
        goodhart_risk?: unknown;
      }>;
    }>;
    counter_indicators?: Array<{
      outcome_id?: unknown;
      outcome_name?: unknown;
      counter_indicator?: unknown;
      rationale?: unknown;
    }>;
  };
  try {
    raw = await llmJSON({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(ctx, flat),
      responseSchema: {
        name: "ensemble_scores",
        schema: RESPONSE_SCHEMA,
      },
      temperature: 0.3,
      maxTokens: 6000,
    });
  } catch (err) {
    return {
      evaluation_method: "ensemble",
      variation_scores: [],
      counter_indicators: [],
      scored_at: now,
      status: "llm_failed",
      status_detail:
        err instanceof Error ? err.message.slice(0, 240) : String(err),
    };
  }

  // ── Validate + aggregate ──
  const variationsById = new Map(ctx.variations.map((v) => [v.id, v]));
  const flatLookup = new Map(
    flat.map((f) => [f.indicator_text.toLowerCase(), f] as const),
  );
  const variation_scores: EnsembleVariationScore[] = [];

  for (const row of raw?.variation_scores ?? []) {
    const variation_id =
      typeof row?.variation_id === "string" ? row.variation_id : "";
    if (!variation_id || !variationsById.has(variation_id)) continue;
    const composite_score =
      typeof row?.composite_score === "number" && Number.isFinite(row.composite_score)
        ? clamp01(row.composite_score)
        : 0.5;

    const indicator_scores: EnsembleIndicatorScore[] = [];
    for (const ind of row?.indicator_scores ?? []) {
      const indicator_text =
        typeof ind?.indicator_text === "string"
          ? ind.indicator_text.trim().slice(0, 240)
          : "";
      if (indicator_text.length === 0) continue;

      // Attribute via outcome_id; fall back to indicator-text lookup.
      let outcome_id =
        typeof ind?.outcome_id === "string" ? ind.outcome_id : "";
      let outcome_name =
        typeof ind?.outcome_name === "string" ? ind.outcome_name : "";
      if (!outcome_id || !outcome_name) {
        const hit = flatLookup.get(indicator_text.toLowerCase());
        if (hit) {
          outcome_id = hit.outcome_id;
          outcome_name = hit.outcome_name;
        } else {
          continue;
        }
      }

      // Parse lens_scores. Must have ≥3 lens rows to count as ensemble
      // — fewer than that means the model hand-waved and we don't
      // have meaningful variance. We still surface it, just with
      // lower lens_agreement_count.
      const parsedLensScores: LensScore[] = [];
      for (const ls of ind?.lens_scores ?? []) {
        const lens = (typeof ls?.lens === "string" ? ls.lens : "") as EnsembleLensId;
        if (!ENSEMBLE_LENS_IDS.includes(lens)) continue;
        const score =
          typeof ls?.score === "number" && Number.isFinite(ls.score)
            ? clamp01(ls.score)
            : 0.5;
        const confidence =
          typeof ls?.confidence === "number" && Number.isFinite(ls.confidence)
            ? clamp01(ls.confidence)
            : 0.5;
        const reason =
          typeof ls?.reason === "string"
            ? ls.reason.trim().slice(0, 240)
            : "";
        parsedLensScores.push({ lens, score, confidence, reason });
      }
      if (parsedLensScores.length === 0) continue;

      const scoreStats = meanAndStddev(parsedLensScores.map((l) => l.score));
      const confStats = meanAndStddev(parsedLensScores.map((l) => l.confidence));
      const lens_agreement_count = parsedLensScores.filter(
        (l) => l.confidence >= 0.5,
      ).length;

      const mediation_check: MediationCheck =
        ind?.mediation_check === "necessary" ||
        ind?.mediation_check === "indirect" ||
        ind?.mediation_check === "questionable"
          ? ind.mediation_check
          : "indirect";
      const goodhart_risk: GoodhartRisk =
        ind?.goodhart_risk === "low" ||
        ind?.goodhart_risk === "medium" ||
        ind?.goodhart_risk === "high"
          ? ind.goodhart_risk
          : "medium";

      indicator_scores.push({
        indicator_text,
        outcome_id,
        outcome_name,
        lens_scores: parsedLensScores,
        consensus_score: scoreStats.mean,
        consensus_confidence: confStats.mean,
        disagreement_score: scoreStats.stddev,
        disagreement_confidence: confStats.stddev,
        lens_agreement_count,
        mediation_check,
        goodhart_risk,
      });
    }

    variation_scores.push({
      variation_id,
      composite_score,
      indicator_scores,
      evaluation_method: "ensemble",
      scored_at: now,
    });
  }

  // Counter-indicators: one per outcome that had indicators in flat.
  const validOutcomeIds = new Set(flat.map((f) => f.outcome_id));
  const counter_indicators: CounterIndicator[] = [];
  for (const ci of raw?.counter_indicators ?? []) {
    const outcome_id =
      typeof ci?.outcome_id === "string" ? ci.outcome_id : "";
    if (!validOutcomeIds.has(outcome_id)) continue;
    const outcome_name =
      typeof ci?.outcome_name === "string" ? ci.outcome_name : "";
    const counter_indicator =
      typeof ci?.counter_indicator === "string"
        ? ci.counter_indicator.trim().slice(0, 200)
        : "";
    const rationale =
      typeof ci?.rationale === "string"
        ? ci.rationale.trim().slice(0, 280)
        : "";
    if (!counter_indicator || !outcome_name) continue;
    counter_indicators.push({
      outcome_id,
      outcome_name,
      counter_indicator,
      rationale,
    });
  }

  return {
    evaluation_method: "ensemble",
    variation_scores,
    counter_indicators,
    scored_at: now,
    status: variation_scores.length > 0 ? "ok" : "llm_failed",
    status_detail:
      variation_scores.length === 0
        ? "LLM returned no usable variation scores."
        : null,
  };
}
