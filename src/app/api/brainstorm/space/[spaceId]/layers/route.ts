// ── GET /api/brainstorm/space/[spaceId]/layers ────────────────────
//
// Phase 11.A.3 — read-side endpoint for the ObjectiveStack. The
// picker page (when the Stack widget mounts) + the chat agent (when
// it needs to reason about layer coverage) both call this.
//
// Returns: { stack: ObjectiveStack | null }
//
// Soft semantics:
//   - 200 + { stack: null } when no stack has been generated yet
//     (lets the UI render an empty state with a "Generate layers"
//     CTA rather than treat absence as an error)
//   - 404 only when the space genuinely isn't accessible

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";

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

  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Read the stack from the canonical path. Pre-Phase-11.A spaces
  // don't have it — return null cleanly.
  const stack: ObjectiveStack | null =
    (space.synthesis_data?.objective_canvas?.layers as
      | ObjectiveStack
      | undefined) ?? null;

  return NextResponse.json({ stack });
}
