// GET /api/spaces/[id]/bridges
//
// Lightweight bridges feed for live-refresh in the synthesis view (and
// anywhere else that wants a current view of cross-space links without
// re-fetching the whole SpaceDataProvider payload).
//
// Returns bridges whose source_space_id OR target_space_id equals the
// given space id. Excludes user-rejected rows by default.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { Bridge } from "@/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Phase A1.3 — enriched bridge shape returned by this endpoint. The
 * base `Bridge` row is spread plus partner-side name lookups so
 * consumers (the universal asset library in particular) can render
 * `this ↔ partner` without another round-trip.
 *
 * Partner resolution is relative to the URL's `spaceId`:
 *   - if spaceId is the source_space_id → partner = target side
 *   - else → partner = source side
 *
 * Partner names fall back to "(cross-space)" when RLS hides the
 * partner space / entity from this user.
 */
export interface EnrichedBridge extends Bridge {
  partner_space_id: string;
  partner_space_name: string;
  partner_entity_id: string;
  partner_entity_name: string;
  /** True when spaceId == bridge.source_space_id */
  this_is_source: boolean;
}

export interface SpaceBridgesResponse {
  bridges: EnrichedBridge[];
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
    .from("bridges")
    .select("*")
    .or(`source_space_id.eq.${spaceId},target_space_id.eq.${spaceId}`)
    .neq("status", "user_rejected")
    .order("created_at", { ascending: false })) as {
    data: Bridge[] | null;
    error: unknown;
  };

  if (error) {
    console.error("[space bridges] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bridges" },
      { status: 500 },
    );
  }

  const bridges = data ?? [];

  // Phase A1.3 — enrich with partner space + entity names so the
  // library can render `this ↔ partner` without an extra fetch.
  // Batched one query per (spaces, entities) regardless of count.
  const partnerSpaceIds = new Set<string>();
  const partnerEntityIds = new Set<string>();
  const meta = bridges.map((b) => {
    const thisIsSource = b.source_space_id === spaceId;
    const partnerSpaceId = thisIsSource
      ? b.target_space_id
      : b.source_space_id;
    const partnerEntityId = thisIsSource
      ? b.target_entity_id
      : b.source_entity_id;
    partnerSpaceIds.add(partnerSpaceId);
    partnerEntityIds.add(partnerEntityId);
    return { bridge: b, thisIsSource, partnerSpaceId, partnerEntityId };
  });

  const spaceNameById = new Map<string, string>();
  if (partnerSpaceIds.size > 0) {
    const { data: spaceRows } = (await db
      .from("spaces")
      .select("id, name")
      .in("id", Array.from(partnerSpaceIds))) as {
      data: Array<{ id: string; name: string }> | null;
    };
    for (const r of spaceRows ?? []) spaceNameById.set(r.id, r.name);
  }

  const entityNameById = new Map<string, string>();
  if (partnerEntityIds.size > 0) {
    const { data: entityRows } = (await db
      .from("entities")
      .select("id, name")
      .in("id", Array.from(partnerEntityIds))) as {
      data: Array<{ id: string; name: string }> | null;
    };
    for (const r of entityRows ?? []) entityNameById.set(r.id, r.name);
  }

  const enriched: EnrichedBridge[] = meta.map((m) => ({
    ...m.bridge,
    partner_space_id: m.partnerSpaceId,
    partner_space_name:
      spaceNameById.get(m.partnerSpaceId) ?? "(cross-space)",
    partner_entity_id: m.partnerEntityId,
    partner_entity_name:
      entityNameById.get(m.partnerEntityId) ?? "(cross-space)",
    this_is_source: m.thisIsSource,
  }));

  const payload: SpaceBridgesResponse = { bridges: enriched };
  return NextResponse.json(payload);
}
