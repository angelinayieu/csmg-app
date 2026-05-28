// ── Evidence Tier — citation-grounded indicator scoring (Phase 11.6) ─
//
// Activates the dormant research pipeline: every Objective Canvas
// space accumulates surface_research + deep_research bundles (Tavily
// sources, scored, optionally lens-tagged), and every entity can
// have its own detail_research (item-level Tavily search). Until
// now the scoring engine never touched them — variations were graded
// from LLM judgment + structural MC, but never asked "what does the
// LITERATURE say about whether this proxy maps to this outcome?"
//
// Evidence tier closes that gap. For each ensemble-graded indicator,
// the LLM scans the available research sources, identifies citations
// that support OR refute the indicator-outcome link, and emits:
//
//   - evidence_citations[]: each row = one source the LLM judged
//     relevant, classified as supports / refutes / contextual, with
//     a 0..1 relevance score
//   - evidence_strength (0..1): aggregate evidence quality from the
//     citations. Composed via smooth saturating function:
//       net_support = supporting_count - 0.5 × refuting_count
//       evidence_strength = 0.5 + 0.5 × tanh(net_support × 0.4)
//     0 net = 0.5 (neutral, no signal). 2 net supporters ≈ 0.85.
//     5 net supporters → ~0.97 (saturates). Refutations halve the
//     contribution since refuting evidence is rarer + more decisive.
//
// Why ONE LLM call for all indicators × all sources:
//   - Sources are reused across indicators; sending them once is
//     cheaper than once-per-indicator
//   - Cross-indicator coherence: the LLM can see "this source talks
//     about indicator X but not indicator Y" in one pass
//   - Cost: ~1.5k input tokens (sources) + 1.5k output tokens (per-
//     indicator citation list) for typical ~3-5 indicators × ~15
//     sources. Fits in a single Sonnet call comfortably.
//
// Composition with ensemble:
//   final_confidence = ensemble_consensus_confidence × evidence_multiplier
//   where evidence_multiplier = 0.5 + (evidence_strength - 0.5)
//                            = evidence_strength
//   When no evidence available: multiplier = 1.0 (pass-through; no
//   downgrade for unstudied proxies — let the ensemble grade stand).
//
// Output: extends each indicator_score with evidence_citations[] +
// evidence_strength + (optionally) evidence_weighted_confidence.

import { llmJSON } from "@/lib/llm";
import type { ResearchSource } from "@/lib/research/research-service";

// ── Public types ──────────────────────────────────────────────────

export type EvidenceClassification = "supports" | "refutes" | "contextual";

export interface EvidenceCitation {
  /** Index into the source list THIS scorer was given. Stable within
   *  a single run; clients should use source_url/title for cross-run
   *  references. */
  source_idx: number;
  source_title: string;
  source_url: string;
  /** Snippet from the source — the same text the LLM cited from. */
  source_snippet: string;
  /** Optional lens tag from deep_research (frameworks / precedents
   *  / mechanisms / failure_modes / metrics). Lets the UI tier
   *  citations by research lens. */
  source_lens?: string;
  /** How this source relates to the indicator-outcome link. */
  classification: EvidenceClassification;
  /** 0..1 — how relevant + reliable IS this citation for this
   *  specific claim. Drives sort order in the UI. */
  relevance: number;
  /** One sentence — the LLM's argument for why this source
   *  supports/refutes the claim. */
  argument: string;
}

export interface IndicatorEvidenceResult {
  indicator_text: string;
  outcome_id: string;
  citations: EvidenceCitation[];
  /** Aggregate strength signal (0..1). 0.5 = no signal (no
   *  citations or balanced supports/refutes). Above 0.5 = net
   *  supporting evidence; below = net refuting. */
  evidence_strength: number;
  /** Convenience: counts so the UI can render "3✓ 1✗ 2·" without
   *  iterating citations. */
  supports_count: number;
  refutes_count: number;
  contextual_count: number;
}

