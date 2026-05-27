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

import { llmJSON } from "@/lib/llm";
import type { ItemVariation } from "./expand-item-detail";
import type { OperationalConstraints } from "./constraints";

export interface ExportPromptResult {
  prompt: string;
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
