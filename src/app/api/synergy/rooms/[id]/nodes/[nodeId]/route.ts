// ── PATCH + DELETE /api/synergy/rooms/[id]/nodes/[nodeId] ──
//
// Both room members can edit or delete either author's nodes — the
// collab UX requires mutual write access. RLS gates membership;
// archived-room guard runs server-side.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { insertRoomEvent, previewLabel } from "@/lib/synergy/room-events";

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
  const { supabase, user, error: authError } = await safeAuth();
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

  // Pre-read OLD so we can compose a meaningful Timeline summary
  // ("foo → bar" vs. moved vs. linked). Soft-fail to {}.
  const { data: old } = await db
    .from("synergy_room_nodes")
    .select("label, parent_id, x, y")
    .eq("id", nodeId)
    .eq("room_id", roomId)
    .maybeSingle();

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

  // Diff-based event classification:
  //   - label changed       → node_edited (most material)
  //   - parent_id changed   → node_linked
  //   - only x/y changed    → suppress (moves don't deserve a row)
  // We prioritize edit > link > move so we emit at most one event
  // per PATCH; the user typically does one thing at a time anyway.
  if (old && user) {
    const labelChanged =
      typeof update.label === "string" && update.label !== old.label;
    const parentChanged =
      "parent_id" in update && update.parent_id !== old.parent_id;
    if (labelChanged) {
      void insertRoomEvent(db, {
        roomId,
        actorId: user.id,
        kind: "node_edited",
        targetNodeId: nodeId,
        summary: `${previewLabel(old.label, 40)} → ${previewLabel(
          updated.label,
          40,
        )}`,
        payload: { old_label: old.label, new_label: updated.label },
      });
    } else if (parentChanged) {
      void insertRoomEvent(db, {
        roomId,
        actorId: user.id,
        kind: "node_linked",
        targetNodeId: nodeId,
        summary: `Linked: ${previewLabel(updated.label)}`,
        payload: {
          old_parent_id: old.parent_id,
          new_parent_id: updated.parent_id,
        },
      });
    }
    // Pure x/y moves are intentionally silent.
  }

  return NextResponse.json({ node: updated });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id: roomId, nodeId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
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

  // Snapshot the label BEFORE delete so the Timeline rail can still
  // render a human summary after the row is gone.
  const { data: old } = await db
    .from("synergy_room_nodes")
    .select("label")
    .eq("id", nodeId)
    .eq("room_id", roomId)
    .maybeSingle();

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

  // The event's target_node_id is intentionally left NULL — the node
  // is gone, the FK would dangle. The summary preserves the snapshot.
  if (old && user) {
    void insertRoomEvent(db, {
      roomId,
      actorId: user.id,
      kind: "node_deleted",
      targetNodeId: null,
      summary: `Removed: ${previewLabel(old.label)}`,
      payload: { deleted_label: old.label },
    });
  }

  return NextResponse.json({ ok: true });
}
