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

Ask questions that surface concrete missing information — audience, time horizon, must-have outcomes, hard constraints, risk tolerance, success metric. Do NOT ask generic open-ended questions ("tell me more about your idea"). Each question should be answerable in 1-2 sentences and should noticeably change the plan if answered differently.

Each question carries a 1-sentence hint explaining why this answer matters for the plan.

Return JSON: { questions: [{ question, hint }, ...] } — 3 to 4 items. Return JSON.`;

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

const SYSTEMS: Record<Exclude<AugmentMode, "variations">, string> = {
  augment: `You are a cognitive brainstorming partner. Given a stream of spoken thoughts plus the current board contents, extract NEW key concepts and structure them as a mindmap.

CRITICAL deduplication rules:
- The current board labels are listed in the context. DO NOT create a node whose label duplicates or near-duplicates an existing one (case-, tense-, and filler-word-insensitive — "Apps" and "apps" and "the apps" are the same).
- Prefer 2-4 sharp NEW nodes over 6-8 mediocre ones. Returning an empty nodes list is correct when the thought is fully covered by existing nodes.
- Each label should NAME something specific (a mechanism, audience, metric, tool, or constraint) — do not restate the parent's label or echo the user's words verbatim.

Labels under 6 words. Be incisive, not generic. The summary should be one sentence on what was added (or skipped and why). Return JSON.`,
  decompose: `Decompose the user's idea into upstream dependencies (what it needs) and downstream outputs (what it produces), plus first-principle components and alternative applications. 3-5 items per array. Return JSON.`,
  questions: `You are a Socratic brainstorming coach. Given the user's current thinking, generate 4 sharp questions that expose hidden assumptions, force specificity, or reveal new angles. Return JSON.`,
  research: `Suggest 4 concrete research directions for the user's idea. Each one has an angle (validate, refute, extend, or alternative), a specific search query, and a one-sentence reason. Return JSON.`,
  rank: `You are a critical evaluator. Rank the provided variations from strongest to weakest based on feasibility, novelty, and impact. Score each 0-100 with one sentence of reasoning, ordered best first. Return JSON.`,
  clarify: CLARIFY_SYSTEM,
  plan: PLAN_SYSTEM,
  synthesize: SYNTHESIZE_SYSTEM,
};

function variationsSystem(precision: number): string {
  return `Generate 4 distinct variations or alternative angles on the GIVEN CONCEPT.

CRITICAL — STAY IN DOMAIN:
- Variations must remain about the SAME underlying subject as the input concept. Use the parent context (if provided) to anchor what that subject is.
- If the input is about cognitive states / biology / a specific mechanism, do NOT pivot to adjacent-but-unrelated topics (e.g., do not turn a cognitive-modelling node into "AI ethics certification programs"). A variation is a different ANGLE on the same problem, not a different problem.
- A useful test: would a reader looking at the parent context immediately see how each variation belongs to it? If no, the variation is off-topic — discard it.

Each variation must take a meaningfully different approach (different scope, audience, mechanism, or framing) — but the approach must address the SAME concept. No near-duplicates either.

PRECISION LEVEL ${precision}/5 — ${PRECISION_GUIDANCE[precision]}

Return labels and rationales per the precision rules above. Return JSON.`;
}

export function systemForMode(mode: AugmentMode, precision: number): string {
  if (mode === "variations") return variationsSystem(precision);
  return SYSTEMS[mode];
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
          },
          required: ["question", "hint"],
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
  }
}
