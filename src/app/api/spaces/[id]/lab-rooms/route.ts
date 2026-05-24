// GET /api/spaces/[id]/lab-rooms — list user-added rooms for a space
// POST /api/spaces/[id]/lab-rooms — create a new room
//
// User-added rooms (is_default=false) extend the default lab columns
// (raw_signal · insights · final_artifacts). The triple-lab renders
// the room stack ABOVE each column's default panel.
//
// We don't seed default rooms here — they're rendered directly by
// triple-lab.tsx as the existing RawSignalPanel / KgPanel /
// InsightsPanel. The lab_rooms table holds ONLY user-added rooms.

import { NextResponse } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface LabRoomRow {
  id: string;
  space_id: string;
  column_slot: "left" | "middle" | "right";
  position: number;
  kind: string;
   
  room_config: Record<string, any>;
  collapsed: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface LabRoomsListResponse {
  rooms: LabRoomRow[];
}

const VALID_COLUMNS = new Set(["left", "middle", "right"]);
const VALID_KINDS = new Set([
  "brainstorm_session",
  "reading_notes",
  "research_session",
  "twin_proposal",
  "scratch_note",
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

   
  const db = supabase as any;
  const { data, error } = (await db
    .from("lab_rooms")
    .select(
      "id, space_id, column_slot, position, kind, room_config, collapsed, is_default, created_at, updated_at",
    )
    .eq("space_id", spaceId)
    .order("column_slot", { ascending: true })
    .order("position", { ascending: true })) as {
    data: LabRoomRow[] | null;
    error: { message: string } | null;
  };
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json<LabRoomsListResponse>({
    rooms: data ?? [],
  });
}

interface CreateBody {
  column_slot?: string;
  kind?: string;
   
  room_config?: Record<string, any>;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body, error: parseErr } = await safeJsonParse<CreateBody>(
    request,
  );
  if (parseErr) return parseErr;

  const columnSlot =
    typeof body?.column_slot === "string" ? body.column_slot : "";
  const kind = typeof body?.kind === "string" ? body.kind : "";
  if (!VALID_COLUMNS.has(columnSlot)) {
    return NextResponse.json(
      { error: "column_slot must be one of: left, middle, right" },
      { status: 400 },
    );
  }
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${Array.from(VALID_KINDS).join(", ")}` },
      { status: 400 },
    );
  }
  const roomConfig =
    body?.room_config && typeof body.room_config === "object"
      ? body.room_config
      : {};

   
  const db = supabase as any;

  // Determine the next position: max existing position in this
  // column + 1. New rooms append to the bottom of their column stack.
  const { data: existing } = (await db
    .from("lab_rooms")
    .select("position")
    .eq("space_id", spaceId)
    .eq("column_slot", columnSlot)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { position: number } | null };
  const nextPosition = (existing?.position ?? -1) + 1;

  const { data: inserted, error: insertErr } = (await db
    .from("lab_rooms")
    .insert({
      space_id: spaceId,
      user_id: user.id,
      column_slot: columnSlot,
      position: nextPosition,
      kind,
      room_config: roomConfig,
      collapsed: false,
      is_default: false,
    })
    .select()
    .single()) as { data: LabRoomRow | null; error: { message: string } | null };
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to create room" },
      { status: 500 },
    );
  }
  return NextResponse.json({ room: inserted });
}
