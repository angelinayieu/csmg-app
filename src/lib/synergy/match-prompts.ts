// ── Synergy matching — LLM re-rank prompts + schemas ──
//
// Pass 1 of the matcher does fast vector kNN via pgvector (HNSW) to
// pull top-50 candidates per source component. Pass 2 (this file)
// uses an LLM to batch-rate complementarity + goal alignment for
// each candidate pair, producing the final ranking.
//
// We batch 6-10 pairs per LLM call to amortize prompt overhead.
// Single-pair calls would cost ~10x more tokens for the same output
// quality. Strict JSON output guarantees parseable results.

export const MATCH_RERANK_SYSTEM = `You are evaluating whether brainstorm components from two different users would meaningfully complement each other for collaboration.

Each candidate pair has:
- COMPONENT_A: a piece of one user's project (their upstream need, downstream output, core idea, or polished product)
- COMPONENT_B: a piece of another user's project (same kinds)
- OBJECTIVE_A: user A's broader objective
- OBJECTIVE_B: user B's broader objective
- COSINE_SIM: their semantic similarity (0-1) from vector embedding

For each pair, evaluate two dimensions:

1. complementarity_score (0-100):
   - For "upstream ↔ downstream" pairs: does B's output meaningfully produce what A's upstream component needs?
   - For "downstream ↔ upstream" pairs: mirror of above
   - For "core_idea / polished_product" parallel pairs: are they working on adjacent problems that would benefit from co-ideation?
   - Low score: same kind both upstream (both need the same thing — no exchange), or topically distant
   - High score: A clearly produces what B needs (or vice versa) with low friction
   - 0 means "completely irrelevant", 100 means "perfect fit"

2. goal_alignment_score (0-100):
   - Do user A's and B's stated objectives suggest they're working in compatible directions?
   - High: academic researcher matched with another academic on the same disease area
   - Medium: academic vs commercial in the same domain (some friction, but exchange possible)
   - Low: completely disjoint objectives (medical AI + restaurant marketing)
   - When OBJECTIVE_A or OBJECTIVE_B is missing, score 50 (neutral)

Then classify match_kind:
- 'a_needs_b' — A's component is upstream/core-idea, B's is downstream/polished_product, and B fills A's gap
- 'b_needs_a' — mirror of above
- 'parallel'  — both same direction or same kind, adjacent problems, ideation co-working potential

Provide a one-sentence rationale that names WHY the match works (or doesn't). Be specific, not generic.

Return JSON.`;

export const MATCH_RERANK_SCHEMA = {
  name: "synergy_match_rerank",
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
            complementarity_score: { type: "number" },
            goal_alignment_score: { type: "number" },
            match_kind: {
              type: "string",
              enum: ["a_needs_b", "b_needs_a", "parallel"],
            },
            rationale: { type: "string" },
          },
          required: [
            "pair_id",
            "complementarity_score",
            "goal_alignment_score",
            "match_kind",
            "rationale",
          ],
        },
      },
    },
    required: ["pairs"],
  },
} as const;

// ── Kind compatibility map ──
//
// Pre-filter applied at the vector-search stage. For each source
// component kind, returns the kinds that could meaningfully match.
// We over-include rather than under-include — the LLM re-rank prunes
// false positives via the complementarity score.

export const KIND_COMPATIBILITY: Record<string, string[]> = {
  // upstream needs flow → downstream outputs / polished products
  upstream: ["downstream", "polished_product", "core_idea"],
  // downstream outputs flow → upstream needs
  downstream: ["upstream", "core_idea"],
  // core ideas resonate with other core ideas and polished products
  core_idea: ["core_idea", "polished_product", "upstream", "downstream"],
  // polished products fill upstream needs + parallel polished products
  polished_product: ["upstream", "polished_product", "core_idea"],
};

// ── Score aggregation ──
//
// final_score = 0.4 × cosine_sim × 100  (semantic relatedness)
//             + 0.4 × complementarity   (directional fit)
//             + 0.2 × goal_alignment    (working in compatible direction)
//
// cosine_sim is scaled to 0-100 to match the LLM dimensions; final
// score is also 0-100 so the storage column reads consistently.

export function aggregateFinalScore(
  cosineSim: number,
  complementarity: number,
  goalAlignment: number,
): number {
  const c = Math.max(0, Math.min(1, cosineSim)) * 100;
  const comp = Math.max(0, Math.min(100, complementarity));
  const goal = Math.max(0, Math.min(100, goalAlignment));
  return 0.4 * c + 0.4 * comp + 0.2 * goal;
}
