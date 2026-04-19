/**
 * GET /api/spaces/[id]/entity-coverage?entityId=X
 *
 * Per-entity coverage footprint. Aggregates all pair_checks touching this
 * specific entity and returns:
 *   - Which of the 9 dimensions have been examined (union across all checks)
 *   - Total pair checks involving this entity
 *   - How many of those led to an edge being proposed
 *   - How many were at L2+ depth
 *
 * Powers the EntityCoverageBadge on the tier-3 entity page.
 */

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const maxDuration = 10;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId");
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fetch all pair checks where this entity is either A or B
  const { data, error } = await db
    .from("pairwise_connection_checks")
    .select("edge_proposed, examination_level, dimensions_examined")
    .eq("space_id", spaceId)
    .or(`entity_a_id.eq.${entityId},entity_b_id.eq.${entityId}`);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  interface CheckRow {
    edge_proposed: boolean;
    examination_level: number;
    dimensions_examined: string[] | null;
  }
  const rows = (data ?? []) as CheckRow[];

  const dimsSet = new Set<string>();
  let edgesFound = 0;
  let level2plus = 0;

  for (const r of rows) {
    if (r.edge_proposed) edgesFound++;
    if (r.examination_level >= 2) level2plus++;
    for (const d of r.dimensions_examined ?? []) {
      dimsSet.add(d);
    }
  }

  return NextResponse.json({
    total_checks: rows.length,
    edges_found: edgesFound,
    level_2_plus: level2plus,
    dimensions_examined: Array.from(dimsSet),
  });
}
