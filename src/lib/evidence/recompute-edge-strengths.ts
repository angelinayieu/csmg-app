// ── Edge-strength recompute service (Phase 6A) ───────────────────
//
// Orchestrator that uses edge-strength-pooler to recompute
// edges.strength + dynamics_properties.pooling_metadata from the
// current evidence_registries state.
//
// Trigger paths (any of):
//   • POST /api/spaces/[id]/recompute-edge-strengths (manual)
//   • Hooked into extract-effect-sizes after a batch insert (auto)
//   • Future: postgres trigger / scheduled job
//
// Algorithm:
//   1. Load evidence_registries rows for this space (status IN
//      ('extracted','reviewed'); we accept extracted rows so the
//      lab updates immediately; v2 can require reviewed-only).
//   2. Group by attached_entity_id. Each entity gets its own
//      pooled effect.
//   3. Load all edges in the space.
//   4. For each edge, find evidence rows attached to either source
//      or target entity. If ≥1 row, pool them and update the edge.
//   5. Persist via per-edge update — soft-fail per row, log losses.
//
// Returns a summary of what updated so the caller can surface a
// "X edges repooled from Y evidence rows" toast.

import type { EvidenceRegistryRow } from "@/types/evidence-registry";
import {
  evidenceToPoolingInputs,
  poolEffects,
  effectToStrength,
  effectToPolarity,
} from "./edge-strength-pooler";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

interface EdgeRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  strength: number | null;
  polarity: string | null;
  source_tag: string | null;
  dynamics_properties: Record<string, unknown> | null;
}

export interface RecomputeSummary {
  edges_total: number;
  edges_updated: number;
  edges_skipped_no_evidence: number;
  evidence_rows_loaded: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errors: Array<{ edge_id: string; message: string }>;
}

export async function recomputeEdgeStrengthsForSpace(
  db: AnyDb,
  spaceId: string,
): Promise<RecomputeSummary> {
  const summary: RecomputeSummary = {
    edges_total: 0,
    edges_updated: 0,
    edges_skipped_no_evidence: 0,
    evidence_rows_loaded: 0,
    errors: [],
  };

  // 1. Load evidence (extracted or reviewed; reject 'rejected'/'superseded').
  const { data: evidenceData, error: evidenceErr } = await db
    .from("evidence_registries")
    .select("*")
    .eq("space_id", spaceId)
    .in("status", ["extracted", "reviewed"]);
  if (evidenceErr) {
    console.warn("[recompute-edge-strengths] evidence query failed:", evidenceErr);
    return summary;
  }
  const evidenceRows = (evidenceData ?? []) as EvidenceRegistryRow[];
  summary.evidence_rows_loaded = evidenceRows.length;

  // Group by attached_entity_id (only rows that have one).
  const evidenceByEntity = new Map<string, EvidenceRegistryRow[]>();
  for (const r of evidenceRows) {
    if (!r.attached_entity_id) continue;
    const arr = evidenceByEntity.get(r.attached_entity_id) ?? [];
    arr.push(r);
    evidenceByEntity.set(r.attached_entity_id, arr);
  }

  if (evidenceByEntity.size === 0) {
    // No evidence attached anywhere — nothing to do.
    return summary;
  }

  // 2. Load edges for the space.
  const { data: edgesData, error: edgesErr } = await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, strength, polarity, source_tag, dynamics_properties",
    )
    .eq("space_id", spaceId);
  if (edgesErr) {
    console.warn("[recompute-edge-strengths] edges query failed:", edgesErr);
    return summary;
  }
  const edges = (edgesData ?? []) as EdgeRow[];
  summary.edges_total = edges.length;

  // 3. For each edge, pool evidence touching either endpoint.
  for (const edge of edges) {
    const srcEvidence = evidenceByEntity.get(edge.source_entity_id) ?? [];
    const tgtEvidence = evidenceByEntity.get(edge.target_entity_id) ?? [];
    // Dedupe by id (same row can attach to both endpoints in theory).
    const seen = new Set<string>();
    const combined: EvidenceRegistryRow[] = [];
    for (const r of [...srcEvidence, ...tgtEvidence]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      combined.push(r);
    }
    if (combined.length === 0) {
      summary.edges_skipped_no_evidence++;
      continue;
    }
    const inputs = evidenceToPoolingInputs(combined);
    if (inputs.length === 0) {
      summary.edges_skipped_no_evidence++;
      continue;
    }
    const pooled = poolEffects(inputs);
    if (!pooled) {
      summary.edges_skipped_no_evidence++;
      continue;
    }
    const strength = effectToStrength(pooled.pooled_effect);
    const inferredPolarity = effectToPolarity(pooled);

    // Build dynamics_properties update — preserve existing keys,
    // upsert pooling_metadata.
    const existingDP = edge.dynamics_properties ?? {};
    const newDP = {
      ...existingDP,
      pooling_metadata: {
        pooled_effect: pooled.pooled_effect,
        pooled_se: pooled.pooled_se,
        pooled_ci_lower: pooled.pooled_ci_lower,
        pooled_ci_upper: pooled.pooled_ci_upper,
        tau_squared: pooled.tau_squared,
        n_studies: pooled.n_studies,
        evidence_row_ids: pooled.evidence_row_ids,
        reml_iterations: pooled.reml_iterations,
        recomputed_at: new Date().toISOString(),
      },
    };

    // Don't override an explicit polarity from the LLM extraction
    // unless we have a clear directional pooled effect AND the
    // existing polarity is null/neutral. Conservatism: respect what
    // the upstream pipeline decided.
    const polarityUpdate =
      edge.polarity === null ||
      edge.polarity === "neutral" ||
      edge.polarity === ""
        ? inferredPolarity
        : edge.polarity;

    const { error: updErr } = await db
      .from("edges")
      .update({
        strength,
        polarity: polarityUpdate,
        // source_tag: keep enum compatibility — "inferred" is the
        // closest existing value to "evidence-pooled". The full
        // pooling lineage lives in dynamics_properties.pooling_metadata.
        source_tag: "inferred",
        dynamics_properties: newDP,
      })
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

  return summary;
}
