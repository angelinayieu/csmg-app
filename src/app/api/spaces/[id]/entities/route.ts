// GET /api/spaces/[id]/entities
//
// Returns the current entities + edges for a space, for live client-side
// refetches after mutations like expansion/decompose. Used by
// SpaceDataContext.refreshEntities() so the whiteboard can see newly
// materialized children without waiting for a full Next.js router refresh
// (which races the client callback).

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { Entity, Edge } from "@/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
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

  const [entitiesRes, edgesRes] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
  ]);

  if (entitiesRes.error || edgesRes.error) {
    console.error(
      "[/api/spaces/:id/entities] error:",
      entitiesRes.error ?? edgesRes.error,
    );
    return NextResponse.json({ error: "Failed to load graph" }, { status: 500 });
  }

  return NextResponse.json({
    entities: (entitiesRes.data ?? []) as Entity[],
    edges: (edgesRes.data ?? []) as Edge[],
  });
}
