/**
 * Layer 8: Field Intersection Computation
 *
 * Identifies where multiple high-influence entities' fields overlap.
 * These overlaps reveal emergent system properties:
 * - Synergistic: both entities push the overlap zone in the same direction
 * - Antagonistic: entities push in opposing directions (inherent tradeoff)
 * - Complex: mixed signals within the overlap zone
 */

import type { InteractionField, FieldIntersection } from "@/types/interactions";

/**
 * Compute field intersections between top entities.
 * Only considers entities in the top quartile by field_strength.
 */
export function computeFieldIntersections(
  fields: InteractionField[]
): FieldIntersection[] {
  if (fields.length < 2) return [];

  // Top quartile by field_strength (minimum 2, maximum 10)
  const cutoff = Math.max(2, Math.min(10, Math.ceil(fields.length * 0.25)));
  const topFields = fields.slice(0, cutoff); // already sorted by field_strength descending

  const intersections: FieldIntersection[] = [];

  for (let i = 0; i < topFields.length; i++) {
    for (let j = i + 1; j < topFields.length; j++) {
      const a = topFields[i];
      const b = topFields[j];

      // Build influence maps for overlap detection
      const aTargets = new Map<string, number>(); // entity_id → net_influence
      for (const inf of a.top_influences) {
        aTargets.set(inf.target_entity_id, inf.net_influence);
      }

      const bTargets = new Map<string, number>();
      for (const inf of b.top_influences) {
        bTargets.set(inf.target_entity_id, inf.net_influence);
      }

      // Find overlap: entities influenced by BOTH a and b
      const overlapIds: string[] = [];
      const overlapNames: string[] = [];
      let synergisticCount = 0;
      let antagonisticCount = 0;
      let combinedInfluence = 0;

      for (const [targetId, aInf] of aTargets) {
        const bInf = bTargets.get(targetId);
        if (bInf === undefined) continue;

        // Skip if the overlap entity is one of the two field sources
        if (targetId === a.entity_id || targetId === b.entity_id) continue;

        overlapIds.push(targetId);
        const targetInfA = a.top_influences.find((inf) => inf.target_entity_id === targetId);
        overlapNames.push(targetInfA?.target_name ?? targetId);

        combinedInfluence += Math.abs(aInf) + Math.abs(bInf);

        // Same sign = synergistic, opposite = antagonistic
        if ((aInf > 0 && bInf > 0) || (aInf < 0 && bInf < 0)) {
          synergisticCount++;
        } else {
          antagonisticCount++;
        }
      }

      if (overlapIds.length === 0) continue;

      // Classify
      let classification: FieldIntersection["classification"];
      if (antagonisticCount === 0) classification = "synergistic";
      else if (synergisticCount === 0) classification = "antagonistic";
      else classification = "complex";

      // Generate insight
      const insight = generateIntersectionInsight(
        a, b, overlapNames, classification, combinedInfluence
      );

      intersections.push({
        entity_a_id: a.entity_id,
        entity_a_name: a.entity_name,
        entity_b_id: b.entity_id,
        entity_b_name: b.entity_name,
        overlap_entities: overlapIds,
        overlap_names: overlapNames,
        classification,
        combined_influence: Math.round(combinedInfluence * 100) / 100,
        insight,
      });
    }
  }

  // Sort by combined_influence descending, take top 8
  return intersections
    .sort((a, b) => b.combined_influence - a.combined_influence)
    .slice(0, 8);
}

function generateIntersectionInsight(
  a: InteractionField,
  b: InteractionField,
  overlapNames: string[],
  classification: FieldIntersection["classification"],
  combinedInfluence: number
): string {
  const overlapStr = overlapNames.length <= 3
    ? overlapNames.join(", ")
    : `${overlapNames.slice(0, 2).join(", ")} and ${overlapNames.length - 2} others`;

  switch (classification) {
    case "synergistic":
      return `${a.entity_name} and ${b.entity_name} both influence ${overlapStr} in the same direction — changes to either compound through the overlap zone.`;
    case "antagonistic":
      return `${a.entity_name} and ${b.entity_name} exert opposing forces on ${overlapStr} — this is an inherent tension that must be managed, not resolved.`;
    case "complex":
      return `${a.entity_name} and ${b.entity_name} create a mixed-signal zone around ${overlapStr} — some effects align while others conflict.`;
  }
}
