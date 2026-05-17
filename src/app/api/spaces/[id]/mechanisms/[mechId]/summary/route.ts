// ── GET /api/spaces/[id]/mechanisms/[mechId]/summary ───────────────
//
// Lightweight per-mechanism read for:
//   - The live mechanism spawner (Phase 2) — when a new mechanism
//     row materializes mid-pipeline, the spawner fetches its
//     summary + paints the canvas card without a full bundle refetch
//   - The mechanism detail drawer on the Twin Detail Page —
//     opens fast (one DB round-trip) instead of waiting for the
//     full bundle to refresh
//
// Returns the same shape as one element of the bundle's mechanisms[]
// array so the consumer can reuse the renderer.

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
}

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

  // Fetch mechanism, apps under it, entities the apps touch, and
  // the layer ontology — all in parallel for the layer_distribution
  // aggregation.
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
      // Select layer_ontology_id explicitly — it's not in the
      // generated types yet (migration 20260615 added it but
      // database.types.ts hasn't been regenerated).
      .from("entities")
      .select("id, layer_ontology_id")
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
  const entities = (entRes.data ?? []) as Array<any>;
  const layers = (layerRes.data ?? []) as Array<{ id: string; slug: string }>;

  // Cast to the thin EntityLayerLink shape — `layer_ontology_id`
  // exists in the DB (migration 20260615) but isn't in the
  // generated database.types.ts yet.
  const entityLayerLinks = entities.map((e) => ({
    id: e.id as string,
    layer_ontology_id: (e.layer_ontology_id as string | null) ?? null,
  }));
  const { entitiesById, layersById } = buildLookupMaps(entityLayerLinks, layers);

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
    // For the per-mechanism summary, we already filtered apps to this
    // mechanism, so all of them count toward the distribution. We still
    // call aggregateLayerDistribution with the full set + mechanism id
    // to match the bundle endpoint's shape (consistency over micro-perf).
    layer_distribution: aggregateLayerDistribution(
      mech.id,
      appRows,
      entitiesById,
      layersById,
    ),
  };

  return NextResponse.json({ mechanism: summary });
}
