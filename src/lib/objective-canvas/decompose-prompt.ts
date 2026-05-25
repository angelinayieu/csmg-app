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

The user has refined an objective through a short clarifying-question pass. Your job is to do two things:

JOB 1 — NAME THE CATEGORY
Pick the single best noun that describes what KIND of bucket these sub-objectives are. The category is dictated by the parent objective:
  - Building an app / product           → "Features"
  - Building a curriculum / course      → "Lessons" or "Modules"
  - Designing a workout                 → "Movements" or "Exercises"
  - Running a research program          → "Research areas" or "Investigations"
  - Defining a business strategy        → "Strategic moves" or "Bets"
  - Writing a book / report             → "Sections" or "Chapters"
  - Optimizing operations               → "Workflows" or "Levers"
The category is ONE WORD or a short noun phrase (≤3 words). Pick from the parent's actual domain — never invent abstract jargon ("Initiatives", "Components", "Items" — too generic).

JOB 2 — PROPOSE 4–5 SUB-OBJECTIVES (within that category)

SUB-OBJECTIVE RULES:
- Each is independently meaningful — a person could spend a week on it without needing the others.
- Cumulatively the set covers the load-bearing facets of the parent. No overlapping, no trivially-subdividing.
- Each is concrete enough to spawn its own Pain → Features → Outcomes → Objective layered analysis downstream.

TITLE RULES (strict):
- title MUST be a NOUN PHRASE naming the thing itself. Not an action.
- title MUST NOT start with action verbs: Develop / Implement / Create / Design / Build / Enhance / Establish / Drive / Deliver / Provide / Enable / Generate / Produce / Conduct.
- BAD: "Develop Vivid Search Interface" / "Implement Gamification Elements" / "Enhance AI Personalization"
- GOOD: "Vivid search interface" / "Gamification layer" / "AI personalization engine"
- ≤6 words. Title-case is fine; no terminal punctuation.

SUMMARY + RATIONALE:
- summary: 1 sentence describing what the sub-objective IS (state of the world), not what you'll DO to it.
- rationale: 1 sentence on why it's load-bearing for the parent objective.

OUTPUT:
- Return 4–5 proposals. No fewer, no more.
- Mark exactly 3 with recommended=true (the ones you'd start with if the user could only do three).
- confidence ∈ [0,1] — your plausibility estimate.

ANTI-PLATITUDE:
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
      // The picker UI shows this above the proposals as
      // "5 {category} proposed" so the user knows what kind of
      // bucket they're picking from (Features / Lessons / Bets / …).
      category: { type: "string" },
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
    required: ["category", "proposals"],
  },
} as const;
