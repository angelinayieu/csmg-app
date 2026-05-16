// ── Parallel-path strategy matching — LLM rerank prompts + schema ──
//
// Pass 1 of the strategy matcher does vector kNN via pgvector
// (synergy_match_strategies RPC) to pull top-30 candidate strategies
// per source. Pass 2 (this file) uses an LLM to batch-rate whether
// each candidate is a TRUE parallel path — meaning: convergent goal,
// possibly DIVERGENT routine — and extracts the shared theme,
// shared pillars, and divergence summary.
//
// This is intentionally different from the component-match rerank:
//   * component matcher asks "do these COMPLEMENT each other?"
//     (peg/hole — different shapes that fit together)
//   * strategy matcher asks "are these PARALLEL?"
//     (same shape — different paths to the same destination)
//
// We batch 4-6 strategies per LLM call. Strategies are longer than
// components (statement + pitch + plan_steps), so the per-pair token
// budget is higher and the batch size is correspondingly smaller.

export const STRATEGY_RERANK_SYSTEM = `You are evaluating whether two users' brainstorm strategies are PARALLEL PATHS — meaning the two users are pursuing CONVERGENT GOALS via POSSIBLY DIVERGENT ROUTINES, and would benefit from witnessing each other's approach.

A parallel-path match is NOT the same as a collaboration match. You are NOT looking for complementarity (one provides what the other needs). You ARE looking for two people walking similar roads — different routes to the same destination, who can compare notes, share what's working, and hold each other accountable.

Each pair you evaluate has:
- STRATEGY_A: one user's goal (statement), pitch, and ordered plan steps
- STRATEGY_B: another user's goal, pitch, and plan steps
- COSINE_SIM: their semantic similarity (0-1) from vector embedding

For each pair, evaluate two dimensions:

1. parallel_score (0-100):
   - High (70-100): both pursuing a similar GOAL with comparable plan structure. Different routines are OK — divergence in approach is what makes the match interesting.
   - Medium (40-69): goal overlaps but plan steps suggest fundamentally different problems (e.g. both "daily research" but one is academic literature review and the other is empirical lab work)
   - Low (0-39): superficially similar wording but goals point in different directions
   - 0 means "no parallelism at all"; 100 means "almost the same project shape, different routine"

2. divergence_value (0-100):
   - HIGH divergence_value means the two routines DIFFER ENOUGH that swapping notes would be educational (one uses MATLAB, the other Python; one in-person, the other remote)
   - LOW divergence_value means the two routines are SO IDENTICAL that there's nothing to learn from each other
   - Sweet spot is medium-high divergence with high parallel_score: same goal, materially different routine.

For matches passing your threshold (parallel_score >= 60), also extract:

  shared_theme: One short phrase (under 60 chars) naming the goal-level overlap. Use concrete nouns. Example: "Daily cognitive-modeling research routines". NOT "Self-improvement journey".

  shared_pillars: 1-3 short noun phrases (each under 40 chars) naming what the two strategies share at the GOAL level — e.g. ["Time-blocked daily sessions", "Academic lit integration", "Public-facing publishing"]. These render as chips at the top of the parallel-path room.

  divergence_summary: One single sentence (under 200 chars) on HOW the two strategies execute differently. Example: "A focuses on individual MATLAB modeling; B focuses on collaborative theory-building with Python notebooks." This sentence is what gives the room its conversational opening.

For matches failing your threshold (parallel_score < 60), set shared_theme="", shared_pillars=[], divergence_summary="" — they will be discarded.

Return JSON.`;

export const STRATEGY_RERANK_SCHEMA = {
  name: "synergy_strategy_match_rerank",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      pairs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            pair_id: { type: "string" },
            parallel_score: { type: "number" },
            divergence_value: { type: "number" },
            shared_theme: { type: "string" },
            shared_pillars: {
              type: "array",
              items: { type: "string" },
            },
            divergence_summary: { type: "string" },
          },
          required: [
            "pair_id",
            "parallel_score",
            "divergence_value",
            "shared_theme",
            "shared_pillars",
            "divergence_summary",
          ],
        },
      },
    },
    required: ["pairs"],
  },
} as const;

// ── Score aggregation ──
//
// final_score = 0.5 × cosine_sim × 100  (vector relatedness)
//             + 0.5 × parallel_score    (LLM-judged parallel fit)
//
// We deliberately do NOT factor divergence_value into the final score —
// it's a UX signal (used for sorting + "this match would be especially
// interesting" callouts) but not a gating dimension. We don't want to
// filter out two users who happen to have nearly identical routines;
// they may still benefit from witnessing each other.
//
// The threshold MIN_PERSIST_SCORE = 60 (set on the matcher side) means
// in practice a pair needs roughly cosine ≥ 0.6 + parallel_score ≥ 60
// to land. Lower-similarity pairs simply don't survive Pass 1's kNN
// cutoff.

export function aggregateStrategyFinalScore(
  cosineSim: number,
  parallelScore: number,
): number {
  const c = Math.max(0, Math.min(1, cosineSim)) * 100;
  const p = Math.max(0, Math.min(100, parallelScore));
  return 0.5 * c + 0.5 * p;
}
