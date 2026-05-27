// ── Generate an exportable AI prompt for a variation (Phase 13) ──
//
// The user wants to take an elected variation OUT of the canvas and
// hand it to an external LLM (ChatGPT, Claude, Cursor, etc.) to
// bootstrap implementation. This module asks the LLM to compose a
// ready-to-paste prompt that encodes:
//
//   - The parent objective (what the user is trying to achieve)
//   - The pain it addresses (why this mechanism exists)
//   - The variation itself (name + description + tradeoff)
//   - Operational constraints (time / budget / team / risk)
//   - Open questions worth probing
//   - A clear ask at the end ("Generate X, Y, Z")
//
// Output is plain text (markdown-flavored) — designed to be pasted
// directly into another model's chat interface.

import { llmGenerate, llmJSON } from "@/lib/llm";
import type { ItemVariation } from "./expand-item-detail";
import type { OperationalConstraints } from "./constraints";

export interface ExportPromptResult {
  prompt: string;
}

// ── Op B — Round-trip tested prompt optimizer ────────────────────
//
// Four-step pipeline:
//   1. Generate prompt v1 (existing generator)
//   2. Test v1 against an LLM (test-runner; uses llmGenerate)
//   3. Judge the test output against a 5-criteria rubric (LLM-as-judge)
//   4. If verdict=revise, fire revisor → re-test → re-judge once more
//
// Hard cap at 2 iterations. Latency budget ~30-40s end-to-end. Cost
// budget ~4 LLM calls worst case (under $0.05 at gpt-4o pricing).
//
// Three models, intentionally different to avoid same-model echo:
//   - generator: gpt-4o (default)
//   - test-runner: claude-sonnet-4-6 (different provider)
//   - judge: gpt-4o (different provider from test-runner)
// Caller can override via opts.

export interface RoundTripResult {
  prompt_v1: string;
  preview_v1: {
    output: string;
    judge_score: number;
    judge_verdict: "ship" | "revise";
    judge_critique: string;
  };
  prompt_v2?: string;
  preview_v2?: {
    output: string;
    judge_score: number;
    judge_verdict: "ship" | "revise";
    judge_critique: string;
  };
  final_prompt: string;
  iterations: number;
}

interface JudgeShape {
  scores?: {
    specificity?: unknown;
    constraint_fit?: unknown;
    mechanism_fidelity?: unknown;
    completeness?: unknown;
    actionability?: unknown;
  };
  weighted_score?: unknown;
  verdict?: unknown;
  critique?: unknown;
}

const JUDGE_SCHEMA = {
  name: "PromptJudge",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      scores: {
        type: "object",
        additionalProperties: false,
        required: [
          "specificity",
          "constraint_fit",
          "mechanism_fidelity",
          "completeness",
          "actionability",
        ],
        properties: {
          specificity: { type: "number" },
          constraint_fit: { type: "number" },
          mechanism_fidelity: { type: "number" },
          completeness: { type: "number" },
          actionability: { type: "number" },
        },
      },
      weighted_score: { type: "number" },
      verdict: { type: "string", enum: ["ship", "revise"] },
      critique: { type: "string" },
    },
    required: ["scores", "weighted_score", "verdict", "critique"],
  },
} as const;

const REVISOR_SCHEMA = {
  name: "RevisedPrompt",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { prompt: { type: "string" } },
    required: ["prompt"],
  },
} as const;

export async function runExportPromptRoundTrip(
  args: GenerateExportPromptArgs,
): Promise<RoundTripResult> {
  // 1. Generate v1 (re-uses the existing single-shot generator).
  const draft = await generateVariationExportPrompt(args);
  const promptV1 = draft.prompt;

  // 2. Test v1 against a different-provider model.
  const previewV1Output = await runTestRoundTrip(promptV1);

  // 3. Judge.
  const judgeV1 = await judgePromptOutput({
    prompt: promptV1,
    output: previewV1Output,
    variationName: args.variation.name,
    framing: args.framing ?? "implementation",
  });

  // If judge says ship OR we'd hit cap immediately, return v1.
  if (judgeV1.verdict === "ship") {
    return {
      prompt_v1: promptV1,
      preview_v1: {
        output: previewV1Output,
        judge_score: judgeV1.weighted_score,
        judge_verdict: judgeV1.verdict,
        judge_critique: judgeV1.critique,
      },
      final_prompt: promptV1,
      iterations: 1,
    };
  }

  // 4. Revise based on critique, re-test, re-judge.
  const promptV2 = await revisePrompt(promptV1, judgeV1.weighted_score, judgeV1.critique);
  const previewV2Output = await runTestRoundTrip(promptV2);
  const judgeV2 = await judgePromptOutput({
    prompt: promptV2,
    output: previewV2Output,
    variationName: args.variation.name,
    framing: args.framing ?? "implementation",
  });

  return {
    prompt_v1: promptV1,
    preview_v1: {
      output: previewV1Output,
      judge_score: judgeV1.weighted_score,
      judge_verdict: judgeV1.verdict,
      judge_critique: judgeV1.critique,
    },
    prompt_v2: promptV2,
    preview_v2: {
      output: previewV2Output,
      judge_score: judgeV2.weighted_score,
      judge_verdict: judgeV2.verdict,
      judge_critique: judgeV2.critique,
    },
    // Ship v2 either way after the cap — surface the score so the
    // UI can badge "needs review" if v2 still failed the bar.
    final_prompt: promptV2,
    iterations: 2,
  };
}

