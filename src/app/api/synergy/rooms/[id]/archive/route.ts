// ── POST /api/synergy/rooms/[id]/archive ──
//
// Archive a synergy_rooms row. Sets `archived_at = now()`. After this:
//   - Room disappears from /rooms grid (the bundle filters
//     `archived_at IS NULL`)
//   - Check-in writes are rejected with 410
//   - Reveal writes are rejected with 410
//   - The weekly digest cron skips this room (filter on `archived_at IS NULL`)
//   - The room interior dispatcher could 404 — current behavior shows
//     the room read-only since the bundle still loads
//
// Either member can archive. Idempotent: archiving an already-archived
// room returns the existing row unchanged.
//
// No unarchive in this surface — the data model supports it (column is
// nullable timestamp) but the UI doesn't expose the action. Future tweak.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id: roomId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
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

    // Idempotent: if already archived, return the existing timestamp.
    if (room.archived_at) {
      return NextResponse.json({
        room_id: room.id,
        archived_at: room.archived_at,
        already_archived: true,
      });
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updErr } = await db
      .from("synergy_rooms")
      .update({ archived_at: nowIso })
      .eq("id", roomId)
      .select("id, archived_at")
      .single();
    if (updErr || !updated) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(updErr) },
        { status: 500 },
      );
    }

    return NextResponse.json({
      room_id: updated.id,
      archived_at: updated.archived_at,
      already_archived: false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
