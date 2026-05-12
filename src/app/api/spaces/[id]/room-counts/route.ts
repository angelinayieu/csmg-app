// GET /api/spaces/[id]/room-counts
//
// Returns the per-stage counts that drive the operational cascade's room
// subtitles ("202 entities · 268 edges · 1 cycle"). Mirrors the
// `RoomCounts` shape from src/lib/whiteboard/room-layout.ts so the
// canvas seeder can pass the response straight to `buildRoomSubtitle()`.
//
// Implementation: 9 parallel SELECT count(*) queries, ~1 round-trip
// total. count-only via `{ count: "exact", head: true }` — no rows
// shipped over the wire. Soft-fails per-table: a missing column or
// access error returns 0 for that field, never 500s the whole response.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { RoomCounts } from "@/lib/whiteboard/room-layout";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface RoomCountsResponse {
  counts: RoomCounts;
  computed_at: string;
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Helper: run a count query, return 0 on any error so a missing
  // table or column doesn't tank the whole response.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safeCount = async (q: any): Promise<number> => {
    try {
      const { count, error } = await q;
      if (error) return 0;
      return count ?? 0;
    } catch {
      return 0;
    }
  };

  // Run all counts in parallel — ~1 round-trip wall-clock.
  const [
    entities,
    edges,
    cycles,
    bridges,
    axesTotal,
    axesScored,
    twinProposals,
    variants,
    assets,
    predictions,
  ] = await Promise.all([
    safeCount(
      db
        .from("entities")
        .select("*", { count: "exact", head: true })
        .eq("space_id", spaceId),
    ),
    safeCount(
      db
        .from("edges")
        .select("*", { count: "exact", head: true })
        .eq("space_id", spaceId),
    ),
    safeCount(
      db
        .from("cycles")
        .select("*", { count: "exact", head: true })
        .eq("space_id", spaceId),
    ),
    safeCount(
      db
        .from("bridges")
        .select("*", { count: "exact", head: true })
        .eq("space_id", spaceId),
    ),
    // Total axes opened for this space. Status doesn't matter for the
    // denominator — a failed axis still counts as an axis the panel
    // opened. The "scored" count uses status to drive the X/Y display.
    safeCount(
      db
        .from("probability_space_runs")
        .select("*", { count: "exact", head: true })
        .eq("space_id", spaceId),
    ),
    safeCount(
      db
        .from("probability_space_runs")
        .select("*", { count: "exact", head: true })
        .eq("space_id", spaceId)
        .eq("status", "scored"),
    ),
    // "proposals" in RoomCounts is overloaded — it drives BOTH the
    // proposal-room subtitle ("3 strategies ranked") and the twin-room
    // subtitle ("Twin pinned · 3 strategies approved"). Source of
    // truth: twin_proposals row count (one per strategy generation).
    safeCount(
      db
        .from("twin_proposals")
        .select("*", { count: "exact", head: true })
        .eq("space_id", spaceId)
        .eq("user_id", user.id),
    ),
    safeCount(
      db
        .from("experiment_variants")
        .select("*", { count: "exact", head: true })
        .eq("space_id", spaceId),
    ),
    safeCount(
      db
        .from("ingested_files")
        .select("*", { count: "exact", head: true })
        .eq("space_id", spaceId),
    ),
    safeCount(
      db
        .from("prediction_ledger")
        .select("*", { count: "exact", head: true })
        .eq("space_id", spaceId),
    ),
  ]);

  const counts: RoomCounts = {
    entities,
    edges,
    cycles,
    axes: axesTotal,
    axesScored,
    proposals: twinProposals,
    variants,
    bridges,
    assets,
    predictions,
  };

  const payload: RoomCountsResponse = {
    counts,
    computed_at: new Date().toISOString(),
  };
  return NextResponse.json(payload);
}
