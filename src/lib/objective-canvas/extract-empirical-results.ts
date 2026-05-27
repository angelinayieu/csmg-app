// ── Tested Tier — Empirical Result Extraction (Phase 11.7) ───────
//
// The top tier in the evaluation stack. Theoretical rigor (ensemble
// + REML + MC + evidence) is real engineering, but it's all
// reasoning ABOUT the proxy-outcome link. The Tested tier is what
// happens when reality talks back: a prototype concluded, the user
// captured a result_summary, and now we can stop predicting and
// start measuring.
//
// What this module does:
//   Given a concluded prototype brief's result_summary + the room's
//   proxy indicators, ONE LLM call parses the free-text result into
//   structured per-indicator empirical signals:
//
//   - observed_lift_pct: signed % change actually observed on the
//     indicator. Positive = moved in the desired direction.
//     Null when the result doesn't mention this indicator.
//
//   - observed_direction: "increased" | "decreased" | "no_change" |
//     "inconsistent" — qualitative direction even when no numeric
//     lift is reported. Captures "users said it felt slower" cases
//     where lift_pct can't be pinned down.
//
//   - methodology_rigor (0..1): how trustworthy is THIS result? A
//     formal A/B test with N=200 scores ~0.9; a single user's
//     anecdotal comment scores ~0.2. Composes with the result's
//     impact into a final empirical confidence.
//
//   - sample_size_estimate: numeric or null when not extractable.
//     Surfaces in the UI as "N=200" so users see the statistical
//     weight at a glance.
//
//   - extraction_rationale: ONE sentence — the LLM's argument for
//     the lift + direction + rigor numbers. The audit trail
//     between the result_summary text and the structured output.
//
// Composition with theoretical scoring:
//   When empirical_overlay is present, evaluation_method on the
//   indicator becomes "tested" and the chip surface shows the
//   empirical numbers as the headline. The theoretical layers
//   (ensemble, MC, evidence) remain available as the audit story
//   but no longer drive the visual hierarchy — reality outranks
//   theory.
//
// Why this matters statistically:
//   The Prentice meta-analytic framework requires individual-level
//   AND trial-level association data to validate a surrogate. The
//   ensemble + MC + evidence layers approximate the individual-
//   level part (within-trial reasoning). The Tested tier provides
//   the trial-level signal — every concluded prototype is a tiny
//   experiment, and aggregating them across variations gives
//   meta-analytic strength to indicator validity claims.

import { llmJSON } from "@/lib/llm";

// ── Public types ──────────────────────────────────────────────────

export type EmpiricalDirection =
  | "increased"
  | "decreased"
  | "no_change"
  | "inconsistent";

export interface EmpiricalIndicatorResult {
  indicator_text: string;
  outcome_id: string;
  /** Signed % change observed on the indicator. Null when the
   *  result_summary text doesn't pin a quantitative number. */
  observed_lift_pct: number | null;
  /** Qualitative direction. Always present even when lift_pct null. */
  observed_direction: EmpiricalDirection;
  /** 0..1 — methodological rigor of THIS empirical result.
   *  Anchoring guidance for the LLM:
   *    0.0-0.2 — single user anecdote, vibes, no measurement
   *    0.3-0.5 — informal observation, small N, no control
   *    0.6-0.8 — structured test with comparison, N≥20 OR strong design
   *    0.9-1.0 — formal A/B with adequate N, pre-registered, replicated */
  methodology_rigor: number;
  /** Sample size when extractable from text. Null otherwise. */
  sample_size_estimate: number | null;
  /** ONE sentence — LLM's argument for the lift/direction/rigor numbers. */
  extraction_rationale: string;
}

export interface EmpiricalExtractEnvelope {
  status: "ok" | "no_indicators" | "no_result_text" | "llm_failed";
  status_detail: string | null;
  results: EmpiricalIndicatorResult[];
  extracted_at: string;
}

