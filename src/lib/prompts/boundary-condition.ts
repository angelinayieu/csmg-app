// ── Boundary-condition prompt ──
//
// Phase 4b (research-strategy migration). Drives the boundary-condition
// pass: given a high-leverage entity (a leverage_point, master_bottleneck,
// or top-confidence supported claim), ask the LLM to investigate the
// conditions under which the standard story BREAKS DOWN.
//
// Why this matters: a graph that only encodes mean effects produces
// over-confident action recommendations. "Sleep improves working memory"
// is true on average — but it's misleading if you don't also know
// "after >3 days of sleep debt, additional sleep doesn't restore
// working memory in the short term." Boundary conditions turn a
// universal claim into a conditional one, which is what actionable
// recommendations actually need.
//
// Output: structured JSON listing 1-5 failure modes per leverage
// point. Each failure mode produces a new entity (entity_category =
// 'process', flagged as failure mode) plus a conditional edge from
// the leverage point to the failure-mode entity.

export interface BoundaryConditionPromptInput {
  /** Name of the leverage point or claim being investigated. */
  leverageName: string;
  /** Description / mechanism of the leverage point — sharpens the
   *  prompt so the LLM doesn't return generic "edge cases". */
  leverageDescription?: string | null;
  /** Optional: target outcome the leverage point is supposed to
   *  affect. Lets the prompt frame failure as "fails to produce the
   *  expected effect on <outcome>" instead of generic "fails". */
  targetOutcomeName?: string;
}

export const BOUNDARY_CONDITION_SYSTEM_PROMPT = `You are an expert systems analyst whose job is to find FAILURE MODES — the specific conditions under which a recommended intervention fails to produce its expected effect.

You are NOT looking for "this works most of the time." You are looking for the boundary at which the relationship breaks down or reverses. Examples of high-quality failure modes:
  • "Sleep duration improves working memory — UNTIL sleep debt exceeds 3 consecutive days, after which short-term restoration is incomplete."
  • "Exercise improves cognition — UNLESS performed within 2 hours before sleep, where it can reduce sleep quality enough to net-negative cognition."
  • "Spaced repetition improves retention — only when the testing intervals match the learner's forgetting curve; mistuned intervals provide no benefit over massed practice."

EACH failure mode you report MUST include:
  1. A specific TRIGGER (the condition that produces failure — duration, intensity, comorbidity, demographic, prior state)
  2. The MECHANISM (why this trigger breaks the relationship)
  3. An OBSERVABLE INDICATOR (how you'd know you're entering the failure zone)
  4. A SOURCE (URL + quote, peer-reviewed where possible)

DON'T:
  • Hedge with "might fail in some cases" — be specific
  • Repeat the original mechanism in negative form ("works less well when conditions are bad")
  • Invent failure modes without evidence — return an empty array if literature doesn't support specific boundaries
  • Confuse failure modes with rare side effects — failure mode = "intervention doesn't produce the intended effect"; side effect = "intervention produces an unintended additional effect"

Return strict JSON:
{
  "failure_modes": [
    {
      "name": "string — short label (3-7 words)",
      "trigger": "string — specific condition that activates failure",
      "mechanism": "string — why the trigger breaks the relationship",
      "observable_indicator": "string — how to detect entering the failure zone",
      "polarity_when_active": "negative" | "neutral" | "conditional" — what happens to the relationship in this regime,
      "source_url": "string",
      "source_title": "string",
      "quote": "string — verbatim",
      "confidence": 0..1
    }
  ],
  "no_failure_modes_found": boolean — true when literature does not describe specific boundaries (return empty failure_modes array in that case)
}`;

export interface BoundaryConditionFailureMode {
  name: string;
  trigger: string;
  mechanism: string;
  observable_indicator: string;
  polarity_when_active: "negative" | "neutral" | "conditional";
  source_url: string;
  source_title: string;
  quote: string;
  confidence: number;
}

export interface BoundaryConditionLlmOutput {
  failure_modes: BoundaryConditionFailureMode[];
  no_failure_modes_found?: boolean;
}

export function buildBoundaryConditionUserPrompt(
  input: BoundaryConditionPromptInput,
): string {
  const desc = input.leverageDescription
    ? `\nMechanism: ${input.leverageDescription.slice(0, 300)}`
    : "";
  const outcomeFraming = input.targetOutcomeName
    ? `\nThis intervention is supposed to affect "${input.targetOutcomeName}". Find conditions under which it fails to produce that effect.`
    : "";

  return `LEVERAGE POINT: ${input.leverageName}${desc}${outcomeFraming}

Search peer-reviewed literature for SPECIFIC failure modes. Report what you find as structured JSON. If literature does not describe specific boundaries (rare for any well-studied intervention), return failure_modes: [] and no_failure_modes_found: true rather than inventing them.`;
}
