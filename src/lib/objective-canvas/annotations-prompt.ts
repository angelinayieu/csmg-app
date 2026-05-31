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

Produce a MIX of word-scope and phrase-scope annotations. Target ~7-9 total.

────────────────────────────────────────────────────────────────────
SCOPE — two complementary visual treatments
────────────────────────────────────────────────────────────────────

⚠ COMPLEMENTARY MANDATE — both scopes are required. They cover DIFFERENT territory.

  scope = "word"  → PILL HIGHLIGHT (saturated semi-transparent background)
    Purpose: answer "what does the AI think this LOADED WORD means?"
    Pairs with the Layers tab (dimensions[] + inference_chain[]) so
    the user audits the AI's semantic interpretation of a single
    concept. The user has explicitly asked to see precisely what each
    loaded word means in their objective.
    Use for: NOUNS / ADJECTIVES / ADVERBS that are conceptually loaded
    — meanings vary wildly across AIs and contexts ("money", "value",
    "passive", "intentional", "history", "engagement", "incentivized",
    "personal", "experience", "smart", "deep", "vivid", "strategic",
    "relevant", "good", "true", "passion", "curiosity").

  scope = "phrase" → DOTTED UNDERLINE (thickness scales with weight)
    Purpose: answer "how does the AI READ this multi-word unit as a
    composed whole?" — the COMBINATION carries meaning that no single
    word inside it carries alone.
    Pairs with the Read tab (committed reading + not_reading).
    Use for: multi-word units (3+ words typically) where the
    INTERPRETIVE WORK is in how the words combine. Examples:
      • "intentional web searching" — the combination defines a mode
      • "past search history → understanding" — the chain itself is the unit
      • "personalized guidance for curiosity" — the framing is the unit

────────────────────────────────────────────────────────────────────
QUOTA (binding — do NOT collapse one scope into the other)
────────────────────────────────────────────────────────────────────
  Emit BOTH:
    • 4-6 WORD-SCOPE annotations on the most-loaded concept words.
    • 2-3 PHRASE-SCOPE annotations on multi-word interpretive units.
  Total: 7-9 annotations.

  Word-scope annotations are the user's primary semantic tool — they
  unlock the Layers tab. Phrase-scope annotations are the user's
  compositional tool — they unlock the Read tab. SHIPPING ONE WITHOUT
  THE OTHER is a regression and removes a layer of meaning the user
  asked for.

  Both scopes share the same fields (dimensions, inference_chain,
  analogies, etc.) but DIFFERENT FIELDS shine in each:
    word    → emphasize dimensions[] + inference_chain[] (semantic unpacking)
    phrase  → emphasize reading + not_reading + analogies[] (compositional read)

────────────────────────────────────────────────────────────────────
NON-OVERLAP RULE
────────────────────────────────────────────────────────────────────
  Word-scope and phrase-scope annotations must NEVER share text spans.
  If you annotate "money" as scope=word, do NOT also annotate "converting
  to money" as scope=phrase — pick one or the other for that text region.
  Choose phrase when the COMPOSITION is the load; choose word when the
  LOADED WORD inside the phrase is the load.

  Practical: pick word-scope concepts FIRST, then look for multi-word
  phrases ELSEWHERE in the text that don't contain those words.

────────────────────────────────────────────────────────────────────
EXAMPLE allocation (load-bearing, READ CAREFULLY)
────────────────────────────────────────────────────────────────────
For a paragraph like:
  "Help people search the web better through enhanced vivid experiences
   plus gamification plus more strategic ai personalization to enhance
   their ability to deep dive and learn what stimulates their curiosity.
   Essentially personalized guidance for curiosity."

  Word-scope (4-5):
    • "vivid"        — loaded (sensory-rich? immediately compelling? saturated?)
    • "strategic"    — loaded (planning-frame? optimization-frame? game-frame?)
    • "curiosity"    — loaded (intrinsic drive? attention pull? exploration?)
    • "deep"         — loaded (depth of focus vs depth of subject?)

  Phrase-scope (2-3) — chosen FROM THE REMAINING TEXT so they don't
  overlap any word-scope ranges above. Each is a multi-word
  interpretive unit:
    • "enhanced ... experiences"
        — COMPOSITION is the unit; what does "enhanced" do to "experience"?
    • "ai personalization"
        — multi-word noun phrase; the interpretive load is in
          the COMBINATION (AI + personalization frame), not in
          either word alone
    • "personalized guidance"
        — same — combination is the unit, not the words alone

  Both layers together: the user sees what each LOADED WORD means
  (Layers tab) AND how each MULTI-WORD UNIT is being read (Read tab).
  Neither alone is sufficient.

