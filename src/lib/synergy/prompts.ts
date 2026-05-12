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
};

function variationsSystem(precision: number): string {
  return `Generate 4 distinct variations or alternative angles on the given concept. Each variation must take a meaningfully different approach (different scope, audience, mechanism, or framing) — do not produce near-duplicates.

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
  }
}
