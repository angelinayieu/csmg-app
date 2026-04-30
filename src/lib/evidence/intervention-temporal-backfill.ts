// ── Intervention temporal backfill ────────────────────────────────
//
// Phase 4 of the temporal-rigor plan. Sets
// interventions.{onset,peak,persistence}_days +
// temporal_confidence + temporal_basis_edge_id from the target
// entity's incoming edges (which were pooled by Phase 3's
// recompute-edge-temporals).
//
// PIPELINE
//
//   evidence_registries (per-row temporal claims)
//     └─→ recompute-edge-temporals (Phase 3)
//          └─→ edges.{onset,peak,persistence}_days_p50
//               └─→ THIS FILE (intervention-level rollup)
//                    └─→ interventions.{onset,peak,persistence}_days
//
// SELECTION RULE — basis edge
//
// An intervention's `target_entity_id` typically has multiple
// incoming edges (different upstream causes). The "basis edge" for
// the intervention's timing is the one whose pool has the most
// supporting evidence (max temporal_evidence_count); ties broken by
// lowest heterogeneity_i2 (most agreement). Edges with no temporal
// pool are excluded — an intervention with only untimed incoming
// edges keeps its temporal columns null and falls back to the
// categorical `timeframe`.
//
// CONFIDENCE
//
// Combined into [0, 1] from three signals on the basis edge:
//   evidence_count_factor = clamp01(count / 5)   — 5+ studies = 1.0
//   agreement_factor      = 1 - i2               — high I² ⇒ low conf
//   coverage_factor       = (count > 0 ? 1 : 0)  — gate on any data
// confidence = coverage_factor × evidence_count_factor × agreement_factor
//
// Strict-mode: callers can pass requireStatedExplicitly=true; the
// helper drops candidates where the basis pool's
// non_explicit_count > 0 in dynamics_properties.temporal_pooling_metadata.
// Today we just consume the scalar columns; strict mode lands in P5.
//
// SOFT-FAIL
//
// Per-intervention update errors are logged but never abort the
// batch. The recompute service (when called manually) returns a
// summary so the caller can surface "X of Y interventions repooled."

import type { Database } from "@/types/database.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

type EdgeRow = Database["public"]["Tables"]["edges"]["Row"];
type InterventionRow = Database["public"]["Tables"]["interventions"]["Row"];

export interface InterventionTemporalSummary {
  interventions_total: number;
  interventions_updated: number;
  interventions_skipped_no_target: number;
  interventions_skipped_no_pooled_edges: number;
  errors: Array<{ intervention_id: string; message: string }>;
}

