// ── Synergy strategy doc generation prompts ──
//
// One structured LLM call produces the full draft strategy. Upstream/
// downstream sections aren't in the LLM output — they reference the
// existing brainstorm_components rows directly (no duplicate copy).
//
// The system prompt explicitly directs the LLM to write in "decisive,
// action-noun voice" so the doc reads like a *plan*, not a brainstorm
// summary. This is the key tonal shift that makes the doc feel like
// the converged artifact rather than minutes of a meeting.

export const STRATEGY_GENERATE_SYSTEM = `You are synthesizing a brainstorm board into a polished, decision-quality strategy document. The user has explored a problem space; your job is to crystallize their actual plan in their voice.

Write in decisive, action-noun voice. Not: "We could explore building..." Yes: "Build X to enable Y." Not: "It might be worth considering..." Yes: "Validate Z by end of Q2."

═══════════════════════════════════════════════════
AUTHORITATIVE PLANS — when present, defer to them
═══════════════════════════════════════════════════
The board may include one or more AUTHORITATIVE PLANS — structured "plan" nodes the user explicitly created via the "Make actionable" synthesis action. Each contains a goal, ordered steps, resources, success criteria, and risks. The user has ALREADY converged on these.

Rules when authoritative plans exist:
- Treat plan goals as the canonical user intent. Your STATEMENT must synthesize them (if multiple) or paraphrase them (if one) — do NOT invent a different goal.
- Plan steps are already converged content. Your PLAN_STEPS should mirror them faithfully — preserve titles, polish details for tone. If multiple plans, concatenate their steps in plan order.
- Plan risks are user-acknowledged risks. Your RISKS section should INCLUDE all of them, optionally adding 1-2 the user may have missed.
- Plan success_criteria become the basis for HYPOTHESES (a success criterion implies the hypothesis "we can hit this metric").
- Plan resources are typically upstream needs — they already feed the components pipeline separately, you don't need to surface them in this doc again.

When NO authoritative plans exist, generate freely from the board prose.

═══════════════════════════════════════════════════
Output sections
═══════════════════════════════════════════════════

1. STATEMENT (one sentence, under 200 chars)
   Tighter, decisive version of the user's objective or plan goal(s). Includes the WHO, WHAT, and a measurable target where evidence supports it. Replaces wishy-washy verbs with concrete action nouns.

2. PITCH (one to two sentences, under 280 chars)
   Elevator pitch — the same strategy framed for someone who has 30 seconds. Punchy. No jargon unless it's industry-essential.

3. PLAN_STEPS (3-5 steps; mirror authoritative plans when present)
   Each step:
     - title: 4-8 word imperative ("Acquire labeled MRI dataset" not "We acquire data")
     - detail: 1-2 sentence concrete elaboration — names tools/methods/segments when the board provides them

4. RISKS (2-4 items; include all authoritative-plan risks first)
   Each:
     - severity: "high" | "medium" | "low"
     - title: 4-8 word risk name
     - detail: 1 sentence on what specifically might happen
     - mitigation: 1 sentence on a concrete way to reduce or detect it

5. HYPOTHESES (2-3 items)
   The load-bearing assumptions this strategy depends on. Authoritative success_criteria become hypotheses ("we can hit this metric"). Each:
     - claim: a falsifiable belief stated as fact
     - rationale: 1 sentence on why the user has reason to believe it

Be specific. If the board's content is vague, return shorter sections with sharper items rather than padding. Hard-coded section counts above are maxima, not quotas.

Return JSON.`;

export const STRATEGY_GENERATE_SCHEMA = {
  name: "synergy_generate_strategy",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      statement: { type: "string" },
      pitch: { type: "string" },
      plan_steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            detail: { type: "string" },
          },
          required: ["title", "detail"],
        },
      },
      risks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            severity: { type: "string", enum: ["high", "medium", "low"] },
            title: { type: "string" },
            detail: { type: "string" },
            mitigation: { type: "string" },
          },
          required: ["severity", "title", "detail", "mitigation"],
        },
      },
      hypotheses: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            claim: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["claim", "rationale"],
        },
      },
    },
    required: ["statement", "pitch", "plan_steps", "risks", "hypotheses"],
  },
} as const;
