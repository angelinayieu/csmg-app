// ── Objective annotation prompt ──
//
// Extracts 5-8 phrase annotations from the user's typed core
// objective. Each annotation names a phrase in the text, states
// how the AI READ it (the committed interpretation — not a
// dictionary definition), and optionally links it to the
// sub-objective that anchors on it.
//
// Selection rules in the prompt:
//   - Concrete nouns / domain words
//   - Ambiguous adjectives the AI committed to a specific reading of
//   - Phrases that became sub-objective anchors
//   - SKIP: filler verbs, articles, generic words ("better", "more")

export interface AnnotationSubObjectiveRef {
  id: string;
  title: string;
  description?: string | null;
}

export function buildSystemPrompt(): string {
  return `You annotate the user's typed objective with the AI's committed reading.

For 5-8 of the most load-bearing phrases in the objective, you'll surface:
  - phrase: the EXACT substring from the user's text (copy-paste-level exact)
  - note: how YOU read it — "Read as: …" or "Used here to mean: …".
          Commit to a specific interpretation, not a dictionary def.
          1-2 sentences. Reference downstream impact when possible.
  - linked_sub_objective_id: the id of the sub-objective that
          anchors on this phrase, or null if none of them do
  - layer_tag: "features" | "outcomes" | "pain" | "objective" | null
          (which layer the phrase will primarily live in once the
           room is generated). Drives the highlight color.

SELECTION RULES (be selective — quality over coverage):
- Pick CONCRETE NOUNS and DOMAIN WORDS first (gamification, personalization, curiosity, …)
- Pick AMBIGUOUS ADJECTIVES you've committed to a specific reading of (vivid, deep, strategic, …)
- Pick PHRASES that became sub-objective anchors (look at the sub_objectives input)
- SKIP filler verbs (help, make, use), articles (the, a), and generic words (better, more, things)
- 5-8 phrases TOTAL. Never more. Prefer fewer high-signal over many low-signal.

PHRASE EXACTNESS:
- The "phrase" field MUST be a verbatim substring of the input text. Same casing, same spacing, no typos. Otherwise we cannot locate it for highlighting.
- If a phrase appears multiple times, choose the first occurrence (we'll offset-resolve to it).

NOTE QUALITY:
- BAD: "Gamification refers to using game elements." (dictionary)
- GOOD: "Read as: reward + progress signals that hook engagement, not points-for-points-sake. Anchors the Gamification Layer sub-objective."
- GOOD: "Used here to mean: sensory-rich + immediately compelling, opposite of comprehensive-but-boring."
- Always concrete. Always tied to how it shapes the analysis.

Return strict JSON.`;
}

export function buildUserPrompt(args: {
  objective: string;
  subObjectives: AnnotationSubObjectiveRef[];
}): string {
  const subBlock =
    args.subObjectives.length > 0
      ? `\n\nSUB-OBJECTIVES (already generated; reference these in your notes when relevant):\n${args.subObjectives
          .map(
            (s, i) =>
              `  ${i + 1}. [id: ${s.id}] ${s.title}${
                s.description ? ` — ${s.description.slice(0, 200)}` : ""
              }`,
          )
          .join("\n")}`
      : "";

  return `CORE OBJECTIVE (user's typed text):
"""
${args.objective}
"""${subBlock}

Produce 5-8 annotations per the system instructions. Each phrase must be a verbatim substring of the text above.`;
}

export const RESPONSE_SCHEMA = {
  name: "objective_annotations",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      annotations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            phrase: { type: "string" },
            note: { type: "string" },
            linked_sub_objective_id: { type: ["string", "null"] },
            layer_tag: {
              type: ["string", "null"],
              enum: ["features", "outcomes", "pain", "objective", null],
            },
          },
          required: ["phrase", "note", "linked_sub_objective_id", "layer_tag"],
        },
      },
    },
    required: ["annotations"],
  },
} as const;
