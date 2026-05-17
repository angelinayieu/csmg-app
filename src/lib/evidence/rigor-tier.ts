// ── Rigor tier classifier ────────────────────────────────────────────
//
// Single source of truth for "where did this evidence_registries row
// come from, and how trustworthy is the sourcing?" Used by the forest
// plot route, the pooling math, and the UI chip system.
//
// The classification is a pure derivation over signals already on the
// row (status, ingested_file_id, flags[], llm_label_provenance JSONB).
// No schema migration needed — five tiers fall out of existing data.
//
// Two HEADLINE buckets the UI cares about:
//   • anchored  — paper_reviewed | paper_extracted     (paper-sourced)
//   • drifted   — web_deep_research | web_heuristic | legacy_unsourced
//
// The full 5-tier classification lives below the headline buckets so
// the decomposition drawer can still show the precise breakdown.
//
// IMPORTANT: this module has zero side effects, zero DB calls, zero
// runtime deps. It's a function over a row shape.

import type { EvidenceRegistryRow } from "@/types/evidence-registry";

// ── Tier vocabulary ────────────────────────────────────────────────

export const RIGOR_TIERS = [
  /** status='reviewed' AND ingested_file_id set — human-approved
   *  extraction from an uploaded paper. Highest rigor. */
  "paper_reviewed",
  /** status='extracted' AND ingested_file_id set — parser fired on an
   *  uploaded paper, awaiting human review. High rigor. */
  "paper_extracted",
  /** flags contains 'from_deep_research' AND llm_label_provenance has
   *  a non-empty source_url — bridge matched the claim to a citation.
   *  Medium rigor. */
  "web_deep_research",
  /** flags contains 'from_deep_research' but no source_url — citation
   *  overlap match failed; we know it came from deep research but the
   *  exact source URL was lost. Low rigor. */
  "web_heuristic",
  /** Neither paper-sourced nor deep-research-flagged. Pre-foundation
   *  rows or manually-entered effect sizes without provenance.
   *  Lowest rigor. */
  "legacy_unsourced",
] as const;

export type RigorTier = (typeof RIGOR_TIERS)[number];

/** UI grouping. Forest plot defaults to showing only these. */
export const ANCHORED_TIERS: ReadonlySet<RigorTier> = new Set<RigorTier>([
  "paper_reviewed",
  "paper_extracted",
]);

export function isAnchoredTier(t: RigorTier): boolean {
  return ANCHORED_TIERS.has(t);
}

// ── Classifier ─────────────────────────────────────────────────────

/** Minimal row shape the classifier needs — broader than
 *  EvidenceRegistryRow so we don't force callers to assemble a full
 *  row (e.g. the route can select a narrow column set). */
export interface RigorRow {
  status: string | null | undefined;
  ingested_file_id: string | null | undefined;
  flags: string[] | null | undefined;
  llm_label_provenance: { source_url?: unknown } | null | undefined;
}

export function classifyRigor(row: RigorRow): RigorTier {
  const flags = Array.isArray(row.flags) ? row.flags : [];
  const fromDeepResearch = flags.includes("from_deep_research");
  const sourceUrl =
    row.llm_label_provenance &&
    typeof row.llm_label_provenance === "object" &&
    typeof (row.llm_label_provenance as { source_url?: unknown })
      .source_url === "string" &&
    ((row.llm_label_provenance as { source_url?: string }).source_url ?? "")
      .trim().length > 0;

  // Paper tiers (highest priority): a file id is the strongest signal
  // that the row originated from an uploaded artifact, not a web pass.
  if (row.ingested_file_id) {
    if (row.status === "reviewed") return "paper_reviewed";
    // 'extracted' is the parser-fired-but-unreviewed default. We treat
    // 'pending' the same way for classification purposes; rejected /
    // superseded rows shouldn't show up in pooling at all (the route
    // filters them out earlier), but we still classify defensively.
    return "paper_extracted";
  }

  if (fromDeepResearch) {
    return sourceUrl ? "web_deep_research" : "web_heuristic";
  }

  return "legacy_unsourced";
}

