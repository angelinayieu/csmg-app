// ── GET /api/brainstorm/space/[spaceId]/deliverables/ready ────────
//
// Returns the list of elected variations across the whole space along
// with their auto-gen gate status and cached-artifact presence. Drives
// the DeliverablesStrip on the main canvas.
//
// Shape: { rows: ReadyVariationRow[] }
// See src/lib/objective-canvas/elected-ready-variations.ts for the row
// shape + gate semantics.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { getElectedReadyVariations } from "@/lib/objective-canvas/elected-ready-variations";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership.
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const rows = await getElectedReadyVariations({
    db,
    spaceId,
    userId: auth.user.id,
    includeNotReady: true,
  });

  return NextResponse.json({ rows });
}
