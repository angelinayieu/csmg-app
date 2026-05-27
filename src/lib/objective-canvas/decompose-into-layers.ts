// ── Decompose Into Layers ────────────────────────────────────────
//
// Phase 11.A — the LLM bridge that produces an ObjectiveStack from
// the user's objective text + clarifying answers. Fires at the
// clarifying→picking transition (alongside sub-objective proposal)
// so the picker page can render the Objective Stack widget above
// the proposal list.
//
// One LLM call. Strict JSON schema. Soft-fail with a domain-generic
// fallback when the LLM errors out — we'd rather show a flat stack
// than crash the picker.
//
// Why a separate file vs. extending another generator:
//   • Different prompt shape — generates the structural skeleton
//     of the problem, not content within it. Variables are the leaves
//     of the stack; sub-objective proposals are how the user picks
//     where to work on the stack.
//   • Decoupled from sub-objective proposal so they can run in
//     parallel from the same trigger.

import { llmJSON } from "@/lib/llm";
import {
  normalizeObjectiveStack,
  type LayerDomainTemplate,
  type ObjectiveStack,
} from "./layer-model";
import { createHash } from "crypto";

export interface DecomposeIntoLayersContext {
  /** The objective the user typed. Required. */
  objectiveText: string;
  /** Clarifying questions the user answered. Empty array tolerated —
   *  the LLM will produce a more generic stack without this context. */
  clarifyingAnswers: Array<{ question: string; answer: string }>;
  /** Optional — when the canvas already has sub-objectives (e.g., the
   *  user is regenerating the stack post-confirm), pass them as
   *  context so the LLM can pick a stack that maps cleanly onto the
   *  existing picks rather than orthogonally to them. */
  existingSubObjectives?: Array<{ title: string; description: string }>;
}

const SYSTEM_PROMPT = `You are decomposing an objective into a causal layer stack. Layers
represent levels of abstraction in the problem — from foundational
substrate (Layer 1, bottom) to emergent outcome (Layer N, top).
Each layer has its own variables, but layers are causally chained.

Rules:

1. Pick ONE domain template based on the objective:
   • software         — for products, apps, technical systems
   • cognition_health — for mental, physical, behavioral health
   • business_ops     — for company / team / process improvements
   • behavior_change  — for personal habits, identity, routines
   • scientific       — for research, hypothesis testing, prediction
   • generic          — fallback when none clearly fits

2. Produce 4-6 layers. NEVER fewer than 4, never more than 6.
   - ordinal 1 = most foundational / substrate / inputs
   - ordinal N = most emergent / outputs / observable outcomes
   - Ordinals must be contiguous 1..N with no gaps.

3. Each layer has:
   - ordinal: integer (1..N)
   - name: 1-3 word domain-specific label using the user's vocabulary
   - description: 1 sentence definition of what this layer is
   - archetype: one of substrate / mechanism / process / output / outcome
       (matches the layer's role in the causal flow — substrate at L1,
       outcome at L_N, mechanism + process + output for the middle)
   - variables: 3-7 specific variables operating at this layer
       • id: snake_case slug (e.g., "sleep_cycles", "task_completion")
       • name: display label (e.g., "Sleep cycles")
       • description: 1-2 sentence definition specific to the objective
       • domain_tag: optional sub-cluster label (e.g., "biological",
         "structural") for visual grouping when a layer has many vars

4. Generate cross-layer influences explaining how layers connect.
   - Use adjacent pairs (L_n → L_(n+1)) for most.
   - Include 1-3 long-range ones (e.g., L_1 → L_N "measures") where
     they exist as real causal closures.
   - verb must match the relationship truthfully — don't say "produces"
     when the relationship is actually constraint or measurement.
   - Verb meanings:
     * enables     — L_n's state allows L_(n+1) to operate (compositional)
     * produces    — L_n's state directly outputs L_(n+1)'s state
     * depends_on  — L_(n+1) requires L_n as substrate (read upward)
     * constrains  — L_(n+1)'s state limits what L_n can do (top-down)
     * measures    — L_top is the measurement of L_lower (closure)
     * aggregates  — L_(n+1) is a rollup of multiple L_n signals
   - rationale (optional but encouraged): 1-sentence explanation of
     this specific influence.

5. template_rationale (1-2 sentences) explains why this template fits
   THIS objective. Surfaces as the tooltip on the stack widget.

Constraints:
- Variables must be SPECIFIC to the user's objective, not generic.
  Don't write "task" if the objective is about focus — write
  "deep work session" or whatever the user's domain calls it.
- Layer names should use the user's domain vocabulary.
- No more than 7 variables per layer (cognitive load cap).
- Influences should explain causal mechanism, not be tautological
  ("L1 enables L2 because L1 is at the bottom" — bad).

Return JSON matching the response schema. No prose outside JSON.`;

