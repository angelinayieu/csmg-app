// ── POST /api/pipeline/clarifying-questions ──────────────────────────
//
// Pre-flight clarifier. Runs BEFORE the user submits to bootstrap
// when they've toggled "ask me clarifying questions" in the
// reasoning settings panel. Returns 3-5 short questions targeted at
// the gaps in their prompt; the client renders an inline Q&A UI;
// answers are appended to input_text before bootstrap fires.
//
// This is a STATELESS pre-flight call. No space row is created; no
// pipeline run starts. The route exists purely to give the user a
// chance to add structure before the (irreversible-by-default)
// pipeline burns credits on a vague intake.
//
// Auth: requires a logged-in user (so guests can't burn LLM cost
// drafting questions for anonymous prompts), but does NOT verify
// space ownership (no space exists yet). Cost: ~250 tokens per call.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import type { ReasoningLens } from "@/types/reasoning-settings";

export const maxDuration = 30;
export const runtime = "nodejs";

interface ClarifyingQuestionsRequest {
  /** The user's draft prompt. */
  text: string;
  /** Active reasoning lenses — used to bias the questions toward
   *  what those lenses care about (e.g., engineer-mode questions
   *  ask for spec data; historian-mode asks for precedent). */
  lenses?: ReasoningLens[];
  /** Optional model override. */
  model?: string;
  /** Phase 4-wire-1 — when the caller is regenerating against an
   *  existing space, pass the space's situation_baseline.unknowns
   *  list and uncertainty_score so the LLM biases its questions
   *  toward closing real gaps the analyzer already identified.
   *  Empty / undefined for fresh-prompt flows where no baseline
   *  exists yet. */
  unknowns?: string[];
  uncertaintyScore?: number;
}

/** A pre-baked multiple-choice option the user can click in one
 *  tap. Options are AI-generated PER QUESTION and aim to be
 *  concrete + quantified (specific numbers, ranges, durations,
 *  or named categories) — never vague filler like "I don't know"
 *  or "Same as before". The user always has a "write your own"
 *  escape hatch rendered by the client, so options here should
 *  represent the LIKELY answers, not exhaustive coverage. */
interface MCQOption {
  /** Concise choice label (5-14 words). Quantified when the
   *  question admits a number ("10-25% within 6 months",
   *  "$50k-$100k budget", "2-3 person team"); otherwise a
   *  precise categorical answer ("Heart-rate variability via
   *  Whoop strap"). Avoids hedges like "roughly" or "around" —
   *  the range itself encodes uncertainty. */
  label: string;
  /** One-line tradeoff or context for the option — what the
   *  user is implicitly committing to by picking it. Rendered
   *  in smaller text under the label. */
  detail: string;
}

interface ClarifyingQuestion {
  /** The question to ask the user — concise, single sentence. */
  question: string;
  /** Why we're asking — what gap this fills. Surfaces as a
   *  tooltip on hover so the user understands the value of
   *  answering. */
  rationale: string;
  /** "mcq" — render the options array as clickable choices plus
   *  a free-text escape hatch. "free_text" — legacy/fallback,
   *  textarea only. New questions should always be mcq. */
  kind: "mcq" | "free_text";
  /** 3-4 pre-baked answer options. Required when kind === "mcq".
   *  Omitted when kind === "free_text" (legacy). */
  options?: MCQOption[];
}

/** What the system inferred about the user's situation from their prompt.
 *  Rendered in the pre-flight UI so the user can confirm or correct
 *  before the pipeline fires. */
export interface InferredBaseline {
  /** One sentence: what we think the user is currently dealing with. */
  current_state_summary: string;
  /** One sentence: what outcome they seem to be trying to achieve. */
  primary_objective: string;
  /** 2-3 load-bearing assumptions the analysis will make. */
  key_assumptions: string[];
}

