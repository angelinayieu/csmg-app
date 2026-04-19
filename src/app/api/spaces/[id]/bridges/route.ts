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

  return NextResponse.json({ bridges: data ?? [] });
}
