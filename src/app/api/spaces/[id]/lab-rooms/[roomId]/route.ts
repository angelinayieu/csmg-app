// DELETE /api/spaces/[id]/lab-rooms/[roomId] — remove a user-added room.
// PATCH  /api/spaces/[id]/lab-rooms/[roomId] — update room (collapsed,
//                                              position, room_config).
//
// Default rooms (is_default=true) are NOT in this table — they're rendered
// directly by triple-lab.tsx — so this endpoint only ever operates on
// user-added rows. Ownership is enforced via RLS (auth.uid() = user_id)
// AND with an explicit space-ownership check for the URL invariant.

import { NextResponse } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; roomId: string }> },
) {
  const { id: spaceId, roomId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

   
  const db = supabase as any;
  const { error } = await db
    .from("lab_rooms")
    .delete()
    .eq("id", roomId)
    .eq("space_id", spaceId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

interface PatchBody {
  collapsed?: boolean;
  position?: number;
   
  room_config?: Record<string, any>;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; roomId: string }> },
) {
  const { id: spaceId, roomId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body, error: parseErr } = await safeJsonParse<PatchBody>(
    request,
  );
  if (parseErr) return parseErr;

   
  const patch: Record<string, any> = {};
  if (typeof body?.collapsed === "boolean") patch.collapsed = body.collapsed;
  if (typeof body?.position === "number" && Number.isFinite(body.position)) {
    patch.position = Math.max(0, Math.floor(body.position));
  }
  if (body?.room_config && typeof body.room_config === "object") {
    patch.room_config = body.room_config;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No updatable fields provided" },
      { status: 400 },
    );
  }

   
  const db = supabase as any;
  const { data, error } = await db
    .from("lab_rooms")
    .update(patch)
    .eq("id", roomId)
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ room: data });
}