────────────────────────────────────────────────────────────────────
ALLOCATION ALGORITHM (apply in this order)
────────────────────────────────────────────────────────────────────
  1. List every conceptually loaded WORD in the objective.
     Pick 4-6 highest-impact → word-scope.
  2. SCAN the remaining text (everywhere those words are NOT) for
     multi-word units that carry compositional meaning.
     Pick 2-3 → phrase-scope.
  3. If no clean phrase candidates exist outside the word-scope
     ranges, you may rephrase: skip one word-scope candidate so its
     containing phrase becomes available. But aim to ship BOTH scopes
     in every annotation set unless the text is impossibly small.

────────────────────────────────────────────────────────────────────
REQUIRED FIELDS
────────────────────────────────────────────────────────────────────
  phrase    — verbatim substring from the user's text (exact casing).
  scope     — "word" | "phrase" (see above).
  reading   — "Read as: …" — committed interpretation. 1 sentence.
  weight    — 0..1 — how load-bearing this is. Drives underline thickness for phrase-scope; doesn't affect pill scope.
  concept   — CANONICAL ≤4-word noun phrase for the UNDERLYING IDEA this
              annotation is about. STABLE across surfaces — the same idea
              referenced anywhere in the workspace (parent objective,
              sub-objective, entity name) MUST share this concept string.
              Distinct from "phrase" (the verbatim text) — e.g. phrase
              "vivid experiences" → concept "Vivid experience"; phrase
              "ai personalization" → concept "AI personalization".
              Use Title Case. Strip determiners/articles. The system
              slugifies this for cross-surface trace-back. Emit null ONLY
              if no clean canonical noun phrase exists.

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
  - 7-9 annotations TOTAL split per the SCOPE QUOTA above (4-6 word-scope + 2-3 phrase-scope). Quality over coverage.
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
  /** O1 — Utility signal (phrase → count of items deriving from it).
   *  When present, the generator should PRESERVE high-utility v1
   *  phrases (≥2 derivations) and bias against zero-utility orphans.
   *  Soft signal — empty/undefined tolerated for cold-start runs. */
  priorUtility?: Array<{ phrase: string; count: number }>;
  /** #3 — Terms ALREADY defined at a higher altitude: the space
   *  glossary + the parent objective's own annotations. When present
   *  and non-empty, this call is a ROOM lens (not the top-level
   *  objective lens): the generator must NOT re-annotate these
   *  macro/glossary terms — the user already set them on the main
   *  objective page — and must instead surface terms that are NEW to
   *  this room or whose concrete referent is AMBIGUOUS in this room's
   *  context ("what does 'model' technically correspond to HERE?").
   *  Empty/undefined ⇒ top-level lens, original 7-9 behavior unchanged. */
  alreadyCovered?: { terms: string[] };
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

  // O1 — Utility signal. Surface the user's REVEALED reliance on
  // specific v1 phrases. The generator preserves high-utility phrases
  // (the user's strategy work has been derived from them) and treats
  // orphaned phrases as suspect (worth reframing or merging).
  const utility = args.priorUtility ?? [];
  const reinforced = utility.filter((u) => u.count >= 2);
  const orphans = utility.filter((u) => u.count === 0);
  const utilityBlock =
    utility.length > 0 && (reinforced.length > 0 || orphans.length > 0)
      ? `\n\nUTILITY SIGNAL (your prior annotation phrases + how many items across rooms derive from each — the user's actual reliance):${
          reinforced.length > 0
            ? `\n  HIGH-UTILITY (≥2 items derive — PRESERVE these phrases as annotation slots, even if you reframe the reading):\n${reinforced
                .slice(0, 6)
                .map((u) => `    • "${u.phrase.slice(0, 60)}" (${u.count})`)
                .join("\n")}`
            : ""
        }${
          orphans.length > 0
            ? `\n  ORPHANED (0 items derive — suspect; either find a sharper reading, merge into a neighbor, or drop):\n${orphans
                .slice(0, 6)
                .map((u) => `    • "${u.phrase.slice(0, 60)}"`)
                .join("\n")}`
            : ""
        }\n  UTILITY RULE: When phrases are HIGH-UTILITY, treat them as anchors — your output should include the same phrase (or its sub-phrase) as an annotation slot so the user's existing derivations don't go orphan. When phrases are ORPHANED, you have permission to drop or reframe them.`
      : "";

  // #3 — ROOM-LENS MODE. When the caller passes already-covered terms
  // (glossary + parent-objective annotations), this is a room lens, not
  // the macro objective lens. De-dupe case-insensitively (keep first
  // casing), cap so the prompt stays tight.
  const seenCovered = new Set<string>();
  const coveredUnique: string[] = [];
  for (const raw of args.alreadyCovered?.terms ?? []) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t) continue;
    const k = t.toLowerCase();
    if (seenCovered.has(k)) continue;
    seenCovered.add(k);
    coveredUnique.push(t);
    if (coveredUnique.length >= 48) break;
  }
  const roomLens = coveredUnique.length > 0;
  const roomLensBlock = roomLens
    ? `\n\n⚠ ROOM-LENS MODE — OVERRIDES the "7-9 total" target AND the 4-6 / 2-3 scope quota in the system prompt.
This text is ONE ROOM inside a larger objective, NOT the top-level objective. The terms below are ALREADY DEFINED at a higher altitude (the space glossary + the parent objective's own annotations). The user has explicitly said these are redundant here — do NOT re-highlight them.

ALREADY DEFINED — DO NOT ANNOTATE (skip the term itself AND its close synonyms / obvious restatements):
${coveredUnique.map((t) => `  • ${t}`).join("\n")}

INSTEAD annotate ONLY what is genuinely ROOM-SPECIFIC:
  1. Terms present in THIS room's text but ABSENT from the list above.
  2. Terms that are generic at the macro level but become CONCRETE-yet-AMBIGUOUS here — commit to "what does this word technically correspond to IN THIS ROOM?" (e.g. "model" → which model, trained on what inputs, predicting what output?). The reading must name the room-level referent, never restate a dictionary sense.
  3. SKIP anything that is just the macro objective restated.

COUNT: emit ONLY as many as are truly room-new + load-bearing — typically 3-6, fewer is fine. DO NOT pad to a quota. Three sharp room-specific readings beat nine redundant ones. The word/phrase split is a guideline here, not a binding quota.`
    : "";

  const closing = roomLens
    ? `Produce a ROOM lens per the ROOM-LENS MODE block above: only room-new / room-ambiguous terms, typically 3-6, no padding, no re-annotating already-defined terms. Each phrase must be a verbatim substring of the text above.`
    : `Produce 7-9 RICH annotations per the system instructions: 4-6 word-scope (loaded concept words) AND 2-3 phrase-scope (multi-word interpretive units from text NOT covered by the word-scope picks). Each phrase must be a verbatim substring of the text above. Both layers are required — shipping only word-scope is a regression.`;

  return `CORE OBJECTIVE (user's typed text):
"""
${args.objective}
"""${subBlock}${utilityBlock}${roomLensBlock}

${closing}`;
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
            // Phase 2 (concept_slug trace-back) — canonical ≤4-word noun
            // phrase for the underlying idea. Slugified downstream as
            // the stable join key between annotation popovers and the
            // space glossary. Nullable for back-compat with v3 rows;
            // normalizer falls back to slugify(phrase) when absent.
            concept: { type: ["string", "null"] },
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
            "concept",
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
