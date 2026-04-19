/**
 * Intelligence Tier Classifier
 *
 * Classifies external entities into two tiers:
 * - "embedded": Directly connected to user's graph via strong bridges — high strategic weight
 * - "observatory": Landscape context without strong bridges — useful for awareness
 *
 * Classification is deterministic (no LLM call) and runs after research + bridge creation.
 * Tiers are stored in entity provenance JSONB — no schema migration needed.
 */

import type { Entity, Edge } from "@/types";
import type { IntelligenceTier } from "@/types/intelligence";

// ── Types ──

export interface TierClassification {
  entity_id: string;
  tier: IntelligenceTier;
  confidence: number;
  reasoning: string;
  promotion_eligible: boolean;
}

export interface TierClassificationResult {
  classifications: TierClassification[];
  embedded_count: number;
  observatory_count: number;
  promotion_candidate_count: number;
}

// ── Helpers ──

function getEntityBridges(entityId: string, bridgeEdges: Edge[]): Edge[] {
  return bridgeEdges.filter(
    (e) => e.source_entity_id === entityId || e.target_entity_id === entityId
  );
}

function getProvenance(entity: Entity): Record<string, unknown> {
  return (entity.provenance as Record<string, unknown>) ?? {};
}

// ── Classification Logic ──

/**
 * Classify a single external entity into "embedded" or "observatory" tier.
 *
 * Entity is "embedded" if ANY of:
 * 1. Has >= 1 bridge edge with strength >= 0.6
 * 2. Has >= 2 bridge edges of any strength
 * 3. Any bridge edge has relationship_type containing "validates" or "challenges"
 * 4. Is category "competitor" or "risk_pattern" AND has connection_hints pointing
 *    to entities flagged is_leverage_point or is_risk_point
 * 5. Was created by signal materialization (provenance.source_type === "signal_materialization")
 */
export function classifySingleEntity(
  entity: Entity,
  entityBridges: Edge[],
  internalEntities: Entity[]
): TierClassification {
  const prov = getProvenance(entity);
  const reasons: string[] = [];
  let criteriaMatched = 0;

  // Criterion 1: Strong bridge (strength >= 0.6)
  const strongBridges = entityBridges.filter(
    (e) => typeof e.strength === "number" && e.strength >= 0.6
  );
  if (strongBridges.length > 0) {
    criteriaMatched++;
    reasons.push(`${strongBridges.length} strong bridge(s) (strength >= 0.6)`);
  }

  // Criterion 2: Multiple bridges (>= 2)
  if (entityBridges.length >= 2) {
    criteriaMatched++;
    reasons.push(`${entityBridges.length} total bridges`);
  }

  // Criterion 3: Validates or challenges bridge type
  const validatesOrChallenges = entityBridges.filter(
    (e) =>
      e.relationship_type?.includes("validates") ||
      e.relationship_type?.includes("challenges")
  );
  if (validatesOrChallenges.length > 0) {
    criteriaMatched++;
    reasons.push(
      `bridge type: ${validatesOrChallenges.map((e) => e.relationship_type).join(", ")}`
    );
  }

  // Criterion 4: Competitor/risk_pattern connected to leverage/risk points
  const category = prov.category as string | undefined;
  if (category === "competitor" || category === "risk_pattern") {
    const connectionHints = (prov.connection_hints as string[]) ?? [];
    const leverageIds = new Set(
      internalEntities
        .filter((e) => e.is_leverage_point || e.is_risk_point)
        .map((e) => e.entity_id)
    );
    const hitsLeverage = connectionHints.some((h) => leverageIds.has(h));
    if (hitsLeverage) {
      criteriaMatched++;
      reasons.push(`${category} connected to leverage/risk point`);
    }
  }

  // Criterion 5: Signal materialization origin
  if (prov.source_type === "signal_materialization") {
    criteriaMatched++;
    reasons.push("materialized from hidden signal");
  }

  // Determine tier
  const isEmbedded = criteriaMatched > 0;

  // Determine promotion eligibility for observatory entities
  let promotionEligible = false;
  if (!isEmbedded) {
    const hasBridge = entityBridges.length > 0;
    const hasHints = ((prov.connection_hints as string[]) ?? []).length > 0;
    promotionEligible = hasBridge || hasHints;
  }

  // Confidence scoring
  let confidence: number;
  if (criteriaMatched >= 5) confidence = 0.95;
  else if (criteriaMatched >= 3) confidence = 0.8;
  else if (criteriaMatched >= 1) confidence = 0.6;
  else if (promotionEligible) confidence = 0.4;
  else confidence = 0.3;

  return {
    entity_id: entity.entity_id,
    tier: isEmbedded ? "embedded" : "observatory",
    confidence,
    reasoning: isEmbedded
      ? `Embedded: ${reasons.join("; ")}`
      : promotionEligible
        ? `Observatory (promotion eligible): has weak connections`
        : `Observatory: no significant bridges to internal graph`,
    promotion_eligible: promotionEligible,
  };
}

/**
 * Classify all external entities into intelligence tiers.
 * Respects manual overrides: if provenance.intelligence_tier_manual is set, skip.
 */
export function classifyIntelligenceTiers(
  externalEntities: Entity[],
  bridgeEdges: Edge[],
  internalEntities: Entity[]
): TierClassificationResult {
  const classifications: TierClassification[] = [];
  let embeddedCount = 0;
  let observatoryCount = 0;
  let promotionCount = 0;

  for (const entity of externalEntities) {
    const prov = getProvenance(entity);

    // Respect manual tier override
    if (prov.intelligence_tier_manual) {
      const manualTier = prov.intelligence_tier_manual as IntelligenceTier;
      classifications.push({
        entity_id: entity.entity_id,
        tier: manualTier,
        confidence: 1.0,
        reasoning: "Manually classified by user",
        promotion_eligible: false,
      });
      if (manualTier === "embedded") embeddedCount++;
      else observatoryCount++;
      continue;
    }

    const entityBridges = getEntityBridges(entity.entity_id, bridgeEdges);
    const classification = classifySingleEntity(
      entity,
      entityBridges,
      internalEntities
    );

    classifications.push(classification);
    if (classification.tier === "embedded") embeddedCount++;
    else observatoryCount++;
    if (classification.promotion_eligible) promotionCount++;
  }

  return {
    classifications,
    embedded_count: embeddedCount,
    observatory_count: observatoryCount,
    promotion_candidate_count: promotionCount,
  };
}