function buildUserPrompt(ctx: DecomposeIntoLayersContext): string {
  const clarifyingBlock = ctx.clarifyingAnswers.length > 0
    ? ctx.clarifyingAnswers
        .slice(0, 8)
        .map((qa) => `  Q: ${qa.question}\n  A: ${qa.answer}`)
        .join("\n\n")
    : "  [no clarifying answers provided]";

  const existingBlock = ctx.existingSubObjectives?.length
    ? `\nEXISTING SUB-OBJECTIVES (already-confirmed picks — use for context,
do NOT change layer count to fit them; tag them downstream):
${ctx.existingSubObjectives
  .slice(0, 12)
  .map(
    (s, i) =>
      `  ${i + 1}. ${s.title} — ${(s.description ?? "").slice(0, 240)}`,
  )
  .join("\n")}`
    : "";

  return `OBJECTIVE:
"""
${ctx.objectiveText.slice(0, 1500)}
"""

CLARIFYING ANSWERS:
${clarifyingBlock}
${existingBlock}

Decompose this objective into a causal layer stack per the system
instructions. Pick the domain template that best fits. Generate 4-6
layers with their variables + cross-layer influences.`;
}

/** Public entry. Returns an ObjectiveStack with computed state_hash.
 *  When the LLM call fails or returns a malformed structure, falls
 *  back to a generic 5-layer stack rather than throwing — the picker
 *  page can still render a baseline stack while the user retries. */
export async function decomposeIntoLayers(
  ctx: DecomposeIntoLayersContext,
): Promise<ObjectiveStack> {
  const stateHash = computeStateHash(ctx);
  try {
    const raw = await llmJSON({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(ctx),
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.4,
      maxTokens: 3600,
    });
    const stack = normalizeObjectiveStack(raw);
    if (!stack) {
      console.warn(
        "[decompose-into-layers] LLM returned malformed stack — falling back to generic",
      );
      return { ...buildGenericFallbackStack(ctx), state_hash: stateHash };
    }
    return { ...stack, state_hash: stateHash };
  } catch (err) {
    console.warn(
      "[decompose-into-layers] LLM call failed — falling back to generic:",
      err instanceof Error ? err.message : String(err),
    );
    return { ...buildGenericFallbackStack(ctx), state_hash: stateHash };
  }
}

// ── State hash — staleness detection ────────────────────────────

/** Derive a stable hash from the inputs that drive the stack. When
 *  the user changes their objective text or re-answers clarifying
 *  questions, the hash changes, and the UI can flag the stack as
 *  stale. Doesn't include sub-objectives — those are downstream. */
function computeStateHash(ctx: DecomposeIntoLayersContext): string {
  const payload = {
    objective: ctx.objectiveText.trim(),
    clarifying: ctx.clarifyingAnswers.map((qa) => ({
      q: qa.question.trim(),
      a: qa.answer.trim(),
    })),
  };
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 16);
}

// ── Fallback — generic 5-layer stack when LLM fails ─────────────

/** Domain-generic substrate→outcome stack. Used as a fallback so
 *  the picker page is never empty. The user can regenerate to get
 *  a real domain-specific decomposition. */
