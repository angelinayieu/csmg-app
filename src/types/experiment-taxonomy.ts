// ── Experiment Taxonomy types ───────────────────────────────────────
//
// Mirrors `supabase/migrations/20260422_experiment_taxonomies.sql`.
//
// The taxonomy is the generalization of "what independent variables
// are we manipulating in this experiment?". A prompt has 5 slots
// (Role/Task/Context/Constraint/Rubric); a recipe has different
// slots (Ingredients/Method/Equipment/…); a routine has yet another
// set. The domain-inferrer picks the right schema at end-of-intake
// so the widgets can render any of them without code changes.

/**
 * One independent-variable slot in the decomposition.
 *
 * The VP Project design pins 5 rings per variant card; the widget
 * clips to the first 6 if the inferrer returns more. Each slot gets
 * its own accent color so the "ring heat" visualisation reads at a
 * glance which slot dominates.
 */
export interface TaxonomySlot {
  /** Stable slot key; used as `experiment_variant_slots.slot_id`.
   *  Snake-case ASCII so it flows through URLs + telemetry cleanly. */
  id: string;
  /** Title-case display label shown on the ring + dashboard. */
  label: string;
  /** Hex color for the ring accent + heatmap overlay. */
  color: string;
  /** One-sentence definition. Rendered as the popover tooltip on the
   *  ring + as the placeholder in the slot editor. */
  description: string;
  /** 0..1 "weight" hint for the default scoring — the inferrer can
   *  pre-weight slots it thinks matter most for this domain. Rendered
   *  as ring thickness on the widget. */
  default_weight?: number;
  /** Ordering index. Lower = earlier on the card. Gaps allowed. */
  ordering: number;
}

/**
 * One status a variant can occupy in this domain's lifecycle.
 *
 * Prompts use CHAMPION / DEPLOYED / CANDIDATE / ARCHIVED. Recipes
 * might use WINNER / DRAFT / SHELVED. The inferrer picks the set;
 * the carousel reads accent per status to color the spine pill.
 */
export interface TaxonomyStatus {
  key: string;   // "CHAMPION"
  label: string; // "Champion"
  accent: string; // hex
  /** "active"/"inactive" hint — drives whether cards pile to the
   *  front or drift to the back of the coverflow. */
  role?: "primary" | "secondary" | "archived";
}

/**
 * One outcome axis the variant carousel scores against.
 *
 * Three are typical (the 3 KPI pills on the header). `unit` and
 * `format` drive the number formatter — prompts show "2.4k tokens"
 * while recipes show "$8.40/serving".
 */
export interface TaxonomyOutcomeAxis {
  key: string;         // "quality" | "tokens" | "lift" | "health"
  label: string;       // "Quality"
  unit?: string;       // "%", "$", null
  format?: "percent" | "count" | "currency" | "ratio" | "duration";
  /** Whether higher is better. Drives the carousel's +/- coloring. */
  higher_is_better: boolean;
}

/**
 * A taxonomy row — one per space, inferred at end of intake.
 *
 * This is the `experiment_taxonomies` row shape as fetched by the
 * resolver. The carousel and decomposition widgets ingest it as a
 * single prop so the app manifest can bind it with one data source.
 */
export interface ExperimentTaxonomy {
  id: string;
  space_id: string;
  domain_key: string;                  // "prompt" | "recipe" | …
  artifact_noun: string;               // "prompt" | "recipe"
  variant_noun: string;                // "variant" | "version"
  situation_noun: string;              // "situation" | "cohort"
  slots: TaxonomySlot[];
  status_vocabulary: TaxonomyStatus[];
  outcome_axes: TaxonomyOutcomeAxis[];
  inferred_by: string;
  inference_confidence: number | null;
  inferred_at: string;
}

