// ── /api/spaces/[id]/edges/catalog ─────────────────────────────────
//
// GET endpoint returning every edge in a space, enriched with the
// info a researcher-grade table needs:
//
//   - source/target entity names + layers
//   - relationship type, polarity, strength, confidence
//   - pooled effect size + CI + τ² + n_studies (from
//     dynamics_properties.pooling_metadata when present)
//   - evidence count attached to either endpoint
//   - source_tag ("inferred" implies evidence-pooled in our schema;
//     "stated" / "predicted" are LLM-only)
//   - timestamps for sorting "recently updated"
//
// One round-trip to the DB (3 parallel queries: edges, entities,
// evidence_count groupby). Joins in memory. Filters via RLS already.
//
// Used by /app/space/[id]/edges page (the edges-catalog browser).

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const runtime = "nodejs";

export interface EdgeCatalogEntry {
  id: string;
  source_entity_id: string;
  source_name: string;
  source_layer_label: string | null;
  source_layer_color: string | null;
  source_layer_ordinal: number | null;
  target_entity_id: string;
  target_name: string;
  target_layer_label: string | null;
  target_layer_color: string | null;
  target_layer_ordinal: number | null;
  relationship_type: string;
  dimension: string | null;
  polarity: string | null;
  strength: number | null;
  confidence: number | null;
  source_tag: string | null;
  // Pooled meta (null when no evidence pool yet).
  pooled_effect: number | null;
  pooled_ci_lower: number | null;
  pooled_ci_upper: number | null;
  tau_squared: number | null;
  n_studies: number | null;
  evidence_row_count: number;
  is_evidence_backed: boolean;
  recomputed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface EdgeCatalogResponse {
  edges: EdgeCatalogEntry[];
  computed_at: string;
  totals: {
    edges: number;
    evidence_backed: number;
    llm_only: number;
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fan out three queries in parallel.
  const [edgesRes, entitiesRes, layersRes, evidenceRes] = await Promise.all([
    db
      .from("edges")
      .select(
        "id, source_entity_id, target_entity_id, relationship_type, dimension, polarity, strength, confidence, source_tag, dynamics_properties, created_at, updated_at",
      )
      .eq("space_id", spaceId),
    db
      .from("entities")
      .select("id, name, layer_ontology_id")
      .eq("space_id", spaceId),
    db
      .from("layer_ontology")
      .select("id, ordinal, label, color")
      .eq("space_id", spaceId),
    db
      .from("evidence_registries")
      .select("attached_entity_id")
      .eq("space_id", spaceId)
      .in("status", ["extracted", "reviewed"])
      .not("attached_entity_id", "is", null),
  ]);

  if (edgesRes.error) {
    console.error("[edges/catalog] edges query failed:", edgesRes.error);
    return NextResponse.json(
      { error: "Edges query failed", db_error: edgesRes.error.message },
      { status: 500 },
    );
  }

  type EdgeRowDB = {
    id: string;
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;
    dimension: string | null;
    polarity: string | null;
    strength: number | null;
    confidence: number | null;
    source_tag: string | null;
    dynamics_properties: Record<string, unknown> | null;
    created_at: string | null;
    updated_at: string | null;
  };
  type EntityRowDB = {
    id: string;
    name: string;
    layer_ontology_id: string | null;
  };
  type LayerRowDB = {
    id: string;
    ordinal: number;
    label: string;
    color: string | null;
  };
  type EvidenceRowDB = { attached_entity_id: string };

  const edges = (edgesRes.data ?? []) as EdgeRowDB[];
  const entities = (entitiesRes.data ?? []) as EntityRowDB[];
  const layers = (layersRes.data ?? []) as LayerRowDB[];
  const evidence = (evidenceRes.data ?? []) as EvidenceRowDB[];

  const layerById = new Map(layers.map((l) => [l.id, l]));
  const entityById = new Map(entities.map((e) => [e.id, e]));

  // Evidence count per entity → roll up to per-edge by summing source+target.
  const evidenceCountByEntity = new Map<string, number>();
  for (const ev of evidence) {
    if (!ev.attached_entity_id) continue;
    evidenceCountByEntity.set(
      ev.attached_entity_id,
      (evidenceCountByEntity.get(ev.attached_entity_id) ?? 0) + 1,
    );
  }

  let evidenceBacked = 0;
  let llmOnly = 0;

  const enriched: EdgeCatalogEntry[] = edges.map((e) => {
    const src = entityById.get(e.source_entity_id);
    const tgt = entityById.get(e.target_entity_id);
    const srcLayer = src?.layer_ontology_id
      ? (layerById.get(src.layer_ontology_id) ?? null)
      : null;
    const tgtLayer = tgt?.layer_ontology_id
      ? (layerById.get(tgt.layer_ontology_id) ?? null)
      : null;

    const pool = pickPoolingMeta(e.dynamics_properties);
    const evCount =
      (evidenceCountByEntity.get(e.source_entity_id) ?? 0) +
      (evidenceCountByEntity.get(e.target_entity_id) ?? 0);

    const isEvidenceBacked = pool?.pooled_effect != null || evCount > 0;
    if (isEvidenceBacked) evidenceBacked++;
    else llmOnly++;

    return {
      id: e.id,
      source_entity_id: e.source_entity_id,
      source_name: src?.name ?? "(unknown)",
      source_layer_label: srcLayer?.label ?? null,
      source_layer_color: srcLayer?.color ?? null,
      source_layer_ordinal: srcLayer?.ordinal ?? null,
      target_entity_id: e.target_entity_id,
      target_name: tgt?.name ?? "(unknown)",
      target_layer_label: tgtLayer?.label ?? null,
      target_layer_color: tgtLayer?.color ?? null,
      target_layer_ordinal: tgtLayer?.ordinal ?? null,
      relationship_type: e.relationship_type,
      dimension: e.dimension,
      polarity: e.polarity,
      strength: e.strength,
      confidence: e.confidence,
      source_tag: e.source_tag,
      pooled_effect: pool?.pooled_effect ?? null,
      pooled_ci_lower: pool?.pooled_ci_lower ?? null,
      pooled_ci_upper: pool?.pooled_ci_upper ?? null,
      tau_squared: pool?.tau_squared ?? null,
      n_studies: pool?.n_studies ?? null,
      evidence_row_count: evCount,
      is_evidence_backed: isEvidenceBacked,
      recomputed_at: pool?.recomputed_at ?? null,
      created_at: e.created_at,
      updated_at: e.updated_at,
    };
  });

  const response: EdgeCatalogResponse = {
    edges: enriched,
    computed_at: new Date().toISOString(),
    totals: {
      edges: enriched.length,
      evidence_backed: evidenceBacked,
      llm_only: llmOnly,
    },
  };
  return NextResponse.json(response);
}

interface PoolingMeta {
  pooled_effect: number | null;
  pooled_ci_lower: number | null;
  pooled_ci_upper: number | null;
  tau_squared: number | null;
  n_studies: number | null;
  recomputed_at: string | null;
}

/** Read the pooling_metadata block out of dynamics_properties JSONB.
 *  Returns null when absent or malformed. Tolerant of partial blocks
 *  (template seed writes a richer block; pooling step writes the same
 *  shape; missing fields → null, not crashes). */
function pickPoolingMeta(
  dp: Record<string, unknown> | null,
): PoolingMeta | null {
  if (!dp) return null;
  // Two possible sources:
  //   1. recompute-edge-strengths writes `pooling_metadata` sub-object
  //   2. research template seed writes effect_size + standard_error
  //      directly at top level (pre-pooling — single-study)
  const meta =
    typeof dp.pooling_metadata === "object" && dp.pooling_metadata !== null
      ? (dp.pooling_metadata as Record<string, unknown>)
      : null;
  if (meta) {
    return {
      pooled_effect: numOrNull(meta.pooled_effect),
      pooled_ci_lower: numOrNull(meta.pooled_ci_lower),
      pooled_ci_upper: numOrNull(meta.pooled_ci_upper),
      tau_squared: numOrNull(meta.tau_squared),
      n_studies: intOrNull(meta.n_studies),
      recomputed_at:
        typeof meta.recomputed_at === "string" ? meta.recomputed_at : null,
    };
  }
  // Fallback: template-seed-style top-level fields (single study, no pool yet).
  if (typeof dp.effect_size === "number") {
    const se = numOrNull(dp.standard_error);
    const ci = se != null ? 1.96 * se : null;
    const eff = dp.effect_size as number;
    return {
      pooled_effect: eff,
      pooled_ci_lower: ci != null ? eff - ci : null,
      pooled_ci_upper: ci != null ? eff + ci : null,
      tau_squared: null,
      n_studies: intOrNull(dp.num_studies),
      recomputed_at: null,
    };
  }
  return null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  return null;
}
