// ── GET /api/synergy/sessions/[id]/summary ──
//
// Lightweight summary read for surfaces that just need to render a
// thumbnail/preview of a brainstorm session — title, node count,
// last-modified — without pulling the full nodes/strokes payload.
//
// Used by:
//   - WorkspaceRoomShape (the universal-canvas brainstorm room
//     renderer) when materializing a brainstorm room
//   - Phase 2+ surfaces that surface brainstorms as compact tiles
//     (recent activity row, brainstorm picker, etc.)
//
// Returns `{ session: { id, title, node_count, updated_at } }`.
// Owner-RLS-gated; unauthorized → 404.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [sessionRes, countRes] = await Promise.all([
    db
      .from("brainstorm_sessions")
      .select("id, title, updated_at")
      .eq("id", id)
      .single(),
    db
      .from("brainstorm_nodes")
      .select("id", { count: "exact", head: true })
      .eq("session_id", id),
  ]);

  if (sessionRes.error || !sessionRes.data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({
    session: {
      id: sessionRes.data.id,
      title: sessionRes.data.title,
      node_count: countRes.count ?? 0,
      updated_at: sessionRes.data.updated_at,
    },
  });
}
