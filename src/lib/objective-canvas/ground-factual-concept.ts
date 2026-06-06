// ── ground-factual-concept — bounded web_search grounding for ONE factual ──
// ambiguity. Reuses the proven Anthropic web_search pattern (getResearchTools +
// parseResearchResponse). Returns a terse factual brief + citations the resolver
// can ground its answer in. SERVER-ONLY (uses the Anthropic client). Soft-fails
// to null so a bad search never blocks resolution.
//
// Only called for ambiguities the planner flags `factual` (legal / technical /
// market). Intent / taste / scope questions are the USER's call and are NEVER
// web-researched — that discrimination is the point (§5 of the plan).

import { getAnthropicClient } from "@/lib/anthropic";
import { BEST_FAST_CLAUDE_MODEL } from "@/lib/llm";
import { getResearchTools, parseResearchResponse } from "@/lib/web-search";

export interface FactualGrounding {
  findings: string;
  citations: { title: string; url: string }[];
}

export async function groundFactualConcept(
  phrase: string,
  why?: string,
): Promise<FactualGrounding | null> {
  if (!phrase || !phrase.trim()) return null;
  try {
    const anthropic = getAnthropicClient();
    const resp = await anthropic.messages.create({
      model: BEST_FAST_CLAUDE_MODEL,
      max_tokens: 1200,
      system:
        "You ground ONE ambiguous term/decision in real external facts so a product decision can be made. Run web searches, then return a TERSE factual brief (≤5 sentences): what the term concretely means in practice, the realistic options, and any hard legal / technical / cost constraints. Facts only — no recommendations, no fluff.",
      messages: [
        {
          role: "user",
          content: `Term/decision to ground: "${phrase}"${
            why ? `\nWhy it matters: ${why}` : ""
          }\n\nSearch the web, then give the factual brief.`,
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: getResearchTools("light") as any,
    });
    const parsed = parseResearchResponse(resp.content);
    const findings = (parsed.jsonOutput ?? "").trim();
    if (!findings) return null;
    return {
      findings: findings.slice(0, 1200),
      citations: parsed.citations.slice(0, 5).map((c) => ({
        title: c.title || c.url,
        url: c.url,
      })),
    };
  } catch {
    return null;
  }
}
