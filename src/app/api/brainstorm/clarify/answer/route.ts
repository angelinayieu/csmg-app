// ── POST /api/brainstorm/clarify/answer ───────────────────────────
//
// Records one answer (or skip) against the active clarifying block.
// Body: { spaceId, questionId, value?: string }
//   value present + non-empty → status: "answered"
//   value missing / empty      → status: "skipped"
//
// Idempotent — re-answering replaces the prior answer.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  readObjectiveCanvasState,
  writeClarifyingBlock,
  recordAnswer,
} from "@/lib/objective-canvas/clarifying-state";

export const runtime = "nodejs";

interface Body {
  spaceId?: string;
  questionId?: string;
  value?: string;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const questionId =
    typeof body?.questionId === "string" ? body.questionId : "";
  if (!spaceId || !questionId) {
    return NextResponse.json(
      { error: "spaceId + questionId required" },
      { status: 400 },
    );
  }
  const value =
    typeof body?.value === "string" && body.value.trim().length > 0
      ? body.value.trim().slice(0, 2000)
      : null;

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
  if (!state.clarifying) {
    return NextResponse.json(
      { error: "No clarifying questions to answer." },
      { status: 409 },
    );
  }

  const nextBlock = recordAnswer(state.clarifying, questionId, value);
  const nextSynth = writeClarifyingBlock(space.synthesis_data, nextBlock);

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

  return NextResponse.json({ clarifying: nextBlock });
}