export interface EmpiricalContext {
  /** The concluded prototype's result_summary text — user-written. */
  result_summary: string;
  /** Variation context — what the prototype was testing. */
  variation_name: string;
  variation_description: string;
  /** Indicators the variation was graded against. Each empirical
   *  result will reference one of these by exact indicator_text. */
  indicators: Array<{
    indicator_text: string;
    outcome_id: string;
    outcome_name: string;
  }>;
  /** Optional: the open_question the prototype brief was built to
   *  answer. Helps the LLM ground the result_summary in WHAT was
   *  being tested. */
  open_question?: string;
}

// ── Prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an empirical results extractor. Given a user-captured result_summary from a concluded prototype + a list of proxy indicators that the variation was theoretically graded against, extract per-indicator empirical signals.

For EACH indicator that the result_summary genuinely informs, return ONE result row with:
  - indicator_text (exact match to one in INDICATORS block)
  - outcome_id (matching the indicator)
  - observed_lift_pct: signed % change (positive = improved). Use null when the text doesn't contain a quantitative number for this indicator.
  - observed_direction: "increased" | "decreased" | "no_change" | "inconsistent". Always present — even qualitative results carry directional information.
  - methodology_rigor (0..1):
      0.0-0.2 = single user anecdote, vibes, no measurement
      0.3-0.5 = informal observation, small N, no control
      0.6-0.8 = structured test with comparison, N≥20 OR strong design
      0.9-1.0 = formal A/B with adequate N, pre-registered, replicated
  - sample_size_estimate: integer when the text mentions N (e.g., "10 users tried it" → 10). Null when not extractable.
  - extraction_rationale: ONE sentence — your argument for the numbers, citing the relevant phrase from result_summary.

Rules:
  - Only include indicators the result_summary GENUINELY informs. A test that didn't measure indicator X must NOT produce an empirical row for X.
  - "increased / decreased" must be in the DIRECTION OF IMPROVEMENT for the outcome, not the raw indicator. If "session time" went up but the outcome is "reduce time wasted," then direction = "decreased" (improvement of the outcome).
  - Be conservative on methodology_rigor. Most prototype result_summaries are 0.2-0.5 territory. Reserve 0.8+ for clearly rigorous designs.
  - When the result_summary is empty / placeholder / says nothing concrete, return an empty results array.

Return JSON matching the response schema. No prose outside the JSON.`;

function buildUserPrompt(ctx: EmpiricalContext): string {
  const indicatorsBlock = ctx.indicators
    .map(
      (ind, i) =>
        `[${i + 1}] "${ind.indicator_text}" (under outcome "${ind.outcome_name}" id=${ind.outcome_id})`,
    )
    .join("\n");

  return `VARIATION TESTED:
  Name: ${ctx.variation_name}
  Description: ${ctx.variation_description}${
    ctx.open_question
      ? `\n  Open question the prototype targeted: ${ctx.open_question}`
      : ""
  }

PROXY INDICATORS the variation was theoretically graded against:
${indicatorsBlock}

RESULT SUMMARY (user-captured at prototype conclusion):
"""
${ctx.result_summary.slice(0, 2000)}
"""

