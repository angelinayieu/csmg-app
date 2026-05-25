// ── Objective annotation prompt (v2) ──
//
// Rich annotation generator. For 5-8 load-bearing phrases in the
// user's typed objective, the LLM produces a layered annotation:
//
//   reading      "Read as: …"     committed interpretation
//   not_reading  "Not: …"         what was ruled out (negative space)
//   crystal      one noun         essence of the phrase
//   weight       0..1             how load-bearing (drives underline)
//   confidence   0..1             how committed we are
//   like         { referent, why_same, glyph }   analogy + structural shape
//   mechanism    short string     causal chain underneath
//   frame        short string     discipline / worldview implied
//   stakes       short string     why it matters for THIS objective
//   fragility    short string     where the reading breaks
//   tensions     phrase refs      harmonies/contradictions across the text
//   linked_sub_objective_id      the sub-objective it anchors
//   layer_tag    pain/features/outcomes/objective | null
//
// Most fields are optional — the LLM is told to include only
// dimensions that meaningfully apply. Annotations with only
// `reading` are still valid; the card adapts its tabs.

import {
  GLYPH_KINDS,
  GLYPH_MEANINGS,
  type GlyphKind,
} from "@/components/objective/icons/annotation-glyphs";

export interface AnnotationSubObjectiveRef {
  id: string;
  title: string;
  description?: string | null;
}

export function buildSystemPrompt(): string {
  return `You annotate the user's typed objective the way a thoughtful reader marks up a text — committing to a reading, naming the shape via analogy, surfacing mechanism, stakes, and fragility.

For 5-8 of the most LOAD-BEARING phrases in the objective, produce a rich annotation.

REQUIRED FIELDS:
  phrase   — verbatim substring from the user's text (exact casing, exact spacing). If the phrase appears multiple times, choose the first occurrence.
  reading  — "Read as: …" — the committed interpretation. 1 sentence. Concrete, not dictionary.
  weight   — 0..1 — how LOAD-BEARING this phrase is in the objective (drives underline thickness). 1.0 = removing this phrase would change the objective fundamentally; 0.3 = supporting detail.

OPTIONAL FIELDS (include only what genuinely applies — quality over coverage):

  not_reading — "Not: …" — what you considered and ruled out. This shows the user the path NOT taken. Same length as reading.

  crystal — ONE NOUN that compresses the phrase's essence. Examples:
    • "gamification" → "Loop"
    • "ai personalization" → "Lens"
    • "deep dive" → "Well"
    • "curiosity" → "Pull"

  confidence — 0..1 — how confident you are in the reading. Lower when the phrase is genuinely ambiguous.

  like — analogy to a familiar structure:
    {
      referent   — the familiar thing ("Duolingo streaks", "a magnifying glass", "Stack Overflow rep")
      why_same   — one sentence on the structural similarity
      glyph      — pick ONE from this set based on the underlying SHAPE of the concept:
${GLYPH_KINDS.map(
  (k) => `        "${k}" — ${GLYPH_MEANINGS[k]}`,
).join("\n")}
    }
    Skip 'like' if no genuine analogy comes to mind — generic ones ("like a tool") are worse than nothing.

  mechanism — short string (≤120 chars) — the causal chain underneath. E.g. "Variable reinforcement → habit formation."

  frame — short string (≤80 chars) — the discipline / worldview implied. E.g. "Behavioral econ frame, not pedagogy."

  stakes — short string (≤140 chars) — why this phrase matters for THIS specific objective. Reference the objective's intent.

  fragility — short string (≤140 chars) — the failure mode of THIS reading. When does this break?

  tensions — array of { phrase, kind, note } where kind = "tension" | "harmony", referencing OTHER phrases in the same objective. Use to surface internal coherence or contradictions. ≤2 entries per annotation.

  linked_sub_objective_id — id of the sub-objective that anchors on this phrase, or null.

  layer_tag — "features" | "outcomes" | "pain" | "objective" | null — drives the underline color.

SELECTION RULES (be selective — 5 great > 8 mediocre):
  - Pick CONCRETE NOUNS and DOMAIN WORDS first.
  - Pick AMBIGUOUS ADJECTIVES you commit to a specific reading of.
  - Pick PHRASES that became sub-objective anchors (look at sub_objectives).
  - Skip filler verbs (help, make), articles, and generic words (better, more, things).

NOTE QUALITY:
  - BAD: "Gamification refers to using game elements." (dictionary)
  - GOOD: reading = "Read as: reward + progress signals that hook engagement, not points-for-points-sake."
    + not_reading = "Not: arbitrary badges layered on top of an existing experience."
    + crystal = "Loop"
    + like = { referent: "Duolingo streaks", why_same: "Same micro-reward loop keeps users returning", glyph: "loop" }
    + mechanism = "Variable reinforcement schedule → habit formation"
    + frame = "Behavioral econ, not pedagogy"
    + stakes = "Without this, depth feels like work, not curiosity"
    + fragility = "Fails when intrinsic motivation already exists"
    + linked_sub_objective_id = "..."
    + layer_tag = "features"
    + weight = 0.85

PHRASE EXACTNESS:
  The "phrase" field MUST be a verbatim substring of the input text. Otherwise we cannot locate it for highlighting.

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

Produce 5-8 RICH annotations per the system instructions. Each phrase must be a verbatim substring of the text above. Include every dimension that genuinely applies; skip the ones that don't.`;
}

export const RESPONSE_SCHEMA = {
  name: "objective_annotations_v2",
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
            reading: { type: "string" },
            weight: { type: "number" },
            not_reading: { type: ["string", "null"] },
            crystal: { type: ["string", "null"] },
            confidence: { type: ["number", "null"] },
            like: {
              type: ["object", "null"],
              additionalProperties: false,
              properties: {
                referent: { type: "string" },
                why_same: { type: "string" },
                glyph: {
                  type: "string",
                  enum: GLYPH_KINDS as unknown as string[],
                },
              },
              required: ["referent", "why_same", "glyph"],
            },
            mechanism: { type: ["string", "null"] },
            frame: { type: ["string", "null"] },
            stakes: { type: ["string", "null"] },
            fragility: { type: ["string", "null"] },
            tensions: {
              type: ["array", "null"],
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  phrase: { type: "string" },
                  kind: { type: "string", enum: ["tension", "harmony"] },
                  note: { type: "string" },
                },
                required: ["phrase", "kind", "note"],
              },
            },
            linked_sub_objective_id: { type: ["string", "null"] },
            layer_tag: {
              type: ["string", "null"],
              enum: ["features", "outcomes", "pain", "objective", null],
            },
          },
          required: [
            "phrase",
            "reading",
            "weight",
            "not_reading",
            "crystal",
            "confidence",
            "like",
            "mechanism",
            "frame",
            "stakes",
            "fragility",
            "tensions",
            "linked_sub_objective_id",
            "layer_tag",
          ],
        },
      },
    },
    required: ["annotations"],
  },
} as const;

export type { GlyphKind };
