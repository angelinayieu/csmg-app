/**
 * Sample Extractor
 *
 * Selects a representative subset of entities and edges from the full graph
 * for use in test lab simulations. The sample should be small enough to fit
 * in a prompt but representative enough that simulation results are meaningful.
 */

import type { Entity, Edge } from "@/types";

export function extractSampleData(params: {
  entities: Entity[];
  edges: Edge[];
  relatedEntityIds: string[];
  maxEntities?: number;
  maxEdges?: number;
}): { sampleEntities: Entity[]; sampleEdges: Edge[] } {
  const { entities, edges, relatedEntityIds, maxEntities = 5, maxEdges = 10 } =
    params;

  const entityMap = new Map(entities.map((e) => [e.entity_id, e]));
  const selectedIds = new Set<string>();

  // ── 1. Start with related entities (up to 2) ──
  for (const id of relatedEntityIds.slice(0, 2)) {
    if (entityMap.has(id)) {
      selectedIds.add(id);
    }
  }

  // ── Helper: sort by centrality (lower rank = higher centrality; nulls last) ──
  const byCentrality = (a: Entity, b: Entity): number => {
    const aRank = a.centrality_rank ?? Infinity;
    const bRank = b.centrality_rank ?? Infinity;
    return aRank - bRank;
  };

  // ── 2. Add 1 leverage point (prefer highest centrality) ──
  const leveragePoints = entities
    .filter((e) => e.is_leverage_point && !selectedIds.has(e.entity_id))
    .sort(byCentrality);

  if (leveragePoints.length > 0) {
    selectedIds.add(leveragePoints[0].entity_id);
  }

  // ── 3. Add 1 risk point (prefer highest centrality) ──
  const riskPoints = entities
    .filter((e) => e.is_risk_point && !selectedIds.has(e.entity_id))
    .sort(byCentrality);

  if (riskPoints.length > 0) {
    selectedIds.add(riskPoints[0].entity_id);
  }

  // ── 4. Fill remaining slots with connected entities ──
  if (selectedIds.size < maxEntities) {
    // Find entities connected to already-selected ones via edges
    const connectedCandidates: Entity[] = [];

    for (const edge of edges) {
      const otherId = selectedIds.has(edge.source_entity_id)
        ? edge.target_entity_id
        : selectedIds.has(edge.target_entity_id)
          ? edge.source_entity_id
          : null;

      if (otherId && !selectedIds.has(otherId)) {
        const entity = entityMap.get(otherId);
        if (entity) connectedCandidates.push(entity);
      }
    }

    // Deduplicate and sort by centrality
    const seen = new Set<string>();
    const uniqueCandidates = connectedCandidates.filter((e) => {
      if (seen.has(e.entity_id)) return false;
      seen.add(e.entity_id);
      return true;
    });
    uniqueCandidates.sort(byCentrality);

    for (const candidate of uniqueCandidates) {
      if (selectedIds.size >= maxEntities) break;
      selectedIds.add(candidate.entity_id);
    }
  }

  // ── 5. Cap at maxEntities ──
  const sampleEntities = entities.filter((e) => selectedIds.has(e.entity_id));

  // ── 6. Select edges connecting pairs of selected entities ──
  // Prefer diverse relationship_type values
  const candidateEdges = edges.filter(
    (e) =>
      selectedIds.has(e.source_entity_id) && selectedIds.has(e.target_entity_id)
  );

  // Sort to prefer diverse relationship types: group by type, interleave
  const edgesByType = new Map<string, Edge[]>();
  for (const edge of candidateEdges) {
    const group = edgesByType.get(edge.relationship_type) ?? [];
    group.push(edge);
    edgesByType.set(edge.relationship_type, group);
  }

  const sampleEdges: Edge[] = [];
  const typeQueues = Array.from(edgesByType.values());
  let typeIdx = 0;

  while (sampleEdges.length < maxEdges && typeQueues.some((q) => q.length > 0)) {
    const queue = typeQueues[typeIdx % typeQueues.length];
    if (queue.length > 0) {
      sampleEdges.push(queue.shift()!);
    }
    typeIdx++;
  }

  return { sampleEntities, sampleEdges };
}
