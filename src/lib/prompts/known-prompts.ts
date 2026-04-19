/**
 * Known Prompts Registry
 *
 * Central registry of all pipeline prompts used by the system.
 * Used by context-detector to match recommendations that reference
 * specific prompts, and by test-lab for prompt comparison experiments.
 *
 * Each entry maps a human-readable prompt name to its full text.
 * Functions that require arguments are called with sensible defaults
 * to produce a representative prompt.
 */

import { DECOMPOSITION_SYSTEM_PROMPT } from "@/lib/prompts/decomposition";
import { SYNTHESIS_SYSTEM_PROMPT, getSynthesisPrompt } from "@/lib/prompts/synthesis";
import { CRITIC_SYSTEM_PROMPT } from "@/lib/prompts/critic";
import { STRUCTURING_SYSTEM_PROMPT } from "@/lib/prompts/structuring";
import { DOMAIN_EXPERT_PROMPT } from "@/lib/prompts/domain-expert";

// REASONING_PROMPTS contains both static strings and functions (cascade, path).
// We only include the static string prompts here; the function-based ones
// require entity IDs that aren't available at registry time.
import { REASONING_PROMPTS } from "@/lib/prompts/reasoning";

// ── Build the registry ──

export const KNOWN_PROMPTS: Record<string, string> = {
  // Agent 1: Decomposition
  decomposition: DECOMPOSITION_SYSTEM_PROMPT,

  // Agent 3: Structuring (JSON parser)
  structuring: STRUCTURING_SYSTEM_PROMPT,

  // Agent 4: Critic (graph structure reviewer)
  critic: CRITIC_SYSTEM_PROMPT,

  // Agent 6: Synthesis (with no intent/goal for a representative baseline)
  synthesis: getSynthesisPrompt(null, null),

  // Also keep the raw base constant for backwards compatibility matching
  synthesis_base: SYNTHESIS_SYSTEM_PROMPT,

  // Agent 7: Domain Expert (training depth = no search instructions)
  domain_expert: DOMAIN_EXPERT_PROMPT,

  // Reasoning sub-prompts (static ones only)
  reasoning_centrality: REASONING_PROMPTS.centrality,
  reasoning_cycles: REASONING_PROMPTS.cycles,
  reasoning_link_prediction: REASONING_PROMPTS.link_prediction,

  // reasoning_cascade and reasoning_path are functions requiring entity IDs
  // at call time — cannot be registered as static prompts.
};

// ── Truncated versions (2000 chars) for context detection & prompt comparison ──

export const KNOWN_PROMPTS_TRUNCATED: Record<string, string> = Object.fromEntries(
  Object.entries(KNOWN_PROMPTS).map(([k, v]) => [k, v.slice(0, 2000)])
);
