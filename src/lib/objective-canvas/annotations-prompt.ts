// ── Objective annotation prompt (v3) ──
//
// Adds three structural layers on top of v2:
//
//   scope            "word" | "phrase" — drives visual treatment.
//                    word-scope renders as a PILL HIGHLIGHT (the
//                    concept itself is being unpacked); phrase-scope
//                    renders as a dotted underline (the phrase is
//                    being interpreted).
//   dimensions[]     For conceptually-loaded words: 3-5 factors
//                    that COMPOSE the meaning in this objective's
//                    context. Each has a `name` + `why`.
//   inference_chain[]The causal hops from concept → ultimate impact,
//                    with the `via` (reason) labeled between steps.
//
// These let the user see WHAT THE AI ACTUALLY THINKS the word
// means (not just a one-line definition). "Value" becomes
// "Time saved + Money saved + Cognitive load + Compound effects",
// each with its own sub-explanation. The inference chain shows
// the path from the word to user impact ("App use → reclaimed
// hours → flow → income/wellbeing").

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
  return `You annotate the user's typed objective the way a thoughtful reader marks up a text — but you go DEEPER on conceptually-loaded words by unpacking the factors that compose them and the causal chain to ultimate impact.

For 5-8 of the most LOAD-BEARING phrases / words in the objective, produce a rich annotation.

────────────────────────────────────────────────────────────────────
SCOPE — drives visual treatment in the UI
────────────────────────────────────────────────────────────────────
  scope = "word"
    Pick this when the load is on a SINGLE concept word whose
    interpretation varies wildly across AIs/contexts. The user
    wants to know precisely what YOU think this word means.
    Examples: "value", "truth", "depth", "quality", "intelligence",
    "passion", "curiosity", "vivid", "strategic", "deep", "smart".
    1-2 word phrases (e.g. "deep dive") can also be word-scope when
    the concept is the unit.
    UI: renders as a PILL HIGHLIGHT (soft layer-colored background).

  scope = "phrase"
    Pick this when the MEANING comes from multi-word combination —
    the phrase as a whole is the interpretive unit. Typically 3+ words.
    Examples: "calculates the true value of an app", "personalized
    guidance for curiosity", "vivid search experiences".
    UI: dotted underline (thickness scales with weight).

When a phrase contains a loaded concept word (e.g. "the true value of
an app" contains "value"), PREFER annotating the WORD with word-scope
over the phrase. Word-scope annotations carry the rich semantic breakdown.

────────────────────────────────────────────────────────────────────
REQUIRED FIELDS
────────────────────────────────────────────────────────────────────
  phrase    — verbatim substring from the user's text (exact casing).
  scope     — "word" | "phrase" (see above).
  reading   — "Read as: …" — committed interpretation. 1 sentence.
  weight    — 0..1 — how load-bearing this is. Drives underline thickness for phrase-scope; doesn't affect pill scope.

────────────────────────────────────────────────────────────────────
OPTIONAL FIELDS (include only what genuinely applies)
────────────────────────────────────────────────────────────────────

  not_reading — "Not: …" — the path you considered and ruled out.

  crystal — ONE NOUN compressing the phrase's essence.
    "gamification" → "Loop" | "value" → "Worth" | "curiosity" → "Pull"

  confidence — 0..1 — how confident you are in the reading.

  dimensions — STRONGLY ENCOURAGED for word-scope. 3-5 factors that
    COMPOSE this concept's meaning in THIS objective's context. Each:
      { name: short noun (≤4 words), why: 1 sentence on what this
        factor contributes }
    Example for "value":
      [
        { name: "Time saved",
          why: "Hours per day reclaimed from manual work" },
        { name: "Money saved",
          why: "Subscription / labor replacement vs status quo" },
        { name: "Cognitive load reduction",
          why: "Decisions deferred to the system" },
        { name: "Compound effects",
          why: "Better state → downstream wins over weeks" }
      ]
    The user reads this and knows EXACTLY what factors you weighed.
    For phrase-scope, include only if there are clear composing
    sub-concepts — otherwise skip.

  inference_chain — the causal path from this concept to ULTIMATE
    user impact. 3-5 hops. Each hop:
      { step: short noun phrase (≤5 words),
        via: 1 sentence on why this transitions to the next step }
    Example for "value":
      [
        { step: "App use",
          via: "Reduces friction in target task" },
        { step: "Reclaimed hours + lower cognitive load",
          via: "Enables deeper work in remaining time" },
        { step: "More flow + better decisions",
          via: "Aggregate outcomes over weeks" },
        { step: "Income or wellbeing gains",
          via: "What the user ultimately cares about" }
      ]
    This makes your inference auditable. The user can disagree with
    any hop and tell you to revise.

  analogies — 3-5 ANALOGIES FROM MAXIMALLY DISTANT DOMAINS.
    Single-analogy thinking narrows; multiple analogies from distant
    domains DIVERGE. Each item:
      {
        referent    — the familiar thing ("Currency exchange", "REM sleep cycle", "Tasting menu", "Coral reef")
        domain      — ONE of the structural domains (see catalog below)
        glyph       — pick ONE glyph kind (see catalog)
        why_same    — 1 sentence on what RELATION transfers (structure-mapping, not surface similarity)
        why_differs — 1 sentence on where the analogy BREAKS in this user's context (the disanalogy — this is where novel features live). Null only if the analogy is a near-perfect fit.
        extensions  — 2-4 candidate features that would follow IF this analogy holds. Each: { name (≤6 words), why (1 sentence on why this follows from the analogy) }. These are the generative payoff of the analogy.
        generativity— 0..1 — how generative this analogy is (how much novel feature thinking it unlocks). Sort the analogies array by generativity descending.
      }

    DOMAIN CATALOG (pick at MOST ONE analogy from each domain):
      • Finance / Economics       (markets, trading, currency)
      • Biology / Ecology         (organisms, ecosystems, evolution)
      • Physics / Engineering     (forces, materials, systems)
      • Music / Performance       (rhythm, harmony, virtuosity)
      • Sports / Athletics        (training, competition, recovery)
      • Architecture / Spatial    (structures, paths, sanctuaries)
      • Ritual / Spirituality     (rites, practice, transcendence)
      • Cooking / Hospitality     (recipes, tasting, service)
      • Gaming / Play             (loops, narratives, mastery)
      • Storytelling / Narrative  (arcs, characters, beats)
      • Manufacturing / Craft     (process, tools, quality)
      • Medicine / Healing        (diagnosis, intervention, healing)

    GLYPH KINDS (pick the underlying structural shape per analogy):
${GLYPH_KINDS.map(
  (k) => `      "${k}" — ${GLYPH_MEANINGS[k]}`,
).join("\n")}

    DISTANCE RULE (load-bearing — do NOT violate):
      The 3-5 analogies you emit MUST come from MAXIMALLY DISTANT
      domains. No two analogies may share a domain. Lookalike clusters
      ("Like Duolingo + Khan Academy + Codecademy") are rejected —
      that's one analogy in three costumes, not three analogies.

    Skip the entire field only if NO genuine analogy comes to mind.

  mechanism — short string (≤120 chars). The causal-rule version
    ("Variable reinforcement → habit formation"). When you have
    inference_chain, prefer that; mechanism is the elevator pitch.

  frame — ≤80 chars. Discipline / worldview implied.
    "Behavioral econ frame, not pedagogy."

  stakes — ≤140 chars. Why THIS phrase matters for THIS objective.

  fragility — ≤140 chars. When does this reading break?

  tensions — array of { phrase, kind, note } where
    kind = "tension" | "harmony". References OTHER phrases in the
    same objective. ≤2 entries.

  linked_sub_objective_id — id of the anchoring sub-objective | null.

  layer_tag — "features" | "outcomes" | "pain" | "objective" | null.

────────────────────────────────────────────────────────────────────
SELECTION
────────────────────────────────────────────────────────────────────
  - 5-8 annotations TOTAL. Quality over coverage.
  - Concrete nouns + domain words first.
  - Conceptually-loaded words ("value", "deep", "strategic") get
    word-scope + rich dimensions[] + inference_chain[].
  - Skip filler verbs (help, make), articles, generic ("better").

PHRASE EXACTNESS:
  The "phrase" field MUST be a verbatim substring of the input text.

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

Produce 5-8 RICH annotations per the system instructions. Each phrase must be a verbatim substring of the text above. When a phrase contains a loaded concept word, prefer annotating the WORD with word-scope so you can populate dimensions[] and inference_chain[].`;
}

