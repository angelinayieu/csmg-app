// ── Cosine similarity ─────────────────────────────────────────────────
//
// Generic dot-product / magnitudes cosine. Lives separately from any
// specific scorer so future axes (novelty, actionability) reuse it
// without pulling in scoring-specific code.

/** Cosine similarity of two equal-length vectors, clamped to [0, 1].
 *  Negative cosine (truly opposite meanings) is treated the same as
 *  zero (unrelated) for the lab's purposes — ranking-by-relevance is
 *  the goal, not direction-of-disagreement. OpenAI text-embedding-3
 *  produces non-negative cosine on natural-language inputs in practice,
 *  so the clamp is a guardrail rather than a load-bearing transform. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  const sim = dot / (Math.sqrt(magA) * Math.sqrt(magB));
  if (Number.isNaN(sim)) return 0;
  return Math.max(0, Math.min(1, sim));
}