// ── Step 2: Test-runner ──────────────────────────────────────────
//
// Fires the user's PROMPT as a system message + a minimal "Begin."
// user message. The output is what the downstream LLM would produce
// if the user pasted the prompt into ChatGPT/Claude. Bound to 1800
// tokens — enough for a real artifact, not so big we burn budget.

async function runTestRoundTrip(prompt: string): Promise<string> {
  // Anthropic provider so the test isn't an echo chamber of the
  // gpt-4o generator. If the user's Anthropic creds aren't set, this
  // falls back to OpenAI inside llmGenerate's withRetry (which would
  // then be a gpt-4o testing gpt-4o output — still useful as a
  // smoke test, less robust as a true round-trip).
  return await llmGenerate({
    system: prompt,
    user: "Begin. Produce the artifact the prompt above is asking for.",
    provider: "anthropic",
    temperature: 0.6,
    maxTokens: 1800,
  });
}

// ── Step 3: Judge ────────────────────────────────────────────────
//
// Rates the test output across 5 criteria + emits a verdict (ship if
// weighted_score >= 7.5). Critique is concrete and actionable so the
// revisor can apply it directly. Temperature 0.2 for consistent
// grading across runs.

async function judgePromptOutput(args: {
  prompt: string;
  output: string;
  variationName: string;
  framing: "implementation" | "design" | "research";
}): Promise<{
  weighted_score: number;
  verdict: "ship" | "revise";
  critique: string;
}> {
  const sys = `You evaluate the OUTPUT of an LLM that was given a prompt designed to help a user implement a specific mechanism. Rate the output across five criteria, each 0-10:

1. SPECIFICITY — Did the output produce concrete, actionable artifacts (code, specs, designs) vs. generic discussion?
2. CONSTRAINT_FIT — Does the output respect the user's operational constraints (time / budget / team / risk)?
3. MECHANISM_FIDELITY — Does the output stay anchored on the specific mechanism described, or did it drift to generic best practices?
4. COMPLETENESS — Did the output address the full ask, or stop short?
5. ACTIONABILITY — Could a developer/designer start work immediately from this output, or would they need to clarify first?

The framing is: ${args.framing} (so the user expected ${
    args.framing === "implementation"
      ? "implementation plan + code skeleton"
      : args.framing === "design"
        ? "a design / spec doc"
        : "research findings + evidence"
  }).

Return JSON:
{
  "scores": { specificity, constraint_fit, mechanism_fidelity, completeness, actionability } — each 0-10,
  "weighted_score": 0-10 (mean, with anything <5 weighted heavily),
  "verdict": "ship" | "revise" (ship if weighted_score >= 7.5),
  "critique": "<2-3 sentences. Concrete: 'add an explicit constraint section', 'demand pseudocode not prose', 'require named user role'. Avoid vague: 'be more specific'."
}`;

  const user = `MECHANISM: ${args.variationName}

PROMPT (what was given to the LLM):
\`\`\`
${args.prompt.slice(0, 4000)}
\`\`\`

OUTPUT (what the LLM produced):
\`\`\`
${args.output.slice(0, 4000)}
\`\`\`

Score the OUTPUT, not the prompt. Then describe how the PROMPT should change to make the output better next time.`;

  const raw = await llmJSON<JudgeShape>({
    system: sys,
    user,
    responseSchema: JUDGE_SCHEMA,
    temperature: 0.2,
    maxTokens: 800,
  });

  const weighted =
    typeof raw.weighted_score === "number" ? raw.weighted_score : 5;
  const verdict: "ship" | "revise" =
    raw.verdict === "ship" || raw.verdict === "revise"
      ? raw.verdict
      : weighted >= 7.5
        ? "ship"
        : "revise";
  const critique =
    typeof raw.critique === "string" && raw.critique.trim().length > 0
      ? raw.critique.trim()
      : "(no critique returned)";
  return { weighted_score: weighted, verdict, critique };
}

// ── Step 4: Revisor ──────────────────────────────────────────────
//
// Takes a critique + the original prompt, rewrites the prompt
// targeting EXACTLY the critique. Doesn't rewrite from scratch.
// Keeps the markdown shape (Context / Objective / Mechanism / etc.).