export interface EvidenceScoreEnvelope {
  status: "ok" | "no_sources" | "no_indicators" | "llm_failed";
  status_detail: string | null;
  indicator_results: IndicatorEvidenceResult[];
  scored_at: string;
  /** Per-source registry — convenience for the UI so it can render
   *  full source cards without re-fetching. */
  sources_used: ResearchSource[];
}

export interface EvidenceContext {
  /** Verbatim indicator text + parent outcome id; one entry per
   *  unique indicator across all variations. Caller dedupes. */
  indicators: Array<{ indicator_text: string; outcome_id: string; outcome_name: string }>;
  /** Pooled source list — caller concats item-level detail_research +
   *  space deep_research (+ surface_research if desired) and dedupes
   *  by URL. Up to MAX_SOURCES kept by score desc. */
  sources: ResearchSource[];
  /** Feature being scored — context for the LLM ("does this source
   *  support [indicator] for measuring [outcome] when intervening
   *  with [feature]"). */
  feature_name: string;
  /** Room context. */
  sub_objective_title: string;
}

const MAX_SOURCES = 18;
const MAX_CITATIONS_PER_INDICATOR = 6;

// ── Aggregation math ──────────────────────────────────────────────

/** Smooth saturating composition of supports / refutes into a single
 *  0..1 evidence_strength. Designed so that:
 *   - No evidence (0 supports, 0 refutes) → 0.5 (neutral, pass-through
 *     multiplier when composed with ensemble confidence)
 *   - 2 net supporters → ~0.85 (clearly positive but not certain)
 *   - 5 net supporters → ~0.97 (saturates — diminishing returns
 *     prevent citation-stuffing from inflating beyond what the
 *     ensemble already established)
 *   - Refuters count double in impact since refuting evidence is
 *     rarer + more decisive. */
function computeEvidenceStrength(
  supports: number,
  refutes: number,
): number {
  const netSupport = supports - 0.5 * refutes;
  // tanh scaled by 0.4 — saturates at ±2.5 net, smooth around 0
  return 0.5 + 0.5 * Math.tanh(netSupport * 0.4);
}

// ── Prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an evidence aggregator. For each proxy indicator, you scan a pool of research sources and identify which ones SUPPORT or REFUTE the claim that this indicator validly measures its parent outcome.

For EACH indicator, return up to ${MAX_CITATIONS_PER_INDICATOR} citations from the provided sources. Each citation carries:
  - source_idx (the source's [N] number from the SOURCES block)
  - classification: "supports" (source provides evidence the indicator IS a valid measure of the outcome), "refutes" (source argues the indicator is misleading, gameable, or weakly correlated), or "contextual" (source is relevant but doesn't take a position on validity)
  - relevance (0..1): how directly the source addresses THIS indicator's relationship to the outcome — a tangential mention scores 0.3; a paper specifically validating this proxy scores 0.9
  - argument: ONE sentence — your reasoning for the classification

Rules:
  - Cite ONLY sources whose snippet text genuinely contains information about the indicator. Do NOT cite based on title alone if the snippet is empty or unrelated.
  - Mark a source "refutes" ONLY when it explicitly argues against the proxy. "Doesn't mention" is NOT refutation.
  - When a single source supports multiple indicators, cite it under each — don't artificially exclude.
  - Sources that ONLY discuss the OUTCOME (not the indicator) are "contextual" — they confirm the outcome matters but don't validate the proxy.
  - When ZERO sources support an indicator, return an empty citations array. Do not invent citations.

Return JSON matching the response schema. No prose outside the JSON.`;

function buildUserPrompt(ctx: EvidenceContext): string {
  const sourcesBlock = ctx.sources
    .slice(0, MAX_SOURCES)
    .map(
      (s, i) =>
        `[${i + 1}]${s.lens ? ` (${s.lens})` : ""} ${s.title}
  url: ${s.url}
  snippet: ${s.snippet.slice(0, 400)}`,
    )
    .join("\n\n");

  const indicatorsBlock = ctx.indicators
    .map(
      (ind, i) =>
        `[Indicator ${i + 1}] "${ind.indicator_text}" (under outcome "${ind.outcome_name}" id=${ind.outcome_id})`,
    )
    .join("\n");

  return `FEATURE being evaluated:
  ${ctx.feature_name}

ROOM:
  ${ctx.sub_objective_title}

INDICATORS to ground in evidence (${ctx.indicators.length} total):
${indicatorsBlock}

SOURCES (${Math.min(ctx.sources.length, MAX_SOURCES)} total — cite by [N] index):

${sourcesBlock}

Return one indicator_evidence entry per indicator, citing the indicator by its indicator_index (the 1-based number from the list above) — never rephrase the indicator. List up to ${MAX_CITATIONS_PER_INDICATOR} citations per indicator. Sources that don't validly cite ANY indicator should not appear in any citation list.`;
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    indicator_evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          // 1-based index into the canonical pre-generated indicator
          // list; text/outcome resolved server-side (no drift).
          indicator_index: { type: "number" },
          citations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                source_idx: { type: "number" },
                classification: {
                  type: "string",
                  enum: ["supports", "refutes", "contextual"],
                },
                relevance: { type: "number" },
                argument: { type: "string" },
              },
              required: [
                "source_idx",
                "classification",
                "relevance",
                "argument",
              ],
            },
          },
        },
        required: ["indicator_index", "citations"],
      },
    },
  },
  required: ["indicator_evidence"],
} as const;