function buildGenericFallbackStack(
  ctx: DecomposeIntoLayersContext,
): ObjectiveStack {
  return {
    domain_template: "generic" as LayerDomainTemplate,
    template_rationale:
      "Generic substrate→outcome stack (LLM decomposition failed; regenerate to get a domain-specific stack).",
    layers: [
      {
        id: "L1",
        ordinal: 1,
        name: "Substrate",
        description: "Foundational inputs the user can adjust directly.",
        archetype: "substrate",
        variables: [
          {
            id: "input_resources",
            name: "Input resources",
            description: "Time, attention, money, or other consumables the user allocates.",
          },
          {
            id: "environmental_conditions",
            name: "Environmental conditions",
            description: "External constraints + supports that shape what's possible.",
          },
          {
            id: "starting_state",
            name: "Starting state",
            description: "The user's current baseline along the objective's primary axis.",
          },
        ],
      },
      {
        id: "L2",
        ordinal: 2,
        name: "Mechanism",
        description: "Levers the user pulls to convert inputs into change.",
        archetype: "mechanism",
        variables: [
          {
            id: "primary_levers",
            name: "Primary levers",
            description: "The user's main interventions on the substrate.",
          },
          {
            id: "supporting_systems",
            name: "Supporting systems",
            description: "Habits, tools, or routines that sustain the primary levers.",
          },
        ],
      },
      {
        id: "L3",
        ordinal: 3,
        name: "Process",
        description: "How the mechanisms execute over time.",
        archetype: "process",
        variables: [
          {
            id: "execution_pattern",
            name: "Execution pattern",
            description: "Frequency, intensity, and consistency of mechanism application.",
          },
          {
            id: "adaptation_loop",
            name: "Adaptation loop",
            description: "How feedback shapes the next iteration.",
          },
        ],
      },
      {
        id: "L4",
        ordinal: 4,
        name: "Output",
        description: "Observable signals the process produces.",
        archetype: "output",
        variables: [
          {
            id: "measurable_signals",
            name: "Measurable signals",
            description: "What the user can track week-over-week to see if it's working.",
          },
          {
            id: "qualitative_indicators",
            name: "Qualitative indicators",
            description: "How the user feels about progress — soft but real signal.",
          },
        ],
      },
      {
        id: "L5",
        ordinal: 5,
        name: "Outcome",
        description: "The strategic goal — what the user is ultimately optimizing.",
        archetype: "outcome",
        variables: [
          {
            id: "primary_outcome",
            name: "Primary outcome",
            description: "The single most-important change the user is seeking.",
          },
          {
            id: "secondary_outcome",
            name: "Secondary outcome",
            description: "Adjacent benefit the user also values.",
          },
        ],
      },
    ],
    influences: [
      { from_layer: 1, to_layer: 2, verb: "enables", rationale: "Substrate availability gates which mechanisms are even viable." },
      { from_layer: 2, to_layer: 3, verb: "produces", rationale: "Mechanisms execute as a process over time." },
      { from_layer: 3, to_layer: 4, verb: "produces", rationale: "Process execution yields observable outputs." },
      { from_layer: 4, to_layer: 5, verb: "aggregates", rationale: "Outputs roll up into the strategic outcome over time." },
      { from_layer: 5, to_layer: 1, verb: "measures", rationale: "Outcome trajectory is the long-term signal the user reads back to recalibrate substrate." },
    ],
    generated_at: new Date().toISOString(),
    state_hash: "",
  };
  // Note: state_hash empty here — the caller fills it from ctx so the
  // hash stays consistent with the inputs that produced the fallback.
}

// ── Response schema (strict JSON) ────────────────────────────────

const RESPONSE_SCHEMA = {
  name: "objective_layer_decomposition",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      domain_template: {
        type: "string",
        enum: [
          "software",
          "cognition_health",
          "business_ops",
          "behavior_change",
          "scientific",
          "generic",
        ],
      },
      template_rationale: { type: "string" },
      layers: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            ordinal: { type: "integer" },
            name: { type: "string" },
            description: { type: "string" },
            archetype: {
              type: "string",
              enum: ["substrate", "mechanism", "process", "output", "outcome"],
            },
            variables: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  description: { type: "string" },
                  domain_tag: { type: "string" },
                },
                required: ["id", "name", "description", "domain_tag"],
              },
            },
          },
          required: ["ordinal", "name", "description", "archetype", "variables"],
        },
      },
      influences: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            from_layer: { type: "integer" },
            to_layer: { type: "integer" },
            verb: {
              type: "string",
              enum: [
                "enables",
                "produces",
                "depends_on",
                "constrains",
                "measures",
                "aggregates",
              ],
            },
            rationale: { type: "string" },
          },
          required: ["from_layer", "to_layer", "verb", "rationale"],
        },
      },
    },
    required: ["domain_template", "template_rationale", "layers", "influences"],
  },
};
