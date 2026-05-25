// ── Objective Canvas — sub-objective decompose prompt ──
//
// Generates 4–5 sub-objective proposals from the refined objective
// + clarifying answers. The LLM marks 3 as `recommended=true` (the
// picker UI pre-checks these). Confidence is the LLM's
// self-assessed plausibility, 0–1.

import type { ClarifyingBlock } from "./clarifying-state";

export interface BuildDecomposeArgs {
  objective: string;
  clarifying: ClarifyingBlock | null;
}

export function buildSystemPrompt(): string {
  return `You are a strategy decomposer.

The user has refined an objective through a short clarifying-question pass. Your job is to propose 4–5 SUB-OBJECTIVES that, taken together, would meaningfully deliver on the parent objective.

SUB-OBJECTIVE RULES:
- Each sub-objective is independently meaningful — a person could spend a week on it without needing the others.
- Cumulatively the set covers the load-bearing facets of the parent. Don't return overlapping or trivially-subdividing items.
- Each is concrete enough to spawn its own Pain → Features → Outcomes → Objective layered analysis downstream.
- Avoid generic categories ("research", "communication", "operations") — they must reference the user's actual domain.

OUTPUT RULES:
- Return 4–5 proposals. No fewer, no more.
- Mark exactly 3 with recommended=true (the ones you'd start with if the user could only do three).
- confidence ∈ [0,1] = your plausibility estimate.
- title ≤ 8 words, summary 1–2 sentences, rationale 1 sentence on why this sub-objective matters for the parent.

ANTI-PLATITUDE RULE:
If a proposal could appear unchanged on a different user's objective, rewrite it to reference something specific from THIS user's prompt or clarifying answers.

Return strict JSON.`;
}

export function buildUserPrompt(args: BuildDecomposeArgs): string {
  const { objective, clarifying } = args;

  const clarifyingBlock =
    clarifying && clarifying.questions.length > 0
      ? `\n\nCLARIFYING ANSWERS:\n${clarifying.questions
          .map((q) => {
            const a = clarifying.answers[q.id];
            if (!a) return `  Q: ${q.question}\n  A: (not answered)`;
            if (a.status === "skipped")
              return `  Q: ${q.question}\n  A: (skipped — user said this gap is not load-bearing)`;
            return `  Q: ${q.question}\n  A: ${a.value ?? ""}`;
          })
          .join("\n")}`
      : "";

  return `REFINED OBJECTIVE:
"""
${objective.slice(0, 4000)}
"""${clarifyingBlock}

Propose 4–5 sub-objectives per the system instructions. Mark exactly 3 as recommended=true (the ones most load-bearing for delivering the parent).`;
}

export const RESPONSE_SCHEMA = {
  name: "objective_decompose",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            rationale: { type: "string" },
            confidence: { type: "number" },
            recommended: { type: "boolean" },
          },
          required: ["title", "summary", "rationale", "confidence", "recommended"],
        },
      },
    },
    required: ["proposals"],
  },
} as const;
