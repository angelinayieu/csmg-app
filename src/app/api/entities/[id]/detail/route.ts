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

  const [edgesRes, claimsRes] = await Promise.all([
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
  ]);

  if (edgesRes.error) {
    console.warn("[entities/detail] edge fetch failed (non-fatal):", edgesRes.error);
  }
  if (claimsRes.error) {
    console.warn("[entities/detail] claims fetch failed (non-fatal):", claimsRes.error);
  }

  return NextResponse.json({
    entity,
    edges: edgesRes.data ?? [],
    claims: claimsRes.data ?? [],
  });
}
