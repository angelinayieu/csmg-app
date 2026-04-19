/**
 * User Feedback Learning Engine — Intelligence Radar v2
 *
 * Processes user signal verdicts (dismiss / escalate / resolve) and feeds
 * them back into entity-level priority scoring. Pure functions: no DB calls,
 * no side effects.
 *
 * Flow:
 *   1. User triages a signal → status change → computeVerdictFromStatus()
 *   2. Verdict recorded → recordVerdict()
 *   3. Entity weights recomputed → computeEntityVerdictWeights()
 *   4. Weights applied to urgency scores → applyVerdictBonus()
 *   5. UI summary stats → getVerdictSummary()
 */

import type { SignalStatus } from "@/types/intelligence";
import type {
  SignalVerdict,
  SignalVerdictRecord,
  EntityVerdictWeight,
} from "@/types/intelligence-v2";

// ── Constants ──

/** Point value assigned to each verdict type when computing entity relevance weights. */
export const VERDICT_WEIGHTS: Record<SignalVerdict, number> = {
  useful: 2,
  needs_research: 1,
  already_known: -0.5,
  irrelevant: -2,
};

/** Exponential decay factor applied per week of age (relative to most recent verdict). */
const DECAY_FACTOR_PER_WEEK = 0.9;

/** Milliseconds in one week, used for time-decay calculations. */
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

// ── 1. Status → Verdict Mapping ──

/**
 * Maps a signal's triage status to an implicit user verdict.
 *
 * Called when a user changes the status of an intelligence signal (e.g.
 * escalates, dismisses, or resolves it). Returns `null` for statuses
 * that carry no implicit verdict (i.e. "active").
 *
 * @param status - The new signal status after user action.
 * @returns The inferred verdict, or `null` if the status is neutral.
 */
export function computeVerdictFromStatus(
  status: SignalStatus,
): SignalVerdict | null {
  switch (status) {
    case "escalated":
      return "useful";
    case "dismissed":
      return "irrelevant";
    case "investigating":
      return "needs_research";
    case "resolved":
      return "useful";
    case "active":
      return null;
    default:
      return null;
  }
}

// ── 2. Record a Verdict ──

/**
 * Appends (or replaces) a verdict record for a given signal.
 *
 * If a verdict already exists for the same `signalId`, it is replaced —
 * this handles the case where a user changes their mind about a signal.
 * Otherwise the new verdict is appended.
 *
 * @param params.existingVerdicts - Current array of verdict records.
 * @param params.signalId         - The signal being judged.
 * @param params.entityId         - The entity the signal relates to.
 * @param params.verdict          - The user's verdict.
 * @param params.note             - Optional free-text note.
 * @returns A new array with the verdict added or replaced.
 */
export function recordVerdict(params: {
  existingVerdicts: SignalVerdictRecord[];
  signalId: string;
  entityId: string;
  verdict: SignalVerdict;
  note?: string;
}): SignalVerdictRecord[] {
  const { existingVerdicts, signalId, entityId, verdict, note } = params;

  const newRecord: SignalVerdictRecord = {
    signal_id: signalId,
    entity_id: entityId,
    verdict,
    note,
    timestamp: new Date().toISOString(),
  };

  // Replace existing verdict for the same signal, or append
  const existingIndex = existingVerdicts.findIndex(
    (v) => v.signal_id === signalId,
  );

  if (existingIndex >= 0) {
    const updated = [...existingVerdicts];
    updated[existingIndex] = newRecord;
    return updated;
  }

  return [...existingVerdicts, newRecord];
}

// ── 3. Compute Entity-Level Verdict Weights ──

/**
 * Aggregates per-signal verdicts into per-entity relevance weights.
 *
 * For each entity that has at least one verdict:
 * - Each verdict contributes its base weight from `VERDICT_WEIGHTS`.
 * - An exponential decay is applied so newer verdicts matter more:
 *   `weight * 0.9^(weeks_since_verdict)` where weeks are measured from
 *   the most recent verdict across all entities.
 * - Results are sorted by absolute relevance_weight descending.
 *
 * @param verdicts - All recorded signal verdicts.
 * @returns Per-entity weight summaries, sorted by importance.
 */
