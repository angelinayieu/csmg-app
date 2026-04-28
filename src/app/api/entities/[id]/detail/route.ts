// ── GET /api/entities/[id]/detail ──
//
// One-shot fetch that backs the canvas entity-expansion drawer. Returns
// the full entity row + every edge touching it + every claim tagged to
// its source_entity_id, so NodeDetail can render everything without
// follow-up requests.
//
// Why entity-scoped (not space-scoped) when the related-edges query
// already knows space_id? Because the caller (a tldraw shape click)
// only knows the entity id. We resolve space_id from the entity row,
// then use it both for RLS-friendly scoping and to enforce ownership.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "entity id required" }, { status: 400 });
  }

  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: entity, error: entityError } = await db
    .from("entities")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (entityError) {
    console.error("[entities/detail] entity fetch failed:", entityError);
    return NextResponse.json({ error: "Entity lookup failed" }, { status: 500 });
  }
  if (!entity) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  const spaceId = entity.space_id as string;

  // Cross-check ownership via the space row — RLS should already gate
  // this but defensive checks keep the 404/403 distinction explicit for
  // consistency with other endpoints.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Edges touching this entity (source or target). Match both UUID and
  // legacy string entity_id since older rows referenced the semantic id.
  const entityCode = entity.entity_id as string | null;
  const orClause = entityCode
    ? `source_entity_id.eq.${id},target_entity_id.eq.${id},source_entity_id.eq.${entityCode},target_entity_id.eq.${entityCode}`
    : `source_entity_id.eq.${id},target_entity_id.eq.${id}`;

  const layerOntologyId = entity.layer_ontology_id as string | null;

  const [edgesRes, claimsRes, evidenceRes, ontologyRowRes] = await Promise.all([
    db
      .from("edges")
      .select("*")
      .eq("space_id", spaceId)
      .or(orClause),
    // Claims are always referenced by UUID (`source_entity_id = entities.id`).
    db
      .from("claims")
      .select("*")
      .eq("space_id", spaceId)
      .eq("source_entity_id", id),
    // Phase 3 — per-entity evidence rollup. Surfaces the L2M
    // extracted effect-size rows that attach to this entity. The
    // drawer uses these to render the "Evidence" section + a count
    // badge in the rigor strip.
    db
      .from("evidence_registries")
      .select("*")
      .eq("space_id", spaceId)
      .eq("attached_entity_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    // Phase 3 — fetch the per-space layer_ontology row this entity
    // belongs to (when active plan materialized one). Lets the
    // drawer show the topic-adaptive layer label + color instead of
    // the legacy 4-value enum fallback.
    layerOntologyId
      ? db
          .from("layer_ontology")
          .select("*")
          .eq("id", layerOntologyId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (edgesRes.error) {
    console.warn("[entities/detail] edge fetch failed (non-fatal):", edgesRes.error);
  }
  if (claimsRes.error) {
    console.warn("[entities/detail] claims fetch failed (non-fatal):", claimsRes.error);
  }
  if (evidenceRes.error) {
    console.warn("[entities/detail] evidence fetch failed (non-fatal):", evidenceRes.error);
  }

  // Phase 6 — partner-entity hydration for the ego-network view.
  // Collect every UUID at the FAR side of an incident edge, then
  // batch-fetch (id, name, entity_category) so the drawer can render
  // labels without a per-edge follow-up roundtrip. Ignored when
  // edges came back empty.
  const edgeRows = (edgesRes.data ?? []) as Array<{
    source_entity_id: string;
    target_entity_id: string;
  }>;
  const partnerIds = new Set<string>();
  for (const e of edgeRows) {
    if (e.source_entity_id !== id) partnerIds.add(e.source_entity_id);
    if (e.target_entity_id !== id) partnerIds.add(e.target_entity_id);
  }
  let partner_entities: Array<{
    id: string;
    name: string;
    entity_category: string | null;
  }> = [];
  if (partnerIds.size > 0) {
    const { data: partnerRows } = await db
      .from("entities")
      .select("id, name, entity_category")
      .in("id", Array.from(partnerIds));
    partner_entities = (partnerRows ?? []) as typeof partner_entities;
  }

  return NextResponse.json({
    entity,
    edges: edgesRes.data ?? [],
    claims: claimsRes.data ?? [],
    partner_entities,
    evidence: evidenceRes.data ?? [],
    layer_ontology_row: ontologyRowRes?.data ?? null,
  });
}
