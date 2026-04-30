/**
 * Deep Research Engine
 *
 * Handles the 3-step deep research process:
 * 1. Prompt enrichment — expand user intent with KG context
 * 2. Deep research execution — via OpenAI Responses API (background mode)
 * 3. Result parsing — extract citations, claims, evidence from output
 *
 * Uses o4-mini-deep-research by default (o3 for high-value investigations).
 */

import OpenAI from "openai";
import type {
  DeepResearchRunConfig,
  DeepResearchOutput,
  DeepResearchCitation,
  DeepResearchToolCall,
  ExtractedClaim,
  EvidenceItem,
  SourceType,
} from "@/types/deep-research";

// ── OpenAI client singleton ──

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return client;
}

// ── Step 1: Prompt enrichment ──

/**
 * Enriches the research prompt with KG context, focus areas, and existing findings.
 * This replaces the "clarification" step from ChatGPT's deep research flow —
 * since we already have structured KG context, we don't need user clarification.
 */
export function buildEnrichedPrompt(config: DeepResearchRunConfig): string {
  const sections: string[] = [];

  // Core research brief
  sections.push(`## Research Brief\n${config.prompt}`);

  // KG context — tell the model what entities/relationships already exist
  if (config.entityContext) {
    sections.push(
      `## Existing Knowledge Graph Context\nThe following entities and relationships are already known. ` +
      `Your research should EXTEND and VALIDATE these, not repeat them. ` +
      `Find mechanisms, evidence, contradictions, and deeper connections.\n\n${config.entityContext}`
    );
  }

  // Focus areas
  if (config.focusAreas && config.focusAreas.length > 0) {
    sections.push(
      `## Priority Research Areas\nPrioritize these specific areas:\n` +
      config.focusAreas.map((a, i) => `${i + 1}. ${a}`).join("\n")
    );
  }

  // Existing findings to build on
  if (config.existingFindings) {
    sections.push(
      `## Previous Research Findings\nBuild on these existing findings — do not re-discover them:\n${config.existingFindings}`
    );
  }

  // Output format instructions
  sections.push(
    `## Output Requirements\n` +
    `1. Provide a comprehensive research report with inline citations.\n` +
    `2. For each major finding, cite the specific source with URL.\n` +
    `3. Identify mechanisms and causal chains, not just correlations.\n` +
    `4. Flag contradictions between sources explicitly.\n` +
    `5. Note the confidence level and evidence quality for key claims.\n` +
    `6. Identify gaps where evidence is weak or missing.\n` +
    `7. Distinguish between peer-reviewed/official sources and opinion/blog sources.`
  );

  // Phase 2 — temporal-rigor instructions. The downstream bridge
  // service runs the L2M-disciplined extract-effect-sizes and
  // extract-temporal parsers over the report text to produce
  // evidence_registries rows. The parsers want VERBATIM quotes that
  // contain numbers, not paraphrases. This block instructs the
  // research model to surface those quotes WHENEVER it finds them
  // — without demanding the model itself extract numbers (the L2M
  // discipline says LLMs are bad at numeric extraction).
  sections.push(
    `## Temporal Findings — REQUIRED when timing data exists\n` +
    `The downstream pipeline extracts MECHANISM TIMING claims (onset, peak, persistence, decay) from your report alongside effect sizes. Mechanism timing means WHEN the body responds to the intervention — distinct from MEASUREMENT timing (when the study LOOKED).\n\n` +
    `Whenever a source reports timing, INCLUDE THE VERBATIM QUOTE in your report. Do NOT paraphrase numbers — preserve the original phrasing that contains the day/week/month value. Examples of timing claims to preserve verbatim:\n` +
    `  • "Improvements were detectable from week 2 onwards."\n` +
    `  • "Peak benefit occurred at approximately week 6."\n` +
    `  • "Effects were sustained at the 6-month follow-up."\n` +
    `  • "T½ of the cognitive benefit was approximately 30 days."\n` +
    `  • A trajectory table reporting outcomes at week 0, 4, 8, 12.\n\n` +
    `Skip MEASUREMENT timing alone — phrases like "outcomes were assessed at 8 weeks" or "patients were followed for 12 months" describe when the study LOOKED, not when the body responded. Those are not mechanism timing.\n\n` +
    `Effect-size statements should likewise be quoted verbatim ("Cohen's d = 0.42 (95% CI 0.18, 0.66)") — paraphrased numbers (0.4-ish) cannot be parsed reliably and will not feed the rigor pipeline.`
  );

  return sections.join("\n\n---\n\n");
}

// ── Step 2: Start deep research (background mode) ──

/**
 * Starts a deep research request via OpenAI Responses API in background mode.
 * Returns the response ID for polling.
 */
