// ── Tier 2 Rubric Scorer ──────────────────────────────────────────
//
// Phase 11.1b — explicit 5-criteria LLM grading replaces Monte Carlo
// as the DEFAULT evaluation tier. The previous default (simulate-
// variant-lift + placebo refutation) was Tier 4 — heavyweight, ~3s
// per feature, and dishonest for questions that don't have
// propagating uncertainty.
//
// The rubric tier:
//   • One LLM call per feature, all variations graded in the same
//     pass for cross-comparison consistency
//   • Returns 5 scored criteria + per-variation composite + reasons
//   • Honest about its method — caller stamps evaluation_method
//     onto each variation so the UI surfaces "📋 Rubric · 0.71"
//
// When MC is genuinely warranted (multiple propagating uncertainties
// in a parametric model), the chat agent or user explicitly opts in
// via method="simulation" on the /score route. Rubric is for "is
// this plausibly good?"; MC is for "what's the distribution of
// outcomes when adherence varies across populations?". Different
// questions, different tools.
//
// The 5 criteria (per lock-in M3):
//   1. plausibility    — does this credibly address the targeted pain?
//   2. addresses_pain  — how directly does this counter the pain?
//   3. constraint_fit  — does this fit the user's operational constraints?
//   4. novelty         — does this propose something non-obvious?
//   5. risk            — likelihood of failure or harm (inverted so 1=safe)
//
// Composite is the unweighted mean. Weighting is a future refinement
// (e.g., addresses_pain × 2) — for MVP, equal weights keep the
// criteria contributions visible.

import { llmJSON } from "@/lib/llm";
import {
  buildConstraintsBlock,
  type OperationalConstraints,
} from "./constraints";
import type { ItemVariation } from "./expand-item-detail";

export interface RubricCriterion {
  /** 0..1 score. */
  score: number;
  /** One-sentence reason — surfaced on the Lab page indicator table. */
  reason: string;
}

export interface RubricCriteria {
  plausibility: RubricCriterion;
  addresses_pain: RubricCriterion;
  constraint_fit: RubricCriterion;
  novelty: RubricCriterion;
  risk: RubricCriterion;
}

/** Phase 11.2 — single proxy-indicator grade for one variation.
 *  The user's stated vision: "scoring based on proxy indicators."
 *  Outcomes carry causal_chain.indicators[] (2-4 observable criteria
 *  per outcome, LLM-generated). For each variation × each indicator
 *  the rubric scorer produces this row: how much does this variation
 *  move this indicator, why, and how confident are we that the proxy
 *  actually maps to the outcome we care about. */
export interface IndicatorScore {
  indicator_text: string;
  outcome_id: string;
  outcome_name: string;
  /** 0..1 — variation's expected effect on this specific indicator. */
  score: number;
  /** One sentence — why this score. */
  reason: string;
  /** 0..1 — confidence that this indicator is a good proxy for the
   *  outcome (NOT confidence in the score). Low values flag "shaky
   *  proxy — reconsider what you're measuring." */
  confidence: number;
}

export interface RubricVariationScore {
  variation_id: string;
  /** Unweighted mean of the 5 criteria scores. */
  composite_score: number;
  criteria: RubricCriteria;
  /** Phase 11.2 — per-proxy-indicator breakdown. Empty array when the
   *  target outcomes carry no indicators or the LLM declined to
   *  grade them (soft-fail; never blocks the composite). */
  indicator_scores: IndicatorScore[];
  /** Always "rubric" for output of this scorer. Discriminator. */
  evaluation_method: "rubric";
  scored_at: string;
}

export interface RubricScoreEnvelope {
  evaluation_method: "rubric";
  variation_scores: RubricVariationScore[];
  scored_at: string;
  /** Status discriminator — mirrors the MC envelope's shape for
   *  consistent caller branching. */
  status:
    | "ok"
    | "no_variations"
    | "llm_failed";
  status_detail: string | null;
}