// ── Public scorer ─────────────────────────────────────────────────

/** Run the evidence scorer over a pool of sources and a set of
 *  unique indicators. ONE LLM call. Soft-fails on empty sources
 *  (returns status="no_sources") or empty indicators ("no_indicators").
 *  Caller composes the resulting evidence_strength into ensemble
 *  consensus_confidence to get the final evidence-weighted confidence. */
export async function scoreIndicatorsWithEvidence(
  ctx: EvidenceContext,
): Promise<EvidenceScoreEnvelope> {
  const now = new Date().toISOString();

  if (ctx.indicators.length === 0) {
    return {
      status: "no_indicators",
      status_detail: "No indicators provided.",
      indicator_results: [],
      scored_at: now,
      sources_used: [],
    };
  }
  if (ctx.sources.length === 0) {
    return {
      status: "no_sources",
      status_detail:
        "No research sources available — surface/deep research has not populated for this space, or item-level research hasn't been run.",
      indicator_results: [],
      scored_at: now,
      sources_used: [],
    };
  }

  const usedSources = ctx.sources.slice(0, MAX_SOURCES);

  let raw: {
    indicator_evidence?: Array<{
      indicator_index?: unknown;
      citations?: Array<{
        source_idx?: unknown;
        classification?: unknown;
        relevance?: unknown;
        argument?: unknown;
      }>;
    }>;
  };
  try {
    raw = await llmJSON({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ ...ctx, sources: usedSources }),
      responseSchema: {
        name: "indicator_evidence",
        schema: RESPONSE_SCHEMA,
      },
      temperature: 0.2,
      maxTokens: 3500,
    });
  } catch (err) {
    return {
      status: "llm_failed",
      status_detail:
        err instanceof Error ? err.message.slice(0, 240) : String(err),
      indicator_results: [],
      scored_at: now,
      sources_used: usedSources,
    };
  }

  // ── Validate + clean ──
  const indicator_results: IndicatorEvidenceResult[] = [];
  const seenIdx = new Set<number>();

  for (const row of raw?.indicator_evidence ?? []) {
    // Resolve from the 1-based index into the canonical pre-generated
    // list (ctx.indicators) — the persisted indicator_text/outcome_id
    // are therefore the real values, so this evidence overlay attaches
    // to the correct indicator row. Out-of-range dropped; repeats deduped.
    const idx =
      typeof row?.indicator_index === "number" &&
      Number.isFinite(row.indicator_index)
        ? Math.round(row.indicator_index)
        : NaN;
    const matched = Number.isFinite(idx) ? ctx.indicators[idx - 1] : undefined;
    if (!matched || seenIdx.has(idx)) continue;
    seenIdx.add(idx);

    const citations: EvidenceCitation[] = [];
    let supports = 0;
    let refutes = 0;
    let contextual = 0;

    for (const c of row?.citations ?? []) {
      const source_idx_raw =
        typeof c?.source_idx === "number" ? c.source_idx : -1;
      // LLM uses 1-based indexing per the prompt; convert to 0-based
      const source_idx = source_idx_raw - 1;
      if (
        source_idx < 0 ||
        source_idx >= usedSources.length ||
        !Number.isFinite(source_idx_raw)
      ) {
        continue;
      }
      const classification: EvidenceClassification =
        c?.classification === "supports" ||
        c?.classification === "refutes" ||
        c?.classification === "contextual"
          ? c.classification
          : "contextual";
      const relevance =
        typeof c?.relevance === "number" && Number.isFinite(c.relevance)
          ? Math.max(0, Math.min(1, c.relevance))
          : 0.5;
      const argument =
        typeof c?.argument === "string"
          ? c.argument.trim().slice(0, 280)
          : "";
      const src = usedSources[source_idx];
      citations.push({
        source_idx,
        source_title: src.title,
        source_url: src.url,
        source_snippet: src.snippet.slice(0, 240),
        source_lens: src.lens,
        classification,
        relevance,
        argument,
      });
      if (classification === "supports") supports += 1;
      else if (classification === "refutes") refutes += 1;
      else contextual += 1;
      if (citations.length >= MAX_CITATIONS_PER_INDICATOR) break;
    }

    // Sort citations by classification priority (supports > refutes >
    // contextual) then by relevance desc. The UI shows the most
    // load-bearing citation first.
    citations.sort((a, b) => {
      const order: Record<EvidenceClassification, number> = {
        supports: 0,
        refutes: 1,
        contextual: 2,
      };
      const co = order[a.classification] - order[b.classification];
      if (co !== 0) return co;
      return b.relevance - a.relevance;
    });

    indicator_results.push({
      indicator_text: matched.indicator_text,
      outcome_id: matched.outcome_id,
      citations,
      evidence_strength: computeEvidenceStrength(supports, refutes),
      supports_count: supports,
      refutes_count: refutes,
      contextual_count: contextual,
    });
  }

  return {
    status: indicator_results.length > 0 ? "ok" : "llm_failed",
    status_detail:
      indicator_results.length === 0
        ? "LLM returned no usable citations."
        : null,
    indicator_results,
    scored_at: now,
    sources_used: usedSources,
  };
}