export async function startDeepResearch(config: DeepResearchRunConfig): Promise<{
  responseId: string;
  status: string;
}> {
  const openai = getClient();
  const enrichedPrompt = buildEnrichedPrompt(config);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (openai.responses as any).create({
    model: config.model,
    input: enrichedPrompt,
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
    ...(config.maxToolCalls > 0 ? { max_tool_calls: config.maxToolCalls } : {}),
    background: true,
    store: true,
  });

  return {
    responseId: response.id,
    status: response.status,
  };
}

// ── Step 2b: Poll for completion ──

/**
 * Polls the OpenAI Responses API for the status of a deep research request.
 */
export async function pollDeepResearch(responseId: string): Promise<{
  status: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any[] | null;
}> {
  const openai = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (openai.responses as any).retrieve(responseId);

  return {
    status: response.status,
    output: response.status === "completed" ? response.output : null,
  };
}

// ── Step 3: Parse deep research output ──

/**
 * Parses the raw OpenAI Responses API output into structured data:
 * citations, tool trace, claims, and evidence items.
 */
export function parseDeepResearchOutput(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputItems: any[],
  startTimeMs: number
): DeepResearchOutput {
  const toolTrace: DeepResearchToolCall[] = [];
  const citations: DeepResearchCitation[] = [];
  let reportText = "";
  let totalSearches = 0;
  let totalPagesOpened = 0;
  let totalCodeRuns = 0;
  const domainSet = new Set<string>();

  for (const item of outputItems) {
    // Tool calls
    if (item.type === "web_search_call") {
      toolTrace.push({
        id: item.id,
        type: "web_search_call",
        status: item.status ?? "completed",
        action: item.action,
      });
      if (item.action?.type === "search") totalSearches++;
      if (item.action?.type === "open_page") totalPagesOpened++;
    } else if (item.type === "code_interpreter_call") {
      toolTrace.push({
        id: item.id,
        type: "code_interpreter_call",
        status: item.status ?? "completed",
        action: { type: "code", code: item.input },
      });
      totalCodeRuns++;
    } else if (item.type === "mcp_tool_call") {
      toolTrace.push({
        id: item.id,
        type: "mcp_tool_call",
        status: item.status ?? "completed",
      });
    }

    // Message with final report
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (block.type === "output_text") {
          reportText += block.text;

          // Extract inline citations
          if (Array.isArray(block.annotations)) {
            for (const ann of block.annotations) {
              if (ann.url) {
                const citedText = block.text.slice(ann.start_index, ann.end_index);
                citations.push({
                  url: ann.url,
                  title: ann.title ?? "",
                  startIndex: ann.start_index,
                  endIndex: ann.end_index,
                  citedText,
                });

                // Track unique domains
                try {
                  const domain = new URL(ann.url).hostname.replace("www.", "");
                  domainSet.add(domain);
                } catch { /* invalid URL */ }
              }
            }
          }
        }
      }
    }
  }

  // Build evidence items from citations
  const evidence: EvidenceItem[] = citations.map((c) => ({
    url: c.url,
    title: c.title,
    sourceType: classifySourceType(c.url, c.title),
    quote: c.citedText,
    spanStart: c.startIndex,
    spanEnd: c.endIndex,
    reliabilityPrior: computeReliabilityPrior(c.url),
    recencyScore: 0.5, // Default — can be improved with published_at detection
  }));

  // Deduplicate evidence by URL
  const seenUrls = new Set<string>();
  const dedupedEvidence: EvidenceItem[] = [];
  for (const ev of evidence) {
    if (!seenUrls.has(ev.url)) {
      seenUrls.add(ev.url);
      dedupedEvidence.push(ev);
    }
  }

  // Extract claims (lightweight — sentence-level extraction from report)
  const claims = extractClaimsFromReport(reportText, citations);

  return {
    reportText,
    citations,
    toolTrace,
    claims,
    evidence: dedupedEvidence,
    stats: {
      totalSearches,
      totalPagesOpened,
      totalCodeRuns,
      totalCitations: citations.length,
      uniqueDomains: Array.from(domainSet),
      totalDurationMs: Date.now() - startTimeMs,
    },
  };
}

// ── Helpers ──

