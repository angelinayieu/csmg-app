// ── GET /api/edges/[id]/detail ──
//
// Backs the canvas edge-expansion drawer. One round-trip returns:
//   - Full edge row (includes dynamics, polarity, conditions, topology,
//     utility sub-fields, dimension, strength, confidence, etc.)
//   - Source + target entity rows for name/category context
//   - Claims linked via `claims.source_edge_id` for evidence chain
//
// Entity-scoped (not space-scoped) because the tldraw shape click only
// knows the edge id — we resolve space_id from the edge row and use
// it to enforce ownership.

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
    return NextResponse.json({ error: "edge id required" }, { status: 400 });
  }

  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: edge, error: edgeError } = await db
    .from("edges")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (edgeError) {
    console.error("[edges/detail] edge fetch failed:", edgeError);
    return NextResponse.json({ error: "Edge lookup failed" }, { status: 500 });
  }
  if (!edge) {
    return NextResponse.json({ error: "Edge not found" }, { status: 404 });
  }

  const spaceId = edge.space_id as string;

  // Ownership check — belt-and-suspenders beyond RLS so the client
  // gets a clear 403 instead of a silent empty.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Hydrate endpoint entities in parallel. Two small SELECTs are
  // faster than a join given RLS composition costs.
  const [sourceRes, targetRes, claimsRes] = await Promise.all([
    db.from("entities").select("*").eq("id", edge.source_entity_id).maybeSingle(),
    db.from("entities").select("*").eq("id", edge.target_entity_id).maybeSingle(),
    db
      .from("claims")
      .select("*")
      .eq("space_id", spaceId)
      .eq("source_edge_id", id),
  ]);

  return NextResponse.json({
    edge,
    sourceEntity: sourceRes.data ?? null,
    targetEntity: targetRes.data ?? null,
    claims: claimsRes.error ? [] : (claimsRes.data ?? []),
  });
}
