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
import { isExperienceMode, type ExperienceMode } from "@/types/experience-mode";
import { isAnswerSlot, type AnswerSlot } from "@/types/clarifier-answer";

export const maxDuration = 30;
export const runtime = "nodejs";

interface ClarifyingQuestionsRequest {
  /** The user's draft prompt. */
  text: string;
  /** Active reasoning lenses — used to bias the questions toward
   *  what those lenses care about (e.g., engineer-mode questions
   *  ask for spec data; historian-mode asks for precedent). */
  lenses?: ReasoningLens[];
  /** Phase B — dashboard experience pill the user picked. Drives
   *  which typed slots each question fills (e.g. brain_probe asks
   *  for `exploration_angle`, brainstorm_speed for `variation_axis`).
   *  Absent on legacy callers — endpoint falls back to the
   *  precise_rd shape. */
  mode?: ExperienceMode;
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
  /** Phase B — typed slot this question is generated to fill.
   *  Drives downstream routing (canvas seed shape kind, expand
   *  context_hint source, twin boundary frame). Absent on legacy
   *  responses or when the LLM declined to slot the question. */
  slot?: AnswerSlot;
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

// ── Mode directives ────────────────────────────────────────────────
//
// Each dashboard experience pill has a different INPUT CONTRACT —
// brain_probe needs angles, brainstorm_speed needs axes, twin needs
// boundaries. The clarifier emits 3 questions per intake; the
// directive block tells the LLM which typed slots those questions
// should fill. Slots are typed on the response shape so bootstrap
// can route the answers (synthesis_data.user_assertions[slot][])
// and the canvas can spawn mode-appropriate seed shapes later.
//
// Slot vocabulary (kept in sync with src/types/clarifier-answer.ts):
//   exploration_angle | variation_axis | target_metric |
//   system_boundary  | state_variable | observation_point |
//   timeframe        | constraint
const MODE_DIRECTIVES: Record<ExperienceMode, string> = {
  brain_probe: `MODE: brain_probe — the user wants to EXPLORE a topic from multiple entry points; they do not yet have a committed target.
Each question should surface a different FACET / LENS to enter from. Options are different angles of the topic (mechanism, sensing, ethics, second-order effects), NOT different specificity levels of the same angle.
Slot every answer as "exploration_angle". Optionally one question may use "constraint" if the prompt contains an explicit hard constraint worth confirming.
Avoid asking for metrics, timeframes, or budgets — the user is not at a target-setting stage yet.`,
  brainstorm_speed: `MODE: brainstorm_speed — the user wants to RAPIDLY GENERATE VARIATIONS around a known direction.
Each question NAMES AN AXIS OF VARIATION. The 3-4 options under each question are different anchor points on that axis (e.g. cost: low/mid/high, autonomy: tele-operated/assistive/fully autonomous).
Slot every answer as "variation_axis". Optionally one question may use "constraint" for a fixed boundary the variants must respect.
The user is picking where the sweep starts; do not ask them to pick a single deliverable.`,
  precise_rd: `MODE: precise_rd — the user has a defined problem and wants a rigorous analysis.
Generate questions that pin down the TARGET metric, the TIMEFRAME, and any operational CONSTRAINTS (team size, budget, regulatory, data access).
Slot answers as "target_metric", "timeframe", or "constraint" as appropriate. Each question fills exactly one slot.
Quantify aggressively — concrete numbers, ranges, named instruments, named methodologies.`,
  digital_twin: `MODE: digital_twin — the user has a real-world system and wants a model of it for prediction / simulation.
Generate questions that nail the SYSTEM SHAPE: scope boundary (what's in vs out), state variables (what changes over time), and observation points (what's measurable).
Slot answers as "system_boundary", "state_variable", or "observation_point". Each question fills exactly one slot.
Avoid asking for strategic targets — twin construction comes before strategy.`,
};

// Rotating example pool. The prior single-example anchor (biometrics
// + EEG/HRV/pupillometry/self-report) was over-weighting the LLM's
// output toward measurement-instrument framing regardless of domain.
// We rotate by mode AND by a 4-slot domain hash from the user's
// prompt so any single example doesn't dominate. Each example is a
// COMPLETE question shape so the LLM has the structure to copy.
const EXAMPLE_POOL: Record<ExperienceMode, string[]> = {
  brain_probe: [
    `{
      "question": "Which angle of the topic do you most want to explore first?",
      "rationale": "Probing from a chosen lens is faster than scattering across all facets at once.",
      "kind": "mcq",
      "slot": "exploration_angle",
      "options": [
        { "label": "Mechanism — how it actually works under the hood", "detail": "Best when you suspect the conventional explanation is incomplete." },
        { "label": "Sensing / measurement — what signal would reveal it", "detail": "Best when the phenomenon is real but evidence is thin." },
        { "label": "Second-order effects — what changes if it works", "detail": "Best when stakeholders disagree about whether it matters." },
        { "label": "Failure modes — where it breaks under load", "detail": "Best when prior attempts succeeded at small scale but failed at large." }
      ]
    }`,
    `{
      "question": "Which user / actor's perspective do you want to enter from?",
      "rationale": "The same system looks different from different actors; picking one anchors the inquiry.",
      "kind": "mcq",
      "slot": "exploration_angle",
      "options": [
        { "label": "The person doing the work day-to-day", "detail": "Ground-truth view; surfaces friction the system designers don't see." },
        { "label": "The operator of the system / platform", "detail": "Optimization lens; surfaces throughput + reliability constraints." },
        { "label": "The downstream beneficiary or customer", "detail": "Outcome lens; surfaces whether the system actually delivers value." },
        { "label": "The regulator or external auditor", "detail": "Constraint lens; surfaces what the system MUST guarantee vs. nice-to-have." }
      ]
    }`,
  ],
  brainstorm_speed: [
    `{
      "question": "Along which axis do you want the variants to spread?",
      "rationale": "Variants spreading along a single chosen axis are more comparable than scattered along many.",
      "kind": "mcq",
      "slot": "variation_axis",
      "options": [
        { "label": "Cost tier (sub-$1k / $1k-$10k / $10k+)", "detail": "Best when budget realism is the load-bearing question." },
        { "label": "Autonomy level (manual / assistive / autonomous)", "detail": "Best when human-in-the-loop tradeoffs matter most." },
        { "label": "Time horizon (1-week prototype / 3-month / multi-year)", "detail": "Best when scope discipline is the binding constraint." },
        { "label": "Audience breadth (single niche / one segment / mass-market)", "detail": "Best when product-market fit is the central uncertainty." }
      ]
    }`,
  ],
  precise_rd: [
    `{
      "question": "Which target metric do you want to move, by how much, and by when?",
      "rationale": "The analysis cannot prioritize interventions without a concrete success criterion.",
      "kind": "mcq",
      "slot": "target_metric",
      "options": [
        { "label": "Move primary KPI by 10-25% within 6 months", "detail": "Moderate stretch; tractable for most well-instrumented systems." },
        { "label": "Move primary KPI by 25-50% within 12 months", "detail": "Aggressive; usually requires changing the system, not just tuning." },
        { "label": "Hold KPI steady while reducing input cost by 30-50%", "detail": "Efficiency play; load-bearing assumption is that quality is non-negotiable." },
        { "label": "Establish a measurable baseline before setting a target", "detail": "Best when current performance is unknown or contested." }
      ]
    }`,
  ],
  digital_twin: [
    `{
      "question": "Which boundary defines what's INSIDE your model vs outside?",
      "rationale": "Twin fidelity is bounded by where you draw the line — wider scope means coarser fidelity.",
      "kind": "mcq",
      "slot": "system_boundary",
      "options": [
        { "label": "Just the core operating loop (1-3 tightly coupled subsystems)", "detail": "High fidelity, narrow scope; misses second-order effects." },
        { "label": "Operating loop + immediate suppliers / consumers", "detail": "Balanced; captures most short-horizon dynamics." },
        { "label": "Full value chain end-to-end", "detail": "Wide scope, coarser fidelity; best for strategic forecasting." },
        { "label": "Operating loop + regulatory / market environment", "detail": "Best when external shocks are the dominant risk." }
      ]
    }`,
  ],
};

function pickExample(mode: ExperienceMode, text: string): string {
  const pool = EXAMPLE_POOL[mode];
  if (pool.length === 0) return "";
  // Deterministic per-prompt rotation so the same prompt yields the
  // same example (stable user experience) but different prompts
  // sample across the pool.
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % pool.length;
  return pool[idx]!;
}

function buildSystemPrompt(mode: ExperienceMode, text: string): string {
  return `You are a research strategist helping to set up a precision analysis.

The user has submitted a draft prompt. You have TWO jobs:

JOB 1 — INFER THE BASELINE (short, crisp)
Summarize what you understood from the prompt in three parts:
  - current_state_summary: One sentence — what is the user currently dealing with or trying to optimize?
  - primary_objective: One sentence — what outcome do they want from this analysis?
  - key_assumptions: 2-3 concrete assumptions the analysis will make (things that aren't stated but need to be true for the analysis to be valid)

JOB 2 — GENERATE CLARIFYING QUESTIONS WITH TYPED SLOTS (3 questions)
Generate exactly 3 short questions that target CONCRETE gaps in the user's prompt, each with 3-4 high-quality multiple-choice options the user can pick in one tap.

${MODE_DIRECTIVES[mode]}

QUESTION RULES:
1. Each question fills a gap not answerable from the prompt itself.
2. "What's your goal?" is too vague — every question must be answerable with a SINGLE concrete commitment.
3. Single sentence, no multi-part essays.
4. Include a rationale — one sentence on why this matters for the analysis.
5. Order by impact: most gap-closing question first.
6. Match the lens bias when provided. With "engineer" active, lean toward measurable specs. With "historian," ask about prior attempts. With "skeptic," surface assumptions worth testing.
7. Each question carries a "slot" field naming which typed commitment it fills, drawn from the mode directive above.

OPTION RULES:
Each question gets 3-4 options. Every option MUST be:
  a. CONCRETE — never "I'm not sure", "Same as before", "It depends", "Roughly average". The user already has a "write your own" escape hatch in the UI; do not waste an MCQ slot on a vague fallback.
  b. QUANTIFIED when the question admits a number — specific ranges, durations, percentages, dollar amounts, counts, or named instruments/metrics.
  c. PRECISE CATEGORICAL when the question is non-numeric — pick a single named option from a real taxonomy.
  d. PERSONALIZED to the user's specific prompt — refer to entities, domains, or constraints they mentioned. Generic options like "Option A / B / C" are unacceptable.
  e. MUTUALLY EXCLUSIVE and ordered logically (low→high for ranges, conservative→ambitious for scope).
  f. ONE LINE label (5-14 words) + one short detail line explaining the tradeoff or what picking this commits to.
  g. SPAN THE LIKELY ANSWER SPACE — the 3-4 options should cover roughly 70-90% of plausible real answers. The user types their own if they fall outside.

ANTI-PLATITUDE RULE — DO NOT SHIP GENERIC R&D SCAFFOLDING:
If a question or option could appear unchanged in a clarifier for any unrelated prompt, REWRITE it. Specifically:
  - "What is your budget?" with options like "<$10k / $10-100k / $100k+" is platitude.
  - "What is your timeline?" with options "<3mo / 3-12mo / 12mo+" is platitude.
  - "Who is your target user?" without naming a specific role from the prompt is platitude.
Every option must reference something specific from the user's prompt OR a named domain taxonomy that's load-bearing for THIS analysis.

DO NOT include "Other" or "Skip" as an option — the UI handles those separately.

Return strict JSON:
{
  "inferred_baseline": {
    "current_state_summary": "...",
    "primary_objective": "...",
    "key_assumptions": ["...", "..."]
  },
  "questions": [
    ${pickExample(mode, text)}
  ]
}`;
}

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
            slot: {
              type: "string",
              enum: [
                "exploration_angle",
                "variation_axis",
                "target_metric",
                "system_boundary",
                "state_variable",
                "observation_point",
                "timeframe",
                "constraint",
              ],
            },
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
          required: ["question", "rationale", "kind", "slot", "options"],
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
  mode: ExperienceMode,
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
Experience mode for this intake: ${mode}. Honor the MODE directive in the system prompt — every question's "slot" field must match the slots that mode allows.

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

  // Phase B — experience mode drives slot vocabulary + directive
  // block. Falls back to precise_rd for legacy callers (immersive-
  // home submits without a mode today).
  const mode: ExperienceMode = isExperienceMode(body?.mode)
    ? body!.mode!
    : "precise_rd";

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
      system: buildSystemPrompt(mode, text),
      user: buildPrompt(text, lenses, unknowns, uncertaintyScore, mode),
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
            // Phase B — carry typed slot through. isAnswerSlot
            // tolerates legacy responses without a slot field; the
            // downstream consumers treat undefined slot as "no typed
            // routing, fall back to open_questions[] only".
            const slot: AnswerSlot | undefined = isAnswerSlot(q.slot)
              ? q.slot
              : undefined;
            return {
              question: q.question.trim(),
              rationale: q.rationale.trim(),
              kind: hasUsableOptions ? ("mcq" as const) : ("free_text" as const),
              ...(slot ? { slot } : {}),
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
