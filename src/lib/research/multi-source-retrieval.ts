// ── Multi-source retrieval orchestrator ──
//
// Given (query, questionType, domain) + candidate entities, runs a
// multi-source retrieval plan:
//
//   1. Plan: `planSourceRetrieval` decides WHERE to look based on
//      type+domain (benchmarks for SaaS predictions, PubMed for
//      medical, government data for macro-finance, etc.).
//   2. Fetch: Anthropic web_search with the plan's query_modifiers.
//      We reuse the existing `parseResearchResponse` helper so we
//      inherit the right content-block parsing + citation extraction.
//   3. Classify + extract: pipe the citations into
//      `extractEvidenceBatch` → structured `ExtractedEvidence[]`.
//   4. (Caller persists via `persistEvidenceBatch`.)
//
// Soft-fails: if the web_search call errors, returns an empty list
// with the error captured. The caller stays responsible for deciding
// whether to fall back to LLM-only reasoning when no evidence
// surfaced.

import { getAnthropicClient } from "@/lib/anthropic";
import { getResearchTools, parseResearchResponse } from "@/lib/web-search";
import type { Citation, ResearchDepth } from "@/lib/web-search";
import {
  extractEvidenceBatch,
  type ExtractedEvidence,
  type RawSearchResult,
} from "./evidence-extractor";
import {
  planSourceRetrieval,
  type CoarseDomain,
  type QuestionType,
} from "./source-strategy";

export interface MultiSourceRetrievalOpts {
  /** The user's query or the specific claim being investigated. */
  query: string;
  questionType: QuestionType;
  domain: CoarseDomain;
  /** Candidate entities this evidence might relate to. Flows through
   *  to the extractor so it can tag relates_to_entity_ids. */
  candidateEntities: Array<{
    id: string;
    name: string;
    description?: string | null;
  }>;
  /** Anthropic web_search depth. Controls max_searches per call. */
  researchDepth?: ResearchDepth;
  /** Override target evidence count from the plan. */
  targetEvidenceCount?: number;
  /** Override min reliability gate from the plan. */
  minReliability?: number;
}

export interface MultiSourceRetrievalResult {
  plan: ReturnType<typeof planSourceRetrieval>;
  searchesPerformed: number;
  rawCitationCount: number;
  evidence: ExtractedEvidence[];
  errors: string[];
}

export async function runMultiSourceRetrieval(
  opts: MultiSourceRetrievalOpts,
): Promise<MultiSourceRetrievalResult> {
  const plan = planSourceRetrieval(opts.questionType, opts.domain);
  const result: MultiSourceRetrievalResult = {
    plan,
    searchesPerformed: 0,
    rawCitationCount: 0,
    evidence: [],
    errors: [],
  };

  // Build the search prompt for Claude. We let the model choose
  // search queries, but we embed the plan's modifiers + scraping
  // targets into the instructions so the searches it issues match
  // the source-type priorities.
  const scrapingHints =
    plan.scraping_targets.length > 0
      ? `Prefer these specific domains when they're relevant: ${plan.scraping_targets.join(", ")}.`
      : "";

  const modifierHints =
    plan.query_modifiers.length > 0
      ? `Apply these search modifiers to focus the retrieval: ${plan.query_modifiers.join(" ; ")}.`
      : "";

  const sourceTypeHint = [
    `Prioritize these source types: ${plan.primary.join(", ")}.`,
    `Fall back to: ${plan.secondary.join(", ")}.`,
    `Avoid content farms, aggregators, and SEO-heavy blogs unless nothing better surfaces.`,
  ].join(" ");

  const systemPrompt = `You are a research agent performing targeted web search. For the user's query, issue ${plan.target_evidence_count >= 10 ? 3 : 2}-${plan.target_evidence_count >= 10 ? 5 : 3} search queries that collectively surface high-signal evidence. Prefer primary sources over secondary summaries.

${sourceTypeHint}
${scrapingHints}
${modifierHints}

After performing the searches, produce ONLY a short summary (1-2 sentences) of what you found. The caller extracts citations from your search results directly — you don't need to repeat URLs in your summary.`;

  const userPrompt = `Research query: ${opts.query}

Question type: ${opts.questionType}
Domain: ${opts.domain}

Issue your web searches now.`;

  // Fire the Anthropic call. Soft-fail so a bad network hit doesn't
  // take down the pipeline — the caller just gets an empty evidence
  // list.
  let rawCitations: Citation[] = [];
  try {
    const anthropic = getAnthropicClient();
    const depth: ResearchDepth = opts.researchDepth ?? "standard";
    const tools = getResearchTools(depth);
    const resp = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools as any,
    });

    const parsed = parseResearchResponse(resp.content);
    result.searchesPerformed = parsed.searchesPerformed;
    rawCitations = parsed.citations;
    result.rawCitationCount = rawCitations.length;
  } catch (err) {
    result.errors.push(
      `anthropic web_search: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }

  if (rawCitations.length === 0) return result;

  // Normalize citations into RawSearchResult shape for the extractor
  const rawResults: RawSearchResult[] = rawCitations.map((c) => ({
    url: c.url,
    title: c.title || null,
    snippet: c.citedText,
    published_at: null, // Anthropic's citation format doesn't expose date
  }));

  // Run extraction (one batch LLM call). Feeds classifications +
  // entity tags back through so callers can persist directly.
  try {
    const extracted = await extractEvidenceBatch(rawResults, {
      queryContext: opts.query,
      candidateEntities: opts.candidateEntities,
      minReliability: opts.minReliability ?? plan.min_reliability_prior,
      maxItems: opts.targetEvidenceCount ?? plan.target_evidence_count,
    });
    result.evidence = extracted;
  } catch (err) {
    result.errors.push(
      `evidence extraction: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return result;
}
