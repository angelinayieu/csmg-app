// ── Adversarial-search prompts ──
//
// Phase 2b (research-strategy migration). Two prompts that drive the
// adversarial pass:
//
//   1. SEARCH framing — fed to the web-search agent so it issues
//      queries explicitly chasing counter-evidence, not corroboration.
//      Prevents the standard "search for X" → "find supportive papers"
//      bias.
//
//   2. EXTRACTION framing — fed to evidence-extractor so it correctly
//      attributes `support_type=contradicts` relative to the ORIGINAL
//      claim (not the adversarial query). Without this, the extractor
//      would mark a counter-finding paper as "supports" because it
//      "supports" the adversarial framing.
//
// Both prompts are deliberately sharp. The whole point of this pass is
// to find what would change our minds about a claim we've already
// promoted to `status='supported'`. Soft adversarial framing (e.g.
// "consider alternative perspectives") produces the same supportive
// papers as a regular search.

export interface AdversarialPromptInput {
  /** The claim being challenged. Verbatim from claims.claim_text. */
  claimText: string;
  /** Optional: name of the primary entity the claim relates to.
   *  Sharpens the search ("X failed in <entity context>") without
   *  losing generality. */
  entityName?: string;
  /** Current confidence on this claim (0..1). Higher confidence claims
   *  warrant deeper adversarial search since the system is more
   *  exposed if they turn out wrong. */
  currentConfidence?: number;
}

/**
 * Search query the web-search agent runs. Aggressive phrasing:
 * "limitations", "failed to replicate", "contradicts", "boundary
 * conditions". The web_search tool will pull papers that include those
 * words in title/abstract — exactly the literature we want.
 */
export function buildAdversarialSearchQuery(
  input: AdversarialPromptInput,
): string {
  const claim = input.claimText.trim().slice(0, 160);
  const entity = input.entityName ? ` ${input.entityName}` : "";
  // Three search-query variants combined into one search-string the
  // agent will issue as multiple queries. Web-search tool handles the
  // multi-query fan-out naturally.
  return [
    `"${claim}"${entity} failed to replicate`,
    `"${claim}"${entity} limitations boundary conditions`,
    `"${claim}"${entity} contradicting evidence systematic review`,
  ].join(" OR ");
}

/**
 * The query CONTEXT the extractor uses to determine support_type.
 * Critically: we pass the ORIGINAL claim, not the adversarial framing.
 * That way when the LLM sees "study X found no effect of Y on Z" and
 * the original claim was "Y improves Z", the extractor correctly tags
 * support_type=contradicts.
 *
 * Without this, the extractor would look at a paper that says
 * "Y didn't improve Z" alongside a query context of "evidence against
 * Y improves Z" and might mark it as `supports` (it supports the
 * adversarial framing). That inversion is silent and devastating.
 */
export function buildAdversarialExtractionContext(
  input: AdversarialPromptInput,
): string {
  return input.claimText.trim();
}

/**
 * System-prompt addendum for the adversarial-mode search agent. Lets
 * the existing multi-source-retrieval prompt keep its source-strategy
 * scaffolding while flipping its goal from "corroborate" to "challenge".
 */
export const ADVERSARIAL_SEARCH_SYSTEM_ADDENDUM = `

ADVERSARIAL MODE — IMPORTANT:
Your goal is NOT to find supporting evidence for the user's query. Your goal is to find evidence that CONTRADICTS or LIMITS the applicability of the claim being investigated. Specifically search for:
  • Failed replications + null results
  • Boundary conditions where the effect breaks down or reverses
  • Contradicting studies, especially recent ones from independent labs
  • Critiques + commentaries that challenge the original findings
  • Meta-analyses showing weaker effects than the headline claim

Treat papers that merely RESTATE the claim as low-value — they don't help us calibrate. Treat papers that SHARPEN the claim's boundary (e.g., "the effect holds only when X") as high-value — they're the most informative.

If after good-faith adversarial search you find no contradicting evidence, that's a meaningful signal too. Report it honestly rather than padding with weak counter-points.`;
