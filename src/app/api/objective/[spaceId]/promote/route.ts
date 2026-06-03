// POST /api/objective/[spaceId]/promote
//
// Promote a draft objective space in place: set the objective text, clear the
// draft flag, create the core improvement_goal, back-link any chatbox
// attachments, and fire the Prompt Sharpening Card. No new space, no
// navigation — the board the user is already on adopts the objective.
//
// Body: { objective, attachedFileIds? }

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { patchObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import { generatePromptSharpeningForSpace } from "@/lib/objective-canvas/generate-prompt-sharpening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ spaceId: string }> };

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
}

export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let body: { objective?: string; attachedFileIds?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const objective = String(body.objective ?? "").trim();
  if (objective.length < 4) {
    return NextResponse.json(
      { error: "Objective must be at least 4 characters." },
      { status: 400 },
    );
  }
  const attachedFileIds = Array.isArray(body.attachedFileIds)
    ? body.attachedFileIds
        .filter((id): id is string => typeof id === "string" && !!id)
        .slice(0, 25)
    : [];

  const { data: space } = await db
    .from("spaces")
    .select("user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const shortName = truncate(objective, 80);

  // Promote: set objective text + clear the draft flag + land on main.
  // `draft` is a module-augmentation key on the canvas state (not in the
  // base ObjectiveCanvasState interface) — cast to the patch param type.
  const patched = patchObjectiveCanvasState(
    space.synthesis_data,
    { stage: "main", draft: false } as unknown as Parameters<
      typeof patchObjectiveCanvasState
    >[1],
  );
  const upd = await db
    .from("spaces")
    .update({
      name: shortName,
      description: objective,
      input_text: objective,
      synthesis_data: patched,
    })
    .eq("id", spaceId);
  if (upd.error) {
    console.error("[objective/promote] update failed:", upd.error.message);
    return NextResponse.json({ error: "Could not save objective." }, { status: 500 });
  }

  // Core improvement_goal (idempotent).
  const { data: existingGoal } = await db
    .from("improvement_goals")
    .select("id")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .limit(1)
    .maybeSingle();
  if (!existingGoal) {
    await db.from("improvement_goals").insert({
      space_id: spaceId,
      user_id: user.id,
      title: shortName,
      description: objective,
      objective_type: "maximize",
    });
  }

  // Claim chatbox attachments onto the space.
  if (attachedFileIds.length > 0) {
    await db
      .from("ingested_files")
      .update({ space_id: spaceId })
      .in("id", attachedFileIds)
      .eq("user_id", user.id)
      .is("space_id", null);
  }

  // The Prompt Sharpening Card is the minimal-flow analysis.
  void generatePromptSharpeningForSpace(db, spaceId, user.id, objective);

  return NextResponse.json({ ok: true });
}