async function revisePrompt(
  original: string,
  weighted: number,
  critique: string,
): Promise<string> {
  const sys = `You revise prompts to fix specific weaknesses identified by a judge. The original prompt produced output the judge scored ${weighted.toFixed(1)}/10. The judge's critique:

"${critique}"

Revise the prompt to address EXACTLY the critique. Don't rewrite from scratch. Don't bloat — if anything, tighten. Keep the markdown shape (Context / Objective / Mechanism / Pain / Constraints / Open questions / Task). Return JSON: { "prompt": "<revised markdown>" }.`;

  const raw = await llmJSON<{ prompt?: unknown }>({
    system: sys,
    user: original,
    responseSchema: REVISOR_SCHEMA,
    temperature: 0.4,
    maxTokens: 2400,
  });

  if (typeof raw.prompt !== "string" || raw.prompt.trim().length === 0) {
    return original;
  }
  return raw.prompt.trim();
}

interface PromptLlmShape {
  prompt?: unknown;
}

const PROMPT_SCHEMA = {
  name: "VariationExportPrompt",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      prompt: { type: "string" },
    },
    required: ["prompt"],
  },
} as const;

export interface GenerateExportPromptArgs {
  variation: ItemVariation;
  entityName: string;
  objectiveText: string;
  roomTitle?: string | null;
  painText?: string | null;
  constraints?: OperationalConstraints | null;
  /** Caller can request a specific framing. Defaults to "implementation"
   *  which asks the downstream LLM to produce code/spec; "research"
   *  asks for an evidence pass instead. */
  framing?: "implementation" | "research" | "design";
}

export async function generateVariationExportPrompt(
  args: GenerateExportPromptArgs,
): Promise<ExportPromptResult> {
  const framing = args.framing ?? "implementation";
  const framingHint =
    framing === "implementation"
      ? "Asks the downstream model to produce a concrete implementation plan + code skeleton."
      : framing === "design"
        ? "Asks the downstream model to produce a design / spec doc."
        : "Asks the downstream model to gather evidence and surface what we'd need to know to commit.";

  const sys = `You compose ready-to-paste prompts that the user will hand to an external AI (ChatGPT, Claude, Cursor) to bootstrap their next move.

PROMPT SHAPE (use markdown headings + bullets):
1. # Context — one paragraph framing what the user is doing.
2. ## Objective — the parent objective text verbatim.
3. ## Mechanism — the variation's name + description + tradeoff.
4. ## Pain it addresses — one sentence on the negative outcome being countered.
5. ## Operational constraints — bulleted list of the user's constraints (time/budget/team/risk).
6. ## Open questions — bulleted list of the variation's open_questions.
7. ## Your task — clear, single-paragraph ASK at the end. Must match the framing: ${framingHint}

RULES:
- Output PLAIN MARKDOWN that the user can paste into another chat. No JSON-formatted scaffolding.
- 250-450 words total. Tight. The user is going to paste this directly.
- The "Your task" closing paragraph is the most important — make it a specific, scoped ask the downstream model can act on in one response.
- Don't reference the Objective Canvas or this internal system — the downstream model has no context for that.

Return JSON: { "prompt": "<the full markdown text>" }`;

  const ct = args.constraints;
  const constraintsBlock = ct
    ? `\nOperational constraints:\n- Time horizon: ${ct.time_horizon}\n- Budget tier: ${ct.budget_tier}\n- Team size: ${ct.team_size}\n- Risk tolerance: ${ct.risk_tolerance}${ct.compliance_requirements && ct.compliance_requirements.length > 0 ? `\n- Compliance: ${ct.compliance_requirements.join(", ")}` : ""}`
    : "";
  const openQ = args.variation.open_questions.length > 0
    ? args.variation.open_questions.join("; ")
    : "(none specified)";

  const user = `Compose an exportable prompt for this variation.

PARENT OBJECTIVE:
${args.objectiveText}

${args.roomTitle ? `ROOM / SUB-OBJECTIVE: ${args.roomTitle}\n` : ""}MECHANISM (entity): ${args.entityName}
VARIATION:
- Name: ${args.variation.name}
- Description: ${args.variation.description}
- Tradeoff: ${args.variation.tradeoff}
${args.painText ? `- Pain addressed: ${args.painText}\n` : ""}- Open questions: ${openQ}
${constraintsBlock}

Framing for the closing ASK: ${framing}.`;

  const raw = await llmJSON<PromptLlmShape>({
    system: sys,
    user,
    responseSchema: PROMPT_SCHEMA,
    temperature: 0.45,
    maxTokens: 2400,
  });

  const prompt =
    typeof raw.prompt === "string" && raw.prompt.trim().length > 0
      ? raw.prompt.trim()
      : "(Empty prompt — try regenerating.)";

  return { prompt };
}
