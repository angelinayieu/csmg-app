// ── Edge-temporal recompute service (Phase 3) ────────────────────
//
// Peer of recompute-edge-strengths.ts. Pulls evidence_registries
// rows into precision-weighted onset / peak / persistence pools per
// edge and writes them to:
//
//   • Scalar columns on edges: {onset,peak,persistence}_days_p{10,50,90},
//     decay_kinetics_modal, temporal_evidence_count,
//     temporal_heterogeneity_i2, temporal_evidence_ids,
//     temporal_pooled_at
//   • dynamics_properties.temporal_pooling_metadata (full per-component
//     audit: τ², I², SE, weighting_method, evidence_row_ids,
//     non_explicit_count)
//   • edges.temporal_validity (legacy JSONB) — populates decay_rate
//     for backward compatibility with the critic prompt + UI surfaces
//     that read the legacy field.
//
// Trigger paths (any of):
//   • POST /api/spaces/[id]/recompute-edge-temporals (manual / backfill)
//   • Hooked into extract-temporal after a batch insert (auto)
//   • Future: postgres trigger / scheduled job
//
// Algorithm (mirrors recompute-edge-strengths):
//   1. Load evidence_registries for the space (status IN
//      ('extracted','reviewed')).
//   2. Group by attached_entity_id.
//   3. Load all edges in the space.
//   4. For each edge, find rows attached to either endpoint.
//      Skip when no rows carry any temporal claim.
//   5. Run THREE independent pools (onset / peak / persistence) +
//      one modal aggregation (decay_kinetics).
//   6. Persist via per-edge update — soft-fail per row.
//
// Returns a summary so the caller can surface a "X edges repooled
// from Y temporal claims" toast.

import type { EvidenceRegistryRow } from "@/types/evidence-registry";
import {
  evidenceToTemporalInputs,
  poolTemporal,
  modalDecayKinetics,
  decayKineticsToLegacyDecayRate,
  type BuildInputsOptions,
  type TemporalPoolingResult,
  type TimingComponent,
} from "./temporal-pooler";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

interface EdgeRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  dynamics_properties: Record<string, unknown> | null;
  temporal_validity: Record<string, unknown> | null;
}

export interface RecomputeTemporalsSummary {
  edges_total: number;
  edges_updated: number;
  edges_skipped_no_temporal_evidence: number;
  evidence_rows_loaded: number;
  evidence_rows_with_temporal: number;
  pools_computed: {
    onset: number;
    peak: number;
    persistence: number;
  };
  errors: Array<{ edge_id: string; message: string }>;
  /** Phase 4 — when any edge got updated, the intervention backfill
   *  also ran. Null when no edges updated (skipped to avoid extra
   *  query). Mirrors the backfill helper's per-row counts. */
  intervention_backfill?: {
    interventions_total: number;
    interventions_updated: number;
    interventions_skipped_no_target: number;
    interventions_skipped_no_pooled_edges: number;
    errors: Array<{ intervention_id: string; message: string }>;
  } | null;
}

interface PerComponentMetadata {
  pool: TemporalPoolingResult | null;
  /** Why the pool was null when applicable. */
  skip_reason: string | null;
}

/** Run the temporal pool for a single edge across all three timing
 *  components + decay-kinetics modal. Returned shape matches the
 *  JSONB structure stored under
 *  dynamics_properties.temporal_pooling_metadata. */
function poolEdgeTemporal(
  rows: EvidenceRegistryRow[],
  options: BuildInputsOptions = {},
): {
  onset: PerComponentMetadata;
  peak: PerComponentMetadata;
  persistence: PerComponentMetadata;
  decay_modal: ReturnType<typeof modalDecayKinetics>;
  has_any_pool: boolean;
} {
  const components: TimingComponent[] = ["onset", "peak", "persistence"];
  const result: {
    onset: PerComponentMetadata;
    peak: PerComponentMetadata;
    persistence: PerComponentMetadata;
  } = {
    onset: { pool: null, skip_reason: null },
    peak: { pool: null, skip_reason: null },
    persistence: { pool: null, skip_reason: null },
  };

  for (const c of components) {
    const inputs = evidenceToTemporalInputs(rows, c, options);
    if (inputs.length === 0) {
      result[c] = { pool: null, skip_reason: "no_inputs_after_filter" };
      continue;
    }
    const pool = poolTemporal(inputs);
    if (!pool) {
      result[c] = { pool: null, skip_reason: "pool_failed" };
      continue;
    }
    result[c] = { pool, skip_reason: null };
  }

  const decay_modal = modalDecayKinetics(rows);
  const has_any_pool =
    !!result.onset.pool ||
    !!result.peak.pool ||
    !!result.persistence.pool ||
    !!decay_modal.modal;

  return { ...result, decay_modal, has_any_pool };
}

