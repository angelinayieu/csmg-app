// ── Evidence extractor ──
//
// Converts raw web-search results (URL + snippet + title) into
// structured `ExtractedEvidence` objects ready for persistence into
// `evidence_items` + linking into `claims`. This is what actually
// populates the schema that's been sitting empty since 20260412.
//
// Two-part pipeline:
//   1. Classify the URL → authority + reliability (no LLM, cheap)
//   2. One batch LLM call extracts verbatim quote + paraphrased claim
//      + claim type + which entities it relates to + support direction
//
// The LLM call uses gpt-4o-mini (not Opus) — extraction is a
// structured pattern-match task, not creative reasoning. ~$0.002 per
// batch of 10 results. Cheap enough to run on every research phase.

import { llmJSON } from "@/lib/llm";
import {
  classifySource,
  type SourceClassification,
} from "./source-classifier";

export interface RawSearchResult {
  url: string;
  title: string | null;
  snippet: string;
  published_at?: string | null;
}

export interface ExtractedEvidence {
  url: string;
  title: string | null;
  source_classification: SourceClassification;
  /** Verbatim passage from the source. Kept faithful to the snippet —
   *  no LLM paraphrase. Used as the grounding quote on the evidence
   *  row. */
  quote: string;
  /** Paraphrased assertion derived from the quote. This is what
   *  populates `claims.claim_text` when the evidence gets linked. */
  extracted_claim: string;
  claim_type: "mechanism" | "assertion" | "prediction" | "assumption" | "finding";
  /** Which entities (by UUID) in the current space this evidence
   *  most directly relates to. LLM picks from candidates the caller
   *  passes in. Empty when no clear entity match. */
  relates_to_entity_ids: string[];
  support_type: "supports" | "contradicts" | "contextualizes";
  /** The LLM's own uncertainty about the extraction — not the
   *  reliability of the source. */
  confidence_in_extraction: number;
  /** Composite score used for ranking/filtering in the caller. */
  combined_score: number;
  published_at: string | null;
}

export interface ExtractEvidenceOpts {
  /** The original user query / claim context. Helps the LLM filter
   *  irrelevant search hits. */
  queryContext: string;
  /** Candidate entities the evidence might relate to. Passed by UUID
   *  + name + short description; LLM picks zero-or-more. */
  candidateEntities: Array<{
    id: string;
    name: string;
    description?: string | null;
  }>;
  /** Minimum reliability_prior — drop results below this before even
   *  calling the LLM. Saves extraction cost on low-signal URLs. */
  minReliability?: number;
  /** Cap on how many results to extract. Batched into one LLM call
   *  up to this cap. */
  maxItems?: number;
}

const EXTRACT_SYSTEM_PROMPT = `You are an evidence analyst processing web search results. For each raw search hit, extract:
  1. A VERBATIM quote from the snippet (do not paraphrase in this field — keep it faithful to the source wording).
  2. A paraphrased CLAIM that compresses what the quote is asserting.
  3. The claim type: mechanism / assertion / prediction / assumption / finding.
  4. Which candidate entities (if any) this evidence relates to — pick zero or more from the provided list by id.
  5. Support direction: supports / contradicts / contextualizes — relative to the original query context.
  6. Your own confidence in the extraction (0..1).

Rules:
  • SKIP results that are irrelevant, vague, or obvious SEO content. Return them with confidence_in_extraction < 0.3 so the caller can filter.
  • Quote MUST be ≤300 chars, verbatim from the snippet. If snippet is too vague to quote, skip.
  • Claim should be a falsifiable assertion, not a topic label.
  • relates_to_entity_ids — only include UUIDs that appear in the provided candidates. Zero matches is fine.
  • Use "contextualizes" when evidence provides background/framing but doesn't directly support or contradict a specific claim.

Return strict JSON matching the schema below.`;

interface LlmExtractionOutput {
  results: Array<{
    index: number; // matches input index
    skip: boolean;
    reason?: string;
    quote?: string;
    extracted_claim?: string;
    claim_type?: "mechanism" | "assertion" | "prediction" | "assumption" | "finding";
    relates_to_entity_ids?: string[];
    support_type?: "supports" | "contradicts" | "contextualizes";
    confidence_in_extraction?: number;
  }>;
}

/**
 * Process a batch of raw search results → structured evidence rows.
 * One LLM call per batch (up to maxItems). Drops items flagged as
 * skip or below confidence threshold.
 */
