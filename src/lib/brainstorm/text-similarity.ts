// ── Text similarity utilities (Phase 2D) ──
//
// Lightweight, dependency-free lexical similarity for the auto-
// connect feature. Runs entirely in the browser — no network cost,
// no AI tokens. Good for detecting OBVIOUS thematic overlap between
// sticky notes ("user retention" ↔ "churn rate"). For subtler
// semantic connections we'd need embeddings; that's the `deepSearch`
// toggle's job, ships separately.
//
// Approach: tokenize → filter stopwords → compute Jaccard
// similarity (|A∩B| / |A∪B|). Jaccard is the right choice here
// because sticky texts are short and we care about overlap
// proportion, not frequency.

/**
 * Common English stopwords that shouldn't count toward similarity.
 * Intentionally conservative — erring on the side of keeping
 * meaningful words than over-filtering. Future: multi-language
 * support when user interface languages expand.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "nor", "so", "yet",
  "in", "on", "at", "to", "from", "by", "of", "with", "about", "as",
  "is", "are", "was", "were", "be", "been", "being", "have", "has",
  "had", "do", "does", "did", "doing", "will", "would", "should",
  "could", "may", "might", "must", "can", "shall",
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves",
  "you", "your", "yours", "yourself", "yourselves", "he", "him",
  "his", "himself", "she", "her", "hers", "herself", "it", "its",
  "itself", "they", "them", "their", "theirs", "themselves",
  "what", "which", "who", "whom", "this", "that", "these", "those",
  "am", "if", "then", "than", "too", "very", "just", "also", "only",
  "not", "no", "nor", "now", "once", "here", "there", "when", "where",
  "why", "how", "all", "any", "both", "each", "few", "more", "most",
  "other", "some", "such", "own", "same", "out", "up", "down", "off",
  "over", "under", "again", "further", "one", "two", "three",
]);

/**
 * Tokenize text into a set of meaningful terms. Lowercases, splits
 * on non-word chars, filters short tokens + stopwords.
 *
 * Min token length = 3 to skip noise like "is", "to", "ok". Minimum
 * has to be 3 not 4 because meaningful short terms ("AI", "KPI",
 * "UX") still matter — but those are typically uppercase, and our
 * lowercase pass catches 3-char tokens like "api", "roi".
 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/\W+/)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    tokens.add(raw);
  }
  return tokens;
}

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|. Returns 0 when either
 * set is empty (avoids division-by-zero noise that would report
 * empty ↔ empty as "100% similar").
 *
 * Returns value in [0, 1]:
 *   0.0     no overlap
 *   0.2-0.3 tangentially related
 *   0.35+   obviously thematically linked  ← auto-connect threshold
 *   0.5+    near-duplicates
 *   1.0     identical token sets
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersectSize = 0;
  for (const token of a) {
    if (b.has(token)) intersectSize += 1;
  }
  const unionSize = a.size + b.size - intersectSize;
  return unionSize > 0 ? intersectSize / unionSize : 0;
}

/**
 * Normalized pair key — two shape ids in a stable order so
 * lookups like `seen.has(pairKey(a, b))` match `pairKey(b, a)`.
 * Consumers use this to dedupe proposals + track accepted edges.
 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