export async function recomputeEdgeTemporalsForSpace(
  db: AnyDb,
  spaceId: string,
  options: BuildInputsOptions = {},
): Promise<RecomputeTemporalsSummary> {
  const summary: RecomputeTemporalsSummary = {
    edges_total: 0,
    edges_updated: 0,
    edges_skipped_no_temporal_evidence: 0,
    evidence_rows_loaded: 0,
    evidence_rows_with_temporal: 0,
    pools_computed: { onset: 0, peak: 0, persistence: 0 },
    errors: [],
  };

  // 1. Load evidence with any temporal claim (extracted or reviewed;
  // exclude rejected/superseded). We could push the filter to the
  // server but keeping the predicate in JS lets us count
  // evidence_rows_with_temporal accurately.
  const { data: evidenceData, error: evidenceErr } = await db
    .from("evidence_registries")
    .select("*")
    .eq("space_id", spaceId)
    .in("status", ["extracted", "reviewed"]);
  if (evidenceErr) {
    console.warn(
      "[recompute-edge-temporals] evidence query failed:",
      evidenceErr,
    );
    return summary;
  }
  const evidenceRows = (evidenceData ?? []) as EvidenceRegistryRow[];
  summary.evidence_rows_loaded = evidenceRows.length;

  const withTemporal = evidenceRows.filter((r) => rowHasAnyTemporal(r));
  summary.evidence_rows_with_temporal = withTemporal.length;

  // Group by attached_entity_id.
  const evidenceByEntity = new Map<string, EvidenceRegistryRow[]>();
  for (const r of withTemporal) {
    if (!r.attached_entity_id) continue;
    const arr = evidenceByEntity.get(r.attached_entity_id) ?? [];
    arr.push(r);
    evidenceByEntity.set(r.attached_entity_id, arr);
  }
  if (evidenceByEntity.size === 0) {
    return summary;
  }

  // 2. Load edges.
  const { data: edgesData, error: edgesErr } = await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, dynamics_properties, temporal_validity",
    )
    .eq("space_id", spaceId);
  if (edgesErr) {
    console.warn("[recompute-edge-temporals] edges query failed:", edgesErr);
    return summary;
  }
  const edges = (edgesData ?? []) as EdgeRow[];
  summary.edges_total = edges.length;

  const recomputed_at = new Date().toISOString();

  for (const edge of edges) {
    const srcEvidence = evidenceByEntity.get(edge.source_entity_id) ?? [];
    const tgtEvidence = evidenceByEntity.get(edge.target_entity_id) ?? [];
    const seen = new Set<string>();
    const combined: EvidenceRegistryRow[] = [];
    for (const r of [...srcEvidence, ...tgtEvidence]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      combined.push(r);
    }
    if (combined.length === 0) {
      summary.edges_skipped_no_temporal_evidence++;
      continue;
    }

    const pooled = poolEdgeTemporal(combined, options);
    if (!pooled.has_any_pool) {
      summary.edges_skipped_no_temporal_evidence++;
      continue;
    }

    if (pooled.onset.pool) summary.pools_computed.onset++;
    if (pooled.peak.pool) summary.pools_computed.peak++;
    if (pooled.persistence.pool) summary.pools_computed.persistence++;

    // Build update payload — scalar columns + JSONB metadata.
    // Citation array: union of contributing evidence_row_ids across
    // all three component pools (deduped). The decay modal doesn't
    // contribute its own ids since it's an aggregate over the same
    // rows already included via temporal pools.
    const evidenceIds = new Set<string>();
    if (pooled.onset.pool)
      pooled.onset.pool.evidence_row_ids.forEach((id) => evidenceIds.add(id));
    if (pooled.peak.pool)
      pooled.peak.pool.evidence_row_ids.forEach((id) => evidenceIds.add(id));
    if (pooled.persistence.pool)
      pooled.persistence.pool.evidence_row_ids.forEach((id) =>
        evidenceIds.add(id),
      );
    const evidenceIdsArr = Array.from(evidenceIds);

    const existingDP = edge.dynamics_properties ?? {};
    const newDP = {
      ...existingDP,
      temporal_pooling_metadata: {
        onset: serializePool(pooled.onset),
        peak: serializePool(pooled.peak),
        persistence: serializePool(pooled.persistence),
        decay_kinetics_modal: pooled.decay_modal.modal,
        decay_kinetics_tied: pooled.decay_modal.tied,
        decay_kinetics_counts: pooled.decay_modal.counts,
        recomputed_at,
        // Echo strict-mode flags so audit logs show what filter ran.
        require_stated_explicitly: !!options.requireStatedExplicitly,
        require_point_with_ci: !!options.requirePointWithCi,
        require_reviewed: !!options.requireReviewed,
      },
    };

    // Legacy temporal_validity backfill — populate decay_rate so the
    // critic prompt + node-detail / edge-explanation-popover see
    // live data. Preserve any other keys (valid_from/until/scope)
    // that may have been set by other code paths.
    const legacyDecayRate = decayKineticsToLegacyDecayRate(
      pooled.decay_modal.modal,
    );
    const existingTemporalValidity =
      (edge.temporal_validity as Record<string, unknown> | null) ?? {};
    const newTemporalValidity = legacyDecayRate
      ? { ...existingTemporalValidity, decay_rate: legacyDecayRate }
      : existingTemporalValidity;

    const update = {
      onset_days_p50: pooled.onset.pool?.p50 ?? null,
      onset_days_p10: pooled.onset.pool?.p10 ?? null,
      onset_days_p90: pooled.onset.pool?.p90 ?? null,
      peak_days_p50: pooled.peak.pool?.p50 ?? null,
      peak_days_p10: pooled.peak.pool?.p10 ?? null,
      peak_days_p90: pooled.peak.pool?.p90 ?? null,
      persistence_days_p50: pooled.persistence.pool?.p50 ?? null,
      persistence_days_p10: pooled.persistence.pool?.p10 ?? null,
      persistence_days_p90: pooled.persistence.pool?.p90 ?? null,
      decay_kinetics_modal: pooled.decay_modal.modal,
      temporal_evidence_count: evidenceIdsArr.length,
      // Heterogeneity reported as the max across components — a
      // single high-I² component is enough to flag the edge as
      // "studies disagree." Per-component I² lives in the JSONB.
      temporal_heterogeneity_i2: maxI2([
        pooled.onset.pool?.i_squared,
        pooled.peak.pool?.i_squared,
        pooled.persistence.pool?.i_squared,
      ]),
      temporal_evidence_ids: evidenceIdsArr,
      temporal_pooled_at: recomputed_at,
      dynamics_properties: newDP,
      temporal_validity: newTemporalValidity,
    };

    const { error: updErr } = await db
      .from("edges")
      .update(update)
      .eq("id", edge.id);

    if (updErr) {
      summary.errors.push({
        edge_id: edge.id,
        message: updErr.message ?? "unknown update error",
      });
      continue;
    }
    summary.edges_updated++;
  }

  // Phase 4 — intervention rollup. When any edge got fresh temporal
  // pools, refresh the per-intervention timing columns
  // (onset/peak/persistence_days + temporal_confidence +
  // temporal_basis_edge_id) so the strategy drawer + cards see the
  // new claim immediately. Soft-fail discipline: errors here do not
  // affect the edge-level result. Skipped when no edges updated to
  // avoid extra DB roundtrips on no-op runs.
  if (summary.edges_updated > 0) {
    try {
      const { backfillInterventionTemporalsForSpace } = await import(
        "./intervention-temporal-backfill"
      );
      summary.intervention_backfill =
        await backfillInterventionTemporalsForSpace(db, spaceId);
    } catch (err) {
      console.warn(
        "[recompute-edge-temporals] intervention backfill soft-failed:",
        err,
      );
      summary.intervention_backfill = null;
    }
  } else {
    summary.intervention_backfill = null;
  }

  return summary;
}

