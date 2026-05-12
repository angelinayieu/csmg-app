// Extract HypothesisLadderDraft[] from a StrategicRecommendation.
//
// Walks `pre_mortem` entries — each one carries the structure we need:
//   • narrative              → context for the claim
//   • assumption_exposed     → CLAIM (the implicit hypothesis)
//   • related_entity_ids     → MECHANISM chain
//   • early_warnings         → FALSIFIER candidates (joined into one)
//   • category/severity/prob → carry-through metadata
//
// Pure function — no DB, no LLM call. Caller persists via
// persistHypothesisLadders().

import type { StrategicRecommendation } from "@/types/strategy";
import type {
  HypothesisLadderDraft,
  HypothesisLadderCategory,
  HypothesisLadderSeverity,
  HypothesisLadderProbability,
  MechanismChainStep,
} from "@/types/hypothesis-ladders";

export interface ExtractHypothesisLaddersArgs {
  spaceId: string;
  recommendation: StrategicRecommendation;
  /** entity_id → display name lookup so the mechanism chain renders
   *  "Sleep → Cortisol → Working Memory" instead of "C20 → C30 → C32".
   *  Pass an empty map and the chain falls back to entity_ids. */
  entityNames?: Map<string, string>;
  sourceStrategyVersion?: number | null;
}

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  "internal",
  "structural",
  "competitive",
  "timing",
  "interaction",
]);

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  "catastrophic",
  "major",
  "moderate",
]);

const VALID_PROBABILITIES: ReadonlySet<string> = new Set([
  "high",
  "moderate",
  "low",
]);

function asCategory(raw: unknown): HypothesisLadderCategory | null {
  if (typeof raw !== "string") return null;
  return VALID_CATEGORIES.has(raw)
    ? (raw as HypothesisLadderCategory)
    : null;
}

function asSeverity(raw: unknown): HypothesisLadderSeverity | null {
  if (typeof raw !== "string") return null;
  return VALID_SEVERITIES.has(raw)
    ? (raw as HypothesisLadderSeverity)
    : null;
}

function asProbability(raw: unknown): HypothesisLadderProbability | null {
  if (typeof raw !== "string") return null;
  return VALID_PROBABILITIES.has(raw)
    ? (raw as HypothesisLadderProbability)
    : null;
}

export function extractHypothesisLadders(
  args: ExtractHypothesisLaddersArgs,
): HypothesisLadderDraft[] {
  const {
    spaceId,
    recommendation,
    entityNames,
    sourceStrategyVersion = null,
  } = args;

  const drafts: HypothesisLadderDraft[] = [];
  const seenClaims = new Set<string>();

  const preMortem = (recommendation.pre_mortem ?? []) as Array<{
    category?: unknown;
    narrative?: unknown;
    early_warnings?: unknown;
    severity?: unknown;
    probability?: unknown;
    assumption_exposed?: unknown;
    related_entity_ids?: unknown;
  }>;

  for (const pm of preMortem) {
    const claim =
      typeof pm.assumption_exposed === "string"
        ? pm.assumption_exposed.trim()
        : "";
    if (!claim) continue;

    // Dedupe by lowercased claim — the LLM occasionally repeats the
    // same assumption across multiple pre_mortem entries with slightly
    // different framings. Keep first.
    const dedupKey = claim.toLowerCase();
    if (seenClaims.has(dedupKey)) continue;
    seenClaims.add(dedupKey);

    // Mechanism chain — walk related_entity_ids and resolve names.
    // The pre_mortem schema doesn't impose ordering on the array, so
    // the rendered chain reads in declaration order. Future enhancement
    // (separate ticket): topologically sort using KG edges so the
    // chain reads "trigger → mediator → outcome" deterministically.
    const ridsRaw = pm.related_entity_ids;
    const rids = Array.isArray(ridsRaw)
      ? ridsRaw.filter((s): s is string => typeof s === "string")
      : [];
    const mechanism_chain: MechanismChainStep[] = rids.map((eid, idx) => ({
      entity_id: eid,
      entity_name: entityNames?.get(eid) ?? eid,
      role:
        idx === 0
          ? "trigger"
          : idx === rids.length - 1 && rids.length > 1
            ? "outcome"
            : rids.length > 2
              ? "mediator"
              : undefined,
    }));

    // Falsifier — join early_warnings into a single observable string.
    // pre_mortem.early_warnings is "observable signs in week 1-4", which
    // is exactly Popperian falsification semantics — what would we see
    // if the claim is wrong?
    const ewRaw = pm.early_warnings;
    const earlyWarnings = Array.isArray(ewRaw)
      ? ewRaw.filter((s): s is string => typeof s === "string")
      : [];
    const falsifier =
      earlyWarnings.length > 0
        ? earlyWarnings.join(" · ").slice(0, 500)
        : null;

    drafts.push({
      space_id: spaceId,
      source: "llm",
      source_strategy_version: sourceStrategyVersion,
      source_category: asCategory(pm.category),
      claim: claim.slice(0, 800),
      mechanism_chain,
      falsifier,
      verdict: "pending",
      verdict_rationale: null,
      severity: asSeverity(pm.severity),
      probability: asProbability(pm.probability),
      related_entity_ids: rids,
    });
  }

  return drafts;
}
