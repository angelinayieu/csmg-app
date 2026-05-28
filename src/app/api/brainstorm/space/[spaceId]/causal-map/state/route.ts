// ── GET / PUT /api/brainstorm/space/[spaceId]/causal-map/state ─────
//
// Phase 12.A (12.A.8-server). Per-user view state for the Causal System
// Map, backed by the `causal_map_state` table (composite PK user_id +
// space_id, RLS-scoped to the owner). Currently stores pinned node
// positions (`state.pins`); the JSONB column also holds future toggles
// (collapsed layers, focused node, layout choice) without a schema
// change.
//
// Mirrors the auth + ownership pattern of the sibling decisions route:
// safeAuth, then verify the space belongs to the caller before
// touching state. RLS is a second line of defense; the explicit check
// gives a clean 404 instead of leaking existence.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

/** Cap the persisted blob so a runaway client can't store megabytes of
 *  pins. ~100KB is thousands of nodes — far past any real canvas. */
const MAX_STATE_BYTES = 100_000;

async function ownsSpace(db: any, spaceId: string, userId: string) {
  const { data } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  return !!data && data.user_id === userId;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  const db = auth.supabase as any;
  if (!(await ownsSpace(db, spaceId, auth.user.id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data } = await db
    .from("causal_map_state")
    .select("state")
    .eq("user_id", auth.user.id)
    .eq("space_id", spaceId)
    .maybeSingle();

  return NextResponse.json({ state: data?.state ?? {} });
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  const db = auth.supabase as any;
  if (!(await ownsSpace(db, spaceId, auth.user.id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: { state?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const state =
    body.state && typeof body.state === "object" && !Array.isArray(body.state)
      ? (body.state as Record<string, unknown>)
      : {};

  if (JSON.stringify(state).length > MAX_STATE_BYTES) {
    return NextResponse.json(
      { error: "map state too large" },
      { status: 413 },
    );
  }

  const { error } = await db.from("causal_map_state").upsert(
    {
      user_id: auth.user.id,
      space_id: spaceId,
      state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,space_id" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
