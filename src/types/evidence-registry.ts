// ── Evidence registry types ──────────────────────────────────────────
//
// Canonical shapes exchanged between:
//
//   - the effect-size extraction primitive
//     (src/lib/extraction/extract-effect-sizes.ts)
//   - the extract-effect-sizes API route
//     (src/app/api/ingest/[assetId]/extract-effect-sizes/route.ts)
//   - the evidence list API route
//     (src/app/api/spaces/[id]/evidence/route.ts)
//   - the canvas evidence drawer
//     (src/components/canvas/chrome/canvas-evidence-drawer.tsx)
//   - the evidence_registries table (migration 20260613)
//
// DESIGN DISCIPLINE — DOMAIN-AGNOSTIC
//
// No CRCI / mind-body / cognition vocabulary in these types. Anywhere
// a categorical value would naturally be enumerated (study_design,
// effect_metric, etc.), we use a string + a soft const list of
// well-known values. New domains add to the const list (or just
// pass new strings) without DDL changes.
//
// L2M TRUST BOUNDARY
//
// LLM provenance and parser provenance are separate fields. This
// matches what the underlying table stores. Every consumer of this
// type can independently inspect what the LLM SAID vs what the
// deterministic parser DID.

// ── Status ──────────────────────────────────────────────────────────

export const EVIDENCE_STATUSES = [
  /** Row created, extraction not yet run. Numeric fields nullable. */
  "pending",
  /** Primitive completed; numeric fields populated; un-reviewed. */
  "extracted",
  /** Reviewed + approved by a human (researcher / clinician). Only
   *  status that participates in rigorous downstream computation. */
  "reviewed",
  /** Reviewer marked the extraction as wrong. Excluded from
   *  downstream consumers but preserved for audit. */
  "rejected",
  /** Newer extraction has replaced this one; supersedes_id on the
   *  newer row points back here. */
  "superseded",
] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export function isEvidenceStatus(x: unknown): x is EvidenceStatus {
  return (
    typeof x === "string" &&
    (EVIDENCE_STATUSES as readonly string[]).includes(x)
  );
}

// ── Effect metric ───────────────────────────────────────────────────
//
// Open vocabulary. The const list is a HINT for the LLM and a
// auto-complete source for the drawer; it is not a check constraint.

export const KNOWN_EFFECT_METRICS = [
  "cohens_d",
  "hedges_g",
  "smd",         // standardized mean difference (synonym in practice)
  "raw_mean_diff",
  "rr",          // risk ratio
  "or",          // odds ratio
  "hr",          // hazard ratio
  "beta",        // regression coefficient
  "r",           // pearson correlation
  "auc",
  "mean_diff_z", // z-scored mean diff
  "percent_change",
] as const;

export type KnownEffectMetric = (typeof KNOWN_EFFECT_METRICS)[number];

// ── Study design ────────────────────────────────────────────────────

export const KNOWN_STUDY_DESIGNS = [
  "rct",
  "cluster_rct",
  "crossover_rct",
  "meta_analysis",
  "systematic_review",
  "observational_cohort",
  "case_control",
  "case_series",
  "single_arm_trial",
  "n_of_1",
  "micro_randomized_trial",
  "qualitative",
] as const;

export type KnownStudyDesign = (typeof KNOWN_STUDY_DESIGNS)[number];

// ── Provenance halves (the L2M trust boundary) ──────────────────────

/** What the LLM said, separately from what the parser did. */
export interface LlmLabelProvenance {
  /** e.g. "claude-opus-4-20250514". */
  model: string;
  /** SHA-256 of the (system + user) prompt at extraction time. Lets
   *  us tell if the same artifact was re-extracted with a different
   *  prompt revision. */
  prompt_hash: string;
  /** Stable span id assigned at extraction time. Lets multiple
   *  parsers fire on the same span and have their results joined. */
  span_id: string;
  /** The LLM's verbatim label string (e.g. "effect_size"). */
  raw_label: string;
  /** LLM self-rated confidence the span really is an effect-size
   *  reporting (vs incidental mention). 0..1. */
  llm_confidence: number;
  /** Optional: the LLM's free-text reasoning for picking this span. */
  reasoning?: string;
}

