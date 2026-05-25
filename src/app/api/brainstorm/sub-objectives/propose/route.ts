// ── POST /api/brainstorm/sub-objectives/propose ───────────────────
//
// Generates sub-objective proposals for an Objective Canvas. Two
// modes:
//
//   initial    — first run. If a block already exists with
//                proposals, returns the cached set (no LLM cost).
//   regenerate — wipe and regenerate. Also clears the picked sets
//                so the user starts fresh.
//
// Body: { spaceId, mode?: "initial" | "regenerate" }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { generateSubObjectiveProposals } from "@/lib/objective-canvas/generate-sub-objectives";
import {
  readObjectiveCanvasState,
  writeSubObjectiveBlock,
} from "@/lib/objective-canvas/sub-objective-state";

export const runtime = "nodejs";
export const maxDuration = 45;

interface Body {
  spaceId?: string;
  mode?: "initial" | "regenerate";
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  const mode: "initial" | "regenerate" =
    body?.mode === "regenerate" ? "regenerate" : "initial";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: space, error: fetchError } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: "DB error", detail: fetchError.message },
      { status: 500 },
    );
  }
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const objective: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";
  if (objective.length < 4) {
    return NextResponse.json(
      { error: "Space has no objective text yet." },
      { status: 400 },
    );
  }

  const state = readObjectiveCanvasState(space.synthesis_data);
  const existingBlock = state.sub_objectives;

  // ── Mode: initial / cache short-circuit ──
  if (
    mode === "initial" &&
    existingBlock &&
    existingBlock.proposals.length > 0
  ) {
    return NextResponse.json({ sub_objectives: existingBlock });
  }

  try {
    const proposals = await generateSubObjectiveProposals({
      objective,
      clarifying: state.clarifying ?? null,
    });

    const block = {
      proposals,
      // Regenerate fully resets picks. Initial-generation with no
      // prior block starts empty too.
      picked_proposal_ids: [],
      picked_goal_ids: [],
      generated_at: new Date().toISOString(),
    };

    const nextSynth = writeSubObjectiveBlock(space.synthesis_data, block);
    const writeRes = await db
      .from("spaces")
      .update({ synthesis_data: nextSynth })
      .eq("id", spaceId);
    if (writeRes.error) {
      console.warn(
        "[sub-objectives/propose] failed to persist:",
        writeRes.error.message,
      );
      // Soft-fail: still return the proposals so user can keep going.
    }

    return NextResponse.json({ sub_objectives: block });
  } catch (err) {
    return NextResponse.json(
      { error: `propose failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
