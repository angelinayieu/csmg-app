// ── GET /api/synergy/rooms/[id]/events ──
//
// Returns the most recent N events for a room. The client typically
// loads this once on mount, then subscribes via Realtime
// (useRoomEvents) for live additions.
//
// RLS gates which events a caller can see (membership-based), so we
// don't double-check membership here — a non-member will get [].

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 200;

export async function GET(request: Request, ctx: RouteContext) {
  const { id: roomId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("synergy_room_events")
    .select(
      "id, room_id, actor_id, kind, target_node_id, summary, payload, created_at",
    )
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }

  // Reverse to chronological for the rail (oldest first → renderer can
  // append to the bottom on Realtime inserts without re-sorting).
  const events = (data ?? []).slice().reverse();
  return NextResponse.json({ events });
}
