// POST /api/objective/[spaceId]/sharpening-emergent
//   { cards: [{ id, text }] }
//   → { status, salience?, emergentCount }
//
// Tier-1 board-aware re-scan: feeds the user's current board cards to a
// salience pass that ADDITIVELY surfaces concepts/ambiguities the board work
// exposed but the original intake didn't see. Merges onto the existing
// artifact (existing wins on slug collision; emergent rows stamped
// `emerged_at`). Soft-fail; never blocks the rail.
//
// Triggered manually from the goal rail's Clarity & priorities header
// ("Re-scan board"). Cheap to no-op: route short-circuits when there are <3
// cards, no existing salience to compare against, or the model returns no
// new rows.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { generateEmergentSalienceForSpace } from "@/lib/objective-canvas/generate-emergent-salience";
import type { EmergentBoardCard } from "@/lib/objective-canvas/prompt-sharpening-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ spaceId: string }> };

const MAX_CARDS = 60;
const MAX_TEXT = 600;

export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let cards: EmergentBoardCard[] = [];
  try {
    const body = (await req.json()) as { cards?: unknown };
    if (Array.isArray(body?.cards)) {
      cards = (body.cards as unknown[])
        .map((c) => {
          const o = (c && typeof c === "object" ? c : {}) as Record<
            string,
            unknown
          >;
          const id = typeof o.id === "string" ? o.id : "";
          const text = typeof o.text === "string" ? o.text : "";
          return id && text ? { id, text: text.slice(0, MAX_TEXT) } : null;
        })
        .filter((c): c is EmergentBoardCard => c !== null)
        .slice(0, MAX_CARDS);
    }
  } catch {
    /* bare body → cards stays [] → generator's MIN_CARDS gate short-circuits */
  }

  const result = await generateEmergentSalienceForSpace(
    db,
    spaceId,
    user.id,
    cards,
  );
  if (!result) {
    return NextResponse.json({ status: "skipped", emergentCount: 0 });
  }
  return NextResponse.json({
    status: "ok",
    salience: result.salience,
    emergentCount: result.emergentCount,
  });
}
