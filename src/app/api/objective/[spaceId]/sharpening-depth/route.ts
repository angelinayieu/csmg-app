// GET  /api/objective/[spaceId]/sharpening-depth → { status, salience? }
// POST /api/objective/[spaceId]/sharpening-depth → run the deep pass (awaited)
//
// The depth/salience pass enriches the SAME prompt_sharpening artifact (it
// fills the interpretation metadata + attaches the salience priority map).
// The card drives POST once the base sharpening has landed, then renders the
// "what to optimize for" map. Soft-fail; never blocks the board.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { generateSharpeningDepthForSpace } from "@/lib/objective-canvas/generate-sharpening-depth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ spaceId: string }> };

function readSalience(synthesisData: unknown): unknown {
  const oc = (synthesisData as { objective_canvas?: unknown } | null)
    ?.objective_canvas as
    | { prompt_sharpening?: { salience?: unknown } }
    | undefined;
  return oc?.prompt_sharpening?.salience ?? null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space)
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const salience = readSalience(space.synthesis_data);
  return NextResponse.json(
    salience ? { status: "ready", salience } : { status: "pending" },
  );
}

export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Optional { force: true } — re-run even if a salience block already exists
  // (e.g. after a re-sharpen). A bare POST is idempotent generate-if-missing,
  // so the card can use it as a reliable AWAITED drive (the open request keeps
  // the function alive for the whole generation).
  let force = false;
  try {
    const body = (await req.json()) as { force?: unknown };
    force = body?.force === true;
  } catch {
    /* no/invalid body — bare drive */
  }

  const salience = await generateSharpeningDepthForSpace(db, spaceId, user.id, {
    force,
  });
  return NextResponse.json(
    salience ? { status: "ready", salience } : { status: "error" },
  );
}
