// ── Metric label normalization (Tier 6) ────────────────────────────────
//
// Prevents drift when LLM-generated strategies rename the "same" metric
// between regens. Examples the audit flagged:
//
//   "NPS (Enterprise)"       vs "NPS for Enterprise Segment"
//   "Customer Churn Rate"    vs "customer-churn-rate"
//   "Weekly Active Users"    vs "Weekly active users"
//
// These all point at the same thing, but the predictor's string-match
// against metric_trackers drops the join silently when the label drifts.
// Tracker_id populates from this same path so a drift kills the whole
// downstream chain: no tracker_id → no observations → no extrapolation
// → prediction either skips or writes with a stale labeled metric.
//
// Normalization is lossy on purpose. We do NOT want the normalized form
// shown in UI — users want "NPS (Enterprise)," not "nps enterprise".
// Instead, normalization is applied ONLY at match/lookup time: both the
// incoming label and the candidate are normalized, then compared.
//
// This module is intentionally tiny + dependency-free so every consumer
// (predictor, resolver, app-strategy-generator, tracker upsert, sub-
// strategy entity_refs populate) can use the identical logic without
// worrying about import cycles.

/**
 * Normalize a metric label for matching.
 *
 * Transformations:
 *   - lowercase
 *   - trim leading/trailing whitespace
 *   - collapse internal whitespace (multiple spaces → single)
 *   - strip punctuation: () [] {} , . : ; ' " ` ~ ! ? — – - _ / \ @
 *   - strip common filler words that drift: "for", "the", "a", "of"
 *
 * What's NOT stripped:
 *   - Numbers (30d, q4, v2 — semantically significant)
 *   - Unicode letters (accented characters preserved, non-ASCII stays)
 *
 * Idempotent: normalize(normalize(x)) === normalize(x) for all x.
 */
export function normalizeMetricLabel(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    // Punctuation — wipe everything commonly-used in metric names that
    // shouldn't affect semantic identity. Deliberately aggressive; the
    // goal is that "NPS (Enterprise)" and "nps - enterprise" match.
    .replace(/[()[\]{},.:;'"`~!?—–\-_/\\@]+/g, " ")
    // Filler words that appear/disappear between regens
    .replace(/\b(for|the|a|of)\b/g, " ")
    // Collapse whitespace runs
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compare two metric labels for "same metric" identity. Handles both
 * null-safety and normalization in one call so callers don't forget
 * either.
 *
 * Returns true when both are non-empty AND normalize to the same string.
 */
export function sameMetricLabel(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const na = normalizeMetricLabel(a);
  const nb = normalizeMetricLabel(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * Find a candidate label matching the target (normalized equality).
 * Returns the first matching candidate verbatim (preserving original
 * capitalization / punctuation), or null.
 *
 * Use this when joining sub-strategy metric labels back to tracker
 * labels — the tracker's display label wins, sub-strategy's drifted
 * label loses.
 */
export function findMatchingLabel(
  target: string,
  candidates: string[],
): string | null {
  const norm = normalizeMetricLabel(target);
  if (!norm) return null;
  for (const c of candidates) {
    if (normalizeMetricLabel(c) === norm) return c;
  }
  return null;
}
