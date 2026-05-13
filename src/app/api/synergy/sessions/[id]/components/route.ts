// ── GET /api/synergy/sessions/[id]/components ──
//
// List the components extracted from this session. Owner-only (RLS).
// Used by the processing page on mount to show the most recent
// extraction without re-running the LLM.
//
// Each component row carries a `match_count` — the number of
// component_matches rows where this component sits on either side.
// Drives the "N collaborators · room-ready" badge on the new
// expandable card and the per-component room-availability signal.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id: sessionId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("brainstorm_components")
    .select(
      "id, kind, subkind, label_public, description_public, description_private, visibility, created_at",
    )
    .eq("session_id", sessionId)
    .order("kind", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];

  // Match counts in a single round trip — pull every row in
  // component_matches that mentions any of our components on either
  // side, then bucket counts client-side. Cheap up to ~500 matches.
  const ids = rows.map((r) => r.id);
  const matchCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: matches } = await db
      .from("component_matches")
      .select("component_a, component_b")
      .or(
        `component_a.in.(${ids.join(",")}),component_b.in.(${ids.join(",")})`,
      );
    for (const m of (matches ?? []) as Array<{
      component_a: string;
      component_b: string;
    }>) {
      if (ids.includes(m.component_a)) {
        matchCounts.set(m.component_a, (matchCounts.get(m.component_a) ?? 0) + 1);
      }
      if (ids.includes(m.component_b)) {
        matchCounts.set(m.component_b, (matchCounts.get(m.component_b) ?? 0) + 1);
      }
    }
  }

  const enriched = rows.map((r) => ({
    ...r,
    match_count: matchCounts.get(r.id) ?? 0,
  }));

  return NextResponse.json({ components: enriched });
}
