// ── Axis semantic scorer (Phase 2E · PR 6.2) ──
//
// Stage 3 of the self-improvement loop. Given a pending-review
// axis_candidate_exemplars row, runs an LLM-as-peer-reviewer over
// the axis output using the 5-dimension rubric in
// DESIGN-self-improvement-loop.md. Returns a weighted score in
// [0,1] + per-dimension breakdown so archive rows preserve the
// "where did this fall short?" signal for failure analysis.
//
// Model-as-judge caveat: the scorer runs on the same underlying
// LLM family as the generator, which means a shared failure mode
// can't be caught by this layer alone. The design spec mandates
// quarterly human calibration (spot-check 20 promotions). When
// that drift is detected, the rubric weights in this file get
// adjusted; the threshold in the cron endpoint (0.8) can also move.
//
// Prompt discipline:
//   - System prompt carries the full rubric + scoring schema
//   - User prompt carries input_gist + output_full as JSON
//   - Response shape is strict JSON: { scores: {...}, weighted: 0.83, notes: "..." }
//   - Scorer gets NO access to the user_rating — it must judge from
//     output alone, so the final promotion gate is a genuine second
//     opinion rather than a rubber-stamp of the user's click

import { llmJSON } from "@/lib/llm";
import type { AxisGenerationOutput } from "@/lib/probability-space/axis-output-validator";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";

export interface SemanticScoreBreakdown {
  /** Grounded in input's specifics, not generic axis vocab. */
  specificity: number;
  /** Mechanisms named vs labels applied. */
  mechanism_depth: number;
  /** Non-redundant entity set. */
  distinctness: number;
  /** Enough high-quality entities for this situation's complexity. */
  coverage: number;
  /** axis_summary surfaces non-obvious observation. */
  insight_density: number;
}

export interface SemanticScoreResult {
  /** Weighted sum: 0.25·spec + 0.25·mech + 0.15·distinct + 0.15·cov + 0.20·insight. */
  score: number;
  breakdown: SemanticScoreBreakdown;
  /** 1-2 sentence reviewer comment. Shown in admin UI next to the score. */
  notes: string;
}

const WEIGHTS = {
  specificity: 0.25,
  mechanism_depth: 0.25,
  distinctness: 0.15,
  coverage: 0.15,
  insight_density: 0.2,
} as const;

const SYSTEM_PROMPT = `You are a senior analyst peer-reviewing another analyst's probability-space-axis output. Your job is to judge whether this output deserves to become a reference exemplar for future runs on similar inputs.

Score five dimensions, each in [0, 1]:

1. SPECIFICITY (weight 0.25)
   Is every entity grounded in the input's specifics? A generic entity name like "Revenue" without the input's specific revenue mechanism scores low; a specific "ACME B2B annual contract revenue (2-year ramp)" scores high.

2. MECHANISM DEPTH (weight 0.25)
   Does each relationship name a SPECIFIC mechanism (how source produces target), or just label the link? "A → B because hiring takes 6 weeks but demand lands in 2" scores high; "A affects B" scores 0.1.

3. DISTINCTNESS (weight 0.15)
   Are entities non-redundant? Two entities describing the same underlying concept under slightly different names = low. A tight set of truly different concepts = high.

4. COVERAGE (weight 0.15)
   Did the axis surface enough high-quality entities for the complexity warranted? Fewer than 4 well-grounded entities = low; 6-10 with genuine axis-specific depth = high. Don't reward padding.

5. INSIGHT DENSITY (weight 0.20)
   Does the axis_summary crystallize a non-obvious observation, or just recap the input? A recap = 0.2. A "this axis reveals that the bottleneck isn't capital, it's sequencing" = 0.9.

Return STRICT JSON in this exact shape:
{
  "scores": {
    "specificity": <0..1>,
    "mechanism_depth": <0..1>,
    "distinctness": <0..1>,
    "coverage": <0..1>,
    "insight_density": <0..1>
  },
  "notes": "<1-2 sentences explaining the lowest score>"
}

Be honest. Most LLM axis outputs are mediocre (0.5-0.7 overall); a genuine exemplar is rare (0.8+) and worth flagging. Don't anchor on a default score of 0.7 — spread the distribution.`;

export interface ScoreAxisCandidateOptions {
  axis: ProbabilitySpaceAxis;
  /** The user's original input (first 200 chars) the axis ran on. */
  inputGist: string;
  /** The full axis generation output the LLM produced. */
  output: AxisGenerationOutput;
}

export async function scoreAxisCandidate(
  opts: ScoreAxisCandidateOptions,
): Promise<SemanticScoreResult> {
  const { axis, inputGist, output } = opts;

  // Shape passed to the reviewer — we strip any fields that'd leak
  // prior-run signals (there aren't any today, but future-proof).
  const reviewPayload = {
    axis,
    axis_summary: output.axis_summary ?? "",
    entities: (output.entities ?? []).map((e) => ({
      name: e.name,
      description: e.description,
      category: e.category,
      importance: e.importance,
      source_tag: e.source_tag,
    })),
    relationships: (output.relationships ?? []).map((r) => ({
      source_id: r.source_id,
      target_id: r.target_id,
      mechanism: r.mechanism,
      dimension: r.dimension,
      polarity: r.polarity,
      dynamics: r.dynamics,
    })),
  };

  const userPrompt = `INPUT (first 200 chars):
"""
${inputGist}
"""

AXIS OUTPUT UNDER REVIEW:
\`\`\`json
${JSON.stringify(reviewPayload, null, 2)}
\`\`\`

Score this output using the rubric. Return STRICT JSON.`;

  type ScorerRaw = {
    scores: Partial<SemanticScoreBreakdown>;
    notes?: string;
  };
  const raw = await llmJSON<ScorerRaw>({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 600,
    temperature: 0.2,
    validator: (data): ScorerRaw => {
      if (!data || typeof data !== "object") {
        throw new Error("scorer returned non-object");
      }
      const d = data as {
        scores?: Partial<SemanticScoreBreakdown>;
        notes?: string;
      };
      if (!d.scores || typeof d.scores !== "object") {
        throw new Error("scorer output missing 'scores' object");
      }
      return { scores: d.scores, notes: d.notes };
    },
    fallback: {
      // Neutral fallback — scorer failures shouldn't poison
      // the library with false positives or skip valid candidates.
      // Ending up in archive with a note is the safe default.
      scores: {
        specificity: 0.5,
        mechanism_depth: 0.5,
        distinctness: 0.5,
        coverage: 0.5,
        insight_density: 0.5,
      },
      notes: "Scorer fallback — LLM call failed, treated as neutral.",
    },
  });

  const clamp01 = (n: unknown): number => {
    const v = typeof n === "number" && Number.isFinite(n) ? n : 0.5;
    return Math.max(0, Math.min(1, v));
  };

  const breakdown: SemanticScoreBreakdown = {
    specificity: clamp01(raw.scores.specificity),
    mechanism_depth: clamp01(raw.scores.mechanism_depth),
    distinctness: clamp01(raw.scores.distinctness),
    coverage: clamp01(raw.scores.coverage),
    insight_density: clamp01(raw.scores.insight_density),
  };

  const score =
    breakdown.specificity * WEIGHTS.specificity +
    breakdown.mechanism_depth * WEIGHTS.mechanism_depth +
    breakdown.distinctness * WEIGHTS.distinctness +
    breakdown.coverage * WEIGHTS.coverage +
    breakdown.insight_density * WEIGHTS.insight_density;

  return {
    score: Math.max(0, Math.min(1, score)),
    breakdown,
    notes: (raw.notes ?? "").slice(0, 500),
  };
}
