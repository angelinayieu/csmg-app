// ── Cycle-close prompt ──
//
// Phase 4 (research-strategy migration). Drives the cycle-closing
// pass: given a near-cycle (an existing 2-hop path A→B→C and a
// missing edge C→A), ask the LLM to investigate whether the missing
// edge is supported by literature.
//
// Output is a structured JSON the route can interpret:
//   - found_evidence: did the LLM find a real causal/correlational
//     mechanism connecting C back to A?
//   - relationship: brief description of the C→A mechanism
//   - polarity: positive / negative / conditional
//   - dimension: causal / functional / temporal / etc.
//   - confidence: 0..1
//   - source_url, source_title, quote: grounding
//
// Critical design: the prompt frames the question as "does C feed
// back to A" rather than "find any connection". The narrowness keeps
// the LLM honest — if no real mechanism exists, it should say so
// (found_evidence: false) instead of inventing one.

export interface CycleClosePromptInput {
  /** Names of the three entities along the existing path. */
  pathNames: [string, string, string];
  /** What we're testing for — "C → A", expressed in plain language. */
  missingEdgeFromName: string;
  missingEdgeToName: string;
  /** Optional: short descriptions of the path entities. Sharpens the
   *  search ("does <C, mechanism description> drive <A, mechanism
   *  description>") so the LLM doesn't hallucinate generic links. */
  pathDescriptions?: [string | null, string | null, string | null];
}

export const CYCLE_CLOSE_SYSTEM_PROMPT = `You are a causal inference analyst investigating whether a specific feedback edge exists in published literature.

You will be given an EXISTING 2-edge causal path (A → B → C) and asked whether the closing edge C → A is supported by evidence. Your job is to either:

  (a) FIND that closing edge — report the mechanism, polarity, and a verbatim quote from a high-reliability source, OR
  (b) HONESTLY REPORT no evidence — return found_evidence: false. Don't fabricate a mechanism just to "complete the cycle".

CRITICAL RULES:
  • The bar is causal/correlational evidence, NOT speculation. "It's plausible that" doesn't qualify.
  • Prefer primary sources (peer-reviewed papers, replications, meta-analyses) over secondary summaries.
  • If you find evidence the closing edge is REVERSED (A → C exists, C → A does not), report found_evidence: false with a note.
  • If the relationship exists but is conditional (e.g., "only under stress"), set polarity: conditional and capture the condition in the description.
  • One source minimum. Multiple sources = higher confidence; report all in the source_urls array.

Return strict JSON matching this shape:
{
  "found_evidence": boolean,
  "no_evidence_reason": "string — required when found_evidence: false. e.g., 'no peer-reviewed source describes this feedback', 'literature describes the reverse direction A → C only'",
  "relationship": "string — concise mechanism description (1-2 sentences). Only required when found_evidence: true.",
  "polarity": "positive" | "negative" | "conditional" | null,
  "dimension": "causal" | "correlational" | "functional" | "temporal" | "structural" | null,
  "confidence": 0..1 (your confidence the C→A edge is real),
  "source_urls": ["string"],
  "source_titles": ["string"],
  "primary_quote": "string — verbatim quote from the strongest source. Required when found_evidence: true."
}`;

export interface CycleCloseLlmOutput {
  found_evidence: boolean;
  no_evidence_reason?: string;
  relationship?: string;
  polarity?: "positive" | "negative" | "conditional" | null;
  dimension?:
    | "causal"
    | "correlational"
    | "functional"
    | "temporal"
    | "structural"
    | null;
  confidence?: number;
  source_urls?: string[];
  source_titles?: string[];
  primary_quote?: string;
}

export function buildCycleCloseUserPrompt(
  input: CycleClosePromptInput,
): string {
  const [aName, bName, cName] = input.pathNames;
  const [aDesc, bDesc, cDesc] = input.pathDescriptions ?? [null, null, null];

  const desc = (label: string, description: string | null): string =>
    description ? ` (${label}: ${description.slice(0, 200)})` : "";

  return `EXISTING CAUSAL PATH:
  ${aName}${desc("A", aDesc)}
  → ${bName}${desc("B", bDesc)}
  → ${cName}${desc("C", cDesc)}

QUESTION:
Does ${input.missingEdgeFromName} (C) feed back to ${input.missingEdgeToName} (A)? Search for primary literature describing this specific mechanism. If found, report it; if no evidence exists, say so honestly.`;
}
