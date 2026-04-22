// ── Grounding tier (Phase 2E · Tier 1) ──
//
// Honest labeling for where numeric values on cards come from.
// Every "probability", "confidence", "score" we render is one of
// four kinds — from computed-from-data to pure-LLM-narrative.
// Cards surface this via a tiny <GroundingBadge/> so the user can
// tell at a glance whether a number is actually grounded or just
// the transformer's self-assessed plausibility.
//
// Why this exists: the rigor audit (2026-04-21) found that the
// vocabulary of our cards ("probability space", "p10/p50/p90",
// "confidence") suggested statistical rigor that isn't present.
// Most numeric fields are LLM-returned values with no calibration
// against outcomes. Rather than pretend otherwise or tear out all
// the numbers, we tag them transparently.

export type GroundingTier =
  | "measured"
  | "estimated"
  | "inferred"
  | "narrative";

export interface GroundingInfo {
  label: string;
  shortLabel: string;
  description: string;
  color: string;
}

/**
 * Canonical definitions per tier. The drawer's grounding badge
 * reads from this map; renderers pass the tier only. Keeping one
 * source of truth makes it cheap to adjust wording or colors
 * globally without hunting through card components.
 */
export const GROUNDING: Record<GroundingTier, GroundingInfo> = {
  measured: {
    label: "Measured",
    shortLabel: "data",
    description:
      "Computed directly from graph structure or persisted data — e.g. edge count, BFS depth, centrality. Deterministic.",
    color: "#16a34a",
  },
  estimated: {
    label: "Estimated",
    shortLabel: "est",
    description:
      "Derived via math with modeling assumptions — e.g. Jaccard similarity, path probability via Dijkstra, cascade thresholds.",
    color: "#0891b2",
  },
  inferred: {
    label: "Inferred",
    shortLabel: "inf",
    description:
      "LLM assignment constrained by graph structure — e.g. tier 1/2 interactor paths, cycle classification based on enumerated cycles.",
    color: "#d97706",
  },
  narrative: {
    label: "Narrative",
    shortLabel: "LLM",
    description:
      "LLM-returned plausibility — uncalibrated. Useful for scenario enumeration, NOT for numerical prediction. Treat as reasoning aid, not statistic.",
    color: "#94a3b8",
  },
};

/**
 * Convenience short name for rendering. When space is truly tight
 * (tiny chips on small shapes), the shortLabel reads as a terse
 * hint; the full Label + description only appear on hover.
 */
export function groundingShortLabel(tier: GroundingTier): string {
  return GROUNDING[tier].shortLabel;
}
