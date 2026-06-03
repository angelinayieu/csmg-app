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
    .select("user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const artifact = readArtifact(space.synthesis_data);
  return NextResponse.json(
    artifact ? { status: "ready", artifact } : { status: "pending" },
  );
}

export async function POST(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("user_id, input_text, description")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const objective = String(space.input_text || space.description || "");
  const artifact = await generatePromptSharpeningForSpace(
    db,
    spaceId,
    user.id,
    objective,
    { force: true },
  );
  return NextResponse.json(
    artifact ? { status: "ready", artifact } : { status: "error" },
  );
}