export function computeEntityVerdictWeights(
  verdicts: SignalVerdictRecord[],
): EntityVerdictWeight[] {
  if (verdicts.length === 0) return [];

  // Find the most recent timestamp across all verdicts as the reference point
  const mostRecentMs = Math.max(
    ...verdicts.map((v) => new Date(v.timestamp).getTime()),
  );

  // Group verdicts by entity_id
  const grouped = new Map<string, SignalVerdictRecord[]>();
  for (const v of verdicts) {
    const list = grouped.get(v.entity_id) ?? [];
    list.push(v);
    grouped.set(v.entity_id, list);
  }

  const weights: EntityVerdictWeight[] = [];

  for (const [entityId, entityVerdicts] of grouped) {
    let cumulativeWeight = 0;

    for (const v of entityVerdicts) {
      const baseWeight = VERDICT_WEIGHTS[v.verdict];
      const ageMs = mostRecentMs - new Date(v.timestamp).getTime();
      const weeksAgo = ageMs / MS_PER_WEEK;
      const decayMultiplier = Math.pow(DECAY_FACTOR_PER_WEEK, weeksAgo);
      cumulativeWeight += baseWeight * decayMultiplier;
    }

    // Find most recent verdict timestamp for this entity
    const lastVerdictAt = entityVerdicts.reduce((latest, v) =>
      v.timestamp > latest ? v.timestamp : latest,
      entityVerdicts[0].timestamp,
    );

    weights.push({
      entity_id: entityId,
      relevance_weight: Math.round(cumulativeWeight * 1000) / 1000,
      verdict_count: entityVerdicts.length,
      last_verdict_at: lastVerdictAt,
    });
  }

  // Sort by absolute weight descending (most impactful entities first)
  weights.sort(
    (a, b) => Math.abs(b.relevance_weight) - Math.abs(a.relevance_weight),
  );

  return weights;
}

// ── 4. Apply Verdict Bonus to Urgency Scores ──

/**
 * Adjusts an entity's base urgency score using accumulated user feedback.
 *
 * The bonus is clamped to [-20, +20] to prevent feedback from completely
 * overwhelming the base heuristic score. If the entity has no recorded
 * verdicts, the base score is returned unchanged.
 *
 * @param baseUrgencyScore - The urgency score before feedback adjustment.
 * @param entityId         - The entity to look up.
 * @param weights          - Pre-computed entity verdict weights (keyed by entity_id).
 * @returns The adjusted urgency score.
 */
export function applyVerdictBonus(
  baseUrgencyScore: number,
  entityId: string,
  weights: Map<string, EntityVerdictWeight>,
): number {
  const weight = weights.get(entityId);
  if (!weight) return baseUrgencyScore;

  const bonus = Math.max(-20, Math.min(20, weight.relevance_weight * 10));
  return baseUrgencyScore + bonus;
}

// ── 5. Verdict Summary for UI ──

/**
 * Produces summary statistics from entity verdict weights for dashboard display.
 *
 * @param weights - Pre-computed entity verdict weights.
 * @returns An object with counts and top-3 most relevant / most dismissed entity IDs.
 */
export function getVerdictSummary(weights: EntityVerdictWeight[]): {
  total_entities_rated: number;
  positive_entities: number;
  negative_entities: number;
  most_relevant: string[];
  most_dismissed: string[];
} {
  const positive = weights.filter((w) => w.relevance_weight > 0);
  const negative = weights.filter((w) => w.relevance_weight < 0);

  // Top 3 most relevant: highest positive weight first
  const mostRelevant = positive
    .sort((a, b) => b.relevance_weight - a.relevance_weight)
    .slice(0, 3)
    .map((w) => w.entity_id);

  // Top 3 most dismissed: lowest (most negative) weight first
  const mostDismissed = negative
    .sort((a, b) => a.relevance_weight - b.relevance_weight)
    .slice(0, 3)
    .map((w) => w.entity_id);

  return {
    total_entities_rated: weights.length,
    positive_entities: positive.length,
    negative_entities: negative.length,
    most_relevant: mostRelevant,
    most_dismissed: mostDismissed,
  };
}