/** What the deterministic parser extracted from the LLM-labelled span. */
export interface ParserProvenance {
  /** Module name, e.g. "cohens_d_parser". Mirrors a TS module path. */
  module: string;
  /** Version string. Bumped any time the parser logic changes so old
   *  extractions are distinguishable from new ones. */
  version: string;
  /** Which internal rule inside the parser fired ("table_row",
   *  "ci_with_d_inline", "p_value_back_calc", etc.). */
  rule_fired: string;
  /** The exact substring of the source span the parser matched. */
  raw_match: string;
  /** Free-form flags raised by the parser. Never substituted for
   *  rejection — they're hints for the reviewer. */
  flags: string[];
}

// ── Source provenance (where in the artifact) ──────────────────────

export interface SourceLocation {
  page: number | null;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Verbatim quote from the source artifact (≤500 chars). */
  quote: string | null;
  /** When extracted from a table, the rendered HTML snippet. */
  table_html: string | null;
}

// ── Row ─────────────────────────────────────────────────────────────
//
// Mirrors the evidence_registries table schema. Used as the response
// shape from the list endpoint and the drawer's row model.

export interface EvidenceRegistryRow {
  id: string;
  space_id: string;
  ingested_file_id: string | null;
  attached_entity_id: string | null;

  status: EvidenceStatus;
  processing_plan_id: string | null;

  outcome_label: string | null;
  instrument_label: string | null;
  instrument_id: string | null;
  intervention_label: string | null;
  intervention_kernel_id: string | null;
  comparator_label: string | null;
  population_label: string | null;

  effect_size: number | null;
  effect_metric: string | null;
  ci_lower: number | null;
  ci_upper: number | null;
  ci_level: number | null;
  p_value: number | null;
  standard_error: number | null;
  n_treatment: number | null;
  n_control: number | null;
  followup_weeks: number | null;
  followup_label: string | null;

  study_design: string | null;
  blinding: string | null;

  source_page: number | null;
  source_bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  source_quote: string | null;
  source_table_html: string | null;

  llm_label_provenance: LlmLabelProvenance | null;
  parser_provenance: ParserProvenance | null;

  extraction_confidence: number | null;
  flags: string[];

  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  supersedes_id: string | null;

  user_id: string;
  created_at: string;
  updated_at: string;
}

// ── Extraction draft (what the primitive returns before insert) ────
//
// The primitive produces these. The route inserts them. Splitting
// the type lets us run the primitive in isolation (in tests, in
// future planner-dispatcher composition) without coupling it to a
// Supabase client.

export interface EffectSizeExtraction {
  /** Local id used to dedupe within one extraction run. NOT the DB id. */
  local_id: string;

  outcome_label: string | null;
  instrument_label: string | null;
  intervention_label: string | null;
  comparator_label: string | null;
  population_label: string | null;

  effect_size: number | null;
  effect_metric: string | null;
  ci_lower: number | null;
  ci_upper: number | null;
  ci_level: number | null;
  p_value: number | null;
  standard_error: number | null;
  n_treatment: number | null;
  n_control: number | null;
  followup_weeks: number | null;
  followup_label: string | null;

  study_design: string | null;
  blinding: string | null;

  source: SourceLocation;
  llm_label_provenance: LlmLabelProvenance;
  parser_provenance: ParserProvenance | null;

  extraction_confidence: number;
  flags: string[];
}

/** Result of running the primitive on one artifact. */
export interface ExtractEffectSizesResult {
  asset_id: string;
  extractions: EffectSizeExtraction[];
  /** ISO timestamp the primitive completed. */
  generated_at: string;
  /** Free-text 1-2 sentence summary of what the LLM saw. Useful for
   *  the drawer header so the user has context on the artifact. */
  summary: string | null;
  /** Total tokens consumed (rough estimate from response usage). */
  token_estimate: number | null;
}

// ── List filter ─────────────────────────────────────────────────────

export interface EvidenceListFilter {
  /** Filter by status. Default: all except 'superseded'. */
  status?: EvidenceStatus[];
  /** Filter by attached_entity_id. */
  attached_entity_id?: string;
  /** Filter by ingested_file_id (per-asset rollup). */
  ingested_file_id?: string;
  /** Free-text search across outcome / intervention / instrument labels. */
  q?: string;
  /** Limit for pagination. */
  limit?: number;
}
