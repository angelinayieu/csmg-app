// GET /api/spaces/[id]/cycles
//
// Phase A1.3 — lists feedback-loop cycles detected in a space so the
// universal asset catalog library can surface them. Mirrors the
// bridges endpoint shape for consistency.
//
// Also returns a map of `entity_name_by_id` covering every entity
// referenced by any cycle — lets the client render `A → B → C`
// previews without a second roundtrip.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { Cycle } from "@/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface CyclesResponse {
  cycles: Cycle[];
  /** entity_id (uuid) → name, for chain-preview rendering */
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
    .from("cycles")
    .select("*")
    .eq("space_id", spaceId)
    .order("classification", { ascending: true })
    .order("name", { ascending: true, nullsFirst: false })) as {
    data: Cycle[] | null;
    error: unknown;
  };

  if (error) {
    console.error("[space cycles] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch cycles" },
      { status: 500 },
    );
  }

  const cycles = data ?? [];

  // Gather every distinct entity id referenced by any cycle so the
  // client can render "A → B → C" previews without a second fetch.
  const allEntityIds = new Set<string>();
  for (const c of cycles) {
    for (const eid of c.entity_ids ?? []) allEntityIds.add(eid);
  }

  const entity_name_by_id: Record<string, string> = {};
  if (allEntityIds.size > 0) {
    const { data: entRows } = (await db
      .from("entities")
      .select("id, name")
      .in("id", Array.from(allEntityIds))) as {
      data: Array<{ id: string; name: string }> | null;
    };
    for (const r of entRows ?? []) entity_name_by_id[r.id] = r.name;
  }

  const payload: CyclesResponse = { cycles, entity_name_by_id };
  return NextResponse.json(payload);
}
