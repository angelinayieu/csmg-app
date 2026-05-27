// ── GET /api/brainstorm/notebook/messages ─────────────────────────
//
// Phase 10c — load chat thread for a (space, sub-objective) pair.
// Returns messages in chronological order (oldest first) so the UI
// can render the conversation naturally.
//
// Query params:
//   spaceId       (required)
//   subObjectiveId (optional) — omit for the canvas-level thread
//   limit         (optional) — default 100, max 200
//
// Soft-fails: if the user doesn't own the space, returns 404 with
// no thread. RLS on notebook_messages enforces the same boundary
// at the DB layer.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { NotebookMessage } from "@/lib/objective-canvas/notebook-chat";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const spaceId = req.nextUrl.searchParams.get("spaceId") ?? "";
  const subObjectiveIdParam = req.nextUrl.searchParams.get("subObjectiveId");
  const subObjectiveId =
    subObjectiveIdParam && subObjectiveIdParam.length > 0
      ? subObjectiveIdParam
      : null;
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    Math.max(
      1,
      limitRaw ? parseInt(limitRaw, 10) || DEFAULT_LIMIT : DEFAULT_LIMIT,
    ),
    MAX_LIMIT,
  );

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership.
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let query = db
    .from("notebook_messages")
    .select(
      "id, role, content, tool_call, tool_result, parent_message_id, created_at",
    )
    .eq("user_id", auth.user.id)
    .eq("space_id", spaceId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (subObjectiveId) {
    query = query.eq("sub_objective_id", subObjectiveId);
  } else {
    query = query.is("sub_objective_id", null);
  }

  const { data: rows } = await query;
  const messages = (rows ?? []) as NotebookMessage[];

  return NextResponse.json({ messages });
}
