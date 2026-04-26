// GET /api/pipeline/space-combinations?space_id=...&plan_id=...
//
// Reads space_combination_results rows for a space (optionally scoped
// to a single plan) and returns them with entity names hydrated. The
// SpacePlanDrawer uses this to render the per-item "Joint analysis"
// card under each selected `intervention_combination` work item.
//
// Without this endpoint the drawer can paint the strategizer's PICK
// of a combination but never the executor's ANSWER — the user sees
// "we will explore A+B" but never finds out what A+B implies.
//
// Soft-fail: missing table → empty array. Recently-inserted rows that
// reference deleted entities → null entity name (caller renders the
// short uuid as a fallback).

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  const planId = url.searchParams.get("plan_id");

  if (!spaceId) {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("space_combination_results")
    .select(
      "id, candidate_id, entity_a_id, entity_b_id, title, novelty, implication, mechanism, probes, created_at",
    )
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (planId) {
    query = query.eq("plan_id", planId);
  }

  const { data: rows, error } = await query;
  if (error) {
    // Likely missing table on a deploy where the migration hasn't run
    // yet — degrade silently rather than leaking schema state.
    console.warn("[space-combinations] read failed:", error);
    return NextResponse.json({ space_id: spaceId, results: [] });
  }

  const records = (rows ?? []) as Array<{
    id: string;
    candidate_id: string;
    entity_a_id: string | null;
    entity_b_id: string | null;
    title: string;
    novelty: string;
    implication: string;
    mechanism: string;
    probes: string[] | null;
    created_at: string;
  }>;

  // Hydrate entity names in a single batched fetch. Skip the join when
  // there are no rows.
  const entityIds = new Set<string>();
  for (const r of records) {
    if (r.entity_a_id) entityIds.add(r.entity_a_id);
    if (r.entity_b_id) entityIds.add(r.entity_b_id);
  }
  const namesById = new Map<string, string>();
  if (entityIds.size > 0) {
    const { data: ents } = await db
      .from("entities")
      .select("id, name")
      .in("id", Array.from(entityIds));
    for (const e of (ents ?? []) as Array<{ id: string; name: string }>) {
      namesById.set(e.id, e.name);
    }
  }

  const results = records.map((r) => ({
    id: r.id,
    candidate_id: r.candidate_id,
    entity_a_id: r.entity_a_id,
    entity_b_id: r.entity_b_id,
    entity_a_name: r.entity_a_id ? (namesById.get(r.entity_a_id) ?? null) : null,
    entity_b_name: r.entity_b_id ? (namesById.get(r.entity_b_id) ?? null) : null,
    title: r.title,
    novelty: r.novelty,
    implication: r.implication,
    mechanism: r.mechanism,
    probes: Array.isArray(r.probes) ? r.probes : [],
    created_at: r.created_at,
  }));

  return NextResponse.json({ space_id: spaceId, results });
}
