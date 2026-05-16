// ── /api/synergy/rooms/[id]/reveal ──
//
// Two methods in one file:
//   POST    — Record YOUR identity reveal in this room. Idempotent
//             upsert on (room_id, user_id). Returns the inserted row.
//   DELETE  — Withdraw your reveal within the 24-hour undo window.
//
// Both endpoints intentionally do NOT report on the OTHER user's
// reveal state — that's leaked only via the realtime CDC channel after
// each side independently opts in. This preserves consent symmetry:
// neither side is socially pressured by knowing the other revealed
// first.
//
// Validation chain on POST:
//   1. Auth
//   2. Room exists, is parallel_path, caller is a member, not archived
//   3. Upsert reveals row (RLS WITH CHECK enforces user_id = auth.uid())
//
// ── Re-reveal idempotency (verified behavior, Phase 5 polish) ──
//
// Three legitimate sequences a user can produce:
//
//   A. Fresh reveal: no prior row → INSERT → revealed_at = now() via
//      column DEFAULT. 24h window opens.
//
//   B. Double-click without withdraw: a prior row already exists →
//      upsert hits the unique constraint → UPDATE runs but the only
//      columns we explicitly write are { room_id, user_id }, both
//      unchanged. revealed_at PRESERVES its original timestamp.
//      This is the correct behavior — we don't want a double-click
//      to silently reset the 24h withdraw window.
//
//   C. Withdraw then re-reveal: prior row was DELETE'd by the
//      withdraw endpoint → upsert finds no conflict → fresh INSERT →
//      revealed_at = now() (new window). The user effectively gets a
//      fresh 24h cycle, which is correct because they explicitly
//      opted out and then back in.
//
// All three are handled correctly by the existing upsert + DEFAULT
// pattern. No special-case branching required here.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ── POST — reveal ──

export async function POST(_request: Request, ctx: RouteContext) {
  const { id: roomId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Verify membership + kind
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
        { error: "Identity reveal is only available in parallel-path rooms" },
        { status: 400 },
      );
    }
    if (room.archived_at) {
      return NextResponse.json(
        { error: "Room is archived" },
        { status: 410 },
      );
    }

    // Idempotent upsert. If the user already has a reveal row, return it.
    const { data: row, error: upErr } = await db
      .from("synergy_room_identity_reveals")
      .upsert(
        { room_id: roomId, user_id: user.id },
        { onConflict: "room_id,user_id" },
      )
      .select("id, room_id, user_id, revealed_at")
      .single();
    if (upErr || !row) {
      const msg = upErr?.message ?? "unknown error";
      if (msg.toLowerCase().includes("policy")) {
        return NextResponse.json(
          { error: "You can only reveal your own identity" },
          { status: 403 },
        );
      }
      return NextResponse.json(
        { error: sanitizeErrorMessage(upErr) },
        { status: 500 },
      );
    }

    return NextResponse.json({ reveal: row });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

// ── DELETE — withdraw within 24h ──

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id: roomId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Pre-check: distinguish 404 from 409 (expired window)
    const { data: existing } = await db
      .from("synergy_room_identity_reveals")
      .select("id, revealed_at")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json(
        { error: "No reveal to withdraw" },
        { status: 404 },
      );
    }
    const ageMs = Date.now() - new Date(existing.revealed_at).getTime();
    if (ageMs >= 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { error: "Withdraw window expired (24 hours)" },
        { status: 409 },
      );
    }

    const { error: delErr } = await db
      .from("synergy_room_identity_reveals")
      .delete()
      .eq("id", existing.id);
    if (delErr) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(delErr) },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
