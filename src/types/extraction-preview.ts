// ── Extraction preview types ─────────────────────────────────────────
//
// Shapes for the HITL extraction-checklist flow (the input-side gap
// from docs/KG_DEPTH_CRITIQUE.md). Today's intake auto-extracts 3-8
// entities from every uploaded asset and writes them straight to the
// KG. The HITL flow inserts a review step:
//
//   ingest → preview (15-30 candidates) → user reviews + filters →
//   extract (commits selected)
//
// These types are the canonical shape exchanged between the preview
// route, the cached `ingested_files.extraction_preview` JSONB column
// (migration 20260612), the ExtractionChecklistDrawer UI, and the
// extract route.

// ── Extraction category ─────────────────────────────────────────────
//
// Richer than entity_category. Captures the SHAPE of the candidate so
// the user can filter by domain-relevant slices: "show me only the
// effect_size and finding candidates from this paper, skip the actor
// and tool ones." Each category also implies a default entity_category
// when committed — see CATEGORY_TO_ENTITY_CATEGORY below.

export const EXTRACTION_CATEGORIES = [
  /** Theory, framework, principle, abstract idea. Most common in
   *  research papers and conceptual prose. */
  "concept",
  /** Quantitative finding with magnitude — e.g. "intervention raised
   *  retention 12pp." Specific to research/dataset assets. */
  "effect_size",
  /** Methodology, technique, approach, protocol. */
  "method",
  /** Observation, result, claim, qualitative finding without
   *  quantitative magnitude. */
  "finding",
  /** Person, organization, role, team. */
  "actor",
  /** Measurable variable / KPI — distinct from effect_size in that a
   *  metric is a measurement target, not a measured outcome. */
  "metric",
  /** Causal explanation — "X causes Y because Z mediates." */
  "mechanism",
  /** Boundary condition, constraint, qualifier on when something
   *  applies. */
  "condition",
  /** Goal, target, desired result. */
  "outcome",
  /** Concrete tool, artifact, instrument, dataset reference. */
  "tool",
] as const;

export type ExtractionCategory = (typeof EXTRACTION_CATEGORIES)[number];

export function isExtractionCategory(x: unknown): x is ExtractionCategory {
  return (
    typeof x === "string" &&
    (EXTRACTION_CATEGORIES as readonly string[]).includes(x)
  );
}

/**
 * Maps the rich extraction category onto the coarser
 * `entity_category` enum the entities table accepts. Used by the
 * commit path to set entity_category when persisting.
 */
export const CATEGORY_TO_ENTITY_CATEGORY: Record<
  ExtractionCategory,
  "concrete" | "abstract" | "process" | "outcome" | "constraint" | null
> = {
  concept: "abstract",
  effect_size: "outcome",
  method: "process",
  finding: "abstract",
  actor: "concrete",
  metric: "abstract",
  mechanism: "process",
  condition: "constraint",
  outcome: "outcome",
  tool: "concrete",
};

// ── Focus level ─────────────────────────────────────────────────────
//
// User-controllable depth selector on the drawer. Maps to a target
// count of selected candidates the "Select suggested" button uses,
// AND to the LLM prompt's max_candidates parameter on preview.
// Stored on commit as ingested_files.extraction_target_count for
// future re-runs to default to the user's prior choice.

export const FOCUS_LEVELS = [
  "shallow", // ~5 candidates — just the load-bearing names
  "moderate", // ~12 candidates — what most users want
  "deep", // ~25 candidates — research-paper-grade extraction
  "exhaustive", // all candidates the LLM proposed
] as const;

export type FocusLevel = (typeof FOCUS_LEVELS)[number];

export function isFocusLevel(x: unknown): x is FocusLevel {
  return (
    typeof x === "string" && (FOCUS_LEVELS as readonly string[]).includes(x)
  );
}

/**
 * Target count per focus level. Drives both the LLM prompt's
 * max-candidates instruction at preview time AND the "Select
 * suggested" button's auto-select count post-preview.
 */
export const FOCUS_LEVEL_TARGETS: Record<FocusLevel, number> = {
  shallow: 5,
  moderate: 12,
  deep: 25,
  exhaustive: 999, // effectively unbounded; commit logic clamps to candidates.length
};

export const DEFAULT_FOCUS_LEVEL: FocusLevel = "moderate";

// ── Candidate shape ─────────────────────────────────────────────────