/**
 * A variant card — the coverflow element.
 *
 * Aggregate scores on this row are denormalized snapshots computed
 * by the iv_scorer agent; the per-slot detail lives in
 * ExperimentVariantSlot rows. The carousel reads this card's header
 * straight off the aggregate columns instead of joining every time.
 */
export interface ExperimentVariant {
  id: string;
  space_id: string;
  app_id: string | null;
  label: string;
  accent_color: string;
  status: string;            // matches TaxonomyStatus.key
  summary: string | null;
  short_id: string | null;
  signature: string | null;
  aggregate_quality: number | null;
  aggregate_lift: number | null;
  aggregate_tokens: number | null;
  /** Where aggregate_quality / aggregate_lift numbers came from.
   *  `llm_review` (current default) — iv-scorer LLM self-rating.
   *  `mc_lift` (future) — real MC p50 delta vs baseline.
   *  `hybrid` — blend. Migration: 20260531_score_provenance.sql. */
  score_provenance?: "llm_review" | "mc_lift" | "hybrid";
  usage_count: number;
  is_active: boolean;
  situation_key: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One row of the IV decomposition grid: variant × slot.
 *
 * The VP Project's decomposed-prompt viz builds its rings from
 * these rows; `spark_points` feeds the per-slot sparkline. Values
 * are written by the `iv_extractor` agent (content) and the
 * `iv_scorer` agent (metrics), separately, so the UI can reflect
 * partial state while scoring is still running.
 */
export interface ExperimentVariantSlot {
  id: string;
  variant_id: string;
  slot_id: string;           // matches TaxonomySlot.id
  value_preview: string | null;
  value_full: string | null;
  score: number | null;
  lift: number | null;
  token_count: number | null;
  iterations_touching: number;
  heat: number | null;
  proposal_count: number;
  spark_points: number[];    // 0..8 points, each in 0..1
  is_active: boolean;
  updated_at: string;
}

/**
 * Composed shape a resolver returns to the carousel — one variant
 * with its slots joined. Saves the widget from a second roundtrip.
 */
export interface VariantWithSlots extends ExperimentVariant {
  slots: ExperimentVariantSlot[];
}

// ── Canonical default taxonomies per known domain ───────────────────
//
// Used as a seed when the domain-inferrer confidence is low OR as a
// fallback when the LLM output fails validation. Keeping these in
// one place (not scattered across widgets) is the whole point of
// taxonomy-as-data — the widgets read the row, whatever it is, and
// this module just makes sure the row is always well-formed.

export const PROMPT_TAXONOMY_SLOTS: TaxonomySlot[] = [
  { id: "role",       label: "Role",       color: "#1a7aff", ordering: 0,
    description: "Who the model acts as — persona, expertise, tone." },
  { id: "task",       label: "Task",       color: "#0a6aee", ordering: 1,
    description: "What to produce — the operation the model performs." },
  { id: "context",    label: "Context",    color: "#8a56cc", ordering: 2,
    description: "Situational frame — the world the task runs inside." },
  { id: "constraint", label: "Constraint", color: "#f5a623", ordering: 3,
    description: "Hard limits — format, length, forbidden moves." },
  { id: "rubric",     label: "Rubric",     color: "#10b981", ordering: 4,
    description: "How to score — the criteria the output is judged by." },
];

export const PROMPT_STATUS_VOCAB: TaxonomyStatus[] = [
  { key: "CHAMPION",  label: "Champion",  accent: "#10b981", role: "primary" },
  { key: "DEPLOYED",  label: "Deployed",  accent: "#1a7aff", role: "primary" },
  { key: "CANDIDATE", label: "Candidate", accent: "#f5a623", role: "secondary" },
  { key: "ARCHIVED",  label: "Archived",  accent: "#7a8698", role: "archived"  },
];

export const PROMPT_OUTCOME_AXES: TaxonomyOutcomeAxis[] = [
  { key: "quality", label: "Quality",                format: "ratio",    higher_is_better: true },
  { key: "lift",    label: "Lift",    unit: "%",     format: "percent",  higher_is_better: true },
  { key: "tokens",  label: "Tokens",                 format: "count",    higher_is_better: false },
];

/** Last-resort fallback when inference fails entirely. */
export const GENERIC_TAXONOMY = {
  domain_key: "generic",
  artifact_noun: "artifact",
  variant_noun: "variant",
  situation_noun: "situation",
  slots: [
    { id: "intent",     label: "Intent",     color: "#1a7aff", ordering: 0,
      description: "What this artifact is trying to achieve." },
    { id: "inputs",     label: "Inputs",     color: "#0a6aee", ordering: 1,
      description: "Materials, data, or signals it consumes." },
    { id: "method",     label: "Method",     color: "#8a56cc", ordering: 2,
      description: "The procedure or steps applied." },
    { id: "constraint", label: "Constraint", color: "#f5a623", ordering: 3,
      description: "Limits, budgets, hard rules." },
    { id: "outcome",    label: "Outcome",    color: "#10b981", ordering: 4,
      description: "How success is measured." },
  ] as TaxonomySlot[],
  status_vocabulary: [
    { key: "CHAMPION",  label: "Champion",  accent: "#10b981", role: "primary"   as const },
    { key: "CANDIDATE", label: "Candidate", accent: "#f5a623", role: "secondary" as const },
    { key: "ARCHIVED",  label: "Archived",  accent: "#7a8698", role: "archived"  as const },
  ] as TaxonomyStatus[],
  outcome_axes: [
    { key: "quality", label: "Quality", format: "ratio"   as const, higher_is_better: true },
    { key: "lift",    label: "Lift",    unit: "%", format: "percent" as const, higher_is_better: true },
    { key: "cost",    label: "Cost",    format: "count"   as const, higher_is_better: false },
  ] as TaxonomyOutcomeAxis[],
};

/**
 * Hydrate a raw Supabase row into an `ExperimentTaxonomy`.
 *
 * Guards against `null` / malformed jsonb — any missing section
 * collapses to the GENERIC_TAXONOMY default for that field so the
 * widgets always get a well-formed shape.
 */
export function hydrateTaxonomy(row: {
  id: string;
  space_id: string;
  domain_key: string | null;
  artifact_noun: string | null;
  variant_noun: string | null;
  situation_noun: string | null;
  slots: unknown;
  status_vocabulary: unknown;
  outcome_axes: unknown;
  inferred_by: string | null;
  inference_confidence: number | null;
  inferred_at: string | null;
}): ExperimentTaxonomy {
  const slots = Array.isArray(row.slots) && row.slots.length > 0
    ? (row.slots as TaxonomySlot[])
    : GENERIC_TAXONOMY.slots;
  const status = Array.isArray(row.status_vocabulary) && row.status_vocabulary.length > 0
    ? (row.status_vocabulary as TaxonomyStatus[])
    : GENERIC_TAXONOMY.status_vocabulary;
  const axes = Array.isArray(row.outcome_axes) && row.outcome_axes.length > 0
    ? (row.outcome_axes as TaxonomyOutcomeAxis[])
    : GENERIC_TAXONOMY.outcome_axes;
  return {
    id: row.id,
    space_id: row.space_id,
    domain_key: row.domain_key ?? GENERIC_TAXONOMY.domain_key,
    artifact_noun: row.artifact_noun ?? GENERIC_TAXONOMY.artifact_noun,
    variant_noun: row.variant_noun ?? GENERIC_TAXONOMY.variant_noun,
    situation_noun: row.situation_noun ?? GENERIC_TAXONOMY.situation_noun,
    slots,
    status_vocabulary: status,
    outcome_axes: axes,
    inferred_by: row.inferred_by ?? "domain_inferrer_v1",
    inference_confidence: row.inference_confidence ?? null,
    inferred_at: row.inferred_at ?? new Date().toISOString(),
  };
}