export async function backfillInterventionTemporalsForSpace(
  db: AnyDb,
  spaceId: string,
): Promise<InterventionTemporalSummary> {
  const summary: InterventionTemporalSummary = {
    interventions_total: 0,
    interventions_updated: 0,
    interventions_skipped_no_target: 0,
    interventions_skipped_no_pooled_edges: 0,
    errors: [],
  };

  // 1. Load interventions in the space.
  const { data: ivData, error: ivErr } = await db
    .from("interventions")
    .select(
      "id, space_id, target_entity_id, onset_days, peak_days, persistence_days, temporal_confidence, temporal_basis_edge_id",
    )
    .eq("space_id", spaceId);
  if (ivErr) {
    console.warn(
      "[intervention-temporal-backfill] interventions query failed:",
      ivErr,
    );
    return summary;
  }
  const interventions = (ivData ?? []) as Array<
    Pick<
      InterventionRow,
      | "id"
      | "space_id"
      | "target_entity_id"
      | "onset_days"
      | "peak_days"
      | "persistence_days"
      | "temporal_confidence"
      | "temporal_basis_edge_id"
    >
  >;
  summary.interventions_total = interventions.length;
  if (interventions.length === 0) return summary;

  // 2. Load all edges in the space with pooled temporal data. Filter
  // server-side so we only fetch the ones we'll actually use.
  const { data: edgeData, error: edgeErr } = await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, peak_days_p50, peak_days_p10, peak_days_p90, onset_days_p50, persistence_days_p50, temporal_evidence_count, temporal_heterogeneity_i2",
    )
    .eq("space_id", spaceId)
    .not("peak_days_p50", "is", null);
  if (edgeErr) {
    console.warn(
      "[intervention-temporal-backfill] edges query failed:",
      edgeErr,
    );
    return summary;
  }
  const edges = (edgeData ?? []) as Array<
    Pick<
      EdgeRow,
      | "id"
      | "source_entity_id"
      | "target_entity_id"
      | "peak_days_p50"
      | "peak_days_p10"
      | "peak_days_p90"
      | "onset_days_p50"
      | "persistence_days_p50"
      | "temporal_evidence_count"
      | "temporal_heterogeneity_i2"
    >
  >;

  // Group by target_entity_id for O(1) lookup per intervention.
  const edgesByTarget = new Map<string, typeof edges>();
  for (const e of edges) {
    const arr = edgesByTarget.get(e.target_entity_id) ?? [];
    arr.push(e);
    edgesByTarget.set(e.target_entity_id, arr);
  }

  // 3. Per intervention: find basis edge, compute confidence, update row.
  for (const iv of interventions) {
    if (!iv.target_entity_id) {
      summary.interventions_skipped_no_target++;
      continue;
    }
    const candidates = edgesByTarget.get(iv.target_entity_id) ?? [];
    if (candidates.length === 0) {
      summary.interventions_skipped_no_pooled_edges++;
      continue;
    }
    const basis = pickBasisEdge(candidates);
    if (!basis) {
      summary.interventions_skipped_no_pooled_edges++;
      continue;
    }
    const confidence = computeTemporalConfidence(basis);

    const { error: updErr } = await db
      .from("interventions")
      .update({
        onset_days: basis.onset_days_p50,
        peak_days: basis.peak_days_p50,
        persistence_days: basis.persistence_days_p50,
        temporal_confidence: confidence,
        temporal_basis_edge_id: basis.id,
      })
      .eq("id", iv.id);
    if (updErr) {
      summary.errors.push({
        intervention_id: iv.id,
        message: updErr.message ?? "unknown update error",
      });
      continue;
    }
    summary.interventions_updated++;
  }

  return summary;
}

// ── Selection rules ──────────────────────────────────────────────

type EdgeWithTemporal = Pick<
  EdgeRow,
  | "id"
  | "source_entity_id"
  | "target_entity_id"
  | "peak_days_p50"
  | "peak_days_p10"
  | "peak_days_p90"
  | "onset_days_p50"
  | "persistence_days_p50"
  | "temporal_evidence_count"
  | "temporal_heterogeneity_i2"
>;

/** Pick the best-supported pooled edge among the candidates targeting
 *  the same entity. Selection key:
 *    1. Highest temporal_evidence_count
 *    2. Tie-break: lowest temporal_heterogeneity_i2 (most agreement)
 *    3. Tie-break: stable id ordering for determinism
 *
 *  Returns null only when the candidates array is empty (defensive). */
function pickBasisEdge(
  candidates: EdgeWithTemporal[],
): EdgeWithTemporal | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const cCount = c.temporal_evidence_count ?? 0;
    const bCount = best.temporal_evidence_count ?? 0;
    if (cCount > bCount) {
      best = c;
      continue;
    }
    if (cCount === bCount) {
      const cI2 = c.temporal_heterogeneity_i2 ?? 0;
      const bI2 = best.temporal_heterogeneity_i2 ?? 0;
      if (cI2 < bI2) {
        best = c;
        continue;
      }
      if (cI2 === bI2 && c.id < best.id) {
        best = c;
      }
    }
  }
  // peak_days_p50 is not nullable for callers (we filtered upstream)
  // but guard anyway since the candidate group could theoretically be
  // empty after the filter due to a race.
  if (best.peak_days_p50 === null) return null;
  return best;
}

/** Combined confidence in the intervention's temporal claim. See
 *  module header for the formula. */
export function computeTemporalConfidence(edge: EdgeWithTemporal): number {
  const count = edge.temporal_evidence_count ?? 0;
  if (count === 0) return 0;
  const evidenceCountFactor = Math.min(1, count / 5);
  const i2 = edge.temporal_heterogeneity_i2 ?? 0;
  const agreementFactor = Math.max(0, 1 - i2);
  return Math.max(0, Math.min(1, evidenceCountFactor * agreementFactor));
}
