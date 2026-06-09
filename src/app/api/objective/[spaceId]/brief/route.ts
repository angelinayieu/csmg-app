// ── GET /api/objective/[spaceId]/brief ───────────────────────────────
//
// The composed objective brief — a READ-ONLY compose of the blocks the Crucible
// + exploration slice persist (intent + first principles + optimization points
// + constraints + swappable decisions + variables). No LLM, no writes; the
// `objective-brief-card` fetches this. Swapping a decision's variation goes
// through the existing /explore-ambiguity swap action (same rows).

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { assembleBrief } from "@/lib/objective-canvas/crucible/crucible-brief";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: space } = await supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const brief = await assembleBrief(supabase, spaceId);
  return NextResponse.json({ brief });
}
