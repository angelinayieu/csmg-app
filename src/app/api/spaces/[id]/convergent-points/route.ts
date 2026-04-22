// GET /api/spaces/[id]/convergent-points
//
// Phase A1.4b — lists convergent points for a space so the universal
// asset catalog can surface them as draggable outcome predictions.
// Returns the full ConvergentPoint rows plus a batched entity-name
// lookup so the library can render "focal → outcome" previews inline.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { ConvergentPoint } from "@/types/convergent-point";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface ConvergentPointsResponse {
  points: ConvergentPoint[];
  /** entity_id → name, for focal + interactor labels */
  entity_name_by_id: Record<string, string>;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = (await db
    .from("convergent_points")
    .select("*")
    .eq("space_id", spaceId)
    .order("probability", { ascending: false })
    .order("confidence", { ascending: false })
    .limit(200)) as {
    data: ConvergentPoint[] | null;
    error: unknown;
  };

  if (error) {
    console.error("[space convergent-points] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch convergent points" },
      { status: 500 },
    );
  }

  const points = data ?? [];

  // Batch-resolve entity names for focal + interactors across all points.
  const entityIds = new Set<string>();
  for (const p of points) {
    if (p.focal_entity_id) entityIds.add(p.focal_entity_id);
    for (const iid of p.interactor_entity_ids ?? []) entityIds.add(iid);
  }

  const entity_name_by_id: Record<string, string> = {};
  if (entityIds.size > 0) {
    const { data: entRows } = (await db
      .from("entities")
      .select("id, name")
      .in("id", Array.from(entityIds))) as {
      data: Array<{ id: string; name: string }> | null;
    };
    for (const r of entRows ?? []) entity_name_by_id[r.id] = r.name;
  }

  const payload: ConvergentPointsResponse = { points, entity_name_by_id };
  return NextResponse.json(payload);
}
