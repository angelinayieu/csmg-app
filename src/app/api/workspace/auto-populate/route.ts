// ── /api/workspace/auto-populate ──────────────────────────────────
//
// Universal-canvas Phase C — idempotency flag for the workspace
// canvas's first-open auto-population.
//
// The CanvasWorkspaceAutoPopulate component reads this flag on mount;
// if not yet populated it spawns rooms for the user's existing
// brainstorms + strategies, then POSTs here to mark the work done.
// Stored as `reasoning_settings.auto_populated_at` (ISO timestamp) so
// the flag survives across browsers / devices.
//
// GET  ?spaceId=…   → { populated: boolean }
// POST { spaceId }  → { populated: true }

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const spaceId = new URL(req.url).searchParams.get("spaceId");
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const { data, error } = await db
      .from("spaces")
      .select("reasoning_settings")
      .eq("id", spaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      // Space doesn't belong to the user or doesn't exist — treat as
      // populated to short-circuit the client (no rooms will spawn).
      return NextResponse.json({ populated: true });
    }
    const settings = (data.reasoning_settings ?? {}) as Record<string, unknown>;
    if (!settings.is_workspace) {
      // Not a workspace — never auto-populate R&D spaces.
      return NextResponse.json({ populated: true });
    }
    const populated = Boolean(settings.auto_populated_at);
    return NextResponse.json({ populated });
  } catch (err) {
    return NextResponse.json(
      {
        error: "auto_populate_status_failed",
        message: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let spaceId: string | undefined;
  try {
    const body = await req.json();
    spaceId = body?.spaceId;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const { data: existing, error: getErr } = await db
      .from("spaces")
      .select("reasoning_settings")
      .eq("id", spaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!existing) {
      return NextResponse.json({ error: "space_not_found" }, { status: 404 });
    }
    const settings = (existing.reasoning_settings ?? {}) as Record<string, unknown>;
    if (!settings.is_workspace) {
      return NextResponse.json({ error: "not_a_workspace" }, { status: 400 });
    }

    const updated = {
      ...settings,
      auto_populated_at: new Date().toISOString(),
    };

    const { error: updErr } = await db
      .from("spaces")
      .update({ reasoning_settings: updated })
      .eq("id", spaceId)
      .eq("user_id", user.id);
    if (updErr) throw updErr;

    return NextResponse.json({ populated: true });
  } catch (err) {
    return NextResponse.json(
      {
        error: "auto_populate_mark_failed",
        message: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }
}
