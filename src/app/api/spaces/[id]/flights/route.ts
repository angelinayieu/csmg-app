// GET /api/spaces/[id]/flights?status=active&category=...&limit=50
//
// Phase 6 — list flights for a space. Drives the gallery surface
// (FlightCard list) and the canvas chrome's "Flights through this
// concept" surface (filterable by entity_id when called from the
// entity-detail drawer).
//
// Defaults: status='active', no category filter, limit=50.
// Auth: user must own the space.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const category = url.searchParams.get("category");
  const entityId = url.searchParams.get("entity_id");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw
    ? Math.min(MAX_LIMIT, Math.max(1, parseInt(limitRaw, 10)))
    : DEFAULT_LIMIT;

  let query = db
    .from("flights")
    .select("*")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status === "active" || status === "draft" || status === "archived") {
    query = query.eq("status", status);
  } else {
    query = query.eq("status", "active");
  }
  if (category) {
    query = query.eq("category", category);
  }
  if (entityId) {
    // GIN index on steps_entity_ids supports `contains` / `cs` filter.
    query = query.contains("steps_entity_ids", [entityId]);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[flights GET] query failed:", error);
    return NextResponse.json(
      { error: error.message ?? "query failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ rows: data ?? [] });
}
