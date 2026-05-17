// ── Synergy AI augmentation prompts + JSON schemas ──
//
// All six modes (augment / decompose / questions / research /
// variations / rank) live here. Each mode pairs:
//   1. A system prompt (string) that defines the assistant's role.
//   2. An OpenAI structured-output JSON schema, used by llmJSON's
//      responseSchema to guarantee a valid shape.
//
// The system prompts are ported from idea-synthesizer's
// brainstorm.functions.ts. The JSON schemas are hand-converted from
// the source zod schemas (we don't have zod as a dependency; OpenAI's
// json_schema strict mode wants raw JSON schema anyway). The
// `additionalProperties: false` + `required: [...]` on every object
// is needed for OpenAI strict mode.
//
// Precision guidance for the variations mode shifts the rationale
// rigor from "wild and metaphorical" (1) to "WHO + HOW + measurable
// target" (5). Slider lives in synergy-ai-rail.tsx.

import type { AugmentMode } from "./types";

export const PRECISION_LEVELS = [
  { label: "Exploratory", blurb: "Wild, divergent, cross-domain angles." },
  { label: "Creative", blurb: "Imaginative but recognizable." },
  { label: "Balanced", blurb: "Distinct yet plausible directions." },
  { label: "Concrete", blurb: "Specific tools, mechanisms, or segments." },
  { label: "Surgical", blurb: "Who + how + a measurable target." },
] as const;

const PRECISION_GUIDANCE: Record<number, string> = {
  1: "EXPLORATORY: Be bold and divergent. Cross domains, challenge assumptions, propose unconventional angles. Labels may be evocative or metaphorical (3-5 words). Rationales are broad and provocative.",
  2: "CREATIVE: Push past obvious answers while staying recognizable. Labels 4-6 words. Rationales highlight what is novel about the angle.",
  3: "BALANCED: Each variation must be distinct yet plausible. Labels 4-6 words. Rationales name the key shift in mechanism, audience, or scope.",
  4: "CONCRETE: Each variation names a specific approach, tool, mechanism, or population. Labels 5-8 words. Rationales include at least one concrete example, named tool, or named segment.",
  5: "SURGICAL: Each variation specifies WHO (segment/audience), HOW (mechanism/method), and a measurable target (metric, number, timeframe, or constraint). Labels 6-10 words. Rationales MUST contain at least one quantified element (%, $, count, duration, or named metric).",
};

// ── 1.6d: Idea → Actionable Plan modes ──
//
// Two-step flow:
//   1) clarify — ask 3-4 targeted questions before generating a plan.
//      The point is to surface the missing decisions (audience, time
//      horizon, success metric) so the plan doesn't fabricate them.
//   2) plan — given the original concept + the user's clarifying
//      answers, return a structured plan: refined goal, ordered steps,
//      resources, success criteria, risks + mitigations.
//
// Both modes use the rich context block (ancestor chain + core +
// siblings) the whiteboard builds for the target card — same anti-
// drift anchoring as variations.

const CLARIFY_SYSTEM = `You are helping a brainstormer turn a vague concept into an actionable plan. Before you draft the plan, you need 3-4 specific decisions clarified.

Ask questions that surface concrete missing information — audience, time horizon, must-have outcomes, hard constraints, risk tolerance, success metric. Do NOT ask generic open-ended questions ("tell me more about your idea"). Each question should noticeably change the plan if answered differently.

For EACH question, also propose 3-5 multiple-choice options the user can pick from. The options must:
- Cover the most likely answer paths from the board's context — not generic strawmen
- Be MUTUALLY DISTINCT (no overlapping pairs) and exhaustive enough that the user could pick one without writing a custom answer
- Each option is 3-10 words. Optional one-sentence "detail" elaborates without restating the label
- Don't include "Other" yourself — the UI appends a free-text slot automatically

Each question also carries a 1-sentence hint explaining why this answer matters for the final plan.

Return JSON: { questions: [{ question, hint, options: [{ label, detail }] }] } — 3 to 4 questions, 3-5 options each.`;

