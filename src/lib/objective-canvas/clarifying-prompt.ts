// ── Objective Canvas — clarifying prompt builder ──
//
// Lean prompt purpose-built for the Objective Canvas module. Targets
// REFINEMENT of a single user-typed objective into a sharper one,
// not the full intake bootstrap (the legacy /api/pipeline/clarifying-
// questions route covers that). 3 questions per call, MCQ options,
// optional "more" mode that produces non-overlapping additions.
//
// Why a separate prompt vs reusing the legacy one:
//   - The legacy route is wrapped in ExperienceMode + ReasoningLens +
//     situation-baseline-gap logic that doesn't apply here (the
//     canvas does not run a baseline analyzer pre-clarify).
//   - The legacy route always returns 3 fresh questions; this prompt
//     supports `existing` to ask the LLM to extend, not replace.
//   - Clarifying answers in the canvas feed the sub-objective
//     decompose call in Phase 3, which is a narrower job than the
//     legacy bootstrap.

import type { ClarifyingQuestion } from "./clarifying-state";

export interface BuildClarifyingPromptArgs {
  /** The user's refined objective text. */
  objective: string;
  /** Optional running list of already-shown questions. When passed,
   *  the LLM is told to generate NEW non-overlapping questions; when
   *  empty, this is a fresh initial generation. */
  existing?: Array<Pick<ClarifyingQuestion, "question">>;
  /** How many to emit. 3 for initial / regenerate; 2 for "more". */
  count: number;
}

export function buildSystemPrompt(): string {
  return `You are an objective-refinement coach.

The user has typed a draft objective for a brainstorm session. Your job is to surface the 2-3 questions whose answers would MOST sharpen the objective into something a downstream decomposer can split into useful sub-objectives.

QUESTION RULES:
- Each question fills a load-bearing gap in the objective — never restate what's already explicit.
- Single sentence.
- Include a one-sentence rationale: why this matters for downstream sub-objective generation.
- Order by impact: most gap-closing first.
- Tag each question with a "selection" field — see SELECTION TYPE below.

SELECTION TYPE (per question) — choose the type that matches the SEMANTICS of the answer, not the convenience of a single pick:
- "single" — answered by exactly ONE option from a mutually-exclusive taxonomy (a timeframe, a budget tier, a named approach, one decision). NOT for "the primary metric" when several listed options each partly define success — that is "weighted".
- "multi" — accepts ONE OR MORE INDEPENDENT options that legitimately co-exist (scope / coverage): "Which user segments are in scope?", "Which mechanisms are in play?", "Which regions?". Any subset is a coherent answer.
- "weighted" — the options are COMPONENTS the user blends into a COMPOSITE with relative importance (weights summing to 100%). Use whenever the real answer is a mix, not a pick: a success metric composed of several signals, a scoring rubric, a priority allocation across dimensions. STRONGLY PREFER "weighted" over "single" when a question asks for "the primary X" / "the main KPI" but the listed options would EACH legitimately contribute to X — e.g. "What defines engagement success?" with options {comments per post, 30-day retention, threaded conversations, time per session} is "weighted", because real success weights all four.

OPTION RULES:
- 3-4 multiple-choice options per question.
- Concrete and quantified when the question admits a number (specific ranges, durations, percentages, counts, named instruments).
- Precise categorical when non-numeric (one option = one named choice from a real taxonomy).
- Personalized to the user's objective — reference entities, domains, or constraints they mentioned.
- Ordered logically (low→high, narrow→broad, conservative→ambitious).
- For "single" questions: options must be MUTUALLY EXCLUSIVE.
- For "multi" questions: options must be INDEPENDENT — picking any subset together must form a coherent answer. Never include options that contradict each other in a multi question.
- For "weighted" questions: each option is a distinct, ADDITIVE COMPONENT of the composite (a signal, dimension, or lever that carries some share of the weight). They need not be mutually exclusive; together they should span the thing being weighted.
- Each option: a single 5-14 word label + one short detail line on the tradeoff.

DO NOT include "Skip" or "Other" as an option — the UI handles those separately.
DO NOT generate generic R&D scaffolding ("What is your budget?", "Who is your target user?") unless the user's objective itself names budget or target user as load-bearing.

Return strict JSON.`;
}

export function buildUserPrompt(args: BuildClarifyingPromptArgs): string {
  const { objective, existing = [], count } = args;
  const exclusionBlock =
    existing.length > 0
      ? `\n\nThe user has already seen these ${existing.length} question${
          existing.length === 1 ? "" : "s"
        }; generate ${count} NEW questions that probe DIFFERENT gaps. Do not restate or paraphrase any of them:
${existing.map((q, i) => `  ${i + 1}. ${q.question}`).join("\n")}`
      : "";

  return `USER'S DRAFT OBJECTIVE:
"""
${objective.slice(0, 4000)}
"""${exclusionBlock}

Generate exactly ${count} clarifying question${
    count === 1 ? "" : "s"
  } per the system instructions. Each question must include 3-4 concrete, quantified, personalized MCQ options.`;
}

export const RESPONSE_SCHEMA = {
  name: "objective_clarifying_questions",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            rationale: { type: "string" },
            selection: { type: "string", enum: ["single", "multi", "weighted"] },
            options: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: { type: "string" },
                  detail: { type: "string" },
                },
                required: ["label", "detail"],
              },
            },
          },
          required: ["question", "rationale", "selection", "options"],
        },
      },
    },
    required: ["questions"],
  },
} as const;