export async function extractEvidenceBatch(
  rawResults: RawSearchResult[],
  opts: ExtractEvidenceOpts,
): Promise<ExtractedEvidence[]> {
  if (rawResults.length === 0) return [];

  const minReliability = opts.minReliability ?? 0.3;
  const maxItems = opts.maxItems ?? 15;

  // Classify + filter BEFORE calling the LLM. No point paying extraction
  // tokens on a content farm that's going to be discarded anyway.
  type PreClassified = {
    raw: RawSearchResult;
    cls: SourceClassification;
    origIndex: number;
  };
  const preClassified: PreClassified[] = rawResults
    .map((raw, i) => ({
      raw,
      cls: classifySource(raw.url, raw.published_at ?? null),
      origIndex: i,
    }))
    .filter((x) => x.cls.reliability_prior >= minReliability)
    .slice(0, maxItems);

  if (preClassified.length === 0) return [];

  // Build the extraction prompt. Results are indexed so the LLM's
  // output can be joined back to the classification even if order
  // shifts.
  const resultsBlock = preClassified
    .map(
      (p, i) =>
        `[${i}] URL: ${p.raw.url}
Title: ${p.raw.title ?? "(none)"}
Snippet: ${p.raw.snippet.slice(0, 800)}
---`,
    )
    .join("\n");

  const candidatesBlock = opts.candidateEntities
    .slice(0, 20)
    .map(
      (e) =>
        `• ${e.id} — ${e.name}${e.description ? ` (${e.description.slice(0, 120)})` : ""}`,
    )
    .join("\n");

  const userPrompt = `Original query context:
${opts.queryContext}

Candidate entities this evidence might relate to:
${candidatesBlock || "(none supplied — return [] for relates_to_entity_ids)"}

Search results to process:
${resultsBlock}

Return JSON with this shape:
{
  "results": [
    {
      "index": <0..${preClassified.length - 1}>,
      "skip": <boolean>,
      "reason": <string if skip>,
      "quote": <string ≤300 chars, verbatim>,
      "extracted_claim": <string, paraphrased assertion>,
      "claim_type": "mechanism" | "assertion" | "prediction" | "assumption" | "finding",
      "relates_to_entity_ids": [<uuid strings from candidates>],
      "support_type": "supports" | "contradicts" | "contextualizes",
      "confidence_in_extraction": <0..1>
    }
  ]
}`;

  let llmOut: LlmExtractionOutput;
  try {
    llmOut = await llmJSON<LlmExtractionOutput>({
      system: EXTRACT_SYSTEM_PROMPT,
      user: userPrompt,
      model: "gpt-4o-mini",
      temperature: 0.1,
      maxTokens: 3072,
    });
  } catch (err) {
    console.warn("[evidence-extractor] LLM batch failed, returning empty:", err);
    return [];
  }

  if (!llmOut || !Array.isArray(llmOut.results)) return [];

  // Join LLM output back to pre-classification + filter/validate
  const byIndex = new Map<number, LlmExtractionOutput["results"][number]>();
  for (const r of llmOut.results) {
    if (typeof r.index === "number") byIndex.set(r.index, r);
  }

  const extracted: ExtractedEvidence[] = [];
  for (let i = 0; i < preClassified.length; i++) {
    const pre = preClassified[i];
    const out = byIndex.get(i);
    if (!out || out.skip) continue;
    if (!out.quote || !out.extracted_claim) continue;

    const claimType = out.claim_type ?? "assertion";
    if (
      !(["mechanism", "assertion", "prediction", "assumption", "finding"] as const).includes(
        claimType,
      )
    ) {
      continue;
    }

    const supportType = out.support_type ?? "contextualizes";
    if (!(["supports", "contradicts", "contextualizes"] as const).includes(supportType)) {
      continue;
    }

    const extractionConf =
      typeof out.confidence_in_extraction === "number"
        ? Math.max(0, Math.min(1, out.confidence_in_extraction))
        : 0.5;
    if (extractionConf < 0.3) continue;

    const relatesTo = Array.isArray(out.relates_to_entity_ids)
      ? out.relates_to_entity_ids.filter(
          (id) =>
            typeof id === "string" &&
            opts.candidateEntities.some((c) => c.id === id),
        )
      : [];

    // Combined score: weight reliability × extraction confidence ×
    // recency. Lets the caller rank the final list and truncate to
    // a budget.
    const combined =
      pre.cls.reliability_prior *
      extractionConf *
      (0.7 + 0.3 * pre.cls.recency_score);

    extracted.push({
      url: pre.raw.url,
      title: pre.raw.title,
      source_classification: pre.cls,
      quote: out.quote.slice(0, 300),
      extracted_claim: out.extracted_claim,
      claim_type: claimType,
      relates_to_entity_ids: relatesTo,
      support_type: supportType,
      confidence_in_extraction: extractionConf,
      combined_score: combined,
      published_at: pre.raw.published_at ?? null,
    });
  }

  // Best-first ranking so callers can cap without losing the best
  // items.
  extracted.sort((a, b) => b.combined_score - a.combined_score);
  return extracted;
}
