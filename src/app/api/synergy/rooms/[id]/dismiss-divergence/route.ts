// ── POST /api/synergy/rooms/[id]/dismiss-divergence ──
//
// Either room member can dismiss the divergence banner. Sets
// `divergence_dismissed_at = now()` on the room row. The banner
// re-surfaces only if the strategy matcher flags a NEW divergence
// after a subsequent regenerate (the matcher clears
// divergence_dismissed_at when it sets diverged_at fresh).
//
// Idempotent: dismissing an already-dismissed banner is a no-op.
// Dismissing a non-diverged room is a no-op (returns 200, no
// side-effect — keeps the client simple).

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
      .select("id, user_a, user_b, room_kind, diverged_at, divergence_dismissed_at")
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
        { error: "Divergence dismiss is only available in parallel-path rooms" },
        { status: 400 },
      );
    }

    // No-op cases (idempotent): not diverged, or already dismissed.
    if (!room.diverged_at) {
      return NextResponse.json({ ok: true, no_op: "not_diverged" });
    }
    if (room.divergence_dismissed_at) {
      return NextResponse.json({ ok: true, no_op: "already_dismissed" });
    }

    const nowIso = new Date().toISOString();
    const { error: updErr } = await db
      .from("synergy_rooms")
      .update({ divergence_dismissed_at: nowIso })
      .eq("id", roomId);
    if (updErr) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(updErr) },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, dismissed_at: nowIso });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