// ── Helpers ───────────────────────────────────────────────────────

function rowHasAnyTemporal(r: EvidenceRegistryRow): boolean {
  return (
    r.onset_days !== null ||
    r.peak_days !== null ||
    r.persistence_days !== null ||
    (Array.isArray(r.time_points) && r.time_points.length > 0) ||
    r.decay_kinetics !== null
  );
}

function serializePool(meta: PerComponentMetadata): Record<string, unknown> {
  if (!meta.pool) {
    return { skip_reason: meta.skip_reason ?? "unknown" };
  }
  return {
    p50: meta.pool.p50,
    p10: meta.pool.p10,
    p90: meta.pool.p90,
    pooled_se: meta.pool.pooled_se,
    tau_squared: meta.pool.tau_squared,
    i_squared: meta.pool.i_squared,
    n_studies: meta.pool.n_studies,
    evidence_row_ids: meta.pool.evidence_row_ids,
    reml_iterations: meta.pool.reml_iterations,
    weighting_method: meta.pool.weighting_method,
    non_explicit_count: meta.pool.non_explicit_count,
  };
}

function maxI2(xs: Array<number | undefined>): number | null {
  let max: number | null = null;
  for (const x of xs) {
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    if (max === null || x > max) max = x;
  }
  return max;
}
