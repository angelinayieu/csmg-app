// ── POST /api/synergy/rooms/[id]/checkin ──
//
// Mark one of the caller's own plan_step blocks as complete inside a
// parallel-path room. Body:
//   { step_block_id: string, reflection?: string | null }
//
// Validation:
//   1. Auth (safeAuth)
//   2. Room exists, is parallel_path, caller is a member
//   3. step_block_id belongs to caller's OWN strategy (block_type='plan_step',
//      strategy.session.owner_id === caller). Enforced both here AND by
//      RLS WITH CHECK on plan_step_checkins_own_insert.
//
// Upsert behavior: if a checkin already exists for (room, user, step),
// the second call is idempotent — returns the existing row. This lets
// the client retry on transient failures without worrying about
// duplicate rows or 409s.
//
// Response: full checkin row, ready to insert into client state.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  step_block_id?: string;
  reflection?: string | null;
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id: roomId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const stepBlockId = body.step_block_id;
  if (!stepBlockId || typeof stepBlockId !== "string") {
    return NextResponse.json(
      { error: "step_block_id is required" },
      { status: 400 },
    );
  }
  const reflection =
    typeof body.reflection === "string"
      ? body.reflection.trim().slice(0, 2000) || null
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Verify room membership + kind in one query
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
        { error: "Check-ins are only available in parallel-path rooms" },
        { status: 400 },
      );
    }
    if (room.archived_at) {
      return NextResponse.json(
        { error: "Room is archived" },
        { status: 410 },
      );
    }

    // Upsert. RLS WITH CHECK enforces step_block ownership; if the
    // block belongs to the OTHER user's strategy, the insert fails
    // with a policy violation (we surface a friendlier 403 below).
    const { data: row, error: upErr } = await db
      .from("plan_step_checkins")
      .upsert(
        {
          room_id: roomId,
          user_id: user.id,
          step_block_id: stepBlockId,
          reflection,
        },
        { onConflict: "room_id,user_id,step_block_id" },
      )
      .select(
        "id, room_id, user_id, step_block_id, marked_complete_at, reflection, updated_at",
      )
      .single();
    if (upErr || !row) {
      // RLS policy violation surfaces as a permission error from PostgREST
      const msg = upErr?.message ?? "unknown error";
      if (msg.toLowerCase().includes("policy")) {
        return NextResponse.json(
          { error: "You can only check in on your own plan steps" },
          { status: 403 },
        );
      }
      return NextResponse.json(
        { error: sanitizeErrorMessage(upErr) },
        { status: 500 },
      );
    }

    return NextResponse.json({ checkin: row });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
