// ── POST /api/brainstorm/clarify/generate ─────────────────────────
//
// Generates clarifying questions for an Objective Canvas. One route,
// three modes:
//
//   mode="initial"     — first generation. No-ops if questions exist
//                        and ?force=true is not set.
//   mode="more"        — appends N new non-overlapping questions to
//                        the active set.
//   mode="regenerate"  — replaces the active set with fresh ones.
//                        Existing answers are kept ONLY for questions
//                        that survive into the new set (matched by
//                        exact text); otherwise dropped — regenerate
//                        is meant to be a hard reset.
//
// Persists the active set to spaces.synthesis_data.objective_canvas
// .clarifying so reloads don't re-call the LLM.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { generateClarifyingQuestions } from "@/lib/objective-canvas/generate-clarifying";
import {
  readObjectiveCanvasState,
  writeClarifyingBlock,
  type ClarifyingQuestion,
} from "@/lib/objective-canvas/clarifying-state";

export const runtime = "nodejs";
export const maxDuration = 30;

type Mode = "initial" | "more" | "regenerate";

interface Body {
  spaceId?: string;
  mode?: Mode;
  count?: number;
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
  const mode: Mode =
    body?.mode === "more" || body?.mode === "regenerate"
      ? body.mode
      : "initial";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Load space + ownership check.
  const { data: space, error: fetchError } = await db
    .from("spaces")
    .select("id, user_id, input_text, description, synthesis_data")
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
  const existingBlock = state.clarifying;

  // ── Mode: initial / cache short-circuit ──
  if (mode === "initial" && existingBlock && existingBlock.questions.length > 0) {
    return NextResponse.json({ clarifying: existingBlock, stage: state.stage });
  }

  try {
    const desiredCount = clampCount(body?.count, mode);

    let nextQuestions: ClarifyingQuestion[];
    let nextAnswers = existingBlock?.answers ?? {};

    if (mode === "more") {
      const existing = existingBlock?.questions ?? [];
      const additions = await generateClarifyingQuestions({
        objective,
        existing: existing.map((q) => ({ question: q.question })),
        count: desiredCount,
      });
      nextQuestions = [...existing, ...additions];
      // answers untouched
    } else {
      // initial OR regenerate — both produce a fresh set
      const fresh = await generateClarifyingQuestions({
        objective,
        count: desiredCount,
      });
      nextQuestions = fresh;
      if (mode === "regenerate" && existingBlock) {
        // Keep answers only for questions whose TEXT matches a survivor.
        const surviving = new Map<string, string>();
        for (const q of nextQuestions) {
          for (const old of existingBlock.questions) {
            if (
              old.question.trim().toLowerCase() ===
              q.question.trim().toLowerCase()
            ) {
              surviving.set(old.id, q.id);
              break;
            }
          }
        }
        nextAnswers = {};
        for (const [oldId, newId] of surviving) {
          const a = existingBlock.answers[oldId];
          if (a) nextAnswers[newId] = a;
        }
      } else {
        nextAnswers = {};
      }
    }

    const nextBlock = {
      questions: nextQuestions,
      answers: nextAnswers,
      generated_at: new Date().toISOString(),
    };

    const nextSynth = writeClarifyingBlock(space.synthesis_data, nextBlock);

    const writeRes = await db
      .from("spaces")
      .update({ synthesis_data: nextSynth })
      .eq("id", spaceId);
    if (writeRes.error) {
      console.warn(
        "[clarify/generate] failed to persist synthesis_data:",
        writeRes.error.message,
      );
      // Soft-fail: still return the questions so the user can keep going.
    }

    return NextResponse.json({
      clarifying: nextBlock,
      stage: state.stage,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `clarify/generate failed: ${sanitizeErrorMessage(err)}`,
      },
      { status: 500 },
    );
  }
}

function clampCount(raw: unknown, mode: Mode): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(1, Math.min(5, Math.floor(raw)));
  }
  return mode === "more" ? 2 : 3;
}
