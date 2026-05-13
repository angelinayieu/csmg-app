// ── Strategy-from-prompt orchestrator prompts ──
//
// The strategy-from-prompt pipeline is "0-to-doc in one shot":
// given a free-form description, synthesize a converged brainstorm,
// extract typed components, and crystallize a strategy doc — all
// without a manual brainstorming step.
//
// This file holds the SYNTHETIC BRAINSTORM prompt — the seed step
// that fabricates a plausible converged board the rest of the
// pipeline can consume. Subsequent stages reuse the existing
// extract + strategy-generate prompts (which are already plan-aware,
// so the synthetic plan card we emit drives the downstream behavior).

export const SYNTHESIZE_FROM_PROMPT_SYSTEM = `You are scaffolding a converged brainstorm from a single user prompt. The output simulates what a thoughtful person would arrive at after 30 minutes of structured ideation — but you produce it in one shot.

The user has described what they want to build / explore / pursue in 1-3 sentences. Your job: emit a JSON object containing:

1. objective_statement (under 200 chars)
   The decisive, action-noun version of their stated intent. Names the WHO + WHAT + ideally a measurable target.

2. objective_constraints (0-4 items, each under 120 chars)
   Real-world constraints implied by the prompt. Don't invent — only surface what's hinted at.

3. objective_success_criteria (0-4 items, each under 120 chars)
   What "we did it" looks like. Prefer measurable.

4. core_concept (under 200 chars)
   The central idea, framed as a noun phrase. Becomes the "core" node label.

5. branches (3-6 items)
   The main exploration threads. Each:
     - label: 3-8 word concept name
     - rationale: 1 sentence on why this thread matters
   Cover the orthogonal dimensions of the problem space — upstream needs, downstream uses, mechanisms, risks, audiences.

6. plan_goal (under 200 chars)
   The user's converged "what we're doing" — synthesized from the prompt + branches. This becomes a plan-kind node so the downstream extractor treats this content as AUTHORITATIVE.

7. plan_steps (3-5 items)
   Ordered actions. Each:
     - label: 4-8 word imperative
     - rationale: 1 sentence concrete elaboration with at least one specific (tool / method / audience / metric)

8. plan_resources (2-5 items, each under 100 chars)
   Upstream needs — data, skills, tools, capital, audience, partnerships. These drive the matcher's upstream components.

9. plan_success_criteria (2-4 items, each under 100 chars)
   Measurable outcomes. Quantified where the prompt supports it.

10. plan_risks (2-4 items)
    Each:
      - risk: one sentence — what could derail this
      - mitigation: one sentence — concrete tactic

CRITICAL guidance:
- Be decisive. Use action-noun voice ("Build…" not "We could explore…").
- Don't pad. Fewer sharp items beats many vague ones.
- Don't invent specifics the prompt doesn't justify. If the prompt is vague on audience, leave audience generic.
- This output will be persisted as a synthesized brainstorm — the user will see it on their whiteboard and be able to edit/expand from there.

Return JSON only.`;

export const SYNTHESIZE_FROM_PROMPT_SCHEMA = {
  name: "synergy_synthesize_from_prompt",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      objective_statement: { type: "string" },
      objective_constraints: { type: "array", items: { type: "string" } },
      objective_success_criteria: { type: "array", items: { type: "string" } },
      core_concept: { type: "string" },
      branches: {
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
      plan_goal: { type: "string" },
      plan_steps: {
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
      plan_resources: { type: "array", items: { type: "string" } },
      plan_success_criteria: { type: "array", items: { type: "string" } },
      plan_risks: {
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
    required: [
      "objective_statement",
      "objective_constraints",
      "objective_success_criteria",
      "core_concept",
      "branches",
      "plan_goal",
      "plan_steps",
      "plan_resources",
      "plan_success_criteria",
      "plan_risks",
    ],
  },
} as const;
