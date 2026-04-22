// GET /api/spaces/[id]/claims
//
// Phase A1.4a — lists claims (statements with evidence status) so the
// universal asset catalog can surface them as draggable chips. Claims
// carry an epistemic status (proposed/supported/contested/refuted)
// that users need to be able to scan visually on the whiteboard.
//
// Batched second query joins source entity names so the library row
// can render "— from: EntityName" without another fetch per row.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { Claim } from "@/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface ClaimsResponse {
  claims: Claim[];
  /** source_entity_id → name, for "— from:" subtitle rendering */
  source_entity_name_by_id: Record<string, string>;
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
    .from("claims")
    .select("*")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false })) as {
    data: Claim[] | null;
    error: unknown;
  };

  if (error) {
    console.error("[space claims] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch claims" },
      { status: 500 },
    );
  }

  const claims = data ?? [];

  // Batch-resolve source entity names.
  const entityIds = Array.from(
    new Set(
      claims
        .map((c) => c.source_entity_id)
        .filter((v): v is string => typeof v === "string"),
    ),
  );
  const source_entity_name_by_id: Record<string, string> = {};
  if (entityIds.length > 0) {
    const { data: entRows } = (await db
      .from("entities")
      .select("id, name")
      .in("id", entityIds)) as {
      data: Array<{ id: string; name: string }> | null;
    };
    for (const r of entRows ?? []) source_entity_name_by_id[r.id] = r.name;
  }

  const payload: ClaimsResponse = { claims, source_entity_name_by_id };
  return NextResponse.json(payload);
}