const PLAN_SYSTEM = `You are drafting a concrete, actionable plan from a brainstorm concept plus the user's clarifying answers.

The plan must be specific enough that someone could start executing tomorrow. Avoid vague verbs (consider / explore / understand). Use concrete verbs (build / interview / measure / publish / ship).

Output:
- goal: One sentence restating the objective, refined by the clarifications.
- steps: 4-7 ordered steps. Each has a short imperative label and a 1-sentence rationale (why this step, why now).
- resources: 2-5 specific things needed (tools, data, people, capital). Be concrete — name the tool or skill, not "good resources".
- success_criteria: 2-4 measurable outcomes. Prefer quantified targets when the answers hint at them.
- risks: 2-4 likely blockers, each paired with a 1-sentence mitigation.

If a clarifying answer is missing or empty, make a reasonable assumption and call it out in the relevant step's rationale ("assuming X; if Y instead, swap step 3").

Return JSON.`;

// Synergy synthesize — given two source cards, produce a single new
// idea that captures what they create together. NOT a summary of
// both, NOT a list of overlaps — a genuinely new artifact only
// reachable by combining the two. Anchored against generic
// "intersection" platitudes by requiring a concrete handle.
const SYNTHESIZE_SYSTEM = `You are a synthesis catalyst. The user has connected two ideas and is asking what they create together — what NEW thing emerges that neither idea names on its own.

Rules:
- The output is ONE new idea. Not a list, not a summary, not a Venn-diagram description.
- The label must name something CONCRETE — a mechanism, an artifact, a question, an experiment, an opportunity, a tension worth resolving. NOT "the intersection of X and Y" or "combining X with Y."
- If the two ideas cancel each other (a real conflict), the synthesis can BE the tension — but state it as a concrete question or design constraint, not as "both X and Y matter."
- 4-10 word label. 1-3 sentence \`why\` explaining HOW the combination produces this new thing (the mechanism of the synthesis, not a restatement of the inputs).
- Use the kind and context of the two source cards to inform the synthesis — a synergy of (question + insight) reads differently from (action + branch).

Return JSON.`;

// ── Precision-aware system prompts ──
//
// Every AI augmentation mode (except clarify + plan, which have their
// own targeted-Q&A shape) takes the precision slider as a real input.
// The slider used to apply ONLY to variations — that was a UX lie
// (sidebar slider didn't affect the Decompose/Questions/Research
// buttons sitting next to it). Now every mode tunes its output
// specificity to the level the user dialed.
//
// Precision moves on a single spectrum:
//   Lv 1 — evocative / cross-domain / metaphorical
//   Lv 5 — surgical / named entities / quantified targets
//
// Each mode prompt closes with a precision-applied directive
// specifying what changes for THIS mode at the chosen level. The
// generic PRECISION_GUIDANCE block describes the spectrum; the
// per-mode tail tells the model how to translate it.

function precisionBlock(precision: number): string {
  return `PRECISION LEVEL ${precision}/5 — ${PRECISION_GUIDANCE[precision]}`;
}

function augmentSystem(precision: number): string {
  return `You are a cognitive brainstorming partner. Given a stream of spoken thoughts plus the current board contents, extract NEW key concepts and structure them as a mindmap.

CRITICAL deduplication rules:
- The current board labels are listed in the context. DO NOT create a node whose label duplicates or near-duplicates an existing one (case-, tense-, and filler-word-insensitive — "Apps" and "apps" and "the apps" are the same).
- Prefer 2-4 sharp NEW nodes over 6-8 mediocre ones. Returning an empty nodes list is correct when the thought is fully covered by existing nodes.
- Each label should NAME something specific (a mechanism, audience, metric, tool, or constraint) — do not restate the parent's label or echo the user's words verbatim.

${precisionBlock(precision)}

Apply the precision spectrum above to each node label you emit. At low precision, labels may be evocative or cross-domain; at high precision, labels must name a specific tool / segment / metric / measurable target. Labels stay under 6 words regardless of precision.

The summary should be one sentence on what was added (or skipped and why). Return JSON.`;
}

