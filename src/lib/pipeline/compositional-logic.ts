/**
 * Compositional Logic Detection
 *
 * Detects emergent structures from entity combinations across layers.
 * Builds on intersection detection but looks for COMPOSITIONAL patterns:
 * entities that COMBINE to create capabilities neither has alone.
 *
 * This implements the "□ + △ = ⬠" pattern from the 3-layer KG architecture:
 * when sub-components from different parent entities share mechanisms,
 * those parents compose into emergent structures.
 */

import type { Entity } from "@/types";
import type {
  ProbabilitySpace,
  SpaceIntersection,
} from "@/types/probability-space";
import type { CompositionResult } from "@/types/layer";
import type { KnowledgeLayer } from "@/types/layer";

// ── Main Entry ──

export function detectCompositions(
  intersections: SpaceIntersection[],
  spaces: ProbabilitySpace[],
  entities: Entity[],
): CompositionResult[] {
  if (intersections.length === 0 || spaces.length === 0) return [];

  const entityById = new Map<string, Entity>();
  const entityByDisplayId = new Map<string, Entity>();
  for (const e of entities) {
    entityById.set(e.id, e);
    entityByDisplayId.set(e.entity_id, e);
  }

  const spaceById = new Map<string, ProbabilitySpace>();
  for (const s of spaces) {
    spaceById.set(s.id, s);
  }

  const candidates: CompositionResult[] = [];
  let compId = 0;

  // Filter intersections to those with sufficient shared nodes and novelty
  const qualifying = intersections.filter(
    (i) => i.shared_nodes.length >= 2 && i.novelty_score > 0.4
  );

  for (const intersection of qualifying) {
    const spaceA = spaceById.get(intersection.space_a_id);
    const spaceB = spaceById.get(intersection.space_b_id);
    if (!spaceA || !spaceB) continue;

    // Extract parent entities for each space
    const entityA =
      entityByDisplayId.get(spaceA.source_entity_id) ??
      entityByDisplayId.get(spaceA.target_entity_id);
    const entityB =
      entityByDisplayId.get(spaceB.source_entity_id) ??
      entityByDisplayId.get(spaceB.target_entity_id);
    if (!entityA || !entityB) continue;
    if (entityA.entity_id === entityB.entity_id) continue; // Same entity, not composition

    // Determine layers
    const layerA = (entityA.knowledge_layer ?? "internal") as KnowledgeLayer;
    const layerB = (entityB.knowledge_layer ?? "internal") as KnowledgeLayer;
    const isCrossLayer = layerA !== layerB;

    // Shared mechanisms are the sub-components that create the composition
    const sharedMechanisms = intersection.shared_nodes.map((sn) => ({
      name: sn.name,
      from_space_a: spaceA.source_entity_name + " → " + spaceA.target_entity_name,
      from_space_b: spaceB.source_entity_name + " → " + spaceB.target_entity_name,
      similarity: sn.similarity,
    }));

    // Score: novelty × impact × cross-layer bonus × shared density
    const crossLayerBonus = isCrossLayer ? 1.3 : 1.0;
    const sharedDensity = Math.min(1, intersection.shared_nodes.length / 3);
    const compositionScore =
      intersection.novelty_score *
      intersection.impact_score *
      crossLayerBonus *
      sharedDensity;

    // Build emergent label from shared mechanism names
    const mechanismNames = sharedMechanisms
      .map((m) => m.name)
      .slice(0, 3)
      .join(", ");
    const emergentLabel = `${entityA.name} × ${entityB.name}`;
    const emergentDescription = `Shared mechanisms (${mechanismNames}) create an emergent connection between ${entityA.name} and ${entityB.name}`;

    candidates.push({
      id: `comp_${compId++}`,
      components: [
        {
          entity_id: entityA.entity_id,
          name: entityA.name,
          layer: layerA,
          role: "contributor",
        },
        {
          entity_id: entityB.entity_id,
          name: entityB.name,
          layer: layerB,
          role: "contributor",
        },
      ],
      emergent_label: emergentLabel,
      emergent_description: emergentDescription,
      mechanism: `Compositional via ${intersection.shared_nodes.length} shared sub-component(s): ${mechanismNames}`,
      confidence: Math.min(
        intersection.novelty_score,
        intersection.impact_score,
        0.9
      ),
      source_intersection_ids: [intersection.id],
      composition_score: compositionScore,
    });
  }

  // Sort by composition score, return top 10
  candidates.sort((a, b) => b.composition_score - a.composition_score);
  return candidates.slice(0, 10);
}
