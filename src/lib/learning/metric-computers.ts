// ── Domain learning metric computers (Phase 2I) ──
//
// Pure functions that score a (user, domain, space) snapshot on four
// proficiency axes. Each returns a [0, 1] scalar so the learning
// panel can render them as bars and the agent can compare them
// across domains without unit juggling.
//
//   • computeCoverageDepth        — how much of the KG has been
//                                   analyzed (not just generated).
//                                   Analysed = analysis_count > 0
//                                   OR evidence_strength is set.
//   • computeCalibration          — how close past predictions came
//                                   to reality (1 - |deviation|).
//                                   NULL when there are 0 resolved
//                                   predictions yet.
//   • computeNoveltyRate          — fraction of entities in this
//                                   space that the user hasn't
//                                   encountered in prior spaces in
//                                   this domain. Falls with exposure.
//   • computeCitationDensity      — evidence_items per entity,
//                                   squashed through tanh so a
//                                   well-grounded space (≥3 per
//                                   entity) saturates near 1.0.
//
// All functions are deterministic. The endpoint that calls them is
// responsible for feeding consistent inputs (same space, same
// domain filter) — that way raw_features in the measurements table
// can reproduce any historical score.

import type { Entity } from "@/types";

export interface CoverageInput {
  entities: Pick<Entity, "analysis_count" | "evidence_strength">[];
}

/**
 * Fraction of entities that show evidence of analysis:
 *   analyzed = analysis_count > 0 OR evidence_strength > 0.
 *
 * Returns 0 for a space with no entities — callers should decide
 * whether that represents "untouched" or "not yet measurable".
 */
export function computeCoverageDepth(input: CoverageInput): number {
  const n = input.entities.length;
  if (n === 0) return 0;
  let analyzed = 0;
  for (const e of input.entities) {
    const count = e.analysis_count ?? 0;
    const strength = e.evidence_strength ?? 0;
    if (count > 0 || strength > 0) analyzed += 1;
  }
  return clamp01(analyzed / n);
}

export interface CalibrationInput {
  /** Only RESOLVED predictions contribute. Pre-filter before calling. */
  predictions: Array<{
    deviation: number | null;
    confidence: number | null;
  }>;
}

export interface CalibrationResult {
  score: number | null;
  resolvedCount: number;
  /** Mean |deviation| among resolved predictions — lower is better. */
  meanAbsDeviation: number | null;
}

/**
 * Simple calibration: 1 - mean(|deviation|), clamped to [0, 1].
 *
 * `deviation` in our prediction_ledger is already the signed error
 * normalized (predicted - actual) / expected_scale, so |deviation|
 * stays in a comparable range across metrics of different units.
 *
 * A bolder version would weight by |confidence - correctness| to
 * penalize overconfidence separately from miscalibration; we can
 * add that later. The current formula is good enough to show whether
 * a user's accuracy is improving over time, which is the whole
 * point of the learning curve.
 *
 * NULL when the user has no resolved predictions yet — different
 * meaning than "0 calibration".
 */
export function computeCalibration(input: CalibrationInput): CalibrationResult {
  const resolved = input.predictions.filter(
    (p) => p.deviation !== null && Number.isFinite(p.deviation as number),
  );
  if (resolved.length === 0) {
    return { score: null, resolvedCount: 0, meanAbsDeviation: null };
  }
  let sumAbsDev = 0;
  for (const p of resolved) sumAbsDev += Math.abs(p.deviation as number);
  const mean = sumAbsDev / resolved.length;
  const score = clamp01(1 - mean);
  return {
    score,
    resolvedCount: resolved.length,
    meanAbsDeviation: mean,
  };
}

export interface NoveltyInput {
  /** Entity names in the current space (lowercased match key). */
  currentEntityNames: string[];
  /** Entity names the user has seen in PRIOR spaces in the same domain. */
  priorEntityNames: string[];
}

/**
 * Fraction of the current space's entities that did not appear in
 * any of this user's earlier spaces in the same domain. Uses a
 * loose exact-match on lowercased names — embedding-based match
 * would be better but is overkill until we see it matter.
 *
 * Returns 1.0 when the user has no prior spaces in this domain
 * (every entity is novel by definition) and when the current space
 * is empty (formally vacuous — treat as "fully novel" so a fresh
 * start isn't penalized).
 */
export function computeNoveltyRate(input: NoveltyInput): number {
  const { currentEntityNames, priorEntityNames } = input;
  if (currentEntityNames.length === 0) return 1;
  if (priorEntityNames.length === 0) return 1;

  const priorSet = new Set(priorEntityNames.map(normalizeName));
  let novel = 0;
  for (const name of currentEntityNames) {
    if (!priorSet.has(normalizeName(name))) novel += 1;
  }
  return clamp01(novel / currentEntityNames.length);
}

export interface CitationDensityInput {
  entityCount: number;
  evidenceCount: number;
  /** Optional — used to compute mean_evidence_reliability alongside. */
  evidenceReliabilities?: Array<number | null | undefined>;
}

export interface CitationDensityResult {
  /** tanh-squashed evidence-per-entity ratio. Saturates near 1 at ~3 evidence/entity. */
  density: number;
  /** Mean reliability_prior across evidence items, NULL when none. */
  meanReliability: number | null;
  perEntity: number;
}

/**
 * Citation density = tanh(evidence_per_entity / 3).
 *
 * tanh keeps the score smooth and bounded: 0 evidence → 0, 1.5/entity →
 * ~0.46, 3/entity → ~0.76, 6/entity → ~0.96. A space with hundreds of
 * citations doesn't silently dominate the learning curve.
 */
export function computeCitationDensity(
  input: CitationDensityInput,
): CitationDensityResult {
  const perEntity =
    input.entityCount > 0 ? input.evidenceCount / input.entityCount : 0;
  const density = clamp01(Math.tanh(perEntity / 3));

  const reliabilities = (input.evidenceReliabilities ?? []).filter(
    (r): r is number => typeof r === "number" && Number.isFinite(r),
  );
  const meanReliability =
    reliabilities.length > 0
      ? reliabilities.reduce((a, b) => a + b, 0) / reliabilities.length
      : null;

  return { density, meanReliability, perEntity };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
