/**
 * Test Lab Prompts
 *
 * Prompt generators for the three test lab experiment types:
 * - Prompt Comparison: variant modifications of a target prompt
 * - Strategy Comparison: alternative strategic approaches
 * - Scenario Simulation: what-if scenario variants
 *
 * Each function returns { system, user } for use with llmGenerate/llmJSON.
 */

// ── Prompt Comparison ──

/**
 * Meta-prompt that asks the LLM to generate 3-5 variant modifications
 * of a target prompt based on a recommendation.
 *
 * Expected LLM output schema:
 * {
 *   "variants": [{
 *     "label": "Conservative: Add section header",
 *     "description": "What this changes and why",
 *     "modified_section": "The actual new prompt text to add/change",
 *     "pros": ["..."],
 *     "cons": ["..."],
 *     "estimated_improvement": "~15% more structured output"
 *   }]
 * }
 */
export function getPromptComparisonVariantPrompt(params: {
  recommendationText: string;
  currentPromptExcerpt: string;
  sampleEntityDescriptions: string[];
  sampleEdgeDescriptions: string[];
  maxVariants?: number;
}): { system: string; user: string } {
  const {
    recommendationText,
    currentPromptExcerpt,
    sampleEntityDescriptions,
    sampleEdgeDescriptions,
    maxVariants = 4,
  } = params;

  const system = `You are a prompt engineering specialist. You analyze existing LLM system prompts and generate targeted modifications that improve specific outcomes. You understand how structural changes to prompts affect LLM behavior — you know when to add constraints, when to relax them, when to restructure sections, and when to add examples.

Rules:
- Each variant must make a DIFFERENT type of change (e.g., one adds structure, one adds examples, one constrains output format, one changes tone/framing).
- Variants should range from conservative (small targeted change) to ambitious (significant restructuring).
- Label each variant with a risk level prefix: "Conservative:", "Moderate:", or "Ambitious:".
- The modified_section must be actual prompt text ready to be inserted — not a description of what to change.
- Pros/cons must be specific to the modification, not generic ("better output" is not acceptable).
- estimated_improvement should be a concrete prediction, not a vague platitude.

Return ONLY valid JSON. No markdown fencing.`;

  const entityBlock =
    sampleEntityDescriptions.length > 0
      ? sampleEntityDescriptions.map((d) => `  - ${d}`).join("\n")
      : "  (none provided)";

  const edgeBlock =
    sampleEdgeDescriptions.length > 0
      ? sampleEdgeDescriptions.map((d) => `  - ${d}`).join("\n")
      : "  (none provided)";

  const user = `RECOMMENDATION (what the user wants to improve):
${recommendationText}

CURRENT PROMPT EXCERPT (the prompt section to modify):
---
${currentPromptExcerpt}
---

SAMPLE ENTITIES this prompt processes:
${entityBlock}

SAMPLE RELATIONSHIPS this prompt processes:
${edgeBlock}

Generate ${maxVariants} variant modifications of the prompt excerpt above. Each variant should address the recommendation from a different angle.

Return JSON:
{
  "variants": [
    {
      "label": "Conservative|Moderate|Ambitious: Short title",
      "description": "What this changes and why — 1-2 sentences",
      "modified_section": "The actual new/changed prompt text",
      "pros": ["specific advantage 1", "specific advantage 2"],
      "cons": ["specific tradeoff 1", "specific tradeoff 2"],
      "estimated_improvement": "concrete prediction, e.g. ~15% more structured output"
    }
  ]
}`;

  return { system, user };
}

// ── Prompt Simulation ──

/**
 * Simulates a single variant's output against sample data.
 * The LLM generates a 200-300 word output excerpt as if it were
 * running the modified prompt against real entities/edges.
 */
export function getPromptSimulationPrompt(params: {
  variantModifiedSection: string;
  sampleEntityDescriptions: string[];
  sampleEdgeDescriptions: string[];
  baselinePromptContext: string;
}): { system: string; user: string } {
  const {
    variantModifiedSection,
    sampleEntityDescriptions,
    sampleEdgeDescriptions,
    baselinePromptContext,
  } = params;

  const system = `You are simulating LLM output. You will be given a prompt modification and sample input data. Produce a realistic 200-300 word output excerpt as if you were an LLM running the modified prompt against this data.

Rules:
- Your output should demonstrate the EFFECT of the prompt modification — show how the changed instructions alter the output style, structure, or content.
- Reference the actual entity and edge names from the sample data.
- Do not describe what you would do — actually produce the simulated output.
- Keep to 200-300 words. This is an excerpt, not a complete analysis.

Return ONLY valid JSON: { "simulated_output": "..." }`;

  const entityBlock =
    sampleEntityDescriptions.length > 0
      ? sampleEntityDescriptions.map((d) => `  - ${d}`).join("\n")
      : "  (none provided)";

  const edgeBlock =
    sampleEdgeDescriptions.length > 0
      ? sampleEdgeDescriptions.map((d) => `  - ${d}`).join("\n")
      : "  (none provided)";

  const user = `BASELINE PROMPT CONTEXT:
${baselinePromptContext}

MODIFIED SECTION (the change being tested):
---
${variantModifiedSection}
---

SAMPLE ENTITIES:
${entityBlock}

SAMPLE RELATIONSHIPS:
${edgeBlock}

Produce a 200-300 word simulated output excerpt showing what this modified prompt would generate when processing the sample data above. Return JSON: { "simulated_output": "..." }`;

  return { system, user };
}

