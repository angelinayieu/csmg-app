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

interface ClarifyingQuestion {
  /** The question to ask the user — concise, single sentence. */
  question: string;
  /** Why we're asking — what gap this fills. Surfaces as a
   *  tooltip on hover so the user understands the value of
   *  answering. */
  rationale: string;
  /** Free-text vs short-answer hint. v1 always uses free-text;
   *  the field exists so a future iteration can render multi-
   *  choice or numeric inputs. */
  kind: "free_text";
}

const SYSTEM_PROMPT = `You are a research interviewer. The user has typed a draft prompt
they're about to submit for analysis. Your job is to generate 3-5
SHORT questions that, when answered, would substantially improve the
analysis the system can do.

Discipline:
1. Each question targets a CONCRETE gap. "What's your goal?" is too
   vague — better: "Which metric do you want to move, and by when?"
2. Prefer questions the user can answer in one sentence. No multi-
   part essays.
3. Include a rationale per question — why this matters. The UI
   surfaces this as a tooltip.
4. Skip questions whose answers can be inferred from the prompt
   itself. Don't ask "What domain are you in?" if the prompt mentions
   "my SaaS retention."
5. Order by impact: the question whose answer would most clarify the
   situation comes first.
6. Match the lens bias when provided. With "engineer" active, lean
   toward measurable specs / tolerances. With "historian," ask about
   prior attempts. With "skeptic," surface assumptions worth testing.

Return strict JSON:
{ "questions": [ { "question": "...", "rationale": "...", "kind": "free_text" } ] }`;

const RESPONSE_SCHEMA = {
  name: "clarifying_questions",
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
            kind: { type: "string", enum: ["free_text"] },
          },
          required: ["question", "rationale", "kind"],
        },
      },
    },
    required: ["questions"],
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
Generate 3-5 clarifying questions per the system instructions.`;
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
    const raw = await llmJSON<{ questions: ClarifyingQuestion[] }>({
      system: SYSTEM_PROMPT,
      user: buildPrompt(text, lenses, unknowns, uncertaintyScore),
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.4,
      maxTokens: 800,
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
          .map((q) => ({
            question: q.question.trim(),
            rationale: q.rationale.trim(),
            kind: "free_text" as const,
          }))
      : [];

    return NextResponse.json({ questions });
  } catch (err) {
    return NextResponse.json(
      {
        error: `clarifying-questions failed: ${sanitizeErrorMessage(err)}`,
        questions: [],
      },
      { status: 500 },
    );
  }
}
