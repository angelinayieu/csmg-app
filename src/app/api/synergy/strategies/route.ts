// ── GET /api/synergy/strategies ──
//
// Lists the authenticated user's strategies, newest first. Used by
// the universal-canvas strategy picker (CanvasWorkspaceRoomPicker)
// to surface existing strategies for canvas materialization.
//
// Returns `{ strategies: [{ id, statement, session_id, updated_at }] }`.
// Owner-RLS-gated.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export async function GET() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // synergy_strategies inherits owner_id via the joining
  // brainstorm_sessions.owner_id (no direct owner_id column). Join
  // path: synergy_strategies.session_id → brainstorm_sessions.owner_id.
  // RLS handles the auth check; we filter via the relation.
  try {
    const { data, error } = await db
      .from("synergy_strategies")
      .select(
        "id, statement, session_id, updated_at, brainstorm_sessions!inner(owner_id)",
      )
      .eq("brainstorm_sessions.owner_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[/api/synergy/strategies GET] error:", error);
      return NextResponse.json(
        { error: sanitizeErrorMessage(error) },
        { status: 500 },
      );
    }

    // Strip the join shape from the response — clients just need the
    // top-level fields.
    const strategies = (data ?? []).map(
      (row: {
        id: string;
        statement: string | null;
        session_id: string;
        updated_at: string;
      }) => ({
        id: row.id,
        statement: row.statement,
        session_id: row.session_id,
        updated_at: row.updated_at,
      }),
    );

    return NextResponse.json({ strategies });
  } catch (e) {
    console.error("[/api/synergy/strategies GET] exception:", e);
    return NextResponse.json(
      { error: sanitizeErrorMessage(e) },
      { status: 500 },
    );
  }
}
