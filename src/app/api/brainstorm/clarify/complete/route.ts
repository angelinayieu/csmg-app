// ── POST /api/brainstorm/clarify/complete ─────────────────────────
//
// Advances the canvas from stage "clarifying" → "picking" (Phase 3).
// Used by the UI when the user clicks "I'm done" on the clarifying
// card. Doesn't require all questions to be answered — skipping is
// a valid completion path.
//
// Body: { spaceId }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  patchObjectiveCanvasState,
  readObjectiveCanvasState,
} from "@/lib/objective-canvas/clarifying-state";

export const runtime = "nodejs";

interface Body {
  spaceId?: string;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: space, error: fetchError } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
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

  const state = readObjectiveCanvasState(space.synthesis_data);
  const nextSynth = patchObjectiveCanvasState(space.synthesis_data, {
    stage: "picking",
    clarifying: state.clarifying,
  });

  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "DB error", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ stage: "picking" });
}