export interface ExtractionCandidate {
  /** Stable client-side id (UUID) used for selection. Generated at
   *  preview time so the drawer can track checked state by id rather
   *  than by name (which the user may not be able to disambiguate
   *  between near-duplicates). */
  id: string;
  /** Short noun phrase the candidate represents. */
  name: string;
  /** One-sentence description, drawn from the asset content (NOT
   *  fabricated). */
  description: string | null;
  /** Rich category (see EXTRACTION_CATEGORIES). */
  category: ExtractionCategory;
  /** LLM self-rated confidence the candidate is meaningfully present
   *  vs incidentally mentioned. 0..1. */
  confidence: number;
  /** Short verbatim quote from the asset content (≤200 chars) that
   *  grounds the candidate. Used in the drawer as italicized
   *  evidence under the candidate name. null when the LLM couldn't
   *  point to a single load-bearing sentence. */
  evidence_quote: string | null;
  /** Pre-checked by default in the drawer iff true. The "Select
   *  suggested" button selects exactly the items where this is true.
   *  LLM picks suggestions based on confidence × category-relevance
   *  to the user's intake_text. */
  suggested: boolean;
}

// ── Paper metadata (P6) ──────────────────────────────────────────────
//
// Extracted at preview time alongside the candidate list. Lets the UI
// show "Smith et al. 2023" / paper title instead of the raw asset id
// in research-library views, popovers, and asset-card subtitles. All
// fields are optional — non-paper assets (specs, web pages, datasets)
// produce no metadata and the UI falls back to source_name.

export interface PaperMetadata {
  /** Best-effort paper title — first sentence of the abstract or
   *  whatever the LLM identifies as the work's title. Already capped
   *  at 240 chars. */
  title: string | null;
  /** Author surnames OR full "Last, F." strings. Max 12 entries; the
   *  preview validator caps each string at 80 chars. */
  authors: string[];
  /** Publication year if extractable. Null when not present. */
  year: number | null;
  /** DOI if present in the asset content. Stored verbatim (no
   *  normalization to a URL form). */
  doi: string | null;
}

// ── Preview shape ────────────────────────────────────────────────────

export interface ExtractionPreview {
  /** ingested_files.id this preview belongs to. */
  asset_id: string;
  /** Full candidate list (15-30 items typical). */
  candidates: ExtractionCandidate[];
  /** Per-category count for the drawer's filter chips. */
  category_counts: Partial<Record<ExtractionCategory, number>>;
  /** Count of candidates with suggested=true. Used by "Select
   *  suggested" button to display "Select N suggested". */
  suggested_count: number;
  /** Total candidates. */
  total_count: number;
  /** ISO timestamp the preview was generated. UI shows it as
   *  "Reviewed Y ago" if user reopens the drawer. */
  generated_at: string;
  /** Free-form narrative summary of what the LLM saw in the asset.
   *  Surfaced at the top of the drawer for context. ≤500 chars. */
  summary: string | null;
  /** P6 · paper-shape metadata (title, authors, year, doi). Optional —
   *  empty fields mean the LLM couldn't extract them or the asset
   *  isn't a research paper. Persists in ingested_files.extraction_preview. */
  paper_metadata?: PaperMetadata | null;
}

// ── Commit-time payload ──────────────────────────────────────────────

export interface ExtractionCommitInput {
  /** ids from preview.candidates the user selected. Server filters
   *  the cached preview to exactly these and persists. */
  selected_candidate_ids: string[];
  /** User-chosen focus level. Persisted to
   *  ingested_files.extraction_target_count. Optional — defaults to
   *  whatever the user's last choice was, or "moderate" for first
   *  commits. */
  focus_level?: FocusLevel;
}

export interface ExtractionCommitResult {
  asset_id: string;
  entity_ids: string[];
  /** Candidates the user selected that were SKIPPED at commit
   *  (e.g. because the same name already existed in the space and
   *  was deduped). Surfaced in the UI as "12 of 15 entities
   *  materialized; 3 already existed." */
  skipped_count: number;
  committed_at: string;
  /** Run id of the chained /api/pipeline/decompose call when
   *  full_decompose=true. Lets the UI link to the canvas event HUD
   *  for the deeper pass. Null when the chain didn't fire (asset
   *  class doesn't warrant it, or normalized_text wasn't ready). */
  decompose_run_id?: string | null;
  /** Non-fatal error string when the decompose chain failed. The
   *  HITL commit still succeeded — the user has their entities
   *  already; we just couldn't run the multi-pass extraction. */
  decompose_error?: string | null;
  /** Whether the route requested a full_decompose chain. False when
   *  the body explicitly disabled it OR the asset class isn't
   *  research_pdf / internal_doc. */
  full_decompose_requested?: boolean;
  /** Initiative 2 — whether /extract-effect-sizes + /extract-temporal
   *  were queued in `after()`. UI shows "extracting effect sizes…"
   *  while this is true and no rows have landed yet; flips off once
   *  evidence_registries rows for this asset arrive via realtime. */
  auto_quantitative_queued?: boolean;
}

// ── Extraction status (mirrors DB enum) ──────────────────────────────

export const EXTRACTION_STATUSES = [
  "pending_preview",
  "previewed",
  "extracting",
  "extracted",
  "skipped",
  "auto_extracted",
] as const;

export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export function isExtractionStatus(x: unknown): x is ExtractionStatus {
  return (
    typeof x === "string" &&
    (EXTRACTION_STATUSES as readonly string[]).includes(x)
  );
}
