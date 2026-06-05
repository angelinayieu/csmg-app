// ── GET /api/objective/[spaceId]/cross-room ───────────────────────────
//
// The data backbone for the "look into content across rooms" browser. Returns
// every sub-objective ROOM in the space plus the items (entities) in each,
// flattened, via the existing loadCrossRoomState loader (which fans one query
// across all rooms by parent_sub_objective_id). Read-only; soft-fails to empty.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { loadCrossRoomState } from "@/lib/objective-canvas/analyses/cross-room-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ spaceId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  try {
    const { state } = await loadCrossRoomState({ db, spaceId });
    const rooms = state.rooms.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description ?? null,
    }));
    const items = state.items.map((it) => ({
      id: it.id,
      roomId: it.room_id,
      name: it.name,
      layer: it.layer,
    }));
    return NextResponse.json({ rooms, items });
  } catch (e) {
    console.warn("[cross-room] load failed (soft):", e);
    return NextResponse.json({ rooms: [], items: [] });
  }
}
