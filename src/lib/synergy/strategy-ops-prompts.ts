// ── Strategy doc — block-level AI op prompts ──
//
// Five micro-prompts driving the hover-revealed buttons on each block.
// Each call is targeted at a single block, so prompts are short and
// inputs are tiny. OpenAI strict JSON output across the board.
//
// Op → block type mapping:
//   expand_plan_step    → plan_step
//   expand_hypothesis   → hypothesis
//   find_evidence       → plan_step | hypothesis | risk
//   challenge           → plan_step | hypothesis
//   mitigate            → risk
//
// All prompts use action-noun voice to match the doc's overall tone.

// ── Expand a plan step ──
// Takes the step's title + detail; returns 2-4 concrete sub-steps the
// user could take. NOT a rewrite — these are downstream of the existing
// step. Stored in plan_step.meta.sub_steps.

export const EXPAND_PLAN_STEP_SYSTEM = `You are sharpening a plan step into concrete sub-steps the user can actually execute.

Input: one plan step (title + detail). The step is one of several in a larger strategy.

Output: 2-4 sub-steps that, together, would complete the parent step. Each sub-step:
- title: 4-8 word imperative ("Set up dev cluster" not "We could set up...")
- detail: 1 sentence concrete elaboration — names a tool, method, or measurable target if relevant

Do NOT restate the parent. Do NOT pad — 2 sharp sub-steps beats 4 vague ones. Return JSON.`;

export const EXPAND_PLAN_STEP_SCHEMA = {
  name: "synergy_expand_plan_step",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sub_steps: {
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
    },
    required: ["sub_steps"],
  },
} as const;

// ── Expand a hypothesis ──
// Takes the claim + rationale; returns 2-3 deeper supporting rationales
// or related sub-hypotheses. Stored in hypothesis.meta.supporting_rationales.

export const EXPAND_HYPOTHESIS_SYSTEM = `You are deepening a hypothesis by surfacing its supporting structure.

Input: one hypothesis (claim + rationale) from a larger strategy.

Output: 2-3 supporting rationales — deeper reasons this claim might be true. Each rationale is one sentence, names a specific mechanism or piece of evidence where possible.

Don't repeat the parent rationale. Each new rationale must add a distinct angle (mechanism / evidence / analogy). Return JSON.`;

export const EXPAND_HYPOTHESIS_SCHEMA = {
  name: "synergy_expand_hypothesis",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      supporting_rationales: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["supporting_rationales"],
  },
} as const;

// ── Find evidence ──
// Generates 2-3 specific source proposals: title + kind + summary +
// optional Google-search query. Each becomes a new evidence block in
// the doc, linked to the source via meta.supports_block_id.
//
// MVP doesn't fetch real URLs — the LLM proposes what to look for and
// the UI surfaces a Google search link. Phase 5+ can swap to real web
// search via the Responses API.

export const FIND_EVIDENCE_SYSTEM = `You are proposing specific evidence sources to validate (or refute) a single claim from a strategy doc.

Input: a block from the doc (plan step, hypothesis, or risk).

Output: 2-3 source proposals. Each:
- source_title: name a real-sounding source ("Smith et al. 2024" / "FDA guidance on..." / "GitHub: openai/whisper") — be specific even if you're not 100% sure it exists
- source_kind: one of "paper" | "article" | "github" | "dataset" | "regulation" | "blog" | "report"
- summary: one sentence on what this source would show that's relevant to the input block
- search_query: a concrete Google search query the user could run to find this source

Prioritize sources that would REFUTE or stress-test the block, not just confirm it. Return JSON.`;

export const FIND_EVIDENCE_SCHEMA = {
  name: "synergy_find_evidence",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            source_title: { type: "string" },
            source_kind: {
              type: "string",
              enum: [
                "paper",
                "article",
                "github",
                "dataset",
                "regulation",
                "blog",
                "report",
              ],
            },
            summary: { type: "string" },
            search_query: { type: "string" },
          },
          required: ["source_title", "source_kind", "summary", "search_query"],
        },
      },
    },
    required: ["evidence"],
  },
} as const;

