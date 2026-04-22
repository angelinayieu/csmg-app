// ── Axis exemplar retrieval (Phase 2E · PR 6) ──
//
// Fetches top-K semantically-closest exemplars from axis_exemplars
// for a given (axis, input) pair. Called by the per-axis generator
// endpoint before building the prompt — the result slots into
// getAxisPrompt's `exemplars` array so good historical runs few-shot
// seed the new generation.
//
// Retrieval flow:
//   1. Embed the user's input via text-embedding-3-small
//   2. Call the `search_axis_exemplars` pgvector RPC with (axis,
//      embedding, optional domain + questionType filters)
//   3. Re-rank top-K by combined (1 - distance) × semantic_score so
//      a slightly-less-similar exemplar with a much higher scorer
//      grade can outrank a near-identical low-grade one
//   4. Map to AxisExemplar shape and return
//
// Cold-start behavior: when the library is empty (no promotions yet),
// the RPC returns zero rows. Generator sees empty array, skips the
// exemplar block in the prompt. No error, no retry — just honest
// "no few-shot available yet."
//
// Soft-fail: embedding API errors or DB errors return [] rather than
// throw. Exemplars are a nice-to-have for prompt quality; a retrieval
// failure should not block generation.

import { embedTexts } from "@/lib/embeddings";
import type { AxisExemplar } from "@/lib/prompts/axis-prompts";
import type { QuestionType } from "@/lib/prompts/axis-prompts";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";

export interface RetrieveAxisExemplarsOptions {
  axis: ProbabilitySpaceAxis;
  /** User's raw input. We truncate + embed this for similarity search. */
  inputText: string;
  /** From question-type classifier. Narrows retrieval to same domain
   *  when present; NULL-tolerant on the DB side. */
  domain?: string | null;
  /** From question-type classifier. Same tolerance story. */
  questionType?: QuestionType | null;
  /** How many exemplars to return. Default 2 — matches the typical
   *  few-shot count before the system prompt starts to bloat. */
  limit?: number;
}

// Upper bound on input_gist length used for embedding. Matches the
// 200-char truncation the capture step uses for `input_gist`, so
// retrieval + capture operate on the same feature shape.
const GIST_MAX_CHARS = 200;

interface RpcRow {
  id: string;
  axis: string;
  input_gist: string;
  output_excerpt: string;
  user_rating: number;
  semantic_score: number;
  domain: string | null;
  question_type: string | null;
  distance: number; // cosine distance, [0..2], lower = more similar
}

export async function retrieveAxisExemplars(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  opts: RetrieveAxisExemplarsOptions,
): Promise<AxisExemplar[]> {
  const { axis, inputText, domain, questionType, limit = 2 } = opts;
  if (!inputText || inputText.length < 5) return [];

  const gist = inputText.slice(0, GIST_MAX_CHARS);

  // ── Embed the input ──
  let embedding: number[];
  try {
    const [vec] = await embedTexts([gist]);
    if (!vec || vec.length === 0) return [];
    embedding = vec;
  } catch (err) {
    console.warn(
      `[axis-exemplar-retrieval] embed failed for axis=${axis} (non-fatal):`,
      err,
    );
    return [];
  }

  // ── ANN search via RPC ──
  //
  // Fetch a wider net than `limit` (2x) so the combined-score rerank
  // below has room to promote a high-scorer slightly further in
  // cosine distance past a near-neighbor with a mediocre score.
  const rpcK = Math.max(limit * 2, limit + 2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rpcRows: RpcRow[] = [];
  try {
    const { data, error } = await db.rpc("search_axis_exemplars", {
      p_axis: axis,
      p_query_embedding: embedding,
      p_k: rpcK,
      p_domain: domain ?? null,
      p_question_type: questionType ?? null,
    });
    if (error) {
      console.warn(
        `[axis-exemplar-retrieval] RPC failed for axis=${axis} (non-fatal):`,
        error,
      );
      return [];
    }
    rpcRows = (data ?? []) as RpcRow[];
  } catch (err) {
    console.warn(
      `[axis-exemplar-retrieval] RPC threw for axis=${axis} (non-fatal):`,
      err,
    );
    return [];
  }

  if (rpcRows.length === 0) return [];

  // ── Combined-score rerank ──
  //
  // cosine_sim = 1 - distance (pgvector <=> returns cosine distance).
  // combined = cosine_sim * semantic_score. Both in [0..1], so product
  // is in [0..1] and preserves intuitive "better on both axes wins"
  // ordering. Tie-break by higher user_rating (more human-validated).
  type Ranked = RpcRow & { combined: number };
  const ranked: Ranked[] = rpcRows.map((r) => {
    const cosineSim = Math.max(0, Math.min(1, 1 - (r.distance ?? 0)));
    const semantic = Math.max(0, Math.min(1, Number(r.semantic_score ?? 0)));
    return { ...r, combined: cosineSim * semantic };
  });
  ranked.sort((a, b) => {
    if (b.combined !== a.combined) return b.combined - a.combined;
    return (b.user_rating ?? 0) - (a.user_rating ?? 0);
  });

  const top = ranked.slice(0, limit);

  // ── Use-count telemetry ──
  //
  // Deferred to a follow-up PR: Supabase's client update() can't
  // reference the current column value inline, so a proper
  // `use_count = use_count + 1` needs an RPC like
  //   CREATE FUNCTION bump_axis_exemplar_use_count(ids uuid[]) ...
  // For now we rely on pipeline logs + the `last_used_at` column
  // being set by that future RPC. Retrieval itself is complete
  // without the telemetry write; skipping it here avoids a broken
  // fire-and-forget call that would write bogus values.

  return top.map((r) => ({
    inputGist: r.input_gist,
    outputExcerpt: r.output_excerpt,
  }));
}
