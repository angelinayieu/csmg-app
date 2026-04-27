// ── Glean-defaults prompts (D9 — docs/KG_DEPTH_CRITIQUE.md §3) ────────
//
// After Pass 1 + Pass 2 of decomposition, certain LLM-extracted fields
// reliably default to placeholder values:
//
//   - edges.dynamics → "linear" (~75% of edges, despite Pass 2 prompt
//     warning against it)
//   - edges.conditions → null (<20% populated, even on causal/enabling
//     edges where conditions almost always exist in reality)
//   - entities.measurement_unit → null (D1 still soft-fails when the
//     LLM omits the spec)
//
// These three fields share a common failure mode: the LLM has the
// information needed, but Pass 2's serialization prompt explicitly
// discourages padding and so the LLM omits anything not absolutely
// required by the schema. Targeted re-prompting recovers the signal.
//
// Pattern is borrowed from Microsoft GraphRAG's "self-reflection
// gleaning" loop (paper §A.2, Figure 3): they showed 2.3× recall
// improvement for entity references at 600-token chunks by iterating
// up to 3 times. We use a single targeted pass per field with a
// cheap yes/no preflight to skip the call when the LLM honestly says
// nothing needs gleaning. See src/lib/pipeline/glean-defaults.ts for
// the orchestrator.
//
// Honesty contract: the prompts MUST allow "no change" / "confirm
// existing" answers. We are NOT trying to force the LLM to invent
// information — only to recover information it already has but
// omitted on the first pass.

// ── Yes/no preflight ─────────────────────────────────────────────────
//
// Logit-bias style: ask for a boolean before paying for the full
// gleaning call. Same trick GraphRAG uses to avoid running the
// extraction loop when it isn't needed (paper §A.2 — they use OpenAI
// logit_bias=100 to force yes/no; we use llmJSON with a tiny schema
// since our wrapper doesn't expose logit_bias).

export const GLEAN_PREFLIGHT_SYSTEM = `You are auditing a knowledge-graph extraction for under-filled fields.

You will be shown a list of items (edges or entities) where a specific field defaulted to a placeholder value during the initial extraction. Your job is to decide whether ANY of those items has information you would meaningfully add or change if asked.

Reply with valid JSON: { "any_gleaning_needed": true | false, "rationale": "<one sentence>" }

Rules:
- "true" only if you'd update at least one item with substantive new information based on the relationship/entity context shown.
- "false" if the placeholder values are appropriate for the items shown — the field may legitimately be the default.
- Never say "true" just to be helpful. False is the honest answer when the placeholder is correct.
- This is a CHEAP preflight; you'll be asked again with a richer prompt only if you say true.`;

// ── Edge dynamics gleaning ──────────────────────────────────────────

export const GLEAN_EDGE_DYNAMICS_SYSTEM = `You are upgrading edges that defaulted to dynamics="linear" during the initial extraction.

For each edge listed, decide whether "linear" is correct OR whether the relationship actually has a more specific dynamics pattern. Linear is the right answer for many edges — only upgrade when the relationship clearly exhibits another pattern.

Allowed dynamics:
- linear: effect scales proportionally with cause (default — confirm when correct)
- threshold: no effect until a condition is met, then full effect (binary gate)
- compounding: part of a feedback cycle where output feeds back into input
- exponential: standalone multiplicative growth (e.g. network effects), NOT a cycle
- logarithmic: diminishing returns
- decay: degrades over time without active maintenance
- step_function: flat, then jumps to a new level at a specific trigger
- delayed: effect exists but takes time to manifest

Output valid JSON conforming to:
{
  "updates": [
    {
      "edge_index": <integer index from the input list>,
      "dynamics": "<one of the allowed values>",
      "dynamics_properties": { "delay": "string?", "threshold_condition": "string?", "cycle_time": "string?", "rate": "string?" } | null,
      "rationale": "<one sentence — required>"
    }
  ]
}

Rules:
- ONLY include items where you're upgrading from "linear" to something else, OR where you're explicitly confirming "linear" with new dynamics_properties.
- Items you'd leave unchanged: omit them from the updates array.
- If the cause-effect lacks a clear non-linear pattern, do NOT upgrade — linear is fine.
- For threshold/delayed/compounding upgrades, populate at least one dynamics_properties field.
- Be honest: returning an empty updates array is a valid answer.`;

// ── Edge conditions gleaning ────────────────────────────────────────

