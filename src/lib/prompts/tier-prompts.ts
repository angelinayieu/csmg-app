import { DECOMPOSITION_SYSTEM_PROMPT } from "./decomposition";
import { STRUCTURING_SYSTEM_PROMPT } from "./structuring";

type Depth = "quick" | "standard" | "deep";

const DECOMPOSITION_TIER_ADDENDA: Record<Depth, string> = {
  quick: `

--- TIER OVERRIDE: QUICK ---
Fast exploration mode. Apply these constraints:
- Target 8-15 entities. Do NOT exceed 15.
- Key relationships only — aim for edge count ~1.2x entity count.
- Brief, one-sentence descriptions for each entity.
- For Tier 4 (Unit Breakdown): only flag the most obvious 1-2 decomposable entities. Do NOT spend time breaking them down.
- For Tier 6 (Fundamental Logic): identify the single most important leverage point and risk point only. Skip centrality ranking.
- Limit cycles to the most obvious 1-2. Do not exhaustively trace.
- Limit novel connections to 2-3 strongest only.
- Prioritize speed over completeness.`,

  standard: `

--- TIER OVERRIDE: STANDARD ---
Thorough analysis mode. Apply these constraints:
- Target 15-25 entities. Under 15 means dig deeper.
- Dense edge network — aim for edge count >= 2x entity count.
- Detailed descriptions with reasoning for each entity (2-3 sentences).
- Complete all six tiers fully.
- Trace all cycles exhaustively.
- Identify all novel connections (moderate and strong).
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
The decomposition was produced in fast mode. Expect:
- 8-15 entities (do NOT invent extras beyond what the decomposition provides)
- Fewer edges (~1.2x entity count)
- Brief descriptions
- Minimal cycles (0-2)
- Fewer propositions and scenarios
If a section has no data from the decomposition, return an empty array for that field.`,

  standard: `

--- TIER OVERRIDE: STANDARD ---
The decomposition was produced in thorough mode. Expect:
- 15-25 entities with detailed descriptions
- Dense edges (~2x entity count)
- Full cycle tracing
- Complete propositions and scenarios
Ensure all fields are richly populated.`,

  deep: `

--- TIER OVERRIDE: DEEP / COMPREHENSIVE ---
The decomposition was produced in exhaustive mode. Expect:
- 25-50 entities with multi-paragraph descriptions
- Maximum edge density (~2.5x entity count)
- Exhaustive cycle tracing with growth dynamics
- Full propositions, scenarios, contradictions, and action items
- Every entity should have confidence justification
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
