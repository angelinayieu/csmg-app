// POST /api/objective/[spaceId]/journal-synthesize  { note? } → synthesize
//        (appends the note to voice_notes, re-synthesizes the whole journal)
// GET   → { status: "ready"|"empty", artifact? } from synthesis_data
//
// Notes + the synthesized journal live in
// spaces.synthesis_data.objective_canvas (voice_notes[] + journal).

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { synthesizeJournalForSpace } from "@/lib/objective-canvas/generate-journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ spaceId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;

  const { data: body } = await safeJsonParse<{ note?: string }>(req);
  const note = typeof body?.note === "string" ? body.note : "";

  const artifact = await synthesizeJournalForSpace(
    supabase,
    spaceId,
    user.id,
    note,
  );
  if (!artifact) {
    return NextResponse.json(
      { error: "Could not synthesize journal." },
      { status: 400 },
    );
  }
  return NextResponse.json({
    title: artifact.title,
    sections: artifact.sections,
    pageCount: artifact.pageCount,
  });
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
  if (!space) return NextResponse.json({ status: "empty" });
  if (space.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const journal =
    (space.synthesis_data as { objective_canvas?: { journal?: unknown } } | null)
      ?.objective_canvas?.journal ?? null;
  return NextResponse.json(
    journal ? { status: "ready", artifact: journal } : { status: "empty" },
  );
}