export const GLEAN_EDGE_CONDITIONS_SYSTEM = `You are filling conditions on causal/enabling edges that defaulted to conditions=null.

A condition is the IF-clause that governs WHEN an edge fires. Examples:
- "X enables Y" might fire only if "user has completed onboarding"
- "A causes B" might fire only "during peak load"
- Many causal edges have implicit conditions the initial extraction missed.

For each edge listed, decide one of three outcomes:
1. The edge is genuinely UNCONDITIONAL — no IF-clause is needed. Mark { "is_unconditional": true }.
2. The edge has an IMPLICIT condition the initial pass missed — add a short conditions string.
3. You're not sure — omit the edge from updates entirely (don't guess).

Output valid JSON:
{
  "updates": [
    {
      "edge_index": <integer index from input list>,
      "conditions": "<short IF-clause>" | null,
      "is_unconditional": true | false,
      "rationale": "<one sentence>"
    }
  ]
}

Rules:
- conditions strings should be specific and observable. "if user has completed onboarding" YES. "if circumstances are right" NO.
- Do NOT invent conditions to satisfy the schema. An empty updates array is fine.
- "is_unconditional: true" with conditions=null is a valid finding for genuinely unconditional edges.`;

// ── Entity measurement gleaning (D1 follow-up) ──────────────────────

export const GLEAN_ENTITY_MEASUREMENT_SYSTEM = `You are filling measurement specs on fundamental/critical entities that defaulted to measurement=null during D1 (the entity measurability pass).

A measurement spec turns an entity from a noun ("user engagement") into a variable ("weekly active users / monthly active users — fraction, continuous, observed via Mixpanel"). Without a unit + scale, the entity cannot be simulated, calibrated, or controlled.

For each entity listed, decide one of three outcomes:
1. The entity has a real, nameable unit you can specify (with scale). Add the spec.
2. The entity genuinely resists measurement at this layer of analysis (e.g. it's a relational tradeoff, an epistemic assumption, or a frame-level concept). Mark with missing_reason.
3. You can't decide — omit from updates.

Allowed scales:
- continuous: unbounded numeric (revenue, latency, %)
- ordinal: ranked categories (low/med/high)
- categorical: unordered categories (cohort A/B/C)
- binary: true/false gate

Output valid JSON:
{
  "updates": [
    {
      "entity_index": <integer index from input list>,
      "measurement": {
        "unit": "<concrete unit, e.g. 'users/week', '%', 'ms', 'USD/MAU'>",
        "scale": "continuous | ordinal | categorical | binary",
        "protocol": { "instrument": "string", "frequency": "string", "sample_unit": "string", "error_bound": "string?", "owner": "string?" } | null,
        "cost_estimate": <number>?,
        "observability": "directly_observable | proxy_required | inferred_only | unobservable"?
      } | null,
      "missing_reason": "<one sentence — populated when measurement is null>" | null,
      "rationale": "<one sentence>"
    }
  ]
}

Rules:
- unit MUST be a real, concrete unit. "users/week" YES. "engagement level" NO. "high" NO.
- Do NOT invent specs for entities that are genuinely abstract. measurement=null with a missing_reason is a valid, honest answer.
- protocol is OPTIONAL — only include it when you have specific signal about HOW the entity is measured. Don't fabricate instruments.
- An empty updates array is fine — every fundamental/critical entity may already be correctly specced or correctly null.`;

// ── Schemas for llmJSON validators ──────────────────────────────────

export interface PreflightResult {
  any_gleaning_needed: boolean;
  rationale: string;
}

export interface DynamicsUpdate {
  edge_index: number;
  dynamics:
    | "linear"
    | "threshold"
    | "compounding"
    | "exponential"
    | "logarithmic"
    | "decay"
    | "step_function"
    | "delayed";
  dynamics_properties: Record<string, unknown> | null;
  rationale: string;
}

export interface ConditionsUpdate {
  edge_index: number;
  conditions: string | null;
  is_unconditional: boolean;
  rationale: string;
}

export interface MeasurementUpdate {
  entity_index: number;
  measurement: {
    unit?: string;
    scale?: "continuous" | "ordinal" | "categorical" | "binary";
    protocol?: Record<string, unknown> | null;
    cost_estimate?: number;
    observability?:
      | "directly_observable"
      | "proxy_required"
      | "inferred_only"
      | "unobservable";
  } | null;
  missing_reason: string | null;
  rationale: string;
}

export interface GleanResponse<T> {
  updates: T[];
}