export interface RubricContext {
  /** The feature being scored — name + first principles for grounding. */
  feature: {
    name: string;
    /** From causal_chain.positive_outcome — optional, improves LLM grounding. */
    positive_outcome?: string;
    /** From causal_chain.first_principles. */
    first_principles?: string[];
  };
  /** The room's pain entities — used for the addresses_pain criterion. */
  room_pains: Array<{
    name: string;
    /** From causal_chain.negative_outcome. */
    negative_outcome?: string;
  }>;
  /** The room's outcomes — used for "what positive change does this
   *  variation drive" reasoning. Phase 11.2 adds `id` + `indicators[]`
   *  so each outcome's proxy indicators feed indicator-level scoring.
   *  When indicators are present the LLM grades each variation × each
   *  indicator (capped globally at MAX_INDICATORS to control tokens).
   *  When absent the scorer skips the indicator-scores side cleanly. */
  room_outcomes?: Array<{
    id?: string;
    name: string;
    indicators?: string[];
    /** Phase 11.6 — user-grounded baseline + target per indicator,
     *  keyed by indicator name. When present, the prompt renders a
     *  per-indicator BASELINE CONTEXT block so the LLM grades
     *  projected MOVEMENT FROM BASELINE rather than abstract
     *  effectiveness. Undefined when no baselines set. */
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
  /** Parent sub-objective title for domain grounding. */
  sub_objective_title: string;
  /** Core objective text. */
  core_objective_text: string;
  /** User's operational constraints — drives the constraint_fit criterion. */
  constraints: OperationalConstraints | null;
  /** Variations to grade. Caller should pass ALL variations for this
   *  feature so the LLM can make relative judgments across the set
   *  (novelty is comparative). */
  variations: ItemVariation[];
}

/** Phase 11.2 — global cap on indicators graded per scoring run.
 *  Keeps the prompt under ~3500 tokens with a typical 5 variations
 *  + 3-4 indicators + 5 criteria. Beyond this, the LLM's per-row
 *  attention thins and grades become noisier. The cap is applied at
 *  the SUM across all outcomes (i.e., pick the top N indicators in
 *  causal_chain order) so the user can predict which indicators get
 *  graded if they have outcome A with 3 indicators + outcome B with
 *  3 indicators (cap=6 grades all; cap=5 drops the last). */
const MAX_INDICATORS = 6;

/** The canonical, capped, ordered list of PRE-GENERATED proxy
 *  indicators (from each outcome's causal_chain.indicators[]). This is
 *  the single source of truth the scorer grades against — built once
 *  and used BOTH to render the numbered prompt list AND to map the
 *  LLM's `indicator_index` back to the verbatim pre-generated text.
 *  That round-trip is what guarantees the persisted indicator_score is
 *  wired to the real indicator (not a paraphrase), so the ensemble /
 *  evidence / persona / empirical overlays — which all key by
 *  `${outcome_id}::${indicator_text}` — stack on the SAME row. */
function flattenIndicators(
  outcomes: RubricContext["room_outcomes"],
): Array<{ indicator_text: string; outcome_id: string; outcome_name: string }> {
  const out: Array<{
    indicator_text: string;
    outcome_id: string;
    outcome_name: string;
  }> = [];
  for (const o of outcomes ?? []) {
    for (const ind of o.indicators ?? []) {
      if (typeof ind !== "string" || ind.trim().length === 0) continue;
      out.push({
        indicator_text: ind.trim(),
        outcome_id: o.id ?? "",
        outcome_name: o.name,
      });
      if (out.length >= MAX_INDICATORS) break;
    }
    if (out.length >= MAX_INDICATORS) break;
  }
  return out;
}

const SYSTEM_PROMPT = `You are an expert evaluator scoring proposed mechanisms (interventions) on a 5-criteria rubric AND against the room's proxy indicators.

PART 1 — for EACH variation, score these 5 criteria from 0 to 1 with a one-sentence reason:

1. plausibility — Does this credibly address the targeted pain via first principles or known prior work? Score 0.0 (implausible, contradicts evidence) to 1.0 (clear mechanism, well-established).

2. addresses_pain — How DIRECTLY does this counter the room's pain entities? Score 0.0 (tangential or doesn't address) to 1.0 (head-on attack on the root cause).

3. constraint_fit — Given the user's operational constraints (time, budget, team, risk tolerance), is this executable? Score 0.0 (literally cannot be done) to 1.0 (fits perfectly within constraints).

4. novelty — Does this propose something non-obvious vs the OTHER variations and standard defaults in this domain? Score 0.0 (cliché / first-thing-anyone-would-suggest) to 1.0 (genuinely surprising and well-reasoned).

5. risk — Likelihood of failure or harm. INVERTED scale: score 0.0 (high risk of failing or causing damage) to 1.0 (low risk, safe to ship).

PART 2 — for EACH variation × EACH proxy indicator listed under "ROOM PROXY INDICATORS", produce ONE indicator_score row:
- indicator_index (integer): the 1-based number of the indicator from the "ROOM PROXY INDICATORS" list — copy it EXACTLY. This is how the row is wired to the indicator; do NOT rephrase the indicator, just cite its number. Only use indices that appear in the list.
- score (0..1): how much would THIS variation move THIS specific indicator if shipped. 0.0 means no effect or wrong direction; 1.0 means strong, direct, sustained movement.
- reason: ONE sentence — why this score.
- confidence (0..1): how well does THIS indicator actually proxy for the outcome it's listed under? 0.0 = clearly the wrong proxy or trivially gameable; 1.0 = canonical and well-established measure of the outcome. Lower this aggressively when the proxy is a vanity metric or easily Goodharted — flagging shaky proxies is a feature, not a flaw.

PART 2 — BASELINE CONTEXT (when present):
When a proxy indicator carries a [BASELINE → TARGET] annotation, your score is the user's projected MOVEMENT FROM BASELINE TOWARD TARGET. 0.0 means no measurable movement or wrong direction (worsens baseline). 0.5 means partial movement (~50% of the gap closed). 1.0 means hitting or exceeding the target. Be HONEST about the gap — a "8/10 → 4/10" anxiety reduction is hard; a "20 min → 30 min" focus increase is moderate. Use the baseline + unit + measurement_method as ground truth context.

Constraints on your scores:
- Be strict but fair. Use the full 0..1 range. A 0.5 means "average for this domain."
- Reasons must be ONE sentence. No hedging like "depends on context" — commit to a judgment.
- If a variation is clearly bad on a criterion, score it ≤0.3 and say why directly.
- If a variation is clearly excellent on a criterion, score it ≥0.8 and name what makes it stand out.
- If NO indicators are provided (PART 2 block empty), omit indicator_scores entirely from the variation's row.

Return JSON matching the response schema. No prose outside the JSON.`;

function buildUserPrompt(ctx: RubricContext): string {
  const constraintsBlock = ctx.constraints
    ? `\n${buildConstraintsBlock(ctx.constraints)}\n`
    : "\n[No explicit constraints — score constraint_fit as 1.0 unless a variation requires impossible scale.]\n";

  const painsBlock = ctx.room_pains.length > 0
    ? ctx.room_pains
        .slice(0, 6)
        .map(
          (p) =>
            `  • ${p.name}${p.negative_outcome ? ` — ${p.negative_outcome}` : ""}`,
        )
        .join("\n")
    : "  [No pain entities provided.]";

  const outcomesBlock = ctx.room_outcomes && ctx.room_outcomes.length > 0
    ? ctx.room_outcomes
        .slice(0, 6)
        .map((o) => `  • ${o.name}`)
        .join("\n")
    : "  [No outcome entities provided.]";

  // Phase 11.2 — flatten indicators across outcomes into a single
  // numbered list, capped at MAX_INDICATORS. Each line gets a stable
  // 1-based index used by the LLM to refer back to the indicator
  // when grading. We keep outcome + indicator text together so the
  // model can grade each in context.
  const flattenedIndicators = flattenIndicators(ctx.room_outcomes);
  // Phase 11.6 — when an indicator has a user-set baseline + target,
  // render them inline so the LLM sees the measurable gap rather than
  // a free-floating proxy name. The format compresses to one line
  // per indicator: "[N] (under outcome "X") indicator_text [BASELINE
  // value → TARGET value, UNIT unit · METHOD method]". The LLM is
  // instructed (in PART 2 of the system prompt) to score relative to
  // closing that gap.
  type BaselineMap = NonNullable<
    NonNullable<RubricContext["room_outcomes"]>[number]["indicator_baselines"]
  >;
  function baselineSuffix(
    baselines: BaselineMap | undefined,
    indicatorText: string,
  ): string {
    if (!baselines) return "";
    // Match case-insensitively so LLM paraphrasing tolerance carries
    // forward — try exact match first, then lowercase fallback.
    let entry = baselines[indicatorText];
    if (!entry) {
      const lower = indicatorText.toLowerCase();
      for (const [k, v] of Object.entries(baselines)) {
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
    if (parts.length === 0) return "";
    return ` [${parts.join(" ")}]`;
  }
  const outcomeBaselinesByName = new Map<string, BaselineMap | undefined>();
  for (const o of ctx.room_outcomes ?? []) {
    outcomeBaselinesByName.set(o.name, o.indicator_baselines);
  }
  const indicatorsBlock = flattenedIndicators.length > 0
    ? flattenedIndicators
        .map((ind, i) => {
          const baselines = outcomeBaselinesByName.get(ind.outcome_name);
          const suffix = baselineSuffix(baselines, ind.indicator_text);
          return `  [${i + 1}] (under outcome "${ind.outcome_name}") ${ind.indicator_text}${suffix}`;
        })
        .join("\n")
    : "  [No proxy indicators on the room's outcomes — skip PART 2 entirely.]";

  const principlesBlock =
    ctx.feature.first_principles && ctx.feature.first_principles.length > 0
      ? `\n  first_principles: ${ctx.feature.first_principles.slice(0, 5).join(" · ")}`
      : "";

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

ROOM PROXY INDICATORS (PART 2 — for indicator_scores; reference by index [N]):
${indicatorsBlock}
${constraintsBlock}
VARIATIONS TO SCORE (${ctx.variations.length} total):

${variationsBlock}

Grade each variation on the 5 criteria (PART 1) AND on each proxy indicator (PART 2) per the system instructions. Return one variation_score entry per variation, keyed by id. Each indicator_scores row cites its indicator by indicator_index (the 1-based number from the list above) — never rephrase the indicator text.`;
}

/** Grade variations against the 5-criteria rubric. Returns an
 *  envelope mirroring the shape of the MC scorer's envelope so the
 *  callsite can branch on `evaluation_method` without restructuring
 *  the persistence layer. Soft-fails on LLM error — returns a
 *  zero-score envelope with status="llm_failed" so the UI can show
 *  "scoring unavailable" instead of crashing. */
export async function scoreVariationsWithRubric(
  ctx: RubricContext,
): Promise<RubricScoreEnvelope> {
  const now = new Date().toISOString();

  if (ctx.variations.length === 0) {
    return {
      evaluation_method: "rubric",
      variation_scores: [],
      scored_at: now,
      status: "no_variations",
      status_detail: "Feature has no variations to score.",
    };
  }

  let raw: {
    variation_scores?: Array<{
      variation_id?: unknown;
      criteria?: {
        plausibility?: { score?: unknown; reason?: unknown };
        addresses_pain?: { score?: unknown; reason?: unknown };
        constraint_fit?: { score?: unknown; reason?: unknown };
        novelty?: { score?: unknown; reason?: unknown };
        risk?: { score?: unknown; reason?: unknown };
      };
      indicator_scores?: Array<{
        indicator_index?: unknown;
        score?: unknown;
        reason?: unknown;
        confidence?: unknown;
      }>;
    }>;
  };
  try {
    raw = await llmJSON({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(ctx),
      responseSchema: {
        name: "rubric_variation_scores",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            variation_scores: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  variation_id: { type: "string" },
                  criteria: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      plausibility: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          score: { type: "number" },
                          reason: { type: "string" },
                        },
                        required: ["score", "reason"],
                      },
                      addresses_pain: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          score: { type: "number" },
                          reason: { type: "string" },
                        },
                        required: ["score", "reason"],
                      },
                      constraint_fit: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          score: { type: "number" },
                          reason: { type: "string" },
                        },
                        required: ["score", "reason"],
                      },
                      novelty: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          score: { type: "number" },
                          reason: { type: "string" },
                        },
                        required: ["score", "reason"],
                      },
                      risk: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          score: { type: "number" },
                          reason: { type: "string" },
                        },
                        required: ["score", "reason"],
                      },
                    },
                    required: [
                      "plausibility",
                      "addresses_pain",
                      "constraint_fit",
                      "novelty",
                      "risk",
                    ],
                  },
                  // Phase 11.2 — per-proxy-indicator grades. Optional
                  // at the schema level (some variations may legit not
                  // move some indicators) — the parser tolerates an
                  // empty / missing array.
                  indicator_scores: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        // Index into the canonical pre-generated indicator
                        // list (1-based). The text/outcome are resolved
                        // server-side from this, so the LLM can't drift.
                        indicator_index: { type: "number" },
                        score: { type: "number" },
                        reason: { type: "string" },
                        confidence: { type: "number" },
                      },
                      required: [
                        "indicator_index",
                        "score",
                        "reason",
                        "confidence",
                      ],
                    },
                  },
                },
                required: ["variation_id", "criteria", "indicator_scores"],
              },
            },
          },
          required: ["variation_scores"],
        },
      },
      temperature: 0.2,
      maxTokens: 2400,
    });
  } catch (err) {
    return {
      evaluation_method: "rubric",
      variation_scores: [],
      scored_at: now,
      status: "llm_failed",
      status_detail:
        err instanceof Error ? err.message.slice(0, 240) : String(err),
    };
  }

  // ── Validate + clean raw → typed scores ──
  const variationsById = new Map(ctx.variations.map((v) => [v.id, v]));
  // Same canonical list the prompt numbered — the LLM's indicator_index
  // maps 1:1 back into this, guaranteeing the persisted indicator_text /
  // outcome_id are the VERBATIM pre-generated values (no paraphrase).
  const flat = flattenIndicators(ctx.room_outcomes);
  const scores: RubricVariationScore[] = [];

  for (const row of raw?.variation_scores ?? []) {
    const variation_id =
      typeof row?.variation_id === "string" ? row.variation_id : "";
    if (!variation_id || !variationsById.has(variation_id)) continue;
    const c = row?.criteria;
    if (!c) continue;

    const criterion = (
      cell: { score?: unknown; reason?: unknown } | undefined,
    ): RubricCriterion => {
      const score =
        typeof cell?.score === "number" && Number.isFinite(cell.score)
          ? Math.max(0, Math.min(1, cell.score))
          : 0.5;
      const reason =
        typeof cell?.reason === "string"
          ? cell.reason.trim().slice(0, 240)
          : "";
      return { score, reason };
    };

    const criteria: RubricCriteria = {
      plausibility: criterion(c.plausibility),
      addresses_pain: criterion(c.addresses_pain),
      constraint_fit: criterion(c.constraint_fit),
      novelty: criterion(c.novelty),
      risk: criterion(c.risk),
    };

    const composite =
      (criteria.plausibility.score +
        criteria.addresses_pain.score +
        criteria.constraint_fit.score +
        criteria.novelty.score +
        criteria.risk.score) /
      5;

    // Phase 11.2 + wiring fix — the LLM cites each indicator by its
    // 1-based indicator_index into the canonical pre-generated list.
    // We resolve indicator_text + outcome_id + outcome_name FROM that
    // index (never from LLM free-text), so the persisted row is wired
    // to the real indicator and the downstream overlays
    // (ensemble/evidence/persona/empirical) join on it correctly. An
    // out-of-range index is dropped (no fabrication); a repeated index
    // is deduped.
    const indicator_scores: IndicatorScore[] = [];
    const seenIdx = new Set<number>();
    for (const ind of row?.indicator_scores ?? []) {
      const idx =
        typeof ind?.indicator_index === "number" &&
        Number.isFinite(ind.indicator_index)
          ? Math.round(ind.indicator_index)
          : NaN;
      const canonical = Number.isFinite(idx) ? flat[idx - 1] : undefined;
      if (!canonical || seenIdx.has(idx)) continue;
      seenIdx.add(idx);
      const score =
        typeof ind?.score === "number" && Number.isFinite(ind.score)
          ? Math.max(0, Math.min(1, ind.score))
          : 0.5;
      const reason =
        typeof ind?.reason === "string"
          ? ind.reason.trim().slice(0, 240)
          : "";
      const confidence =
        typeof ind?.confidence === "number" && Number.isFinite(ind.confidence)
          ? Math.max(0, Math.min(1, ind.confidence))
          : 0.5;
      indicator_scores.push({
        indicator_text: canonical.indicator_text,
        outcome_id: canonical.outcome_id,
        outcome_name: canonical.outcome_name,
        score,
        reason,
        confidence,
      });
    }

    scores.push({
      variation_id,
      composite_score: composite,
      criteria,
      indicator_scores,
      evaluation_method: "rubric",
      scored_at: now,
    });
  }

  return {
    evaluation_method: "rubric",
    variation_scores: scores,
    scored_at: now,
    status: scores.length > 0 ? "ok" : "llm_failed",
    status_detail:
      scores.length === 0
        ? "LLM returned no usable scores."
        : null,
  };
}
