// ── POST /api/synergy/rooms/[id]/nodes ──
//
// Insert a new node into a synergy room. Author is the caller. RLS
// gates membership; we additionally guard archived rooms server-side.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { insertRoomEvent, previewLabel } from "@/lib/synergy/room-events";

interface Body {
  id?: unknown;
  parent_id?: unknown;
  kind?: unknown;
  label?: unknown;
  meta?: unknown;
  x?: unknown;
  y?: unknown;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

const VALID_KINDS = [
  "core",
  "branch",
  "insight",
  "question",
  "action",
  "variation",
  "ranking",
  "plan",
  "synergy",
  "anchor",
];

export async function POST(request: Request, ctx: RouteContext) {
  const { id: roomId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  if (
    typeof body.label !== "string" ||
    typeof body.kind !== "string" ||
    typeof body.x !== "number" ||
    typeof body.y !== "number"
  ) {
    return NextResponse.json(
      { error: "label, kind, x, y required" },
      { status: 400 },
    );
  }
  if (!VALID_KINDS.includes(body.kind as string)) {
    return NextResponse.json(
      { error: `kind must be one of: ${VALID_KINDS.join(", ")}` },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Guard against writes to an archived room
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

  const payload = {
    id: typeof body.id === "string" ? body.id : undefined,
    room_id: roomId,
    author_id: user.id,
    parent_id: typeof body.parent_id === "string" ? body.parent_id : null,
    kind: body.kind as string,
    label: (body.label as string).slice(0, 1000),
    meta: typeof body.meta === "string" ? (body.meta as string).slice(0, 4000) : null,
    x: body.x as number,
    y: body.y as number,
  };

  const { data: inserted, error: insertErr } = await db
    .from("synergy_room_nodes")
    .insert(payload)
    .select(
      "id, room_id, author_id, parent_id, kind, label, meta, x, y, created_at, updated_at",
    )
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertErr) },
      { status: 500 },
    );
  }

  // Append a Timeline event (soft-fail). The summary mirrors what the
  // rail will render: short preview of the label, e.g. "Sketch first."
  // Linked-create (parent_id set) is logged as node_linked so the rail
  // can hint "added under …" if it wants.
  void insertRoomEvent(db, {
    roomId,
    actorId: user.id,
    kind: payload.parent_id ? "node_linked" : "node_added",
    targetNodeId: inserted.id,
    summary: previewLabel(inserted.label),
    payload: payload.parent_id ? { parent_id: payload.parent_id } : null,
  });

  return NextResponse.json({ node: inserted }, { status: 201 });
}