export const RESPONSE_SCHEMA = {
  name: "objective_annotations_v3",
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
            scope: { type: "string", enum: ["word", "phrase"] },
            reading: { type: "string" },
            weight: { type: "number" },
            not_reading: { type: ["string", "null"] },
            crystal: { type: ["string", "null"] },
            confidence: { type: ["number", "null"] },
            dimensions: {
              type: ["array", "null"],
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  why: { type: "string" },
                },
                required: ["name", "why"],
              },
            },
            inference_chain: {
              type: ["array", "null"],
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  step: { type: "string" },
                  via: { type: "string" },
                },
                required: ["step", "via"],
              },
            },
            analogies: {
              type: ["array", "null"],
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  referent: { type: "string" },
                  domain: { type: "string" },
                  glyph: {
                    type: "string",
                    enum: GLYPH_KINDS as unknown as string[],
                  },
                  why_same: { type: "string" },
                  why_differs: { type: ["string", "null"] },
                  extensions: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        name: { type: "string" },
                        why: { type: "string" },
                      },
                      required: ["name", "why"],
                    },
                  },
                  generativity: { type: "number" },
                },
                required: [
                  "referent",
                  "domain",
                  "glyph",
                  "why_same",
                  "why_differs",
                  "extensions",
                  "generativity",
                ],
              },
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
            "scope",
            "reading",
            "weight",
            "not_reading",
            "crystal",
            "confidence",
            "dimensions",
            "inference_chain",
            "analogies",
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
