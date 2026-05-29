// ── GET /api/objective/[spaceId]/sub/[subId]/room ─────────────────
//
// Read-side endpoint that returns a sub-objective room's full payload
// (lanes, edges, annotations, cross-room coverage, constraints, …) so
// the objective canvas can mount SubObjectiveRoomView CLIENT-SIDE inside
// its room-window (direct mount, no iframe). Mirrors the data the
// /sub/[subId] server route assembles.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { loadRoomData } from "@/lib/objective-canvas/load-room-data";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string; subId: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId, subId } = await ctx.params;
  if (!spaceId || !subId) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const data = await loadRoomData(auth.supabase, {
    spaceId,
    subId,
    userId: auth.user.id,
  });
  if (!data) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
