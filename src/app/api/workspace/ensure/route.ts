// ── GET /api/workspace/ensure ─────────────────────────────────────
//
// Universal-canvas Phase C — returns the authenticated user's
// "workspace" space, creating one if missing. A workspace is just a
// regular spaces row flagged with `reasoning_settings.is_workspace =
// true`. It hosts WorkspaceRoomShape rooms representing brainstorms,
// strategies, sub-spaces, and twins the user has accumulated.
//
// Why a flag on reasoning_settings JSONB instead of a dedicated
// column or table: migration-free. No schema risk, no rollback story
// needed, no extra index. The trade-off is we have to filter on
// `reasoning_settings->>'is_workspace' = 'true'` in queries — fine
// for this volume (one workspace per user).
//
// Idempotent: repeated calls return the same workspace row. If a
// user somehow has multiple flagged rows (race condition), returns
// the oldest one to keep "your workspace" stable.
//
// Response: { workspace: { id, name } }

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
    // 1. Look for an existing flagged workspace, oldest-first for
    //    stability if multiple exist.
    const existing = await db
      .from("spaces")
      .select("id, name")
      .eq("user_id", user.id)
      .eq("reasoning_settings->>is_workspace", "true")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing.error && existing.error.code !== "PGRST116") {
      throw existing.error;
    }

    if (existing.data) {
      return NextResponse.json({ workspace: existing.data });
    }

    // 2. None exists — create one. Minimal row: no input_text seed
    //    (workspace is a meta-canvas, not an R&D pipeline run), no
    //    pipeline_runs entry, no decompose call.
    const insert = await db
      .from("spaces")
      .insert({
        user_id: user.id,
        name: "Your workspace",
        description:
          "Your home canvas. Brainstorms, strategies, R&D spaces, and twins land here as rooms you can compose.",
        space_prefix: "WS",
        input_text: "",
        entity_count: 0,
        edge_count: 0,
        cycle_count: 0,
        maturity: "actionable_now",
        reasoning_settings: { is_workspace: true },
        synthesis_data: {},
      })
      .select("id, name")
      .single();

    if (insert.error) throw insert.error;

    return NextResponse.json({ workspace: insert.data });
  } catch (err) {
    return NextResponse.json(
      {
        error: "workspace_ensure_failed",
        message: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }
}