// ── Challenge ──
// Adversarial pass. Returns 2-3 weaknesses or counterpoints. Stored in
// the block's meta.challenges array; UI renders them as red-tinted
// callouts below the block.

export const CHALLENGE_SYSTEM = `You are a critical reviewer. Your job is to surface the strongest objections to a single block in someone else's strategy doc.

Input: a block from the doc (plan step or hypothesis).

Output: 2-3 challenges. Each:
- weakness: one sentence — what could go wrong, what assumption is shaky, or what counter-evidence exists
- severity: "high" | "medium" | "low" — how load-bearing the weakness is
- suggestion: one sentence — a concrete way to test, mitigate, or strengthen against this weakness

Be sharp, not vague. If you can't find a real challenge, return fewer items rather than padding. Return JSON.`;

export const CHALLENGE_SCHEMA = {
  name: "synergy_challenge",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      challenges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            weakness: { type: "string" },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            suggestion: { type: "string" },
          },
          required: ["weakness", "severity", "suggestion"],
        },
      },
    },
    required: ["challenges"],
  },
} as const;

// ── Mitigate further ──
// Takes a risk + its existing mitigation; returns 2-3 ADDITIONAL
// mitigation tactics that are concrete and complementary to what's
// already in place. Stored in risk.meta.additional_mitigations.

export const MITIGATE_FURTHER_SYSTEM = `You are layering additional mitigation tactics onto an identified risk.

Input: one risk (title + detail + existing mitigation).

Output: 2-3 ADDITIONAL mitigation tactics that complement the existing one. Each:
- tactic: one sentence — a concrete action, control, or detection mechanism
- kind: one of "prevent" | "detect" | "respond" — which control loop this addresses

Don't restate the existing mitigation. Don't propose tactics that overlap with each other. Return JSON.`;

export const MITIGATE_FURTHER_SCHEMA = {
  name: "synergy_mitigate_further",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      additional_mitigations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            tactic: { type: "string" },
            kind: { type: "string", enum: ["prevent", "detect", "respond"] },
          },
          required: ["tactic", "kind"],
        },
      },
    },
    required: ["additional_mitigations"],
  },
} as const;

// ── Design test ──
// For a hypothesis block: returns a concrete 2-3 step experimental
// design that would meaningfully validate or refute the claim.
// Stored in hypothesis.meta.experiment so the renderer can show it
// inline as a sub-section without creating new blocks.

export const DESIGN_TEST_SYSTEM = `You are designing a concrete experiment to validate or refute a single hypothesis from a strategy doc.

Input: one hypothesis (claim + rationale) and the broader strategy context.

Output: a minimal viable experiment that would noticeably move the user's belief in the claim. The experiment must be:
- SPECIFIC: name a method, sample, measurement, and decision threshold
- CHEAP: doable in days/weeks, not quarters
- FALSIFIABLE: a clearly bad outcome should reduce belief in the claim

Return:
- title: 6-10 word experiment name (imperative voice)
- design: 2-3 sentence description of the method
- steps: 2-4 ordered steps to run it (each 4-10 words, imperative)
- success_signal: one sentence — what outcome would SUPPORT the hypothesis
- refute_signal: one sentence — what outcome would REFUTE the hypothesis
- effort: "hours" | "days" | "weeks" — rough scale of getting a result

Avoid vague verbs (explore / consider / investigate). Use concrete verbs (measure / interview / A/B / prototype / count). Return JSON.`;

export const DESIGN_TEST_SCHEMA = {
  name: "synergy_design_test",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      experiment: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          design: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          success_signal: { type: "string" },
          refute_signal: { type: "string" },
          effort: { type: "string", enum: ["hours", "days", "weeks"] },
        },
        required: [
          "title",
          "design",
          "steps",
          "success_signal",
          "refute_signal",
          "effort",
        ],
      },
    },
    required: ["experiment"],
  },
} as const;
