// ── GET /api/objective/[spaceId]/glossary-timeline ─────────────────
//
// Returns the time-ordered "how your glossary was built" story for a space.
// Pure read; reconstructs from existing artifact/glossary/context timestamps
// (+ the glossary_events log when present). Soft — never 500s on a thin space.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import { buildGlossaryTimeline } from "@/lib/objective-canvas/glossary-timeline";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ spaceId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  if (!(await verifySpaceOwnership(supabase, spaceId, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = await buildGlossaryTimeline(supabase as any, spaceId);
  return NextResponse.json({ events });
}
