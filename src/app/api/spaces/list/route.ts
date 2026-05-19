// ── GET /api/spaces/list ──────────────────────────────────────────
//
// Lists the authenticated user's R&D spaces (newest first), trimmed
// to the fields the universal-canvas picker needs. Used by the Space
// tab of CanvasWorkspaceRoomPicker to surface existing spaces for
// canvas materialization.
//
// Returns `{ spaces: [{ id, name, entity_count, edge_count, maturity,
// digital_twin_state, updated_at }] }`. Owner-RLS-gated; archived
// spaces filtered out.

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

  try {
    const { data, error } = await db
      .from("spaces")
      .select(
        "id, name, entity_count, edge_count, maturity, digital_twin_state, twin_initialized_at, updated_at, reasoning_settings",
      )
      .eq("user_id", user.id)
      .eq("archived", false)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[/api/spaces/list GET] error:", error);
      return NextResponse.json(
        { error: sanitizeErrorMessage(error) },
        { status: 500 },
      );
    }

    // Filter out the user's workspace row (Phase C). Workspaces are
    // flagged via reasoning_settings.is_workspace and hosted at the
    // top of the homepage — exposing them in the room picker would
    // let the user spawn their own workspace as a room inside itself,
    // which is recursive and confusing. Done post-fetch (small list,
    // cheap) instead of via PostgREST's JSON-path filter to avoid the
    // SQL-NULL semantics gotcha (NULL != 'true' is NULL, not true).
    const filtered = (data ?? []).filter((s: { reasoning_settings?: { is_workspace?: boolean } | null }) => {
      const rs = s.reasoning_settings ?? null;
      return !(rs && typeof rs === "object" && rs.is_workspace === true);
    }).map((s: Record<string, unknown>) => {
      // Strip reasoning_settings from the response payload — picker
      // doesn't need it; keeping the response shape unchanged for
      // existing callers.
      const { reasoning_settings: _ignored, ...rest } = s;
      void _ignored;
      return rest;
    });

    return NextResponse.json({ spaces: filtered });
  } catch (e) {
    console.error("[/api/spaces/list GET] exception:", e);
    return NextResponse.json(
      { error: sanitizeErrorMessage(e) },
      { status: 500 },
    );
  }
}
