import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import type { SynthesisData, RichOpenQuestion } from "@/types/synthesis";
import {
  applyObservation,
  observationFromAnswer,
  type PosteriorMap,
} from "@/lib/upf/posterior";

export const maxDuration = 15;

/**
 * POST /api/spaces/[id]/open-questions
 *
 * Phase 4b: accept a user-supplied answer for a specific open question,
 * mutate the question in-place on the space's synthesis_data JSONB, and
 * log a changelog row so the regeneration flow can pick it up.
 *
 * Body: { index: number; answer: string }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body, error: bodyErr } = await safeJsonParse<{
    index: number;
    answer: string;
  }>(request);
  if (bodyErr) return bodyErr;

  const index = Number(body?.index);
  const answer = typeof body?.answer === "string" ? body.answer.trim() : "";

  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json(
      { error: "Field 'index' must be a non-negative integer." },
      { status: 400 }
    );
  }
  if (answer.length === 0) {
    return NextResponse.json(
      { error: "Field 'answer' must be a non-empty string." },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space, error: loadErr } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .single();

  if (loadErr || !space) {
    return NextResponse.json(
      { error: "Space not found" },
      { status: 404 }
    );
  }

  let synthData: SynthesisData | null = null;
  try {
    synthData = (typeof space.synthesis_data === "string"
      ? JSON.parse(space.synthesis_data)
      : space.synthesis_data) as SynthesisData | null;
  } catch {
    synthData = null;
  }

  const questions: RichOpenQuestion[] = Array.isArray(synthData?.open_questions)
    ? [...(synthData!.open_questions as RichOpenQuestion[])]
    : [];

  if (index >= questions.length) {
    return NextResponse.json(
      { error: `Index ${index} out of range (have ${questions.length} questions).` },
      { status: 400 }
    );
  }

  const answeredAt = new Date().toISOString();
  questions[index] = {
    ...questions[index],
    user_answer: answer,
    answered_at: answeredAt,
  };

  // Phase 4b: mark the strategy stale so the user sees a "Regenerate" nudge
  // and the next refresh picks up the new answer as a factual anchor.
  const existingStrat =
    (synthData as SynthesisData | null)?.strategic_recommendation ?? null;
  const hasExistingStrategy =
    !!(existingStrat && typeof existingStrat === "object" && "recommendation" in existingStrat);

  const questionPriority = questions[index].priority ?? "medium";

  // Phase 4c-final+: fan the observation out across the stable entity
  // constructs this question references. We deliberately do NOT write a
  // posterior for `question:<text>` because the text key is not stable
  // across LLM re-synthesis — answered-state is already captured in
  // user_answer on the question row itself.
  const priorPosteriors: PosteriorMap =
    ((synthData as SynthesisData | null)?.construct_posteriors as
      | PosteriorMap
      | undefined) ?? {};
  const relatedEntityConstructIds = (questions[index].related_entity_ids ?? []).map(
    (eid) => `entity:${eid}`
  );

  let nextPosteriors: PosteriorMap = priorPosteriors;
  for (const cid of relatedEntityConstructIds) {
    nextPosteriors = applyObservation(
      nextPosteriors,
      observationFromAnswer(cid, answeredAt)
    );
  }

  const nextSynth: SynthesisData & { strategy_stale_reason?: string } = {
    ...(synthData as SynthesisData),
    open_questions: questions,
    construct_posteriors: nextPosteriors,
    // Only flip is_stale / reason when a strategy actually exists — otherwise
    // it's noise (the next strategy will naturally pick up the answer).
    ...(hasExistingStrategy
      ? {
          is_stale: true,
          strategy_stale_reason: `User answered ${questionPriority}-priority open question — refresh to incorporate`,
        }
      : {}),
  };

  const { error: updateErr } = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);

  if (updateErr) {
    console.error("[open-questions] update failed:", updateErr);
    return NextResponse.json(
      { error: "Failed to save answer" },
      { status: 500 }
    );
  }

  const answeredCount = questions.filter(
    (q) => typeof q.user_answer === "string" && q.user_answer.trim().length > 0
  ).length;

  // Soft-fail changelog — don't block the user on telemetry.
  try {
    await db.from("space_changelog").insert({
      space_id: spaceId,
      change_type: "open_question_answered",
      summary: `Open question answered: "${questions[index].question.slice(0, 80)}"`,
      details: {
        question_index: index,
        question: questions[index].question,
        priority: questions[index].priority ?? null,
        answered_at: answeredAt,
        answered_count: answeredCount,
        total_questions: questions.length,
        marked_strategy_stale: hasExistingStrategy,
      },
    });
  } catch (err) {
    console.warn("[open-questions] changelog insert failed:", err);
  }

  return NextResponse.json({
    success: true,
    question_index: index,
    answered_count: answeredCount,
    answered_at: answeredAt,
    strategy_marked_stale: hasExistingStrategy,
  });
}

/**
 * DELETE /api/spaces/[id]/open-questions
 *
 * Soft-clear a previously submitted answer (un-answer the question).
 *
 * Body: { index: number }
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body, error: bodyErr } = await safeJsonParse<{ index: number }>(
    request
  );
  if (bodyErr) return bodyErr;

  const index = Number(body?.index);
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json(
      { error: "Field 'index' must be a non-negative integer." },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space, error: loadErr } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .single();

  if (loadErr || !space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  let synthData: SynthesisData | null = null;
  try {
    synthData = (typeof space.synthesis_data === "string"
      ? JSON.parse(space.synthesis_data)
      : space.synthesis_data) as SynthesisData | null;
  } catch {
    synthData = null;
  }

  const questions: RichOpenQuestion[] = Array.isArray(synthData?.open_questions)
    ? [...(synthData!.open_questions as RichOpenQuestion[])]
    : [];

  if (index >= questions.length) {
    return NextResponse.json(
      { error: `Index ${index} out of range (have ${questions.length} questions).` },
      { status: 400 }
    );
  }

  const hadAnswer =
    typeof questions[index].user_answer === "string" &&
    questions[index].user_answer!.trim().length > 0;

  const cleared: RichOpenQuestion = { ...questions[index] };
  delete cleared.user_answer;
  delete cleared.answered_at;
  questions[index] = cleared;

  // If we just removed an answer the strategy might have relied on, the
  // strategy is now based on stale information. Mirror POST's behaviour.
  const existingStrat =
    (synthData as SynthesisData | null)?.strategic_recommendation ?? null;
  const hasExistingStrategy =
    !!(existingStrat && typeof existingStrat === "object" && "recommendation" in existingStrat);
  const shouldMarkStale = hadAnswer && hasExistingStrategy;

  const nextSynth: SynthesisData & { strategy_stale_reason?: string } = {
    ...(synthData as SynthesisData),
    open_questions: questions,
    ...(shouldMarkStale
      ? {
          is_stale: true,
          strategy_stale_reason:
            "User cleared a previously-answered open question — refresh to drop the stale anchor",
        }
      : {}),
  };

  const { error: updateErr } = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);

  if (updateErr) {
    console.error("[open-questions] clear failed:", updateErr);
    return NextResponse.json(
      { error: "Failed to clear answer" },
      { status: 500 }
    );
  }

  const answeredCount = questions.filter(
    (q) => typeof q.user_answer === "string" && q.user_answer.trim().length > 0
  ).length;

  return NextResponse.json({
    success: true,
    question_index: index,
    answered_count: answeredCount,
  });
}
