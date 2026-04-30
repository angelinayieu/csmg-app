// ── Temporal coverage helper (Phase 2) ────────────────────────────
//
// Reports the temporal-evidence coverage state for an entity by
// looking at its incident edges' Phase-3 pooled temporal columns.
// Used by:
//
//   - research-questions to AUTO-FLAG entities that have effect-size
//     evidence but no peak/onset/persistence — those entities are
//     prime targets for a temporal-dimension research question
//     ("What's the time-to-effect of X?").
//   - Future UI chips on edge cards (Phase 6) that surface "no
//     timing data yet" / "peak only — onset unknown" badges.
//   - Deep-research planning to prioritize searches that fill
//     temporal gaps over searches that re-cover magnitude.
//
// COVERAGE BUCKETS
//
//   'missing'           — no temporal data at all on incident edges.
//   'magnitude_only'    — effect_size pooled but no temporal pool.
//                          (Most actionable: an existing
//                           effect-size citation is likely already
//                           in evidence_registries; the same source
//                           may report timing.)
//   'onset_only'        — onset pooled but neither peak nor
//                          persistence. (Trial reported "improvements
//                           began at week 2" but didn't characterize
//                           sustainability.)
//   'peak_only'         — peak pooled, no onset / no persistence.
//                          (Endpoint-only studies — common in single-
//                           timepoint trials.)
//   'persistence_only'  — persistence pooled, no peak / no onset.
//                          (Long-term followup studies that didn't
//                           track ramp-up.)
//   'partial'           — two of {onset, peak, persistence} present
//                          but not all three.
//   'full'              — onset + peak + persistence all pooled.
//
// The bucket is COMPUTED across the entity's incident edges, taking
// the BEST coverage available across them. An entity with one well-
// pooled edge gets 'full' even if other incident edges are missing
// data — the rationale is that a high-quality literature pull
// (deep-research) is unlikely to surface MORE timing data on the
// well-covered edge, but might fill the gap on the others. Coverage
// is for prioritization, not certification.

import type { Database } from "@/types/database.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

type EdgeRow = Database["public"]["Tables"]["edges"]["Row"];

export type TemporalCoverage =
  | "missing"
  | "magnitude_only"
  | "onset_only"
  | "peak_only"
  | "persistence_only"
  | "partial"
  | "full";

export interface EntityTemporalCoverage {
  coverage: TemporalCoverage;
  has_effect_size: boolean;
  has_onset: boolean;
  has_peak: boolean;
  has_persistence: boolean;
  edge_count: number;
  /** Number of incident edges that contributed to the analysis.
   *  A coverage of 'full' on 0 edges is impossible — when edge_count
   *  is 0 the entity has no causal context, so coverage = 'missing'
   *  by definition. */
  incident_edge_count: number;
  /** Pre-derived suggested research focus: which temporal aspect to
   *  prioritize when generating a deep-research query for this
   *  entity. Null when coverage is already 'full'. */
  suggested_temporal_focus:
    | "onset"
    | "peak"
    | "persistence"
    | "all"
    | null;
}

/** Compute coverage given an array of edges (already loaded by the
 *  caller). Pure function — no DB access. Useful when the caller
 *  already has incident edges in memory. */
export function classifyTemporalCoverage(
  incidentEdges: Pick<
    EdgeRow,
    | "strength"
    | "onset_days_p50"
    | "peak_days_p50"
    | "persistence_days_p50"
    | "temporal_evidence_count"
  >[],
): EntityTemporalCoverage {
  let hasEffectSize = false;
  let hasOnset = false;
  let hasPeak = false;
  let hasPersistence = false;
  let edgeCount = 0;
  for (const e of incidentEdges) {
    edgeCount++;
    // strength is non-null on every edge by schema, but a default-0.5
    // edge with no evidence isn't really "effect size pooled." We
    // treat it as having effect_size only when there's a numeric
    // strength AND temporal_evidence_count = 0 (proxy for "we have
    // magnitude evidence" because Phase 6A's recompute-edge-strengths
    // sets strength from evidence pooling). For now, treat any
    // strength != null as having SOME magnitude — the caller can
    // refine if needed.
    if (typeof e.strength === "number") hasEffectSize = true;
    if (typeof e.onset_days_p50 === "number") hasOnset = true;
    if (typeof e.peak_days_p50 === "number") hasPeak = true;
    if (typeof e.persistence_days_p50 === "number") hasPersistence = true;
  }

  let coverage: TemporalCoverage;
  let focus: EntityTemporalCoverage["suggested_temporal_focus"] = null;

  if (edgeCount === 0) {
    coverage = "missing";
    focus = "all";
  } else if (hasOnset && hasPeak && hasPersistence) {
    coverage = "full";
    focus = null;
  } else if (!hasOnset && !hasPeak && !hasPersistence) {
    coverage = hasEffectSize ? "magnitude_only" : "missing";
    focus = "all";
  } else if (hasOnset && !hasPeak && !hasPersistence) {
    coverage = "onset_only";
    focus = "peak";
  } else if (hasPeak && !hasOnset && !hasPersistence) {
    coverage = "peak_only";
    focus = "onset";
  } else if (hasPersistence && !hasPeak && !hasOnset) {
    coverage = "persistence_only";
    focus = "peak";
  } else {
    coverage = "partial";
    // Pick the missing one to prioritize.
    if (!hasOnset) focus = "onset";
    else if (!hasPeak) focus = "peak";
    else focus = "persistence";
  }

  return {
    coverage,
    has_effect_size: hasEffectSize,
    has_onset: hasOnset,
    has_peak: hasPeak,
    has_persistence: hasPersistence,
    edge_count: edgeCount,
    incident_edge_count: edgeCount,
    suggested_temporal_focus: focus,
  };
}

/** DB-loading wrapper. Pulls all incident edges (source OR target =
 *  entityId) in the entity's space, applies classifyTemporalCoverage.
 *  Returns a 'missing' coverage on query failure (soft-fail). */
export async function computeEntityTemporalCoverage(
  db: AnyDb,
  entityId: string,
): Promise<EntityTemporalCoverage> {
  const { data, error } = await db
    .from("edges")
    .select(
      "strength, onset_days_p50, peak_days_p50, persistence_days_p50, temporal_evidence_count",
    )
    .or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`);
  if (error) {
    console.warn("[temporal-coverage] edges query failed:", error);
    return classifyTemporalCoverage([]);
  }
  return classifyTemporalCoverage((data ?? []) as Parameters<typeof classifyTemporalCoverage>[0]);
}

/** Map a coverage bucket to a one-line UI label. Used by chips +
 *  research-questions auto-prompt. */
export function describeTemporalCoverage(c: TemporalCoverage): string {
  switch (c) {
    case "missing":
      return "No temporal data";
    case "magnitude_only":
      return "Effect-size only — timing unknown";
    case "onset_only":
      return "Onset only — peak/persistence unknown";
    case "peak_only":
      return "Peak only — onset/persistence unknown";
    case "persistence_only":
      return "Persistence only — onset/peak unknown";
    case "partial":
      return "Partial timing data";
    case "full":
      return "Onset + peak + persistence all pooled";
  }
}
