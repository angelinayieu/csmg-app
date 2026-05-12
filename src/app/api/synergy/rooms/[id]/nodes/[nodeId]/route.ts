// ── PATCH + DELETE /api/synergy/rooms/[id]/nodes/[nodeId] ──
//
// Both room members can edit or delete either author's nodes — the
// collab UX requires mutual write access. RLS gates membership;
// archived-room guard runs server-side.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

interface Body {
  label?: unknown;
  meta?: unknown;
  x?: unknown;
  y?: unknown;
  parent_id?: unknown;
}

interface RouteContext {
  params: Promise<{ id: string; nodeId: string }>;
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id: roomId, nodeId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: room } = await db
    .from("synergy_rooms")
    .select("id, archived_at")
    .eq("id", roomId)
    .single();
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (room.archived_at) {
    return NextResponse.json(
      { error: "Room is archived (read-only)" },
      { status: 403 },
    );
  }

  const update: Record<string, unknown> = {};
  if (typeof body.label === "string") update.label = body.label.slice(0, 1000);
  if (typeof body.meta === "string") update.meta = body.meta.slice(0, 4000);
  if (body.meta === null) update.meta = null;
  if (typeof body.x === "number") update.x = body.x;
  if (typeof body.y === "number") update.y = body.y;
  if (typeof body.parent_id === "string" || body.parent_id === null) {
    update.parent_id = body.parent_id;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: updated, error } = await db
    .from("synergy_room_nodes")
    .update(update)
    .eq("id", nodeId)
    .eq("room_id", roomId)
    .select(
      "id, room_id, author_id, parent_id, kind, label, meta, x, y, created_at, updated_at",
    )
    .single();
  if (error || !updated) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: error?.code === "PGRST116" ? 404 : 500 },
    );
  }
  return NextResponse.json({ node: updated });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id: roomId, nodeId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: room } = await db
    .from("synergy_rooms")
    .select("id, archived_at")
    .eq("id", roomId)
    .single();
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (room.archived_at) {
    return NextResponse.json(
      { error: "Room is archived (read-only)" },
      { status: 403 },
    );
  }

  const { error } = await db
    .from("synergy_room_nodes")
    .delete()
    .eq("id", nodeId)
    .eq("room_id", roomId);
  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
