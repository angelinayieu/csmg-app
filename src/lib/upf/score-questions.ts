/**
 * UPF info-gain + friction scorers for open questions (Phase 4c)
 *
 * Converts a RichOpenQuestion into a ProxyDescriptor with transparent,
 * auditable heuristic scoring. Future phases (4c-beta, 4e) replace the
 * heuristics with a learned posterior update, but the interface is stable.
 *
 * The scoring is deliberately simple and explainable — every coefficient is
 * a named constant, so when the selector picks question A over question B
 * we can show a short "rationale" string in the UI and debug it.
 */

import type { RichOpenQuestion } from "@/types/synthesis";
import type { Entity } from "@/types";
import type { ProxyDescriptor } from "./types";
import {
  entityReferenceInfoBits,
  entityReferenceTags,
} from "./derive-entity-descriptor";

/**
 * Optional enrichment context — if the caller provides a lookup from
 * `entity_id` to Entity, the scorer uses structural flags (bottleneck,
 * leverage, importance) to refine info-gain estimates.
 */
export interface QuestionScoreContext {
  entityLookup?: (entityId: string) => Entity | undefined;
}

/** How much the LLM-assigned priority alone is worth, in bits. */
const PRIORITY_BITS: Record<NonNullable<RichOpenQuestion["priority"]>, number> = {
  critical: 3.0,
  high: 1.6,
  medium: 0.6,
};
const UNRANKED_BITS = 0.3;

/**
 * Each distinct related entity id the question touches adds this much info
 * (fallback when no Entity lookup is available — we only know the count,
 * not what's in the entities themselves).
 */
const BITS_PER_RELATED_ENTITY = 0.25;
/** Cap on how many related entities contribute (diminishing returns). */
const RELATED_ENTITY_CAP = 6;

/**
 * Coefficient on entity-reference info-bits. The entity helper produces
 * raw bits (can be 3+ for a master-bottleneck); we attenuate so a single
 * bottleneck reference doesn't completely drown out the priority signal.
 */
const RELATED_ENTITY_WEIGHT = 0.4;

/** Bonus bits when `what_changes` predicts a meaningful shift in the analysis. */
const WHAT_CHANGES_BONUS_BITS = 0.6;
/** Length threshold for `what_changes` to count as "meaningful shift". */
const WHAT_CHANGES_MIN_CHARS = 80;

/** Answer friction baseline for a free-text, one-sentence answer. */
const BASE_QUESTION_FRICTION = 0.22;
/** Extra friction for a long / dense question — more cognitive load to answer. */
const LONG_QUESTION_FRICTION = 0.12;
const LONG_QUESTION_CHAR_THRESHOLD = 140;
/** Extra friction when the question requires a number / quantification. */
const NUMERIC_QUESTION_FRICTION = 0.18;
/** Maximum friction we'll assign — keep questions in-range of even strict budgets. */
const MAX_QUESTION_FRICTION = 0.75;

const NUMERIC_PATTERNS = [
  /\bhow many\b/i,
  /\bhow much\b/i,
  /\bwhat (?:is the |the )?(?:rate|ratio|percent(?:age)?|number|count|frequency|cadence|average|median|mean)\b/i,
  /\bquantif(?:y|ied|ying)\b/i,
  /\bper (?:day|week|month|year|user|session)\b/i,
  /\bat what (?:pace|rate|frequency|interval)\b/i,
];

function isNumericQuestion(text: string): boolean {
  return NUMERIC_PATTERNS.some((r) => r.test(text));
}

export function scoreQuestionInfoBits(
  q: RichOpenQuestion,
  ctx?: QuestionScoreContext
): number {
  const priorityBits =
    (q.priority && PRIORITY_BITS[q.priority]) ?? UNRANKED_BITS;

  const relatedIds = (q.related_entity_ids ?? []).slice(0, RELATED_ENTITY_CAP);

  // Entity-aware path: sum enriched info-bits from each resolved entity.
  // Fallback path: use the flat per-entity count when no lookup available.
  let relatedBits = 0;
  if (ctx?.entityLookup && relatedIds.length > 0) {
    let resolvedBits = 0;
    let resolvedCount = 0;
    let unresolvedCount = 0;
    for (const eid of relatedIds) {
      const ent = ctx.entityLookup(eid);
      if (ent) {
        resolvedBits += entityReferenceInfoBits(ent);
        resolvedCount += 1;
      } else {
        unresolvedCount += 1;
      }
    }
    relatedBits =
      resolvedBits * RELATED_ENTITY_WEIGHT +
      unresolvedCount * BITS_PER_RELATED_ENTITY;
    void resolvedCount;
  } else {
    relatedBits = relatedIds.length * BITS_PER_RELATED_ENTITY;
  }

  const whatChangesBits =
    typeof q.what_changes === "string" &&
    q.what_changes.trim().length >= WHAT_CHANGES_MIN_CHARS
      ? WHAT_CHANGES_BONUS_BITS
      : 0;

  return priorityBits + relatedBits + whatChangesBits;
}