const SYSTEM_PROMPT = `You are a research strategist helping to set up a precision analysis.

The user has submitted a draft prompt. You have TWO jobs:

JOB 1 — INFER THE BASELINE (short, crisp)
Summarize what you understood from the prompt in three parts:
  - current_state_summary: One sentence — what is the user currently dealing with or trying to optimize?
  - primary_objective: One sentence — what outcome do they want from this analysis?
  - key_assumptions: 2-3 concrete assumptions the analysis will make (things that aren't stated but need to be true for the analysis to be valid)

JOB 2 — GENERATE CLARIFYING QUESTIONS WITH OPTIONS (3 questions)
Generate exactly 3 short questions that target CONCRETE gaps, each with 3-4 high-quality multiple-choice options the user can pick in one tap.

QUESTION RULES:
1. Each question fills a gap not answerable from the prompt itself.
2. "What's your goal?" is too vague — better: "Which metric do you want to move, and by when?"
3. Single sentence, no multi-part essays.
4. Include a rationale — one sentence on why this matters for the analysis.
5. Order by impact: most gap-closing question first.
6. Match the lens bias when provided. With "engineer" active, lean toward measurable specs. With "historian," ask about prior attempts. With "skeptic," surface assumptions worth testing.

OPTION RULES (this is the key part — DO THIS WELL):
Each question gets 3-4 options. Every option MUST be:
  a. CONCRETE — never "I'm not sure", "Same as before", "It depends", "Roughly average". The user already has a "write your own" escape hatch in the UI; do not waste an MCQ slot on a vague fallback.
  b. QUANTIFIED when the question admits a number — use specific ranges, durations, percentages, dollar amounts, counts, or named instruments/metrics:
       - "10-25% improvement within 6 months"
       - "$5k-$15k monthly budget"
       - "2-3 weeks of pilot data, n=20-50 participants"
       - "Heart-rate variability via Whoop strap, daily"
  c. PRECISE CATEGORICAL when the question is non-numeric — pick a single named option from a real taxonomy:
       - "Solo founder, no team yet" / "2-5 person product team" / "Internal R&D lab with 10+ scientists"
       - "Behavioral nudges (timing, framing)" / "Pharmacological (supplements, off-label meds)" / "Neurostimulation (tDCS, vagal)"
  d. PERSONALIZED to the user's specific prompt — refer to entities, domains, or constraints they mentioned. Generic options like "Option A / B / C" are unacceptable.
  e. MUTUALLY EXCLUSIVE and ordered logically (low→high for ranges, conservative→ambitious for scope).
  f. ONE LINE label (5-14 words) + one short detail line explaining the tradeoff or what picking this commits to.
  g. SPAN THE LIKELY ANSWER SPACE — the 3-4 options should cover roughly 70-90% of plausible real answers. The user types their own if they fall outside.

DO NOT include "Other" or "Skip" as an option — the UI handles those separately.

Return strict JSON:
{
  "inferred_baseline": {
    "current_state_summary": "...",
    "primary_objective": "...",
    "key_assumptions": ["...", "..."]
  },
  "questions": [
    {
      "question": "Which biometric signal do you want to use as the primary cognitive-state proxy?",
      "rationale": "Different signals impose different sampling rates and noise floors on the action-stimulus model.",
      "kind": "mcq",
      "options": [
        { "label": "EEG, 8-channel consumer headset (Muse / Emotiv)", "detail": "High temporal resolution, noisy in motion; ~$300-500 hardware." },
        { "label": "Heart-rate variability via wrist strap (Whoop, Polar)", "detail": "Daily aggregate signal; clean but lags 15-30 min behind state shifts." },
        { "label": "Pupillometry via webcam-based eye tracking", "detail": "Real-time arousal proxy; needs controlled lighting, ~5% data loss." },
        { "label": "Subjective self-report at fixed intervals", "detail": "Cheapest, no hardware; recall bias makes it weakest as ground truth." }
      ]
    }
  ]
}`;

const RESPONSE_SCHEMA = {
  name: "clarifying_questions",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      inferred_baseline: {
        type: "object",
        additionalProperties: false,
        properties: {
          current_state_summary: { type: "string" },
          primary_objective: { type: "string" },
          key_assumptions: { type: "array", items: { type: "string" } },
        },
        required: ["current_state_summary", "primary_objective", "key_assumptions"],
      },
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            rationale: { type: "string" },
            kind: { type: "string", enum: ["mcq", "free_text"] },
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
          required: ["question", "rationale", "kind", "options"],
        },
      },
    },
    required: ["inferred_baseline", "questions"],
  },
} as const;

const LENS_LABELS: Record<ReasoningLens, string> = {
  systems_analyst: "systems analyst (feedback loops, mechanisms)",
  skeptic: "skeptic (assumptions, blind spots)",
  operator: "operator (day-to-day execution)",
  engineer: "engineer (physical / structural constraints)",
  historian: "historian (precedents, base rates)",
};

