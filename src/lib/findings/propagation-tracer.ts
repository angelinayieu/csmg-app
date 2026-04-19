/**
 * Propagation Tracer — Pure compute, no LLM calls.
 *
 * Walks the entity graph from a finding's source entities upward through
 * L4→L3→L2→L1 by following edges and entity importance tiers.
 * Returns a PropagationStep[] showing how a deep insight cascades
 * to surface-level outcomes.
 */

import type { Entity, Edge } from "@/types";
import type { ConvergenceDepth } from "@/types/interactions";
import type { PropagationStep } from "@/types/finding";

const IMPORTANCE_ORDER: ConvergenceDepth[] = ["L4", "L3", "L2", "L1"];

const IMPORTANCE_TO_LAYER: Record<string, ConvergenceDepth> = {
  moderate: "L4",
  important: "L3",
  critical: "L2",
  fundamental: "L1",
};

/**
 * Trace propagation path from a source entity upward through layers.
 * Returns steps from deepest layer (source) to shallowest (L1 outcome).
 */
export function tracePropagation(
  sourceEntityId: string,
  entities: Entity[],
  edges: Edge[],
): PropagationStep[] {
  const entityById = new Map<string, Entity>();
  for (const e of entities) {
    entityById.set(e.id, e);
    if (e.entity_id) entityById.set(e.entity_id, e);
  }

  // Build outgoing edge map (source → targets)
  const outgoing = new Map<string, Array<{ target: Entity; edge: Edge }>>();
  for (const edge of edges) {
    const target = entityById.get(edge.target_entity_id);
    if (!target) continue;
    if (!outgoing.has(edge.source_entity_id)) outgoing.set(edge.source_entity_id, []);
    outgoing.get(edge.source_entity_id)!.push({ target, edge });
  }

  // Also build incoming (reverse) for bidirectional traversal
  const incoming = new Map<string, Array<{ source: Entity; edge: Edge }>>();
  for (const edge of edges) {
    const source = entityById.get(edge.source_entity_id);
    if (!source) continue;
    if (!incoming.has(edge.target_entity_id)) incoming.set(edge.target_entity_id, []);
    incoming.get(edge.target_entity_id)!.push({ source, edge });
  }

  const sourceEntity = entityById.get(sourceEntityId);
  if (!sourceEntity) return [];

  const sourceLayer = IMPORTANCE_TO_LAYER[sourceEntity.importance ?? "moderate"] ?? "L3";
  const sourceLayerIndex = IMPORTANCE_ORDER.indexOf(sourceLayer);

  // Build path from source layer upward to L1
  const steps: PropagationStep[] = [];
  const visited = new Set<string>();

  // Add the source entity as the first step
  steps.push({
    layer: sourceLayer,
    label: sourceEntity.name,
    entity_id: sourceEntity.id,
    status: "verified",
  });
  visited.add(sourceEntity.id);

  // Walk upward through layers
  let currentEntityId = sourceEntity.id;
  for (let i = sourceLayerIndex + 1; i < IMPORTANCE_ORDER.length; i++) {
    const targetLayer = IMPORTANCE_ORDER[i];
    const targetImportance = Object.entries(IMPORTANCE_TO_LAYER).find(
      ([, l]) => l === targetLayer,
    )?.[0];
    if (!targetImportance) continue;

    // Find connected entities at this layer
    const candidates: Entity[] = [];

    // Check outgoing edges
    const outEdges = outgoing.get(currentEntityId) ?? [];
    for (const { target } of outEdges) {
      if (!visited.has(target.id) && target.importance === targetImportance) {
        candidates.push(target);
      }
    }

    // Check incoming edges (propagation can flow in either direction)
    const inEdges = incoming.get(currentEntityId) ?? [];
    for (const { source } of inEdges) {
      if (!visited.has(source.id) && source.importance === targetImportance) {
        candidates.push(source);
      }
    }

    if (candidates.length > 0) {
      // Pick the most central candidate
      const best = candidates.sort(
        (a, b) => (a.centrality_rank ?? 999) - (b.centrality_rank ?? 999),
      )[0];

      steps.push({
        layer: targetLayer,
        label: best.name,
        entity_id: best.id,
        status: "verified",
      });
      visited.add(best.id);
      currentEntityId = best.id;
    } else {
      // No direct connection at this layer — mark as inferred
      steps.push({
        layer: targetLayer,
        label: `${targetLayer} propagation`,
        status: "inferred",
      });
    }
  }

  return steps;
}

/**
 * Batch compute propagation paths for all findings.
 * Returns a map of finding source entity ID → PropagationStep[].
 */
export function batchTracePropagation(
  sourceEntityIds: string[],
  entities: Entity[],
  edges: Edge[],
): Map<string, PropagationStep[]> {
  const results = new Map<string, PropagationStep[]>();
  for (const id of sourceEntityIds) {
    results.set(id, tracePropagation(id, entities, edges));
  }
  return results;
}