export function scoreQuestionFriction(q: RichOpenQuestion): number {
  let friction = BASE_QUESTION_FRICTION;
  if ((q.question ?? "").length >= LONG_QUESTION_CHAR_THRESHOLD) {
    friction += LONG_QUESTION_FRICTION;
  }
  if (isNumericQuestion(q.question ?? "")) {
    friction += NUMERIC_QUESTION_FRICTION;
  }
  return Math.min(friction, MAX_QUESTION_FRICTION);
}

/**
 * Human-readable one-line rationale. Used in tooltips / "why was this picked".
 * Deliberately short so it fits in a hover label.
 */
export function questionRationale(
  q: RichOpenQuestion,
  ctx?: QuestionScoreContext
): string {
  const parts: string[] = [];
  if (q.priority) parts.push(`${q.priority} priority`);

  const relatedIds = q.related_entity_ids ?? [];

  // When we can resolve entities, surface the most salient structural tags
  // (bottleneck, leverage, risk, fundamental/critical) rather than a count.
  if (ctx?.entityLookup && relatedIds.length > 0) {
    const salient = new Set<string>();
    let resolvedCount = 0;
    for (const eid of relatedIds) {
      const ent = ctx.entityLookup(eid);
      if (!ent) continue;
      resolvedCount += 1;
      for (const t of entityReferenceTags(ent)) salient.add(t);
    }
    if (salient.has("bottleneck")) parts.push("touches master bottleneck");
    if (salient.has("leverage")) parts.push("touches leverage point");
    if (salient.has("risk")) parts.push("touches risk point");
    if (
      !salient.has("bottleneck") &&
      (salient.has("fundamental") || salient.has("critical")) &&
      resolvedCount > 0
    ) {
      parts.push(`touches ${salient.has("fundamental") ? "fundamental" : "critical"}-importance node`);
    }
    if (salient.size === 0 && resolvedCount > 0) {
      parts.push(
        `${resolvedCount} downstream entit${resolvedCount === 1 ? "y" : "ies"}`
      );
    }
  } else if (relatedIds.length > 0) {
    parts.push(
      `${relatedIds.length} downstream entit${relatedIds.length === 1 ? "y" : "ies"}`
    );
  }

  if (
    typeof q.what_changes === "string" &&
    q.what_changes.trim().length >= WHAT_CHANGES_MIN_CHARS
  ) {
    parts.push("meaningful predicted shift");
  }
  if (isNumericQuestion(q.question ?? "")) {
    parts.push("numeric answer");
  }
  return parts.length > 0 ? parts.join(" · ") : "baseline priors";
}

/**
 * Convert a RichOpenQuestion + its index into a ProxyDescriptor that the
 * shared selector can consume. `construct_id` is the question's canonical
 * form so two rephrasings of the same question would (ideally) collapse.
 */
export function questionToDescriptor(
  q: RichOpenQuestion,
  index: number,
  spaceId: string,
  ctx?: QuestionScoreContext
): ProxyDescriptor {
  const id = `question:${spaceId}:${index}`;
  const construct_id = `question:${(q.question ?? "").trim().toLowerCase()}`;

  // Phase 4c-final+: probes_constructs contains ONLY entity:<id> constructs,
  // not the question's own `question:<text>` construct. Rationale:
  //   - Entity IDs are stable across LLM re-synthesis; question text isn't.
  //     Including the text-keyed construct would orphan posteriors on every
  //     LLM rephrase (C3 question "what's your MRR?" → "what's current MRR?"
  //     silently loses one observation per answered question).
  //   - The answered-state is already captured in `user_answer` on the
  //     question itself, which the selector uses to exclude answered
  //     questions from the candidate set. We don't need a second signal.
  // Net: stability through rephrasing + no behavior change for ranking.
  const probes_constructs = (q.related_entity_ids ?? []).map(
    (eid) => `entity:${eid}`
  );

  return {
    id,
    construct_id,
    kind: "question",
    // Questions are inherently self-report / cognitive work from the user.
    // We call them "light" because answering is cheap compared to a heavy
    // instrument. A numeric question with lots of related entities can still
    // win on info-per-friction even if its friction is higher.
    depth_tier: "light",
    friction_cost: scoreQuestionFriction(q),
    expected_info_bits: scoreQuestionInfoBits(q, ctx),
    // Answering a question discloses nothing the user wasn't already willing
    // to type — no consent categories required.
    data_categories: [],
    probes_constructs,
    metadata: {
      index,
      priority: q.priority ?? null,
      related_entity_ids: q.related_entity_ids ?? [],
      rationale: questionRationale(q, ctx),
    },
  };
}