// ── Strategy Comparison ──

/**
 * Single call that generates all strategy variant TestVariant objects.
 * Each variant represents a different strategic approach to the recommendation.
 */
export function getStrategyComparisonPrompt(params: {
  recommendationText: string;
  entityDescriptions: string[];
  edgeDescriptions: string[];
  synthesisContext: string;
  maxVariants?: number;
}): { system: string; user: string } {
  const {
    recommendationText,
    entityDescriptions,
    edgeDescriptions,
    synthesisContext,
    maxVariants = 4,
  } = params;

  const system = `You are a strategic advisor generating alternative approaches to a recommendation. Each variant must represent a genuinely different strategic bet — not minor tweaks on the same idea.

Rules:
- Each variant must target a DIFFERENT assumption about what matters most (e.g., one optimizes for speed, one for resilience, one for scope, one for learning).
- Include a simulated 200-300 word output showing what pursuing this strategy would look like in practice.
- Pros/cons must be specific to the entities and relationships in the data, not generic strategy platitudes.
- risk_assessment should identify the specific failure mode for each approach.
- dependencies should list entity names (not IDs) that this strategy depends on.
- timeline should be a concrete timeframe, not "varies."

Return ONLY valid JSON. No markdown fencing.`;

  const entityBlock =
    entityDescriptions.length > 0
      ? entityDescriptions.map((d) => `  - ${d}`).join("\n")
      : "  (none provided)";

  const edgeBlock =
    edgeDescriptions.length > 0
      ? edgeDescriptions.map((d) => `  - ${d}`).join("\n")
      : "  (none provided)";

  const user = `RECOMMENDATION:
${recommendationText}

SYNTHESIS CONTEXT:
${synthesisContext}

ENTITIES:
${entityBlock}

RELATIONSHIPS:
${edgeBlock}

Generate ${maxVariants} strategic variants. Each must take a fundamentally different approach.

Return JSON:
{
  "variants": [
    {
      "label": "string — name of this strategic approach",
      "description": "string — what this approach does differently and why",
      "sample_output": "string — 200-300 word simulated output showing this strategy in action",
      "pros": ["specific advantage referencing entities"],
      "cons": ["specific tradeoff referencing entities"],
      "estimated_improvement": "concrete prediction",
      "risk_assessment": "the specific failure mode for this approach",
      "dependencies": ["entity names this strategy depends on"],
      "timeline": "concrete timeframe"
    }
  ]
}`;

  return { system, user };
}

// ── Scenario Simulation ──

/**
 * Single call generating scenario (what-if) variant TestVariant objects.
 * Each variant simulates a different scenario unfolding.
 */
export function getScenarioSimulationPrompt(params: {
  recommendationText: string;
  entityDescriptions: string[];
  edgeDescriptions: string[];
  synthesisContext: string;
  maxVariants?: number;
}): { system: string; user: string } {
  const {
    recommendationText,
    entityDescriptions,
    edgeDescriptions,
    synthesisContext,
    maxVariants = 4,
  } = params;

  const system = `You are a scenario planner generating what-if simulations. Each variant represents a different plausible future that could unfold based on the current system state and the recommendation being considered.

Rules:
- Scenarios must be STRUCTURALLY different — varying which entities strengthen, weaken, or interact differently, not just optimistic/pessimistic versions of the same path.
- At least one scenario should explore what happens if a key assumption FAILS.
- At least one scenario should explore an unexpected positive cascade.
- sample_output should be a 200-300 word narrative of how this scenario unfolds over time, referencing specific entities and relationships.
- risk_assessment should describe what signals would indicate this scenario is materializing.
- dependencies should list the entity names whose behavior determines this scenario.

Return ONLY valid JSON. No markdown fencing.`;

  const entityBlock =
    entityDescriptions.length > 0
      ? entityDescriptions.map((d) => `  - ${d}`).join("\n")
      : "  (none provided)";

  const edgeBlock =
    edgeDescriptions.length > 0
      ? edgeDescriptions.map((d) => `  - ${d}`).join("\n")
      : "  (none provided)";

  const user = `RECOMMENDATION BEING CONSIDERED:
${recommendationText}

SYNTHESIS CONTEXT:
${synthesisContext}

ENTITIES:
${entityBlock}

RELATIONSHIPS:
${edgeBlock}

Generate ${maxVariants} scenario simulations. Each must explore a structurally different future.

Return JSON:
{
  "variants": [
    {
      "label": "string — name of this scenario",
      "description": "string — the key assumption or change driving this scenario",
      "sample_output": "string — 200-300 word narrative of how this scenario unfolds",
      "pros": ["what goes well in this scenario"],
      "cons": ["what goes poorly in this scenario"],
      "estimated_improvement": "net effect if this scenario materializes",
      "risk_assessment": "signals that would indicate this scenario is happening",
      "dependencies": ["entity names whose behavior drives this scenario"],
      "timeline": "timeframe over which this scenario plays out"
    }
  ]
}`;

  return { system, user };
}