/** Convenience: build the evidence context from an item's
 *  detail_research + space-level deep_research + surface_research.
 *  De-dupes by URL, sorts by score desc, caps at MAX_SOURCES.
 *  Drops sources with empty snippets (nothing for the LLM to cite). */
export function buildEvidenceSourcePool(input: {
  item_research?: { sources?: ResearchSource[] } | null;
  deep_research?: { all_sources?: ResearchSource[] } | null;
  surface_research?: { sources?: ResearchSource[] } | null;
}): ResearchSource[] {
  const pool: ResearchSource[] = [];
  const seenUrls = new Set<string>();
  function add(s: ResearchSource | undefined | null) {
    if (!s || typeof s.url !== "string" || s.url.length === 0) return;
    if (typeof s.snippet !== "string" || s.snippet.trim().length === 0)
      return;
    if (seenUrls.has(s.url)) return;
    seenUrls.add(s.url);
    pool.push(s);
  }
  // Item-level first (most specific), then deep, then surface
  for (const s of input.item_research?.sources ?? []) add(s);
  for (const s of input.deep_research?.all_sources ?? []) add(s);
  for (const s of input.surface_research?.sources ?? []) add(s);
  // Sort by score desc — Tavily relevance is the proxy for source
  // quality. Caller slices to MAX_SOURCES.
  pool.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return pool;
}
