// ── /api/spaces/[id]/snapshots/[snapshotId] ──────────────────────────
//
// R5 Phase A — full-detail snapshot read.
//
// The list endpoint at /api/spaces/[id]/snapshots returns only scalar
// meta (counts + reason + captured_at). This endpoint hydrates the
// entire frozen subgraph (entities + edges + cycles + bridges +
// twin_state). Meant for the scenario editor and diff viewer, not
// for casual dashboard reads — payloads can be hundreds of KB for
// large spaces.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { TwinSnapshot } from "@/types/snapshot";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string; snapshotId: string }>;
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId, snapshotId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("twin_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const row = data as TwinSnapshot;
  if (row.space_id !== spaceId) {
    return NextResponse.json(
      { error: "Snapshot belongs to a different space" },
      { status: 400 },
    );
  }
  if (row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ snapshot: row });
}
