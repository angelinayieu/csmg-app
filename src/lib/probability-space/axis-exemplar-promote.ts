// ── Axis exemplar promotion (Phase 2E · PR 6.2) ──
//
// Stage 4 of the self-improvement loop. Given a scored candidate
// row (semantic_score already written), either promotes it into
// `axis_exemplars` with an input_gist embedding, or archives it.
// Either way the `axis_candidate_exemplars.status` lands in a
// terminal state so the scorer cron doesn't re-process it.
//
// Promotion path:
//   1. Embed input_gist via text-embedding-3-small (matches the
//      retrieval query's embedding space)
//   2. INSERT axis_exemplars — user_rating + semantic_score carried
//      forward so retrieval's combined ranker has both signals
//      without a candidate join
//   3. UPDATE candidate.status = 'promoted'
//
// Archive path:
//   1. UPDATE candidate.status = 'archived'
//
// Both paths persist the semantic_breakdown on the candidate row
// BEFORE the terminal status flip so failure-analysis queries can
// still see "this was archived because mechanism_depth was 0.3
// even though user_rating was 5" without loading the scorer
// response again.
//
// All DB operations are awaited — the cron endpoint needs to know
// (a) whether promotion actually succeeded and (b) how many landed
// for its telemetry. Soft-fail internal: embedding failure → skip
// promote + log + leave candidate as 'pending_review' for retry
// next cron tick. We'd rather try again than accept a pending row
// as unpromotable and hide the retry path.

import { embedTexts } from "@/lib/embeddings";
import type {
  SemanticScoreBreakdown,
  SemanticScoreResult,
} from "@/lib/probability-space/axis-semantic-scorer";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";

export const PROMOTION_THRESHOLD = 0.8;

export interface CandidateRow {
  id: string;
  run_id: string;
  axis: ProbabilitySpaceAxis;
  input_gist: string;
  output_excerpt: string;
  user_rating: number;
  domain: string | null;
  question_type: string | null;
  status: string;
}

export interface PromotionResult {
  candidateId: string;
  outcome: "promoted" | "archived" | "skipped_retry";
  score: number;
  /** Populated on promotion; the new axis_exemplars row id. */
  exemplarId?: string;
  /** Only present when outcome is 'skipped_retry' — tells the cron
   *  endpoint why we didn't make a terminal decision. */
  retryReason?: string;
}

/**
 * Write the scorer output onto the candidate row — persisted BEFORE
 * any status flip so failure analysis retains the breakdown even if
 * the promotion step crashes mid-flight.
 */
export async function persistScorerOutput(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  candidateId: string,
  scored: SemanticScoreResult,
): Promise<void> {
  await db
    .from("axis_candidate_exemplars")
    .update({
      semantic_score: scored.score,
      semantic_breakdown:
        scored.breakdown as unknown as Record<string, unknown>,
      semantic_review_at: new Date().toISOString(),
      semantic_notes: scored.notes,
    })
    .eq("id", candidateId);
}

/**
 * Terminal-state decision for a scored candidate. Writes the
 * scorer output first (idempotent), then takes the promote/archive
 * branch. Returns a structured result the cron endpoint aggregates.
 */
export async function promoteOrArchive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  candidate: CandidateRow,
  scored: SemanticScoreResult,
): Promise<PromotionResult> {
  // Persist scorer output first so failure-analysis queries can
  // read the breakdown regardless of what happens next.
  await persistScorerOutput(db, candidate.id, scored);

  if (scored.score < PROMOTION_THRESHOLD) {
    // Archive — a terminal state, but the row stays in the table
    // so quality-analysis queries can mine it later.
    await db
      .from("axis_candidate_exemplars")
      .update({ status: "archived" })
      .eq("id", candidate.id);
    return {
      candidateId: candidate.id,
      outcome: "archived",
      score: scored.score,
    };
  }

  // ── Promotion path ──
  let embedding: number[];
  try {
    const [vec] = await embedTexts([candidate.input_gist]);
    if (!vec || vec.length === 0) {
      return {
        candidateId: candidate.id,
        outcome: "skipped_retry",
        score: scored.score,
        retryReason: "embedding returned empty",
      };
    }
    embedding = vec;
  } catch (err) {
    console.warn(
      `[axis-exemplar-promote] embed failed for candidate ${candidate.id} (will retry next tick):`,
      err,
    );
    return {
      candidateId: candidate.id,
      outcome: "skipped_retry",
      score: scored.score,
      retryReason: "embedding threw",
    };
  }

  const { data: inserted, error: insertErr } = await db
    .from("axis_exemplars")
    .insert({
      candidate_id: candidate.id,
      axis: candidate.axis,
      input_gist: candidate.input_gist,
      output_excerpt: candidate.output_excerpt,
      embedding,
      user_rating: candidate.user_rating,
      semantic_score: scored.score,
      domain: candidate.domain,
      question_type: candidate.question_type,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.warn(
      `[axis-exemplar-promote] insert failed for candidate ${candidate.id}:`,
      insertErr,
    );
    return {
      candidateId: candidate.id,
      outcome: "skipped_retry",
      score: scored.score,
      retryReason: insertErr?.message ?? "insert failed",
    };
  }

  await db
    .from("axis_candidate_exemplars")
    .update({ status: "promoted" })
    .eq("id", candidate.id);

  return {
    candidateId: candidate.id,
    outcome: "promoted",
    score: scored.score,
    exemplarId: inserted.id,
  };
}

/** Re-export for cron + admin consumers. */
export type { SemanticScoreBreakdown };
