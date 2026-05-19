// ── GET /api/spaces/[id]/mechanisms/[mechId]/summary ───────────────
//
// Per-mechanism read for:
//   - The live mechanism spawner — when a new mechanism row
//     materializes mid-pipeline, the spawner fetches its summary +
//     paints the canvas card without a full bundle refetch
//   - The mechanism detail drawer on the Twin Detail Page —
//     opens fast (one DB round-trip) instead of waiting for the
//     full bundle to refresh
//
// Phase 3 D adds two enrichment payloads so the drawer can render
// the "Entities this touches" + "Predictions from this mechanism"
// sections without follow-on round trips:
//   - entities[]    — entities referenced by the mechanism's apps'
//                     dominant_entity_ids (resolved + de-duped)
//   - predictions[] — last 10 prediction_ledger rows whose app_id
//                     belongs to this mechanism

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  aggregateLayerDistribution,
  buildLookupMaps,
} from "@/lib/twin/aggregate-layer-distribution";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string; mechId: string }>;
}

export interface MechanismSummary {
  id: string;
  kind: string;
  name: string;
  cycle_pattern: string | null;
  rationale: string | null;
  status: string;
  agent_count: number;
  app_count: number;
  apps: Array<{ id: string; name: string; status: string }>;
  layer_distribution: Record<string, number>;
  /** Entities touched by this mechanism — resolved from the union
   *  of dominant_entity_ids across all child apps. Capped at 30
   *  most-important entries to keep the drawer scannable. */
  entities: Array<{
    id: string;
    name: string;
    entity_category: string;
    importance: string | null;
  }>;
  /** Last 10 predictions emitted by this mechanism's apps. */
  predictions: Array<{
    id: string;
    metric_label: string;
    predicted_value: number | null;
    predicted_value_text: string | null;
    status: string;
    deviation_tag: string | null;
    resolved_at: string | null;
    predicted_at: string;
    horizon_at: string;
  }>;
}

const MAX_ENTITIES = 30;
const MAX_PREDICTIONS = 10;
const IMPORTANCE_WEIGHT: Record<string, number> = {
  fundamental: 0,
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

export async function GET(_req: Request, ctx: Ctx) {
  const { id: spaceId, mechId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Auth: confirm the mechanism belongs to the user's space.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Fetch mechanism, its apps, entities, and the layer ontology.
  // Entity columns now include name/category/importance so the drawer
  // can render full chips, not just IDs.
  const [mechRes, appsRes, entRes, layerRes] = await Promise.all([
    db
      .from("mechanisms")
      .select(
        "id, kind, name, cycle_pattern, rationale, status, agent_assignments",
      )
      .eq("id", mechId)
      .eq("space_id", spaceId)
      .maybeSingle(),
    db
      .from("apps")
      .select("id, name, status, parent_mechanism_id, dominant_entity_ids")
      .eq("space_id", spaceId)
      .eq("parent_mechanism_id", mechId),
    db
      .from("entities")
      // layer_ontology_id is on the row but not in generated types yet
      // (migration 20260615) — cast through any at the consumer.
      .select(
        "id, name, entity_category, importance, layer_ontology_id",
      )
      .eq("space_id", spaceId),
    db
      .from("layer_ontology")
      .select("id, slug")
      .eq("space_id", spaceId),
  ]);

  if (!mechRes?.data) {
    return NextResponse.json(
      { error: "Mechanism not found" },
      { status: 404 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mech = mechRes.data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appRows = (appsRes.data ?? []) as Array<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entityRows = (entRes.data ?? []) as Array<any>;
  const layers = (layerRes.data ?? []) as Array<{ id: string; slug: string }>;

  // Layer-distribution aggregation reuses the existing helper. We
  // pass the thin EntityLayerLink shape since layer_ontology_id is
  // the only field that path needs.
  const entityLayerLinks = entityRows.map((e) => ({
    id: e.id as string,
    layer_ontology_id: (e.layer_ontology_id as string | null) ?? null,
  }));
  const { entitiesById, layersById } = buildLookupMaps(entityLayerLinks, layers);

  // ── Resolve mechanism-linked entities ─────────────────────────
  //
  // Walk each app's dominant_entity_ids, de-dup, look up the full
  // entity row, sort by importance + name. Capped at MAX_ENTITIES so
  // the drawer doesn't bloat for huge mechanisms.
  const entityById = new Map<string, (typeof entityRows)[number]>();
  for (const e of entityRows) entityById.set(e.id, e);

  const linkedEntityIds = new Set<string>();
  for (const a of appRows) {
    const ids = (a.dominant_entity_ids as string[] | null) ?? [];
    for (const id of ids) linkedEntityIds.add(id);
  }

  const entitiesPayload: MechanismSummary["entities"] = [];
  for (const id of linkedEntityIds) {
    const row = entityById.get(id);
    if (!row) continue;
    entitiesPayload.push({
      id: row.id,
      name: row.name,
      entity_category: row.entity_category,
      importance: row.importance ?? null,
    });
  }
  entitiesPayload.sort((a, b) => {
    const ai = a.importance
      ? (IMPORTANCE_WEIGHT[a.importance] ?? 5)
      : 5;
    const bi = b.importance
      ? (IMPORTANCE_WEIGHT[b.importance] ?? 5)
      : 5;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });
  const trimmedEntities = entitiesPayload.slice(0, MAX_ENTITIES);

  // ── Predictions from this mechanism ────────────────────────────
  //
  // Skip the query entirely when there are no apps — `.in("app_id", [])`
  // would still hit the DB.
  const appIds = appRows.map((a) => a.id as string);
  let predictionsPayload: MechanismSummary["predictions"] = [];
  if (appIds.length > 0) {
    const { data: predRows } = await db
      .from("prediction_ledger")
      .select(
        "id, metric_label, predicted_value, predicted_value_text, status, deviation_tag, resolved_at, predicted_at, horizon_at",
      )
      .eq("space_id", spaceId)
      .in("app_id", appIds)
      .order("predicted_at", { ascending: false })
      .limit(MAX_PREDICTIONS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    predictionsPayload = ((predRows ?? []) as Array<any>).map((p) => ({
      id: p.id,
      metric_label: p.metric_label,
      predicted_value:
        typeof p.predicted_value === "number" ? p.predicted_value : null,
      predicted_value_text: p.predicted_value_text ?? null,
      status: p.status ?? "open",
      deviation_tag: p.deviation_tag ?? null,
      resolved_at: p.resolved_at ?? null,
      predicted_at: p.predicted_at,
      horizon_at: p.horizon_at,
    }));
  }

  const summary: MechanismSummary = {
    id: mech.id,
    kind: mech.kind,
    name: mech.name,
    cycle_pattern: mech.cycle_pattern,
    rationale: mech.rationale,
    status: mech.status,
    agent_count: Array.isArray(mech.agent_assignments)
      ? mech.agent_assignments.length
      : 0,
    app_count: appRows.length,
    apps: appRows.map((a) => ({ id: a.id, name: a.name, status: a.status })),
    layer_distribution: aggregateLayerDistribution(
      mech.id,
      appRows,
      entitiesById,
      layersById,
    ),
    entities: trimmedEntities,
    predictions: predictionsPayload,
  };

  return NextResponse.json({ mechanism: summary });
}
