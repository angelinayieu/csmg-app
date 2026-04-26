// ── Variant outcome score types (Phase 3 — downstream reality) ───────
//
// Mirrors `supabase/migrations/20260423_variant_outcome_scores.sql`.
//
// Latent variables are dimensions DISCOVERED after variants are
// materialized — not taxonomy outcome_axes (those come from the
// inferrer up-front). The downstream_reality widget renders a
// variant × latent-variable heatmap: rows are variants, columns are
// these dimensions, cells are normalized 0..1 scores.

/**
 * One discovered outcome dimension — e.g., "specificity", "emotional
 * tone", "structural rigor". The finder agent proposes 3-5 per run.
 */
export interface LatentVariable {
  id: string;
  space_id: string;
  /** snake_case slug, unique per space. */
  key: string;
  /** Title-case display label rendered as column header. */
  label: string;
  description: string;
  /** Hex accent for the column header band + chips. */
  color: string;
  discovered_by: string;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * One cell in the variant × latent-variable heatmap. `score` is
 * normalized 0..1 where 1 = "strongly high on this dimension".
 */
export interface VariantOutcomeScore {
  id: string;
  variant_id: string;
  space_id: string;
  latent_variable_id: string;
  score: number;
  evidence: string | null;
  scored_at: string;
}

/**
 * Composed shape a resolver returns to the downstream_reality widget —
 * the full grid ready to render without the widget having to join.
 */
export interface DownstreamReality {
  latent_variables: LatentVariable[];
  /** Maps variant_id → (latent_variable_id → score row). Saves the
   *  widget from O(n·m) lookups on every render. */
  scores_by_variant: Record<string, Record<string, VariantOutcomeScore>>;
}

/**
 * Compose the widget-shaped `DownstreamReality` from the raw row
 * arrays the /api/apps/[id] endpoint returns. Stable key order in the
 * nested map matches `latent_variables[]`, so consumers that iterate
 * the outer array get a consistent column order.
 */
export function composeDownstreamReality(
  latents: LatentVariable[],
  scores: VariantOutcomeScore[],
): DownstreamReality {
  const scoresByVariant: Record<string, Record<string, VariantOutcomeScore>> = {};
  for (const s of scores) {
    const bucket = scoresByVariant[s.variant_id] ?? {};
    bucket[s.latent_variable_id] = s;
    scoresByVariant[s.variant_id] = bucket;
  }
  return {
    latent_variables: latents,
    scores_by_variant: scoresByVariant,
  };
}
