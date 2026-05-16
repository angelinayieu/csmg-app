// ── GET /api/synergy/rooms/[id]/peer-profile ──
//
// Returns the OTHER member's display_name + avatar_url for a parallel-
// path room. Privacy-gated: the response is 403 unless BOTH members
// have a row in synergy_room_identity_reveals for this room.
//
// Why this exists (separate from the bundle): when User A is sitting on
// the room page and User B hits "Reveal" — the bundle the page server-
// rendered against still has their_display_name=null. The client picks
// up the mutual-reveal event via realtime CDC, then calls THIS endpoint
// to lazily fetch the now-permitted profile data. Beats a router.refresh()
// because it preserves all in-flight check-in state.
//
// Uses service-role for the cross-user profile read after the mutual-
// reveal check passes (RLS on synergy_profiles is per-user-only).

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id: roomId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Membership + kind probe
    const { data: room } = await db
      .from("synergy_rooms")
      .select("id, user_a, user_b, room_kind, archived_at")
      .eq("id", roomId)
      .maybeSingle();
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    if (room.user_a !== user.id && room.user_b !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (room.room_kind !== "parallel_path") {
      return NextResponse.json(
        { error: "Peer-profile is only available in parallel-path rooms" },
        { status: 400 },
      );
    }
    const otherUserId = room.user_a === user.id ? room.user_b : room.user_a;

    // Mutual-reveal gate. RLS lets the caller read both rows since
    // they're a room member; we still verify both exist before
    // returning any profile data.
    const { data: reveals } = await db
      .from("synergy_room_identity_reveals")
      .select("user_id")
      .eq("room_id", roomId);
    const revealedUserIds = new Set(
      ((reveals ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
    );
    const bothRevealed =
      revealedUserIds.has(user.id) && revealedUserIds.has(otherUserId);
    if (!bothRevealed) {
      // Privacy-preserving: don't leak partial state. 403 with a
      // generic message rather than 200 + null fields.
      return NextResponse.json(
        { error: "Mutual reveal not yet achieved" },
        { status: 403 },
      );
    }

    // Service-role read of the peer's profile. RLS on synergy_profiles
    // typically gates display_name to the row owner; service-role
    // bypasses that since the consent gate (mutual reveal) was already
    // verified above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdb = createServiceClient() as any;
    const { data: profile } = await sdb
      .from("synergy_profiles")
      .select("display_name, avatar_url")
      .eq("user_id", otherUserId)
      .maybeSingle();

    return NextResponse.json({
      display_name: profile?.display_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
