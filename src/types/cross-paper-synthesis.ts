// ── Cross-paper synthesis types ──────────────────────────────────
//
// Shared between the algorithm (src/lib/synthesis/cross-paper.ts), the
// endpoint (/api/spaces/[id]/cross-paper-synthesis), and the UI strip
// (src/components/convergence/cross-paper-strip.tsx).
//
// Surfaces three findings from the user's accumulated evidence_registries
// rows for a space:
//
//   1. recurring   — a (intervention → outcome) claim that appears in
//                    ≥2 papers
//   2. contradictions — same claim with both positive- and negative-sign
//                    effect sizes across papers
//   3. under_supported — fundamental/critical entities backed by only
//                    one paper, suggesting next research targets
//
// Honest limits: claim dedup is algorithmic Jaccard with ≥0.6 token
// overlap. False negatives (missed merges of equivalent claims phrased
// differently) > false positives. v2 would use embedding similarity.

export interface PaperRef {
  /** ingested_files.id */
  asset_id: string;
  /** ingested_files.source_name — paper title or document name. */
  title: string;
  /** Effect size from this paper for the claim, when extracted. Null
   *  when the row recorded only a temporal anchor with no numerical
   *  effect. */
  effect_size: number | null;
  /** Standard error — drives inverse-variance weights for aggregation. */
  standard_error: number | null;
  /** Cohen's d / log-OR / etc. Mirrors evidence_metric. */
  effect_metric: string | null;
  /** Sample size of the treatment arm, when reported. */
  n_treatment: number | null;
  /** Indicates the LLM read this as supporting (positive sign + significant)
   *  vs contradicting the recurring claim's modal direction. Computed
   *  by the algorithm, not extracted directly. */
  direction: "supports" | "contradicts" | "unclear";
}

/** Claims present in ≥2 papers. Sorted by paper_count desc. */
export interface RecurringClaim {
  /** Stable ID derived from the canonical claim signature (hashed). */
  id: string;
  /** Display string — first occurrence's intervention/outcome combo,
   *  e.g. "Aerobic exercise → working memory". */
  representative_text: string;
  /** Normalized signature used for clustering (debug/exposable). */
  claim_signature: string;
  /** Entity the claim is attached to, when papers agreed on the
   *  attachment target. Null when papers disagreed or none attached. */
  primary_entity_id: string | null;
  primary_entity_name: string | null;
  /** Distinct papers that surface this claim. Always ≥2. */
  paper_count: number;
  papers: PaperRef[];
  /** Inverse-variance-weighted mean effect size + pooled SE.
   *  Computed only when ≥2 papers have non-null effect_size + SE.
   *  Otherwise undefined and the UI falls back to count-only. */
  aggregate_effect?: {
    mean: number;
    se: number;
    /** Cochran's Q-derived I² across the pooled rows. Null when k<2. */
    heterogeneity_i2: number | null;
    n_studies: number;
    /** Effect metric the aggregate is in. Picked from the modal
     *  metric across papers; if mixed, set to "mixed" and the UI
     *  shows a caveat. */
    metric: string;
  };
}

/** Same claim with rows on both sides of zero. */
export interface Contradiction {
  id: string;
  representative_text: string;
  claim_signature: string;
  primary_entity_id: string | null;
  primary_entity_name: string | null;
  supporting_papers: PaperRef[];
  contradicting_papers: PaperRef[];
  /** "high" when both sides have ≥2 papers; "medium" when 2 vs 1;
   *  "low" when 1 vs 1 (might just be measurement noise). */
  severity: "high" | "medium" | "low";
}

/** Fundamental / critical entity backed by exactly one paper. */
export interface UnderSupportedClaim {
  /** entity.id */
  entity_id: string;
  entity_name: string;
  importance: "fundamental" | "critical";
  sole_paper: PaperRef;
  /** Suggested next-research prompt — first 200 chars of the paper's
   *  outcome label or claim text. Used to hand off to research-deep. */
  suggested_search: string;
}

export interface CrossPaperSynthesis {
  /** Always populated. Empty array when no recurring claims found. */
  recurring: RecurringClaim[];
  contradictions: Contradiction[];
  under_supported: UnderSupportedClaim[];
  /** Counts, for the strip's heading row. */
  counts: {
    total_papers: number;
    total_evidence_rows: number;
  };
  generated_at: string;
}
