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
        "id, name, entity_count, edge_count, maturity, digital_twin_state, twin_initialized_at, updated_at",
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

    return NextResponse.json({ spaces: data ?? [] });
  } catch (e) {
    console.error("[/api/spaces/list GET] exception:", e);
    return NextResponse.json(
      { error: sanitizeErrorMessage(e) },
      { status: 500 },
    );
  }
}
