// ── Deep-research → evidence_registries bridge (Phase 2) ──────────
//
// Closes the silo between `evidence_items` (URL + verbatim-quote
// rows produced by deep-research) and `evidence_registries` (the
// L2M-disciplined effect-size + temporal substrate populated from
// PDFs). Both contain "what a paper said," but they're consumed
// differently:
//
//   • evidence_items / claims   → narrative report substrate, drives
//     the research-deep panel + claim-evidence links.
//   • evidence_registries       → rigor substrate; participates in
//     edge-strength pooling (Phase 6A), edge-temporal pooling
//     (Phase 3), and the strategizer's signals.
//
// Without this bridge, deep-research can populate the narrative
// surface but it cannot feed the rigor pipeline — magnitude + timing
// claims surfaced from the web sit unused as far as edge pooling is
// concerned. The bridge re-runs the SAME extract-effect-sizes /
// extract-temporal primitives that PDF ingestion uses, but over the
// deep-research reportText, and writes the resulting extractions to
// evidence_registries with provenance tagged source='deep_research'.
//
// PIPELINE
//
//   /api/pipeline/research-deep (action='poll' completed)
//     └─→ parseDeepResearchOutput → reportText + citations
//          └─→ THIS BRIDGE
//               ├─→ extractEffectSizes(reportText)
//               │     └─→ evidence_registries (effect-size half)
//               └─→ extractTemporal(reportText)
//                     └─→ evidence_registries (temporal half)
//
// SOFT-FAIL DISCIPLINE
//
// Per-extraction insert errors are logged and surfaced via the
// summary's error counts. Extraction failure (LLM call fails) is
// silently soft-failed — the deep-research result itself still
// persists via the existing evidence_items/claims path; the bridge
// is the rigor add-on, not a blocking step.

import { extractEffectSizes } from "@/lib/extraction/extract-effect-sizes";
import { extractTemporal } from "@/lib/extraction/extract-temporal";
import type { DeepResearchCitation, DeepResearchOutput } from "@/types/deep-research";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// `evidence_registries` is not tracked in database.types.ts (the
// existing extract-effect-sizes route uses an any-cast for its
// inserts). We follow the same pattern: build a plain object payload
// that mirrors the column set on the table.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EvidenceRegistryInsert = Record<string, any>;

export interface BridgeResult {
  effect_size_extractions: number;
  effect_size_inserted: number;
  temporal_extractions: number;
  temporal_inserted: number;
  errors: Array<{ stage: string; message: string }>;
}

export interface BridgeOpts {
  /** Free-text scoped to keep extraction relevant (e.g. the user's
   *  research goal). Same goalContext flag the PDF-ingest path uses. */
  goalContext?: string | null;
  /** Override the LLM model. Defaults match the underlying primitives. */
  model?: string;
}

/** Run the rigor primitives over a deep-research report and persist
 *  the extractions to evidence_registries. Each row is tagged with
 *  source='deep_research' provenance + the most-overlapping citation
 *  URL so reviewers can trace claims back to their web source. */
export async function bridgeDeepResearchToEvidenceRegistries(
  db: AnyDb,
  spaceId: string,
  userId: string,
  parsed: DeepResearchOutput,
  opts: BridgeOpts = {},
): Promise<BridgeResult> {
  const summary: BridgeResult = {
    effect_size_extractions: 0,
    effect_size_inserted: 0,
    temporal_extractions: 0,
    temporal_inserted: 0,
    errors: [],
  };

  const reportText = parsed.reportText ?? "";
  if (reportText.trim().length < 200) {
    // Too short to extract anything meaningful — soft-skip.
    return summary;
  }

  // Synthetic source name for the primitives (they expect a
  // source_name for grounding). Deep research isn't a single
  // artifact, so we tag it as such.
  const sourceName = "deep_research_report";

  // ── Effect-size pass ──
  let effectSizes;
  try {
    effectSizes = await extractEffectSizes({
      assetId: "deep_research", // synthetic — not a real ingested_files row
      sourceName,
      artifactClass: "research_report",
      artifactText: reportText,
      goalContext: opts.goalContext ?? null,
      model: opts.model,
    });
    summary.effect_size_extractions = effectSizes.extractions.length;
  } catch (err) {
    summary.errors.push({
      stage: "extract_effect_sizes",
      message: err instanceof Error ? err.message : String(err),
    });
    effectSizes = null;
  }

  // ── Temporal pass ──
  let temporal;
  try {
    temporal = await extractTemporal({
      assetId: "deep_research",
      sourceName,
      artifactClass: "research_report",
      artifactText: reportText,
      goalContext: opts.goalContext ?? null,
      model: opts.model,
    });
    summary.temporal_extractions = temporal.extractions.length;
  } catch (err) {
    summary.errors.push({
      stage: "extract_temporal",
      message: err instanceof Error ? err.message : String(err),
    });
    temporal = null;
  }

  // ── Persist ──

  // Effect-size rows.
  if (effectSizes) {
    for (const e of effectSizes.extractions) {
      const insertRow = effectSizeToInsert(
        e,
        spaceId,
        userId,
        parsed.citations,
        reportText,
      );
      const { error } = await db
        .from("evidence_registries")
        .insert(insertRow);
      if (error) {
        summary.errors.push({
          stage: `insert_effect_size:${e.local_id}`,
          message: error.message ?? "unknown insert error",
        });
        continue;
      }
      summary.effect_size_inserted++;
    }
  }

  // Temporal rows.
  if (temporal) {
    for (const e of temporal.extractions) {
      const insertRow = temporalToInsert(
        e,
        spaceId,
        userId,
        parsed.citations,
        reportText,
      );
      const { error } = await db
        .from("evidence_registries")
        .insert(insertRow);
      if (error) {
        summary.errors.push({
          stage: `insert_temporal:${e.local_id}`,
          message: error.message ?? "unknown insert error",
        });
        continue;
      }
      summary.temporal_inserted++;
    }
  }

  return summary;
}

