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

export interface RubricVariationScore {
  variation_id: string;
  /** Unweighted mean of the 5 criteria scores. */
  composite_score: number;
  criteria: RubricCriteria;
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
   *  variation drive" reasoning. */
  room_outcomes?: Array<{
    name: string;
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

const SYSTEM_PROMPT = `You are an expert evaluator scoring proposed mechanisms (interventions) on a 5-criteria rubric.

For EACH variation, score these 5 criteria from 0 to 1 with a one-sentence reason:

1. plausibility — Does this credibly address the targeted pain via first principles or known prior work? Score 0.0 (implausible, contradicts evidence) to 1.0 (clear mechanism, well-established).

2. addresses_pain — How DIRECTLY does this counter the room's pain entities? Score 0.0 (tangential or doesn't address) to 1.0 (head-on attack on the root cause).

3. constraint_fit — Given the user's operational constraints (time, budget, team, risk tolerance), is this executable? Score 0.0 (literally cannot be done) to 1.0 (fits perfectly within constraints).

4. novelty — Does this propose something non-obvious vs the OTHER variations and standard defaults in this domain? Score 0.0 (cliché / first-thing-anyone-would-suggest) to 1.0 (genuinely surprising and well-reasoned).

5. risk — Likelihood of failure or harm. INVERTED scale: score 0.0 (high risk of failing or causing damage) to 1.0 (low risk, safe to ship).

Constraints on your scores:
- Be strict but fair. Use the full 0..1 range. A 0.5 means "average for this domain."
- Reasons must be ONE sentence. No hedging like "depends on context" — commit to a judgment.
- If a variation is clearly bad on a criterion, score it ≤0.3 and say why directly.
- If a variation is clearly excellent on a criterion, score it ≥0.8 and name what makes it stand out.

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
${constraintsBlock}
VARIATIONS TO SCORE (${ctx.variations.length} total):

${variationsBlock}

Grade each variation on the 5 criteria per the system instructions. Return one variation_score entry per variation, keyed by id.`;
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
                },
                required: ["variation_id", "criteria"],
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

    scores.push({
      variation_id,
      composite_score: composite,
      criteria,
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