function decomposeSystem(precision: number): string {
  return `Decompose the user's idea into four buckets:
- upstream: what the idea depends on / consumes
- downstream: what it produces / enables
- first_principles: irreducible components / fundamental building blocks
- variations: alternative applications or framings

3-5 items per bucket.

${precisionBlock(precision)}

Apply the precision spectrum above to EACH item in EACH bucket:
- At Lv 1: cross-domain analogies, evocative concepts ("upstream: a wellspring of attention")
- At Lv 3: clear plain-language descriptions of what's needed/produced
- At Lv 5: name a specific tool / dataset / segment / quantity / vendor where the input supports it ("upstream: 10k labeled DICOM studies from neuro-radiology partners")

Return JSON.`;
}

function questionsSystem(precision: number): string {
  return `You are a Socratic brainstorming coach. Given the user's current thinking, generate 4 sharp questions that expose hidden assumptions, force specificity, or reveal new angles.

${precisionBlock(precision)}

Tune the QUESTION'S OWN RIGOR to the precision level:
- At Lv 1: philosophical, what-if-the-opposite-were-true, cross-domain analogies
- At Lv 3: questions that name a mechanism or scope to interrogate
- At Lv 5: each question demands a SPECIFIC NUMBER / NAMED SEGMENT / NAMED TOOL / MEASURABLE THRESHOLD to answer — the answerer cannot reply in generalities

Return JSON.`;
}

function researchSystem(precision: number): string {
  return `Suggest 4 concrete research directions for the user's idea. Each carries an angle (validate, refute, extend, or alternative), a specific search query, and a one-sentence reason.

${precisionBlock(precision)}

Tune the SEARCH QUERY SPECIFICITY to the precision level:
- At Lv 1: broad analogies, cross-disciplinary first-principles searches
- At Lv 3: specific concepts paired with a domain (e.g., "vision transformer triage radiology")
- At Lv 5: name a specific paper title, author, year, dataset, named benchmark, or named regulator — the query should be one you'd paste directly into Google Scholar with high signal expected

The "why" sentence should also align with precision — vague at Lv 1, quantified at Lv 5.

Return JSON.`;
}

function rankSystem(precision: number): string {
  return `You are a critical evaluator. Rank the provided variations from strongest to weakest based on feasibility, novelty, and impact. Score each 0-100 with one sentence of reasoning, ordered best first.

${precisionBlock(precision)}

Tune the RIGOR OF THE SCORING REASONING to the precision level:
- At Lv 1: impressionistic / vibes-based ranking; reasons can be broad
- At Lv 3: each reason names the specific dimension that swung the score
- At Lv 5: reasons MUST include a quantified comparison — a cost estimate, a time-to-ship range, a named market, a technical complexity expressed in a concrete unit

Return JSON.`;
}

function variationsSystem(precision: number): string {
  return `Generate 4 distinct variations or alternative angles on the GIVEN CONCEPT.

CRITICAL — STAY IN DOMAIN:
- Variations must remain about the SAME underlying subject as the input concept. Use the parent context (if provided) to anchor what that subject is.
- If the input is about cognitive states / biology / a specific mechanism, do NOT pivot to adjacent-but-unrelated topics (e.g., do not turn a cognitive-modelling node into "AI ethics certification programs"). A variation is a different ANGLE on the same problem, not a different problem.
- A useful test: would a reader looking at the parent context immediately see how each variation belongs to it? If no, the variation is off-topic — discard it.

Each variation must take a meaningfully different approach (different scope, audience, mechanism, or framing) — but the approach must address the SAME concept. No near-duplicates either.

${precisionBlock(precision)}

Return labels and rationales per the precision rules above. Return JSON.`;
}