// ── Mapping helpers ──────────────────────────────────────────────

/** Find the citation whose annotated span overlaps with the given
 *  source quote. The deep-research engine annotates each citation
 *  with start/end character offsets in reportText; we look up where
 *  the quote appears and pick the citation that spans that location.
 *  Returns null when no overlap (the LLM may have synthesized a
 *  quote that combines multiple citations). */
function findOverlappingCitation(
  quote: string | null,
  reportText: string,
  citations: DeepResearchCitation[],
): DeepResearchCitation | null {
  if (!quote || citations.length === 0 || reportText.length === 0)
    return null;
  const idx = reportText.indexOf(quote.slice(0, 200));
  if (idx < 0) return null;
  const end = idx + quote.length;
  let best: DeepResearchCitation | null = null;
  let bestOverlap = 0;
  for (const c of citations) {
    const overlap = Math.max(
      0,
      Math.min(c.endIndex, end) - Math.max(c.startIndex, idx),
    );
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = c;
    }
  }
  return best;
}

type EffectSizeExtraction =
  Awaited<ReturnType<typeof extractEffectSizes>>["extractions"][number];

type TemporalExtraction =
  Awaited<ReturnType<typeof extractTemporal>>["extractions"][number];

function effectSizeToInsert(
  e: EffectSizeExtraction,
  spaceId: string,
  userId: string,
  citations: DeepResearchCitation[],
  reportText: string,
): EvidenceRegistryInsert {
  const citation = findOverlappingCitation(
    e.source.quote,
    reportText,
    citations,
  );

  // Tag the L2M provenance halves so reviewers can tell this row
  // came from deep research, not a PDF.
  const llm_label_provenance = {
    ...e.llm_label_provenance,
    source: "deep_research",
    ...(citation
      ? { source_url: citation.url, source_title: citation.title }
      : {}),
  };
  const parser_provenance = e.parser_provenance
    ? {
        ...e.parser_provenance,
        flags: [...e.parser_provenance.flags, "from_deep_research"],
      }
    : null;
  const flags = [...e.flags];
  if (!flags.includes("from_deep_research")) flags.push("from_deep_research");

  return {
    space_id: spaceId,
    ingested_file_id: null, // deep-research rows are not tied to a single file
    user_id: userId,
    status: "extracted",
    outcome_label: e.outcome_label,
    instrument_label: e.instrument_label,
    intervention_label: e.intervention_label,
    comparator_label: e.comparator_label,
    population_label: e.population_label,
    effect_size: e.effect_size,
    effect_metric: e.effect_metric,
    ci_lower: e.ci_lower,
    ci_upper: e.ci_upper,
    ci_level: e.ci_level,
    p_value: e.p_value,
    standard_error: e.standard_error,
    n_treatment: e.n_treatment,
    n_control: e.n_control,
    followup_weeks: e.followup_weeks,
    followup_label: e.followup_label,
    study_design: e.study_design,
    blinding: e.blinding,
    source_page: e.source.page,
    source_quote: e.source.quote,
    llm_label_provenance,
    parser_provenance,
    extraction_confidence: e.extraction_confidence,
    flags,
  } as EvidenceRegistryInsert;
}

function temporalToInsert(
  e: TemporalExtraction,
  spaceId: string,
  userId: string,
  citations: DeepResearchCitation[],
  reportText: string,
): EvidenceRegistryInsert {
  const citation = findOverlappingCitation(
    e.source.quote,
    reportText,
    citations,
  );

  const temporal_llm_provenance = {
    ...e.llm_provenance,
    source: "deep_research",
    ...(citation
      ? { source_url: citation.url, source_title: citation.title }
      : {}),
  };
  const temporal_parser_provenance = e.parser_provenance
    ? {
        ...e.parser_provenance,
        flags: [...e.parser_provenance.flags, "from_deep_research"],
      }
    : null;
  const temporal_flags = [...e.flags];
  if (!temporal_flags.includes("from_deep_research"))
    temporal_flags.push("from_deep_research");

  return {
    space_id: spaceId,
    ingested_file_id: null,
    user_id: userId,
    status: "extracted",
    outcome_label: e.outcome_label,
    instrument_label: e.instrument_label,
    intervention_label: e.intervention_label,
    comparator_label: e.comparator_label,
    population_label: e.population_label,
    study_design: e.study_design,
    source_page: e.source.page,
    source_quote: e.source.quote,
    onset_days: e.onset_days,
    onset_days_ci_lower: e.onset_days_ci_lower,
    onset_days_ci_upper: e.onset_days_ci_upper,
    peak_days: e.peak_days,
    peak_days_ci_lower: e.peak_days_ci_lower,
    peak_days_ci_upper: e.peak_days_ci_upper,
    persistence_days: e.persistence_days,
    persistence_days_ci_lower: e.persistence_days_ci_lower,
    persistence_days_ci_upper: e.persistence_days_ci_upper,
    decay_kinetics: e.decay_kinetics,
    time_points: e.time_points,
    temporal_evidence_quote: e.temporal_evidence_quote,
    temporal_extraction_method: e.temporal_extraction_method,
    temporal_flags,
    temporal_llm_provenance,
    temporal_parser_provenance,
    temporal_extraction_confidence: e.extraction_confidence,
  } as EvidenceRegistryInsert;
}
