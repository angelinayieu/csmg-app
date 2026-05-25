// ── GET /api/brainstorm/research/status?spaceId=... ───────────────
//
// Polled by the clarifying UI to know when the surface (and
// later, deep) bundles are ready. Returns the status fields +
// source counts but NOT the full snippet payloads — that's heavy
// and the polling UI only needs progress signal.
//
// Lightweight by design: read-only, RLS-checked, cheap to call
// every 2-3s while clarifying is in progress.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const url = new URL(req.url);
  const spaceId = url.searchParams.get("spaceId") ?? "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: space, error } = await db
    .from("spaces")
    .select("id, user_id, surface_research, deep_research")
    .eq("id", spaceId)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: "DB error", detail: error.message },
      { status: 500 },
    );
  }
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const surface = (space.surface_research ?? {}) as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deep = (space.deep_research ?? {}) as Record<string, any>;

  return NextResponse.json({
    surface: {
      status: typeof surface.status === "string" ? surface.status : "idle",
      source_count: Array.isArray(surface.sources) ? surface.sources.length : 0,
      skip_reason:
        typeof surface.skip_reason === "string" ? surface.skip_reason : null,
    },
    deep: {
      status: typeof deep.status === "string" ? deep.status : "idle",
      source_count: Array.isArray(deep.all_sources) ? deep.all_sources.length : 0,
    },
  });
}