Extract per-indicator empirical signals. Indicators NOT mentioned in the result_summary should NOT appear in the output. Match indicator_text exactly to the strings above.`;
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          indicator_text: { type: "string" },
          outcome_id: { type: "string" },
          observed_lift_pct: { type: ["number", "null"] },
          observed_direction: {
            type: "string",
            enum: ["increased", "decreased", "no_change", "inconsistent"],
          },
          methodology_rigor: { type: "number" },
          sample_size_estimate: { type: ["number", "null"] },
          extraction_rationale: { type: "string" },
        },
        required: [
          "indicator_text",
          "outcome_id",
          "observed_lift_pct",
          "observed_direction",
          "methodology_rigor",
          "sample_size_estimate",
          "extraction_rationale",
        ],
      },
    },
  },
  required: ["results"],
} as const;

// ── Public extractor ──────────────────────────────────────────────

/** Extract structured per-indicator empirical results from a
 *  concluded prototype's result_summary text. Soft-fails on empty
 *  text or empty indicator list (returns appropriate status). */
export async function extractEmpiricalResults(
  ctx: EmpiricalContext,
): Promise<EmpiricalExtractEnvelope> {
  const now = new Date().toISOString();
  const trimmedSummary = ctx.result_summary.trim();

  if (trimmedSummary.length === 0) {
    return {
      status: "no_result_text",
      status_detail: "result_summary is empty.",
      results: [],
      extracted_at: now,
    };
  }
  if (ctx.indicators.length === 0) {
    return {
      status: "no_indicators",
      status_detail:
        "Variation has no indicator_scores yet — score with ensemble first to establish indicators.",
      results: [],
      extracted_at: now,
    };
  }

  let raw: {
    results?: Array<{
      indicator_text?: unknown;
      outcome_id?: unknown;
      observed_lift_pct?: unknown;
      observed_direction?: unknown;
      methodology_rigor?: unknown;
      sample_size_estimate?: unknown;
      extraction_rationale?: unknown;
    }>;
  };
  try {
    raw = await llmJSON({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(ctx),
      responseSchema: {
        name: "empirical_extraction",
        schema: RESPONSE_SCHEMA,
      },
      temperature: 0.15,
      maxTokens: 1800,
    });
  } catch (err) {
    return {
      status: "llm_failed",
      status_detail:
        err instanceof Error ? err.message.slice(0, 240) : String(err),
      results: [],
      extracted_at: now,
    };
  }

  // ── Validate + clean ──
  const indicatorByText = new Map(
    ctx.indicators.map((i) => [i.indicator_text.toLowerCase(), i] as const),
  );
  const results: EmpiricalIndicatorResult[] = [];
  for (const row of raw?.results ?? []) {
    const indicator_text =
      typeof row?.indicator_text === "string"
        ? row.indicator_text.trim().slice(0, 240)
        : "";
    if (indicator_text.length === 0) continue;
    // Indicator text MUST match one we asked about — defends against
    // LLM hallucination of indicators that weren't in the prompt.
    const matched = indicatorByText.get(indicator_text.toLowerCase());
    if (!matched) continue;

    const observed_lift_pct =
      typeof row?.observed_lift_pct === "number" &&
      Number.isFinite(row.observed_lift_pct)
        ? row.observed_lift_pct
        : null;
    const observed_direction: EmpiricalDirection =
      row?.observed_direction === "increased" ||
      row?.observed_direction === "decreased" ||
      row?.observed_direction === "no_change" ||
      row?.observed_direction === "inconsistent"
        ? row.observed_direction
        : "no_change";
    const methodology_rigor =
      typeof row?.methodology_rigor === "number" &&
      Number.isFinite(row.methodology_rigor)
        ? Math.max(0, Math.min(1, row.methodology_rigor))
        : 0.3;
    const sample_size_estimate =
      typeof row?.sample_size_estimate === "number" &&
      Number.isFinite(row.sample_size_estimate) &&
      row.sample_size_estimate > 0
        ? Math.round(row.sample_size_estimate)
        : null;
    const extraction_rationale =
      typeof row?.extraction_rationale === "string"
        ? row.extraction_rationale.trim().slice(0, 280)
        : "";

    results.push({
      indicator_text,
      outcome_id: matched.outcome_id,
      observed_lift_pct,
      observed_direction,
      methodology_rigor,
      sample_size_estimate,
      extraction_rationale,
    });
  }

  return {
    status: results.length > 0 ? "ok" : "llm_failed",
    status_detail:
      results.length === 0
        ? "LLM returned no usable empirical results — result_summary may not contain indicator-specific signals."
        : null,
    results,
    extracted_at: now,
  };
}
