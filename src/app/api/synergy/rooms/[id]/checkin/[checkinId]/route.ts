// ── /api/synergy/rooms/[id]/checkin/[checkinId] ──
//
// Two methods sharing one file:
//   PATCH — edit the reflection on a check-in (within 24h)
//   DELETE — undo a check-in (within 24h)
//
// Both are owner-only + 24-hour-window. The RLS policies on
// plan_step_checkins enforce both — these endpoints just translate
// PostgREST policy violations into clean 403 / 409 responses.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string; checkinId: string }>;
}

interface PatchBody {
  reflection?: string | null;
}

// ── PATCH — edit reflection ──

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id: roomId, checkinId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const reflection =
    body.reflection === null
      ? null
      : typeof body.reflection === "string"
        ? body.reflection.trim().slice(0, 2000) || null
        : undefined;
  if (reflection === undefined) {
    return NextResponse.json(
      { error: "reflection field is required (string | null)" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Pre-check: is the row visible to me + still within 24h? (We
    // need to distinguish 404 from 409.)
    const { data: existing } = await db
      .from("plan_step_checkins")
      .select("id, user_id, marked_complete_at, room_id")
      .eq("id", checkinId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json(
        { error: "Check-in not found" },
        { status: 404 },
      );
    }
    if (existing.room_id !== roomId) {
      return NextResponse.json(
        { error: "Check-in does not belong to this room" },
        { status: 400 },
      );
    }
    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const ageMs = Date.now() - new Date(existing.marked_complete_at).getTime();
    if (ageMs >= 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { error: "Edit window expired (24 hours)" },
        { status: 409 },
      );
    }

    const { data: updated, error: updErr } = await db
      .from("plan_step_checkins")
      .update({ reflection })
      .eq("id", checkinId)
      .select(
        "id, room_id, user_id, step_block_id, marked_complete_at, reflection, updated_at",
      )
      .single();
    if (updErr || !updated) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(updErr) },
        { status: 500 },
      );
    }
    return NextResponse.json({ checkin: updated });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

// ── DELETE — undo ──

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id: roomId, checkinId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const { data: existing } = await db
      .from("plan_step_checkins")
      .select("id, user_id, marked_complete_at, room_id")
      .eq("id", checkinId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json(
        { error: "Check-in not found" },
        { status: 404 },
      );
    }
    if (existing.room_id !== roomId) {
      return NextResponse.json(
        { error: "Check-in does not belong to this room" },
        { status: 400 },
      );
    }
    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const ageMs = Date.now() - new Date(existing.marked_complete_at).getTime();
    if (ageMs >= 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { error: "Undo window expired (24 hours)" },
        { status: 409 },
      );
    }

    const { error: delErr } = await db
      .from("plan_step_checkins")
      .delete()
      .eq("id", checkinId);
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