/** Classify source type from URL and title */
function classifySourceType(url: string, title: string): SourceType {
  const lUrl = url.toLowerCase();
  const lTitle = title.toLowerCase();

  // Academic
  if (
    lUrl.includes("scholar.google") ||
    lUrl.includes("pubmed") ||
    lUrl.includes("doi.org") ||
    lUrl.includes("arxiv.org") ||
    lUrl.includes("jstor.org") ||
    lUrl.includes("ncbi.nlm.nih") ||
    lUrl.includes("semanticscholar") ||
    lUrl.includes("researchgate") ||
    lUrl.includes(".edu/")
  ) return "academic";

  // Government
  if (
    lUrl.includes(".gov") ||
    lUrl.includes("who.int") ||
    lUrl.includes("un.org") ||
    lUrl.includes("worldbank.org") ||
    lUrl.includes("imf.org") ||
    lUrl.includes("oecd.org")
  ) return "government";

  // News
  if (
    lUrl.includes("reuters") ||
    lUrl.includes("bloomberg") ||
    lUrl.includes("nytimes") ||
    lUrl.includes("wsj.com") ||
    lUrl.includes("bbc.") ||
    lUrl.includes("ft.com") ||
    lUrl.includes("economist") ||
    lUrl.includes("apnews") ||
    lUrl.includes("cnbc.com") ||
    lTitle.includes("news")
  ) return "news";

  // Earnings/financial
  if (
    lUrl.includes("sec.gov") ||
    lUrl.includes("investor") ||
    lTitle.includes("earnings") ||
    lTitle.includes("annual report") ||
    lTitle.includes("10-k") ||
    lTitle.includes("10-q")
  ) return "earnings";

  // Organization
  if (
    lUrl.includes("mckinsey") ||
    lUrl.includes("deloitte") ||
    lUrl.includes("gartner") ||
    lUrl.includes("forrester") ||
    lUrl.includes("statista")
  ) return "organization";

  // Social
  if (
    lUrl.includes("twitter.com") ||
    lUrl.includes("x.com") ||
    lUrl.includes("reddit.com") ||
    lUrl.includes("linkedin.com")
  ) return "social";

  // Blog (catch-all for medium, substack, wordpress, etc.)
  if (
    lUrl.includes("medium.com") ||
    lUrl.includes("substack") ||
    lUrl.includes("wordpress") ||
    lUrl.includes("blog")
  ) return "blog";

  return "unknown";
}

/** Compute reliability prior based on source type */
function computeReliabilityPrior(url: string): number {
  const sourceType = classifySourceType(url, "");
  const priors: Record<SourceType, number> = {
    academic: 0.85,
    government: 0.80,
    news: 0.65,
    earnings: 0.75,
    organization: 0.70,
    social: 0.30,
    blog: 0.40,
    unknown: 0.50,
  };
  return priors[sourceType];
}

/**
 * Extract claims from report text using sentence-level heuristics.
 * Identifies assertive statements and maps them to supporting citations.
 */
function extractClaimsFromReport(
  reportText: string,
  citations: DeepResearchCitation[]
): ExtractedClaim[] {
  if (!reportText) return [];

  const claims: ExtractedClaim[] = [];

  // Split into paragraphs, then sentences
  const paragraphs = reportText.split(/\n{2,}/).filter((p) => p.trim().length > 30);

  for (const para of paragraphs) {
    // Split into sentences
    const sentences = para
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.trim().length > 20)
      .map((s) => s.trim());

    for (const sentence of sentences) {
      // Skip headings, lists, etc.
      if (sentence.startsWith("#") || sentence.startsWith("-") || sentence.startsWith("*")) continue;

      // Identify claim-like sentences (contains assertive language)
      const isAssertive = /\b(shows?|finds?|indicates?|suggests?|demonstrates?|reveals?|confirms?|causes?|leads? to|results? in|according to|research shows|studies? show|evidence suggests|data indicates)\b/i.test(sentence);
      const isMechanism = /\b(because|through|via|mechanism|pathway|mediates?|driven by|caused by)\b/i.test(sentence);
      const isPrediction = /\b(will|likely|expect|forecast|project|predict|anticipate)\b/i.test(sentence);
      const isContradiction = /\b(however|contrary|contradicts?|despite|although|inconsistent)\b/i.test(sentence);

      if (!isAssertive && !isMechanism && !isPrediction && !isContradiction) continue;

      // Find citations that overlap with this sentence
      const sentenceStart = reportText.indexOf(sentence);
      const sentenceEnd = sentenceStart + sentence.length;
      const supportingCitations = citations
        .map((c, idx) => ({ idx, c }))
        .filter(
          ({ c }) =>
            (c.startIndex >= sentenceStart && c.startIndex <= sentenceEnd) ||
            (c.endIndex >= sentenceStart && c.endIndex <= sentenceEnd)
        )
        .map(({ idx }) => idx);

      // Classify claim type
      const claimType: ExtractedClaim["claimType"] = isMechanism
        ? "mechanism"
        : isPrediction
          ? "prediction"
          : isContradiction
            ? "assertion" // Contradictions are assertions about disagreement
            : isAssertive
              ? "finding"
              : "assertion";

      // Confidence based on citation support
      const confidence = supportingCitations.length > 0 ? 0.7 : 0.4;

      claims.push({
        claimText: sentence.slice(0, 500), // Cap length
        claimType,
        confidence,
        supportingCitationIndices: supportingCitations,
      });
    }
  }

  // Limit to top claims (avoid noise)
  return claims.slice(0, 50);
}
