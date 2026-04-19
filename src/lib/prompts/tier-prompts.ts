import { DECOMPOSITION_SYSTEM_PROMPT } from "./decomposition";
import { STRUCTURING_SYSTEM_PROMPT } from "./structuring";

type Depth = "quick" | "standard" | "deep";

const DECOMPOSITION_TIER_ADDENDA: Record<Depth, string> = {
  quick: `

--- TIER OVERRIDE: QUICK ---
Fast but rich exploration mode. Apply these constraints:
- Target 15-25 entities. Under 12 means you are under-extracting.
- Dense edge network — aim for edge count >= 2x entity count. Every entity MUST have at least 2 edges.
- Brief, one-sentence descriptions for each entity.
- For Tier 4 (Unit Breakdown): flag the most obvious 2-3 decomposable entities.
- For Tier 6 (Fundamental Logic): identify the top 2 leverage points and 2 risk points. Identify the master bottleneck.
- Trace at least 1-3 feedback cycles.
- Identify 2-3 novel connections.
- MANDATORY: Assign accurate entity_category to every entity (concrete/abstract/process/relational/epistemic).
- MANDATORY: Identify at least 2 "critical" and 1 "fundamental" entity.

CRITICAL — BRIEF INPUT EXPANSION:
If the user's input is short (under 200 words), you MUST still produce a rich analysis. A brief input like "nutrition app for brain health" contains DOZENS of implicit entities:
- The product itself (concrete), the target users (concrete), the market (concrete)
- Core technology/algorithm (process), data collection (process), recipe generation (process)
- Regulatory compliance (epistemic), scientific validation (epistemic)
- User retention vs accuracy tradeoff (relational), cost vs quality tradeoff (relational)
- Network effects (abstract), competitive moat (abstract), pricing model (abstract)
- Key assumptions the user is making (epistemic)
Short input ≠ shallow analysis. The user trusts you to see what they haven't stated. Extract the full implied system.`,

  standard: `

--- TIER OVERRIDE: STANDARD ---
Thorough analysis mode. Apply these constraints:
- Target 25-40 entities. Under 20 means you are significantly under-extracting — dig deeper into implicit entities, background assumptions, processes, and relational tensions.
- Dense edge network — aim for edge count >= 2.5x entity count. Every entity MUST have at least 3 edges. Under-connected entities indicate missing relationships.
- Detailed descriptions with reasoning for each entity (2-3 sentences).
- Complete all six tiers fully.
- Trace all cycles exhaustively.
- Identify all novel connections (moderate and strong).
- MANDATORY: Assign accurate entity_category to EVERY entity. Use the full taxonomy:
  - "concrete" for people, organizations, products, assets, artifacts
  - "abstract" for concepts, capabilities, qualities, metrics, constraints
  - "process" for activities, mechanisms, decisions, events
  - "relational" for tradeoffs, dependencies, tensions, alignments
  - "epistemic" for assumptions, claims, unknowns, irreducibles
  Do NOT default everything to "abstract". A startup is "concrete". A feedback loop is "process". A tradeoff is "relational". Be precise.
- MANDATORY: Assign meaningful importance levels. Not everything is "moderate" — identify at least 3 "critical" and 2 "fundamental" entities.
- Every entity needs at least 3 edges.`,

  deep: `

--- TIER OVERRIDE: DEEP / COMPREHENSIVE ---
Exhaustive analysis mode. Apply these constraints:
- Target 25-50 entities per space. Under 25 means you are under-extracting.
- Maximum edge density — aim for edge count >= 2.5x entity count.
- Multi-paragraph descriptions for each entity. Every entity needs a confidence justification.
- Complete all six tiers with maximum depth.
- Trace every possible cycle, including second-order feedback loops.
- Every entity must have at least 4 edges with specific mechanism descriptions.
- Identify all novel connections including speculative ones.
- Cross-layer analysis must be exhaustive.
- Flag every decomposable entity.`,
};

const STRUCTURING_TIER_ADDENDA: Record<Depth, string> = {
  quick: `

--- TIER OVERRIDE: QUICK ---
The decomposition was produced in fast-but-rich mode. Expect:
- 15-25 entities with brief descriptions
- Dense edges (~2x entity count, minimum 2 per entity)
- 1-3 cycles
- Brief propositions and scenarios
- MANDATORY: Preserve entity_category from the decomposition. Do NOT default to "abstract".
- MANDATORY: Preserve importance levels. At least 2 "critical" and 1 "fundamental".
- Generate manifold data for fundamental and critical entities (the top 3-5 most important).
If a section has no data from the decomposition, return an empty array for that field.`,

  standard: `

--- TIER OVERRIDE: STANDARD ---
The decomposition was produced in thorough mode. Expect:
- 25-40 entities with detailed descriptions
- Dense edges (~2.5x entity count, minimum 3 per entity)
- Full cycle tracing
- Complete propositions and scenarios
- MANDATORY: Preserve entity_category from the decomposition. Do NOT default to "abstract". Every entity must have one of: "concrete", "abstract", "process", "relational", "epistemic". If the decomposition assigned a category, keep it.
- MANDATORY: Preserve importance levels. At least 3 entities should be "critical" and 2 "fundamental".
- MANDATORY: Generate manifold data for every fundamental and critical entity. Look for [MANIFOLD: ...] annotations in the decomposition and convert them to the manifold JSON structure. If the decomposition lacks explicit manifold annotations, infer manifold values from the entity's description, relationships, and domain context.
Ensure all fields are richly populated.`,

  deep: `

--- TIER OVERRIDE: DEEP / COMPREHENSIVE ---
The decomposition was produced in exhaustive mode. Expect:
- 25-50 entities with multi-paragraph descriptions
- Maximum edge density (~2.5x entity count)
- Exhaustive cycle tracing with growth dynamics
- Full propositions, scenarios, contradictions, and action items
- Every entity should have confidence justification
- MANDATORY: Generate manifold data for ALL fundamental, critical, and important entities. Convert [MANIFOLD: ...] annotations from the decomposition into the manifold JSON structure. For entities without explicit annotations, infer manifold values from context — every non-moderate entity should have a populated manifold.
Ensure maximum richness across all fields.`,
};

/**
 * Returns the decomposition system prompt with tier-specific instructions appended.
 */
export function getDecompositionPrompt(depth: Depth): string {
  return DECOMPOSITION_SYSTEM_PROMPT + DECOMPOSITION_TIER_ADDENDA[depth];
}

/**
 * Returns the structuring system prompt with tier-specific expectations appended.
 */
export function getStructuringPrompt(depth: Depth): string {
  return STRUCTURING_SYSTEM_PROMPT + STRUCTURING_TIER_ADDENDA[depth];
}