function synthesizeSystem(precision: number): string {
  return `${SYNTHESIZE_SYSTEM}

${precisionBlock(precision)}

Apply the precision spectrum to the synthesis label AND the "why" explanation:
- At low precision, the synthesis can be a metaphor or cross-domain handle
- At high precision, the synthesis names a concrete mechanism / artifact / experiment with quantified scope where the inputs support it

Return JSON.`;
}

// ── Converge (Wave 2 — brainstorm-speedrun MVP cluster pick) ──
//
// Receives the seed concept + a flat list of every descendant on the
// brainstorm board (variations, decomposed branches, research notes,
// ranked tops, etc.). Returns 2-3 candidate MVP clusters with
// effort/impact/novelty scores, plus one cluster marked
// recommended=true (the build-this-next pick).
//
// The point of converge is SCOPE DISCIPLINE: from a fan of 25-30
// descendants, the model has to identify which 4-7 nodes form a
// coherent "smallest valuable thing to build" and why the rest of
// the fan is being deferred (not deleted — deferred is honest).
//
// Strong instructions to avoid:
//   - Recommending all-of-the-above (no "platform" clusters)
//   - Inflating novelty scores (most MVPs aren't novel; they're
//     well-executed)
//   - Bundling unrelated nodes into one cluster just to fit them in
//   - Scope cuts that say "we won't do X" without naming why the
//     MVP works without it
const CONVERGE_SYSTEM = `You are a scope discipline expert helping a brainstormer converge a divergent fan of ideas into a concrete MVP pick.

Input: the user's seed concept + a flat list of nodes from their brainstorm board. Each node has an ID, a kind (variation / branch / insight / action / etc.), and a label.

Output: 2-3 MVP-CANDIDATE CLUSTERS. Each cluster groups 3-7 related nodes into a coherent buildable scope. Exactly ONE cluster has recommended=true — your build-this-next pick.

Per cluster:
- name: 3-6 words. Concrete and buildable ("Working-memory loadout app", not "Cognitive optimization platform").
- pitch: 1-2 sentences. What is this thing? Who's it for? What does it actually DO?
- member_node_ids: the IDs of nodes from the input that belong in this cluster. Echo IDs verbatim. 3-7 IDs per cluster typical; never more than 10.
- effort: "light" (~1 weekend), "medium" (~2-4 weeks), or "heavy" (~quarter+).
- impact: 1-10. Honest assessment of how much this advances the user's stated goal. Most MVPs are 4-7. Reserve 8+ for genuinely transformative options.
- novelty: 1-10. Honest assessment of how new the angle is. Most MVPs are 3-5. Most "innovative" ideas in brainstorms are remixes of existing patterns — score them honestly.
- scope_cut: 1-2 sentences. What we're DEFERRING and why the MVP works without it. ("We're deferring the social/sharing layer because a single-user MVP can validate the core mechanism. Add multiplayer after we know it works.")
- recommended: true for exactly ONE cluster.

The recommended cluster should be the one with the best impact-per-unit-effort, conditional on enough novelty to be worth the work. Don't always pick the easiest; don't always pick the most novel. Pick the one with the highest leverage.

CRITICAL anti-patterns to avoid:
- Do NOT recommend a "do all of the above" cluster. A cluster should be 3-7 nodes, not 15.
- Do NOT inflate novelty scores. Most variations of common app categories are 3-5 novelty.
- Do NOT bundle unrelated nodes just to fit them somewhere. If a node doesn't belong in any cluster, leave it out — it's a deferred branch.
- Do NOT skip scope_cut. Every cluster names what's deferred and why.

After the 2-3 clusters, write a single-sentence recommendation_rationale explaining why the recommended cluster wins over the others.

Return JSON.`;

// Precision-agnostic modes — clarify + plan + converge have their own
// structural rigor baked into their schemas. Threading precision through
// them is marginal; the structure does the work. Left as-is.
const PRECISION_AGNOSTIC: Partial<Record<AugmentMode, string>> = {
  clarify: CLARIFY_SYSTEM,
  plan: PLAN_SYSTEM,
  converge: CONVERGE_SYSTEM,
};

