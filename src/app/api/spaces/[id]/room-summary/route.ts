// ── GET /api/spaces/[id]/room-summary ────────────────────────────
//
// Lightweight summary read for the universal-canvas room renderers
// (kind="space" and kind="twin"). Pulls a few aggregate counts off
// the space row so a tile-sized renderer has everything it needs in
// one round trip — no separate fetches for entities/edges/twin-state.
//
// Returns:
//   { space: { id, name, entity_count, edge_count, cycle_count,
//              maturity, digital_twin_state, twin_initialized_at,
//              updated_at, has_synthesis } }
//
// The has_synthesis flag is true when the space has any synthesis
// data persisted (synthesis_text or synthesis_data) — twin rooms use
// this to gate the "Open twin →" CTA (no synthesis = twin isn't
// meaningful yet). Owner-RLS-gated; unauthorized → 404.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "space id required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const { data, error } = await db
      .from("spaces")
      .select(
        "id, name, entity_count, edge_count, cycle_count, maturity, digital_twin_state, twin_initialized_at, updated_at, synthesis_text, synthesis_data",
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[/api/spaces/[id]/room-summary GET] error:", error);
      return NextResponse.json(
        { error: sanitizeErrorMessage(error) },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const hasSynthesis =
      (typeof data.synthesis_text === "string" &&
        data.synthesis_text.trim().length > 0) ||
      (data.synthesis_data && typeof data.synthesis_data === "object");

    return NextResponse.json({
      space: {
        id: data.id,
        name: data.name,
        entity_count: data.entity_count ?? 0,
        edge_count: data.edge_count ?? 0,
        cycle_count: data.cycle_count ?? 0,
        maturity: data.maturity ?? "theoretical",
        digital_twin_state: data.digital_twin_state ?? "not_started",
        twin_initialized_at: data.twin_initialized_at,
        updated_at: data.updated_at,
        has_synthesis: Boolean(hasSynthesis),
      },
    });
  } catch (e) {
    console.error("[/api/spaces/[id]/room-summary GET] exception:", e);
    return NextResponse.json(
      { error: sanitizeErrorMessage(e) },
      { status: 500 },
    );
  }
}
