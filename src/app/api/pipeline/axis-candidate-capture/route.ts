// POST /api/pipeline/axis-candidate-capture
//
// Phase 2E · PR 6.1 — Stage 1 + Stage 2 of the self-improvement loop.
//
// Request: { runId, rating: 1..5, note?: string }
//
// Behavior:
//   1. Upserts a pipeline_run_ratings row for (runId, user).
//   2. If rating ≥ 4 AND this rating hasn't yet been captured:
//        - Fetches every probability_space_runs row for this run with
//          axis_output_json present
//        - Inserts one axis_candidate_exemplars row per axis output,
//          status = 'pending_review'
//        - Stamps candidates_captured_at on the rating row so a
//          subsequent re-rating doesn't duplicate
//   3. Returns { rating, candidatesCreated, note }
//
// Rating < 4: still persists the rating for telemetry, but captures
// no candidates. This keeps the below-threshold signal in the DB for
// calibration ("was our 0.8 promotion floor too lenient? too strict?
// what did 3-star runs look like?") without polluting the review
// queue with low-signal submissions.
//
// Re-rating an already-captured run: we DON'T re-capture. If a user
// flips a 3 to a 5, the code path does update the rating (for
// honesty + audit) but leaves candidates_captured_at where it was,
// and any existing axis_candidate_exemplars rows keep their
// user_rating stamped from the FIRST capture. If that's wrong in
// practice (telemetry shows users do meaningfully revise), we can
// add a "recapture" query path later.
//
// Soft-fail discipline:
//   - Missing axis_output_json on a run row → skip that axis (doesn't
//     block other axes or the rating write)
//   - Candidate insert failure on one axis → log + continue; don't
//     rollback the rating itself

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import type {
  AxisGenerationOutput,
} from "@/lib/probability-space/axis-output-validator";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";

export const maxDuration = 30;
export const runtime = "nodejs";

interface CaptureRequest {
  runId: string;
  rating: number;
  note?: string;
  /** Optional — forwarded from the rating UI if it was aware of the
   *  question-type classification. Copied onto each candidate row
   *  so retrieval / scoring can filter without re-reading
   *  pipeline_runs. */
  domain?: string | null;
  questionType?: string | null;
}