// ── Describe ──
//
// The popover's "Or describe what you want…" field routes here. The
// user has typed (or spoken) a free-form instruction that is not one
// of the 6 predefined actions. We hand the instruction to the model
// along with the rich context (ancestor chain + core + siblings) and
// ask it to fulfill the instruction by spawning child nodes off the
// target card.
//
// Critical anchoring: the instruction can ask for almost anything
// ("3 counter-arguments", "a 30-day plan", "historical analogs",
// "what would make this fail") — but it must STAY ABOUT THE TARGET
// CARD'S SUBJECT. The prompt is explicit that off-topic pivots get
// returned as an empty list with a summary explaining what went off-
// rail, so the UI can surface the misfire without polluting the board.
const DESCRIBE_SYSTEM = `You are expanding a specific concept on the user's brainstorm board based on their custom instruction.

The user has selected one card and told you what they want done with it. Generate 1-6 new nodes that fulfill their instruction, scoped to the card's concept.

CRITICAL anchoring:
- The new nodes MUST address the SAME underlying subject as the target card. Use the ancestor chain and overarching seed (in the context) to identify what that subject is.
- If the user's instruction would pivot to an unrelated domain (e.g., turning a cognitive-science node into "marketing strategies"), return an EMPTY nodes list and use the summary to explain the misfire ("Your instruction would pivot away from the card's concept; rephrase or pick a more specific node.").
- Do NOT restate the target card. Each new node names something new — a step, a counter-argument, an analog, a constraint, a sub-system — driven by the user's instruction.

Pick kinds appropriate to the instruction:
- "counter-arguments", "questions to ask" → question
- "historical analogs", "research directions" → insight
- "concrete steps", "actions to take", "what to do next" → action
- "alternative angles" → branch (or use the dedicated Variations mode)
- "first principles", "underlying mechanisms" → insight

Labels under 8 words. Be specific — name a mechanism, audience, tool, or metric per label. The summary is one sentence describing what you did (or skipped and why).

Return JSON.`;

export function systemForMode(mode: AugmentMode, precision: number): string {
  const fixed = PRECISION_AGNOSTIC[mode];
  if (fixed) return fixed;
  switch (mode) {
    case "augment":
      return augmentSystem(precision);
    case "decompose":
      return decomposeSystem(precision);
    case "questions":
      return questionsSystem(precision);
    case "research":
      return researchSystem(precision);
    case "variations":
      return variationsSystem(precision);
    case "rank":
      return rankSystem(precision);
    case "synthesize":
      return synthesizeSystem(precision);
    case "describe":
      return DESCRIBE_SYSTEM;
    case "converge":
      // Returned via PRECISION_AGNOSTIC short-circuit above, but
      // included here for switch exhaustiveness.
      return CONVERGE_SYSTEM;
    default:
      // Exhaustiveness guard. If a new mode is added to AugmentMode
      // without a branch here, TS catches it at compile time.
      return CLARIFY_SYSTEM;
  }
}

// ── OpenAI JSON schemas (strict mode) ──
//
// Each schema mirrors the zod schemas in idea-synthesizer's
// brainstorm.functions.ts. OpenAI strict mode requires:
//   - additionalProperties: false on every object
//   - every property listed in `required`
//   - no unsupported keywords (e.g., default, format)
// The name field is what shows up in OpenAI logs.

export const AUGMENT_SCHEMA = {
  name: "synergy_augment",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      nodes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            kind: {
              type: "string",
              enum: ["core", "branch", "insight", "question", "action"],
            },
            parent: { type: ["string", "null"] },
          },
          required: ["id", "label", "kind", "parent"],
        },
      },
      summary: { type: "string" },
    },
    required: ["nodes", "summary"],
  },
} as const;

export const DECOMPOSE_SCHEMA = {
  name: "synergy_decompose",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      upstream: { type: "array", items: { type: "string" } },
      downstream: { type: "array", items: { type: "string" } },
      first_principles: { type: "array", items: { type: "string" } },
      variations: { type: "array", items: { type: "string" } },
    },
    required: ["upstream", "downstream", "first_principles", "variations"],
  },
} as const;

