// ── GET /api/brainstorm/research/full?spaceId=... ─────────────────
//
// Returns the full research bundles (surface + deep) — used by the
// Research Sources Sheet to render the source list with snippets,
// per-lens grouping, and clickable URLs.
//
// Heavier than the /status route (returns full snippets) so the
// status route stays cheap for polling, while this route is hit
// only on demand when the user clicks the indicator.

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
      source_count: Array.isArray(surface.sources)
        ? surface.sources.length
        : 0,
      sources: Array.isArray(surface.sources) ? surface.sources : [],
      query: typeof surface.query === "string" ? surface.query : undefined,
      summary:
        typeof surface.summary === "string" ? surface.summary : undefined,
    },
    deep: {
      status: typeof deep.status === "string" ? deep.status : "idle",
      source_count: Array.isArray(deep.all_sources)
        ? deep.all_sources.length
        : 0,
      sources: Array.isArray(deep.all_sources) ? deep.all_sources : [],
      by_lens: deep.by_lens ?? {},
      queries: deep.queries ?? {},
    },
  });
}
