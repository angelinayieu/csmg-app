// GET /api/spaces/[id]/evidence-rollup?entity_ids=<csv>
//
// Returns evidence_registries rows attached to any of the given
// entity_ids (capped at 80 ids to keep the URL + query sane).
// Used by LabEvidenceBasis to surface the literature backing a
// lab subject's in-scope entities.
//
// Soft-fail: returns { rows: [], total: 0 } on missing params or
// query errors so the panel just renders an empty state instead of
// blocking the lab.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { EvidenceRegistryRow } from "@/types/evidence-registry";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("entity_ids") ?? "";
  const entityIds = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 80);

  if (entityIds.length === 0) {
    return NextResponse.json({ rows: [], total: 0 });
  }

  const { data, error, count } = (await db
    .from("evidence_registries")
    .select("*", { count: "exact" })
    .eq("space_id", spaceId)
    .in("attached_entity_id", entityIds)
    .order("created_at", { ascending: false })
    .limit(20)) as {
    data: EvidenceRegistryRow[] | null;
    error: { message?: string } | null;
    count: number | null;
  };

  if (error) {
    console.warn("[evidence-rollup] query failed:", error);
    return NextResponse.json({ rows: [], total: 0 });
  }

  return NextResponse.json({
    rows: data ?? [],
    total: count ?? (data?.length ?? 0),
  });
}
