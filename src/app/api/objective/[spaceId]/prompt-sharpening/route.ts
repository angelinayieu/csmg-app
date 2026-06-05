// GET  /api/objective/[spaceId]/prompt-sharpening → { status, artifact? }
// POST /api/objective/[spaceId]/prompt-sharpening → force regenerate
//
// The artifact is generated fire-and-forget at intake (brainstorm/start)
// and persisted into spaces.synthesis_data.objective_canvas.prompt_sharpening.
// The board's PromptSharpeningMount polls GET until status === "ready", then
// materializes the card. POST re-runs the agent (e.g. a "re-sharpen" action).

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { generatePromptSharpeningForSpace } from "@/lib/objective-canvas/generate-prompt-sharpening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ spaceId: string }> };

function readArtifact(synthesisData: unknown): unknown {
  const oc = (synthesisData as { objective_canvas?: unknown } | null)
    ?.objective_canvas as { prompt_sharpening?: unknown } | undefined;
  return oc?.prompt_sharpening ?? null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("user_id, synthesis_data, input_text, description")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const artifact = readArtifact(space.synthesis_data);
  // objectivePresent lets the board distinguish "still pre-submit, nothing to
  // generate yet" from "objective set but no artifact" — the latter means the
  // post-response generation hasn't landed, so the board can drive it.
  const objectivePresent = !!String(
    space.input_text || space.description || "",
  ).trim();
  return NextResponse.json(
    artifact
      ? { status: "ready", artifact }
      : { status: "pending", objectivePresent },
  );
}

export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Optional objective override — the "New objective" power-up sends fresh text
  // to (re)set + refine. No body → regenerate the stored objective.
  let override = "";
  try {
    const body = (await req.json()) as { objective?: unknown };
    if (typeof body?.objective === "string") override = body.objective.trim();
  } catch {
    /* no/invalid body — fall back to the stored objective */
  }

  const { data: space } = await db
    .from("spaces")
    .select("user_id, input_text, description")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Persist a supplied objective so the board + future regen use it.
  if (override) {
    await db.from("spaces").update({ input_text: override }).eq("id", spaceId);
  }
  const objective = override || String(space.input_text || space.description || "");
  // Force only when a NEW objective is supplied (the "new objective" power-up
  // re-sharpens). A bare POST is idempotent generate-if-missing, so the board
  // can use it as a reliable AWAITED drive (the open request keeps the function
  // alive for the full generation) without wastefully regenerating an existing
  // artifact.
  const errorSink: { reason?: string } = {};
  const artifact = await generatePromptSharpeningForSpace(
    db,
    spaceId,
    user.id,
    objective,
    { force: override.length > 0 },
    errorSink,
  );
  if (!artifact) {
    // Surface the real reason so the board card (and we) can see WHY instead of
    // a generic "couldn't sharpen / out of credits". Logged server-side too.
    console.warn("[prompt-sharpening] POST returned error:", errorSink.reason);
    return NextResponse.json({
      status: "error",
      detail: errorSink.reason || "unknown",
    });
  }
  return NextResponse.json({ status: "ready", artifact });
}