/** Convenience for callers that already have a full registry row.
 *  `LlmLabelProvenance` doesn't formally declare `source_url`, but
 *  the deep-research bridge writes one through spread (see
 *  bridge-to-evidence-registries.ts), so we widen the cast here. */
export function classifyRigorRow(row: EvidenceRegistryRow): RigorTier {
  return classifyRigor({
    status: row.status,
    ingested_file_id: row.ingested_file_id,
    flags: row.flags,
    llm_label_provenance:
      row.llm_label_provenance as
        | { source_url?: unknown }
        | null
        | undefined,
  });
}

// ── Tier metadata for UI ───────────────────────────────────────────
//
// Shared between forest-plot rows, cascade-objective chip, and the
// decomposition drawer. The `tone` field maps to the rigor mark's
// solid/hollow variant; the label / description show in tooltips.

export interface TierMeta {
  /** Short display label (e.g. "Paper · reviewed"). */
  label: string;
  /** Short label without the family prefix (e.g. "reviewed"). Used in
   *  per-tier count rows where the family is implicit from grouping. */
  shortLabel: string;
  /** One-sentence explanation surfaced in tooltips. */
  description: string;
  /** Visual variant of the RigorMark glyph this tier renders with. */
  tone: "solid" | "hollow";
  /** Higher = more rigorous. Used for stable sort within the "show
   *  all" forest plot view (paper-sourced rows first, web rows next,
   *  legacy rows last). */
  rank: number;
}

export const TIER_META: Record<RigorTier, TierMeta> = {
  paper_reviewed: {
    label: "Paper · reviewed",
    shortLabel: "reviewed",
    description:
      "Extracted from an uploaded paper and approved by a reviewer. " +
      "Highest rigor — participates in strict pooling.",
    tone: "solid",
    rank: 5,
  },
  paper_extracted: {
    label: "Paper · extracted",
    shortLabel: "extracted",
    description:
      "Parser fired on an uploaded paper; not yet reviewed. " +
      "High rigor; awaiting human approval before strict pooling.",
    tone: "solid",
    rank: 4,
  },
  web_deep_research: {
    label: "Web · deep research",
    shortLabel: "deep research",
    description:
      "Surfaced by deep-research with a matched citation URL. " +
      "Medium rigor — sourced, but not from a paper we can re-parse.",
    tone: "hollow",
    rank: 3,
  },
  web_heuristic: {
    label: "Web · heuristic",
    shortLabel: "heuristic",
    description:
      "Surfaced by deep-research but citation overlap match failed. " +
      "Low rigor — we know it came from a web pass, not the source URL.",
    tone: "hollow",
    rank: 2,
  },
  legacy_unsourced: {
    label: "Legacy · unsourced",
    shortLabel: "unsourced",
    description:
      "Pre-foundation row or manual entry with no source provenance. " +
      "Lowest rigor — kept for audit; excluded from strict pooling.",
    tone: "hollow",
    rank: 1,
  },
};

// ── Per-tier counter helper ────────────────────────────────────────

export type TierCounts = Record<RigorTier, number>;

export function emptyTierCounts(): TierCounts {
  return {
    paper_reviewed: 0,
    paper_extracted: 0,
    web_deep_research: 0,
    web_heuristic: 0,
    legacy_unsourced: 0,
  };
}

export function countByTier(rows: RigorRow[]): TierCounts {
  const out = emptyTierCounts();
  for (const r of rows) out[classifyRigor(r)] += 1;
  return out;
}

export function anchoredTotal(counts: TierCounts): number {
  return counts.paper_reviewed + counts.paper_extracted;
}

export function driftedTotal(counts: TierCounts): number {
  return (
    counts.web_deep_research +
    counts.web_heuristic +
    counts.legacy_unsourced
  );
}

/** True when the pooled rows are dominated by drifted tiers — drives
 *  the cascade chip's warning glyph. */
export function isLowRigorWarning(counts: TierCounts): boolean {
  const anchored = anchoredTotal(counts);
  const drifted = driftedTotal(counts);
  if (anchored + drifted === 0) return false;
  return anchored === 0 && drifted > 0;
}