const CAPTURE_RATING_THRESHOLD = 4;
const MAX_INPUT_GIST_CHARS = 200;
const MAX_OUTPUT_EXCERPT_CHARS = 1200;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<CaptureRequest>(request);
  if (parseError) return parseError;

  const { runId, rating, note, domain, questionType } = body;
  if (!runId || typeof runId !== "string") {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }
  if (
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    return NextResponse.json(
      { error: "rating must be an integer 1..5" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Ownership guard ──
  //
  // RLS on pipeline_runs gates this to the run's owner already, but
  // pulling the run row explicitly lets us extract `initial_prompt`
  // for the candidate's input_gist without a second query.
  const { data: runRow, error: runErr } = await db
    .from("pipeline_runs")
    .select("id, space_id, initial_prompt, created_by, status")
    .eq("id", runId)
    .single();
  if (runErr || !runRow) {
    return NextResponse.json(
      { error: "run not found" },
      { status: 404 },
    );
  }
  if (runRow.created_by !== user.id) {
    return NextResponse.json(
      { error: "not authorized to rate this run" },
      { status: 403 },
    );
  }

  // ── Upsert the rating row ──
  //
  // Stamped updated_at on re-rating so telemetry can watch the
  // "rating flipped after X hours" signal. created_at stays at the
  // first rating time via onConflict.
  const nowIso = new Date().toISOString();
  const { data: ratingRow, error: ratingErr } = await db
    .from("pipeline_run_ratings")
    .upsert(
      {
        run_id: runId,
        user_id: user.id,
        rating,
        note: note?.slice(0, 2000) ?? null,
        updated_at: nowIso,
      },
      { onConflict: "run_id,user_id" },
    )
    .select("id, rating, candidates_captured_at")
    .single();
  if (ratingErr || !ratingRow) {
    console.warn("[axis-candidate-capture] rating upsert failed:", ratingErr);
    return NextResponse.json(
      { error: "failed to persist rating" },
      { status: 500 },
    );
  }

  // ── Below threshold: done. ──
  if (rating < CAPTURE_RATING_THRESHOLD) {
    return NextResponse.json({
      runId,
      rating,
      candidatesCreated: 0,
      note: "rating below capture threshold — stored for telemetry only",
    });
  }

  // ── Already captured: don't duplicate candidates. ──
  if (ratingRow.candidates_captured_at) {
    return NextResponse.json({
      runId,
      rating,
      candidatesCreated: 0,
      note: "candidates already captured on a prior rating — skipping",
    });
  }

  // ── Pull axis outputs that actually produced content. ──
  //
  // We only capture axes whose generator succeeded + persisted
  // axis_output_json. Thin / failed axes contribute negative
  // exemplars (useful for a different learning loop) but are out of
  // scope for the promotion library.
  const { data: axisRows, error: axisErr } = await db
    .from("probability_space_runs")
    .select("axis, axis_output_json, rationale, status")
    .eq("run_id", runId)
    .eq("status", "merged");
  if (axisErr) {
    console.warn("[axis-candidate-capture] axis read failed:", axisErr);
    return NextResponse.json(
      { error: "failed to read axis outputs" },
      { status: 500 },
    );
  }

  const rows = ((axisRows ?? []) as Array<{
    axis: string;
    axis_output_json: AxisGenerationOutput | null;
    rationale: string | null;
    status: string;
  }>).filter((r) => r.axis_output_json != null);

  const inputGist = (runRow.initial_prompt ?? "")
    .trim()
    .slice(0, MAX_INPUT_GIST_CHARS);

  // Bail if input_gist is empty — a candidate without a gist is
  // useless for retrieval (nothing to embed against). Mark the
  // rating captured anyway so we don't retry a dead run.
  if (!inputGist) {
    await db
      .from("pipeline_run_ratings")
      .update({ candidates_captured_at: nowIso })
      .eq("id", ratingRow.id);
    return NextResponse.json({
      runId,
      rating,
      candidatesCreated: 0,
      note: "run has no initial_prompt — cannot create exemplars",
    });
  }

  let created = 0;
  const errors: string[] = [];

  for (const r of rows) {
    const output = r.axis_output_json as AxisGenerationOutput;
    const excerpt = buildOutputExcerpt(output);
    if (!excerpt) {
      errors.push(`${r.axis}: empty output excerpt`);
      continue;
    }
    const { error: insertErr } = await db
      .from("axis_candidate_exemplars")
      .insert({
        run_id: runId,
        axis: r.axis as ProbabilitySpaceAxis,
        input_gist: inputGist,
        output_excerpt: excerpt,
        output_full: output,
        user_rating: rating,
        user_id: user.id,
        user_note: note?.slice(0, 2000) ?? null,
        domain: domain ?? null,
        question_type: questionType ?? null,
        status: "pending_review",
      });
    if (insertErr) {
      console.warn(
        `[axis-candidate-capture] candidate insert failed for axis ${r.axis}:`,
        insertErr,
      );
      errors.push(`${r.axis}: ${insertErr.message ?? "insert failed"}`);
      continue;
    }
    created += 1;
  }

  // ── Mark capture as complete on the rating row ──
  // Even if some axes failed; we don't re-run capture for a given
  // rating. The partial-failure errors[] is returned for debugging.
  await db
    .from("pipeline_run_ratings")
    .update({ candidates_captured_at: nowIso })
    .eq("id", ratingRow.id);

  return NextResponse.json({
    runId,
    rating,
    candidatesCreated: created,
    axesAvailable: rows.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

/**
 * Build the short text excerpt stored on the candidate row for the
 * scorer + admin UIs. Shape is `<axis_summary> ▸ <top-3 entities>`.
 * Kept concise so reviewers can scan candidates without loading the
 * full output_full JSON.
 */
function buildOutputExcerpt(output: AxisGenerationOutput): string {
  const parts: string[] = [];
  if (output.axis_summary?.trim()) {
    parts.push(`Summary: ${output.axis_summary.trim()}`);
  }
  const topEntities = (output.entities ?? []).slice(0, 3);
  if (topEntities.length > 0) {
    const entLines = topEntities
      .map((e) =>
        e.description ? `  • ${e.name}: ${e.description}` : `  • ${e.name}`,
      )
      .join("\n");
    parts.push(`Top entities:\n${entLines}`);
  }
  return parts.join("\n\n").slice(0, MAX_OUTPUT_EXCERPT_CHARS);
}
