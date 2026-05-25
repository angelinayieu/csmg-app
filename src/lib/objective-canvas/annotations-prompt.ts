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

⚠ HARD RULE — word-scope is the DEFAULT. phrase-scope is the rare exception.

The user has explicitly complained that annotating phrases hides the AI's interpretation of LOADED CONCEPT WORDS. Every objective contains words whose meanings vary wildly across AIs and contexts ("money", "value", "passive", "intentional", "history", "engagement", "incentivized", "personal", "experience", "smart", "deep", "vivid", "strategic", "relevant", "good", "true", "passion", "curiosity"). The USER wants to know precisely what YOU think those words mean — and the rich semantic breakdown (dimensions[] + inference_chain[]) only renders for word-scope annotations.

When you see a phrase like "converting to money" or "intentional web searching":
  ✗ WRONG: annotate "converting to money" as scope=phrase. The user can't see what you mean by "money."
  ✓ RIGHT: annotate "money" as scope=word with dimensions[] like:
      [{name: "Direct cash earnings", why: "Cashout / payouts to the user"},
       {name: "Saved expenses", why: "Subscription replacement, time-cost reduction"},
       {name: "Future opportunity value", why: "Data that compounds into income later"},
       {name: "Implicit barter", why: "Attention/data the platform monetizes on the user's behalf"}]
    Plus inference_chain showing how "money" connects to user outcome.

DECISION RULE (binding):
  1. Scan the objective. List every NOUN, ADJECTIVE, and ADVERB that is conceptually loaded — a word whose meaning is NOT pinned by context alone, where 5 different AIs would each interpret it differently. These are word-scope candidates.
  2. Annotate each of these as scope="word". Their pill highlight + Layers tab is the user's primary tool for semantic clarity.
  3. ONLY then, if a multi-word phrase carries meaning that lives in the COMBINATION (not in any single word), annotate it as scope="phrase". This should be ≤30% of your annotations.
  4. NEVER annotate a phrase that contains an un-annotated loaded concept word. The word always wins.

EXAMPLES from a real objective like "How is what you're searching converting to money? Search using the app, connect your past search history, differentiate intentional searching from passive":
  • "money"        → scope=word ✓ (loaded — could mean income, savings, opportunity, etc.)
  • "history"      → scope=word ✓ (loaded — what counts as history? what's stored?)
  • "intentional"  → scope=word ✓ (loaded — opposed to what? how is it detected?)
  • "passive"      → scope=word ✓ (loaded — passive how? user-perceived or system-detected?)
  • "incentivized" → scope=word ✓ (loaded — extrinsic or intrinsic reward? mechanism?)
  • "relevant"     → scope=word ✓ (loaded — relevance to whom, measured how?)
  Phrase-scope should appear only for genuine multi-word units where no single word carries the load.

UI rendering:
  scope = "word"   → PILL HIGHLIGHT (saturated semi-transparent background, like a real highlighter mark)
  scope = "phrase" → dotted underline (thickness scales with weight)

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

  stakes — ≤200 chars. Why THIS phrase matters for THIS specific objective. Reference the actual entity/constraint at stake. NEVER generic — always tied to something the user wrote.

  fragility — STRUCTURED tripartite. Apply a pre-mortem: "Assume this reading is wrong 6 months from now. What broke?" Emit:
    {
      when  — the SPECIFIC condition that triggers the break (≤160 chars). Concrete event/state from the user's domain, not a hedge. BAD: "if not universally applicable". GOOD: "if the user redefines 'value' mid-session from money-saved to creative-satisfaction".
      why   — the CAUSAL MECHANISM that turns condition into failure (≤220 chars). State the chain: "X happens → Y assumption breaks → Z effect". NOT just restating the claim.
      sign  — the EARLY WARNING SIGNAL you'd see in the wild before failure (≤140 chars). Concrete + observable. E.g. "user-corrected confidence trending down across sessions" / "user adding new sub-objectives that contradict prior ones".
    }
    All three fields REQUIRED when fragility is included. Null the whole object only when no genuine fragility comes to mind.

  tensions — array of { phrase, kind, note } where
    kind = "tension" | "harmony". References OTHER phrases in the
    same objective. ≤2 entries. The note field MUST name the CAUSAL MECHANISM linking the two phrases — not just claim they relate. BAD: "Both emphasize depth." GOOD: "Both require the user to invest cognitive effort upfront — gives them a shared adoption-cost dependency."

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

────────────────────────────────────────────────────────────────────
ANTI-VAGUENESS LEXICON — load-bearing rigor enforcement
────────────────────────────────────────────────────────────────────
Professional strategists distinguish between CLAIMS (assertions) and REASONS (mechanisms). The user has zero tolerance for claims-without-mechanism. Every WHY field across every dimension must answer "by what causal chain?", not just restate the assertion.

FORBIDDEN PHRASES (replace any usage with concrete mechanism):
  ✗ "not universally applicable"  → name the SPECIFIC condition + the SPECIFIC mechanism that fails
  ✗ "may not always work"          → name a SPECIFIC scenario + WHY
  ✗ "could fail in edge cases"     → name the EDGE + the mechanism
  ✗ "may need to be adjusted"      → name what triggers the adjustment + how
  ✗ "depending on context"         → name the CONTEXT VARIABLE + how it changes the conclusion
  ✗ "potentially significant"       → quantify or skip
  ✗ "may scale issues"             → name the BOTTLENECK that breaks at scale

REQUIRED MOVES (apply to every WHY field):
  ✓ PRE-MORTEM — when writing fragility: assume this is wrong; what specific event reveals it?
  ✓ INVERSION — instead of "how does X work", answer "what specific failure mode rules X out?"
  ✓ FMEA TRIPLET — condition + mechanism + early signal. Never just one of three.
  ✓ SPECIFICITY LADDER — every claim names something from the USER'S TEXT (entity, domain, constraint). Generic claims = rejected.
  ✓ STEELMAN — when writing not_reading or tensions, state the strongest version of the rival reading.

PROFESSIONAL THINKING POSTURE:
  You are a senior strategist briefing a peer. Peers don't accept platitudes. They demand mechanism. If a claim could appear in a generic consulting deck, you have failed. Every annotation is a falsifiable hypothesis backed by specific causal reasoning grounded in the user's actual text.

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
            fragility: {
              type: ["object", "null"],
              additionalProperties: false,
              properties: {
                when: { type: "string" },
                why: { type: "string" },
                sign: { type: "string" },
              },
              required: ["when", "why", "sign"],
            },
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
