/**
 * Cron: Axis exemplar scorer + promoter
 *
 * Phase 2E · PR 6.2 — Stages 3+4 of the self-improvement loop.
 * Runs hourly via Vercel Cron (see vercel.json). Picks up
 * `axis_candidate_exemplars` rows with status='pending_review',
 * runs the semantic scorer (5-dim rubric LLM call), then
 * promotes rows with score ≥ 0.8 into `axis_exemplars` (with a
 * pgvector embedding on input_gist) or archives the rest.
 *
 * Auth: CRON_SECRET bearer header — same pattern as other crons.
 *
 * Batch cap: 50 candidates per tick. Each scoring call is one LLM
 * roundtrip (~3-6s) + a potential embedding call (~200ms) for
 * promoted rows. 50 × ~5s = ~4min worst case, well under the
 * maxDuration budget. Backlog gets retried next tick; the
 * idx_axis_candidate_exemplars_pending index keeps the query
 * cheap even when the table grows.
 *
 * Idempotency: the status flip to 'archived' or 'promoted' takes
 * the row out of the pending_review predicate so a second tick
 * won't re-score it. Promotion failures leave status at
 * 'pending_review' so the next tick retries (documented in the
 * promote helper's skipped_retry branch).
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { scoreAxisCandidate } from "@/lib/probability-space/axis-semantic-scorer";
import {
  promoteOrArchive,
  type CandidateRow,
} from "@/lib/probability-space/axis-exemplar-promote";
import type { AxisGenerationOutput } from "@/lib/probability-space/axis-output-validator";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BATCH_SIZE = 50;

export async function GET(request: Request) {
  // ── Auth ──
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const startedAt = new Date().toISOString();

  // ── Pull pending candidates ──
  //
  // Ordered oldest-first so a backlog drains FIFO. Bounded by
  // BATCH_SIZE so one tick can't run away.
  const { data: pending, error: pendingErr } = await db
    .from("axis_candidate_exemplars")
    .select("id, run_id, axis, input_gist, output_excerpt, output_full, user_rating, domain, question_type, status")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (pendingErr) {
    console.error("[cron:axis-scorer] pending read failed:", pendingErr);
    return NextResponse.json(
      {
        ok: false,
        error: pendingErr.message,
        ran_at: startedAt,
      },
      { status: 500 },
    );
  }

  const candidates = (pending ?? []) as Array<
    CandidateRow & { output_full: AxisGenerationOutput }
  >;

  if (candidates.length === 0) {
    return NextResponse.json({
      ok: true,
      scored: 0,
      promoted: 0,
      archived: 0,
      skipped_retry: 0,
      ran_at: startedAt,
    });
  }

  let promoted = 0;
  let archived = 0;
  let skipped = 0;
  const errors: Array<{ candidateId: string; error: string }> = [];

  // Process sequentially rather than in parallel — each tick has
  // <=50 rows, scoring is LLM-bound, and sequential keeps the rate
  // limit predictable. Parallelize in the future if throughput is
  // insufficient at target scale.
  for (const c of candidates) {
    try {
      const scored = await scoreAxisCandidate({
        axis: c.axis as ProbabilitySpaceAxis,
        inputGist: c.input_gist,
        output: c.output_full,
      });
      const result = await promoteOrArchive(db, c, scored);
      if (result.outcome === "promoted") promoted += 1;
      else if (result.outcome === "archived") archived += 1;
      else skipped += 1;
    } catch (err) {
      // Hard failure during scoring — log + skip. Candidate stays
      // pending_review for the next tick to retry. Don't flip to
      // archived: a transient LLM outage shouldn't permanently
      // drop the candidate from the review queue.
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[cron:axis-scorer] candidate ${c.id} scoring threw:`,
        message,
      );
      errors.push({ candidateId: c.id, error: message.slice(0, 500) });
    }
  }

  return NextResponse.json({
    ok: true,
    scored: candidates.length,
    promoted,
    archived,
    skipped_retry: skipped,
    errors: errors.length > 0 ? errors : undefined,
    ran_at: startedAt,
  });
}