function buildPrompt(
  text: string,
  lenses: ReasoningLens[],
  unknowns: string[],
  uncertaintyScore: number | null,
): string {
  const lensesBlock =
    lenses.length > 0
      ? `\nACTIVE LENSES (bias your questions toward what these care about): ${lenses
          .map((l) => LENS_LABELS[l])
          .join(", ")}\n`
      : "";

  // Phase 4-wire-1 — baseline-gap injection. When the caller knows
  // the space's prior situation_baseline.unknowns, surface them as
  // priority targets so the question generator closes real analyzer-
  // detected gaps instead of inventing parallel ones.
  const baselineBlock =
    unknowns.length > 0
      ? `\nPRIOR ANALYSIS GAPS (from the situation_baseline ran on a previous version of this prompt):
${unknowns.slice(0, 8).map((u, i) => `  ${i + 1}. ${u}`).join("\n")}
${uncertaintyScore != null ? `Overall uncertainty: ${uncertaintyScore.toFixed(2)} (0=fully known, 1=fully unknown).` : ""}

Prioritize questions that would close the gaps above. If a gap is too vague to be a single-sentence question, skip it. Don't invent new gaps when the analyzer already found ones — refine those instead.\n`
      : "";

  return `USER'S DRAFT PROMPT:
"""
${text.slice(0, 2000)}
"""
${lensesBlock}${baselineBlock}
Generate exactly 3 clarifying questions per the system instructions. Each question must include 3-4 concrete, quantified, personalized MCQ options. Reference specifics from the user's prompt above — generic options are unacceptable.`;
}

export async function POST(request: Request) {
  const { error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<ClarifyingQuestionsRequest>>(request);
  if (parseError) return parseError;

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length < 4) {
    return NextResponse.json(
      { error: "text is required (min 4 chars)" },
      { status: 400 },
    );
  }

  const lenses = Array.isArray(body?.lenses)
    ? (body!.lenses as unknown[]).filter(
        (l): l is ReasoningLens =>
          typeof l === "string" &&
          [
            "systems_analyst",
            "skeptic",
            "operator",
            "engineer",
            "historian",
          ].includes(l),
      )
    : [];

  // Phase 4-wire-1 — sanitize unknowns. Cap at 8 (matches frame-
  // extractor's slice), drop empty / non-string entries, trim each.
  const unknowns = Array.isArray(body?.unknowns)
    ? (body!.unknowns as unknown[])
        .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
        .map((u) => u.trim())
        .slice(0, 8)
    : [];
  const uncertaintyScore =
    typeof body?.uncertaintyScore === "number" &&
    Number.isFinite(body.uncertaintyScore) &&
    body.uncertaintyScore >= 0 &&
    body.uncertaintyScore <= 1
      ? body.uncertaintyScore
      : null;

  try {
    const raw = await llmJSON<{
      inferred_baseline: InferredBaseline;
      questions: ClarifyingQuestion[];
    }>({
      system: SYSTEM_PROMPT,
      user: buildPrompt(text, lenses, unknowns, uncertaintyScore),
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.4,
      maxTokens: 2400,
      model: body?.model,
    });

    const questions = Array.isArray(raw?.questions)
      ? raw.questions
          .filter(
            (q): q is ClarifyingQuestion =>
              !!q &&
              typeof q.question === "string" &&
              q.question.length > 0 &&
              typeof q.rationale === "string",
          )
          .slice(0, 5)
          .map((q) => {
            const options = Array.isArray(q.options)
              ? q.options
                  .filter(
                    (o): o is MCQOption =>
                      !!o &&
                      typeof o.label === "string" &&
                      o.label.trim().length > 0 &&
                      typeof o.detail === "string",
                  )
                  .map((o) => ({
                    label: o.label.trim(),
                    detail: o.detail.trim(),
                  }))
                  .slice(0, 4)
              : [];
            // If LLM gave us usable options, surface them as MCQ.
            // Otherwise fall back to free_text so the modal still
            // renders a textarea instead of an empty option list.
            const hasUsableOptions = options.length >= 2;
            return {
              question: q.question.trim(),
              rationale: q.rationale.trim(),
              kind: hasUsableOptions ? ("mcq" as const) : ("free_text" as const),
              ...(hasUsableOptions ? { options } : {}),
            };
          })
      : [];

    const inferred_baseline: InferredBaseline | null =
      raw?.inferred_baseline &&
      typeof raw.inferred_baseline.current_state_summary === "string" &&
      typeof raw.inferred_baseline.primary_objective === "string" &&
      Array.isArray(raw.inferred_baseline.key_assumptions)
        ? {
            current_state_summary: raw.inferred_baseline.current_state_summary.trim(),
            primary_objective: raw.inferred_baseline.primary_objective.trim(),
            key_assumptions: raw.inferred_baseline.key_assumptions
              .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
              .map((a) => a.trim())
              .slice(0, 4),
          }
        : null;

    return NextResponse.json({ questions, inferred_baseline });
  } catch (err) {
    return NextResponse.json(
      {
        error: `clarifying-questions failed: ${sanitizeErrorMessage(err)}`,
        questions: [],
        inferred_baseline: null,
      },
      { status: 500 },
    );
  }
}
