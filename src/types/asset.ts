// ── Asset types ─────────────────────────────────────────────────────
//
// Assets are first-class user-provided inputs that feed the pipeline
// alongside the intake prompt. They land via /api/ingest (PDF / DOCX /
// URL / pasted text / image) and persist to the existing `ingested_files`
// table with extra columns added by 20260605_assets_and_situation_baseline:
// asset_class, preextracted_entity_ids, uncertainty_resolved.
//
// Asset class drives downstream pipeline behavior:
//   - research_pdf, prior_analysis  → treated as evidence the situation
//                                     analyzer leans on for knowns
//   - spec_sheet, internal_doc      → treated as structure the
//                                     analyzer extracts as inputs/process
//   - dataset                       → treated as observation that gets
//                                     a current-state metric
//   - image_diagram                 → treated as visual structure (OCR'd
//                                     content folded into intake_text)
//   - web_article                   → treated as supporting context
//   - pasted_text                   → treated as supplemental intake
//
// See supabase/migrations/20260605_assets_and_situation_baseline.sql.

export type AssetClass =
  | "research_pdf"
  | "internal_doc"
  | "dataset"
  | "image_diagram"
  | "prior_analysis"
  | "spec_sheet"
  | "web_article"
  | "pasted_text";

export interface AssetRow {
  id: string;
  user_id: string;
  space_id: string | null;
  source_type: "file" | "url" | "text";
  source_name: string;
  mime_type: string | null;
  source_url: string | null;
  normalized_text: string;
  raw_chars: number;
  normalized_chars: number;
  extraction_method: string | null;
  metadata: Record<string, unknown>;
  asset_class: AssetClass | null;
  preextracted_entity_ids: string[];
  uncertainty_resolved: string[];
  created_at: string;
  updated_at: string;
}

/**
 * Heuristic to classify uploads when the caller hasn't specified.
 * Mime type + filename signals first; content keywords as a fallback.
 * Returns null when the heuristic isn't confident — caller can
 * default to internal_doc or run the LLM classifier.
 */
export function inferAssetClass(args: {
  sourceType: "file" | "url" | "text";
  mimeType: string | null;
  sourceName: string;
  contentSnippet?: string; // first ~500 chars of normalized text
}): AssetClass {
  const { sourceType, mimeType, sourceName, contentSnippet } = args;
  const lowerName = sourceName.toLowerCase();
  const lowerSnippet = (contentSnippet ?? "").toLowerCase();

  // Source-type fast paths.
  if (sourceType === "url") return "web_article";
  if (sourceType === "text") return "pasted_text";

  // Image → diagram.
  if (mimeType && mimeType.startsWith("image/")) return "image_diagram";

  // CSV / Excel / TSV → dataset.
  if (
    mimeType?.includes("csv") ||
    mimeType?.includes("spreadsheet") ||
    mimeType?.includes("excel") ||
    /\.(csv|tsv|xlsx|xls)$/i.test(sourceName)
  ) {
    return "dataset";
  }

  // PDF/DOCX with research-leaning filename → research_pdf.
  // Filename signal is reliable for the "user uploaded an academic
  // paper" case; we don't try to LLM-classify the content here
  // (that's the situation analyzer's job).
  if (
    /paper|study|research|whitepaper|article|journal|preprint|arxiv/.test(
      lowerName,
    )
  ) {
    return "research_pdf";
  }

  // Spec / requirements / RFC / brief → spec_sheet.
  if (/spec|requirement|rfc|brief|sow|prd|datasheet/.test(lowerName)) {
    return "spec_sheet";
  }

  // Prior analysis if the filename screams "report" / "analysis".
  if (/analysis|report|memo|summary|assessment|review/.test(lowerName)) {
    return "prior_analysis";
  }

  // Content-based fallback for short snippets.
  if (lowerSnippet) {
    if (/abstract|methodology|references\b|et al\./.test(lowerSnippet)) {
      return "research_pdf";
    }
    if (/this report|in this analysis|recommendations?:/.test(lowerSnippet)) {
      return "prior_analysis";
    }
  }

  // Default for everything else (PDFs, DOCX without obvious signal):
  // internal_doc — the user uploaded a document, we don't know what
  // kind, but it's structural content.
  return "internal_doc";
}

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  research_pdf: "Research",
  internal_doc: "Document",
  dataset: "Dataset",
  image_diagram: "Diagram",
  prior_analysis: "Prior analysis",
  spec_sheet: "Spec",
  web_article: "Article",
  pasted_text: "Pasted text",
};

export const ASSET_CLASS_ACCENT: Record<AssetClass, string> = {
  research_pdf: "#7C3AED", // violet — evidence-tier
  internal_doc: "#0891B2", // cyan — neutral document
  dataset: "#059669", // emerald — observation
  image_diagram: "#D97706", // amber — visual structure
  prior_analysis: "#9333EA", // deep violet — synthesized evidence
  spec_sheet: "#2563EB", // blue — structural specification
  web_article: "#64748B", // slate — supporting context
  pasted_text: "#475569", // slate dark — supplemental intake
};