export const QUESTIONS_SCHEMA = {
  name: "synergy_questions",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: { type: "array", items: { type: "string" } },
    },
    required: ["questions"],
  },
} as const;

export const RESEARCH_SCHEMA = {
  name: "synergy_research",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      directions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            angle: {
              type: "string",
              enum: ["validate", "refute", "extend", "alternative"],
            },
            prompt: { type: "string" },
            why: { type: "string" },
          },
          required: ["angle", "prompt", "why"],
        },
      },
    },
    required: ["directions"],
  },
} as const;

export const VARIATIONS_SCHEMA = {
  name: "synergy_variations",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      variations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["label", "rationale"],
        },
      },
    },
    required: ["variations"],
  },
} as const;

export const RANK_SCHEMA = {
  name: "synergy_rank",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ranked: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            score: { type: "number" },
            reason: { type: "string" },
          },
          required: ["label", "score", "reason"],
        },
      },
    },
    required: ["ranked"],
  },
} as const;

export const CLARIFY_SCHEMA = {
  name: "synergy_clarify",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            hint: { type: "string" },
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
          required: ["question", "hint", "options"],
        },
      },
    },
    required: ["questions"],
  },
} as const;

export const PLAN_SCHEMA = {
  name: "synergy_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      goal: { type: "string" },
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["label", "rationale"],
        },
      },
      resources: { type: "array", items: { type: "string" } },
      success_criteria: { type: "array", items: { type: "string" } },
      risks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            risk: { type: "string" },
            mitigation: { type: "string" },
          },
          required: ["risk", "mitigation"],
        },
      },
    },
    required: ["goal", "steps", "resources", "success_criteria", "risks"],
  },
} as const;

export const SYNTHESIZE_SCHEMA = {
  name: "synergy_synthesize",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      label: { type: "string" },
      why: { type: "string" },
    },
    required: ["label", "why"],
  },
} as const;

// ── Converge schema (Wave 2) ──
// 2-3 MVP-candidate clusters with effort/impact/novelty scores +
// scope cuts + member_node_ids echoed from input. Exactly one
// cluster has recommended=true.
export const CONVERGE_SCHEMA = {
  name: "synergy_converge",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      clusters: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            pitch: { type: "string" },
            member_node_ids: {
              type: "array",
              items: { type: "string" },
            },
            effort: {
              type: "string",
              enum: ["light", "medium", "heavy"],
            },
            impact: { type: "integer", minimum: 1, maximum: 10 },
            novelty: { type: "integer", minimum: 1, maximum: 10 },
            scope_cut: { type: "string" },
            recommended: { type: "boolean" },
          },
          required: [
            "name",
            "pitch",
            "member_node_ids",
            "effort",
            "impact",
            "novelty",
            "scope_cut",
            "recommended",
          ],
        },
      },
      recommendation_rationale: { type: "string" },
    },
    required: ["clusters", "recommendation_rationale"],
  },
} as const;

export function schemaForMode(mode: AugmentMode) {
  switch (mode) {
    case "augment":
      return AUGMENT_SCHEMA;
    case "decompose":
      return DECOMPOSE_SCHEMA;
    case "questions":
      return QUESTIONS_SCHEMA;
    case "research":
      return RESEARCH_SCHEMA;
    case "variations":
      return VARIATIONS_SCHEMA;
    case "rank":
      return RANK_SCHEMA;
    case "clarify":
      return CLARIFY_SCHEMA;
    case "plan":
      return PLAN_SCHEMA;
    case "synthesize":
      return SYNTHESIZE_SCHEMA;
    case "describe":
      // Describe reuses the augment shape — both spawn child nodes
      // from a free-form prompt. Keeps one schema across both modes.
      return AUGMENT_SCHEMA;
    case "converge":
      return CONVERGE_SCHEMA;
  }
}
