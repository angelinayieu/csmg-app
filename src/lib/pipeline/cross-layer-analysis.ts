/**
 * Cross-Layer Analysis Engine
 *
 * Deterministic computation (no LLM) that analyzes relationships BETWEEN
 * knowledge layers:
 *
 *   KG 1 (internal)    ↔  KG 2 (conceptual)  ↔  KG 3 (external)
 *   User Assets           Concept Model           Deep Research
 *
 * Discovers:
 *   1. Validation chains: external evidence → conceptual mechanism → internal asset
 *   2. Layer tensions: where external evidence contradicts internal assumptions
 *   3. Layer density metrics: entity/edge counts per layer
 *   4. Cross-layer edge counts by pair
 */

import type { Entity, Edge } from "@/types";
import type {
  CrossLayerAnalysisResult,
  ValidationChain,
  LayerTension,
} from "@/types/layer";
import {
  isUserLayer,
  isConceptualLayer,
  isExternalLayer,
  crossLayerKey,
} from "@/lib/intelligence/layer-semantics";

// ── Main Entry Point ──

export function computeCrossLayerAnalysis(
  entities: Entity[],
  edges: Edge[],
): CrossLayerAnalysisResult {
  // Build lookup maps
  const entityById = new Map<string, Entity>();
  const entityByDisplayId = new Map<string, Entity>();
  for (const e of entities) {
    entityById.set(e.id, e);
    entityByDisplayId.set(e.entity_id, e);
  }

  // Build adjacency with edge references
  const adj = new Map<string, Array<{ targetId: string; edge: Edge }>>();
  for (const edge of edges) {
    const srcId = edge.source_entity_id;
    const tgtId = edge.target_entity_id;
    if (!adj.has(srcId)) adj.set(srcId, []);
    if (!adj.has(tgtId)) adj.set(tgtId, []);
    adj.get(srcId)!.push({ targetId: tgtId, edge });
    adj.get(tgtId)!.push({ targetId: srcId, edge });
  }

  // 1. Layer density
  const layerDensity = computeLayerDensity(entities, edges);

  // 2. Cross-layer edge counts
  const crossLayerEdges = computeCrossLayerEdgeCounts(edges, entityById);

  // 3. Validation chains
  const validationChains = findValidationChains(
    entities,
    edges,
    entityById,
    adj,
  );

  // 4. Layer tensions
  const layerTensions = findLayerTensions(
    entities,
    edges,
    entityById,
    adj,
  );

  return {
    validation_chains: validationChains,
    layer_tensions: layerTensions,
    layer_density: layerDensity,
    cross_layer_edges: crossLayerEdges,
  };
}

// ── Layer Density ──

function computeLayerDensity(
  entities: Entity[],
  edges: Edge[],
): Record<string, { entities: number; edges: number; density: number }> {
  const layers = ["internal", "conceptual", "external", "bridge"];
  const result: Record<string, { entities: number; edges: number; density: number }> = {};

  for (const layer of layers) {
    const layerEntities = entities.filter(
      (e) => (e.knowledge_layer ?? "internal") === layer
    );
    const layerEdges = edges.filter(
      (e) => (e.knowledge_layer ?? "internal") === layer
    );
    const n = layerEntities.length;
    const maxEdges = n > 1 ? (n * (n - 1)) / 2 : 1;
    result[layer] = {
      entities: n,
      edges: layerEdges.length,
      density: n > 1 ? layerEdges.length / maxEdges : 0,
    };
  }

  return result;
}

// ── Cross-Layer Edge Counts ──

function computeCrossLayerEdgeCounts(
  edges: Edge[],
  entityById: Map<string, Entity>,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const edge of edges) {
    const src = entityById.get(edge.source_entity_id);
    const tgt = entityById.get(edge.target_entity_id);
    if (!src || !tgt) continue;

    const srcLayer = src.knowledge_layer ?? "internal";
    const tgtLayer = tgt.knowledge_layer ?? "internal";
    if (srcLayer === tgtLayer) continue;

    const key = crossLayerKey(srcLayer, tgtLayer);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

// ── Validation Chains ──
// BFS from external entities through conceptual → internal, max depth 3

function findValidationChains(
  entities: Entity[],
  _edges: Edge[],
  entityById: Map<string, Entity>,
  adj: Map<string, Array<{ targetId: string; edge: Edge }>>,
): ValidationChain[] {
  const externalEntities = entities.filter((e) =>
    isExternalLayer(e.knowledge_layer)
  );
  const chains: ValidationChain[] = [];
  let chainId = 0;

  for (const ext of externalEntities) {
    // BFS from external entity, looking for paths to internal entities
    // through conceptual intermediaries
    const neighbors = adj.get(ext.id) ?? [];

    for (const { targetId: mid1Id, edge: edge1 } of neighbors) {
      const mid1 = entityById.get(mid1Id);
      if (!mid1) continue;

      // Direct external → internal (no conceptual intermediary)
      if (isUserLayer(mid1.knowledge_layer)) {
        chains.push({
          id: `vc_${chainId++}`,
          external_entity: { id: ext.entity_id, name: ext.name },
          conceptual_entity: null,
          internal_entity: { id: mid1.entity_id, name: mid1.name },
          bridge_edges: [
            {
              id: edge1.id,
              relationship_type: edge1.relationship_type,
              confidence: edge1.confidence,
            },
          ],
          direction: inferDirection(edge1),
          chain_confidence: edge1.confidence,
        });
        continue;
      }

      // External → conceptual → internal
      if (isConceptualLayer(mid1.knowledge_layer)) {
        const mid1Neighbors = adj.get(mid1Id) ?? [];
        for (const { targetId: mid2Id, edge: edge2 } of mid1Neighbors) {
          if (mid2Id === ext.id) continue; // Don't go back
          const mid2 = entityById.get(mid2Id);
          if (!mid2 || !isUserLayer(mid2.knowledge_layer)) continue;

          chains.push({
            id: `vc_${chainId++}`,
            external_entity: { id: ext.entity_id, name: ext.name },
            conceptual_entity: { id: mid1.entity_id, name: mid1.name },
            internal_entity: { id: mid2.entity_id, name: mid2.name },
            bridge_edges: [
              {
                id: edge1.id,
                relationship_type: edge1.relationship_type,
                confidence: edge1.confidence,
              },
              {
                id: edge2.id,
                relationship_type: edge2.relationship_type,
                confidence: edge2.confidence,
              },
            ],
            direction: inferDirection(edge1),
            chain_confidence: edge1.confidence * edge2.confidence,
          });
        }
      }
    }
  }

  // Sort by chain_confidence descending, take top 15
  chains.sort((a, b) => b.chain_confidence - a.chain_confidence);
  return chains.slice(0, 15);
}

// ── Layer Tensions ──
// Internal assumptions contradicted by external evidence

function findLayerTensions(
  entities: Entity[],
  edges: Edge[],
  entityById: Map<string, Entity>,
  adj: Map<string, Array<{ targetId: string; edge: Edge }>>,
): LayerTension[] {
  const tensions: LayerTension[] = [];
  let tensionId = 0;

  // Find internal entities that have both:
  // (a) High-confidence internal edges (assumptions about how system works)
  // (b) Low-confidence or negative-polarity bridge/cross-layer edges to external entities
  const internalEntities = entities.filter((e) =>
    isUserLayer(e.knowledge_layer)
  );

  for (const ie of internalEntities) {
    const neighbors = adj.get(ie.id) ?? [];

    // Find high-confidence internal assertions
    const internalAssertions = neighbors.filter(({ edge }) => {
      const other = entityById.get(
        edge.source_entity_id === ie.id
          ? edge.target_entity_id
          : edge.source_entity_id
      );
      return (
        other &&
        isUserLayer(other.knowledge_layer) &&
        edge.confidence >= 0.7 &&
        (edge.dimension === "causal" || edge.dimension === "functional")
      );
    });

    if (internalAssertions.length === 0) continue;

    // Find external connections (direct or via bridge/conceptual)
    const externalConnections = neighbors.filter(({ edge }) => {
      const other = entityById.get(
        edge.source_entity_id === ie.id
          ? edge.target_entity_id
          : edge.source_entity_id
      );
      return other && isExternalLayer(other.knowledge_layer);
    });

    // Also check via conceptual intermediaries
    const conceptualNeighborIds = neighbors
      .map(({ targetId }) => entityById.get(targetId))
      .filter(
        (e): e is Entity => !!e && isConceptualLayer(e.knowledge_layer)
      )
      .map((e) => e.id);

    for (const cnId of conceptualNeighborIds) {
      const cnNeighbors = adj.get(cnId) ?? [];
      for (const { edge } of cnNeighbors) {
        const other = entityById.get(
          edge.source_entity_id === cnId
            ? edge.target_entity_id
            : edge.source_entity_id
        );
        if (other && isExternalLayer(other.knowledge_layer)) {
          externalConnections.push({
            targetId: other.id,
            edge,
          });
        }
      }
    }

    // Check for tension: external evidence that challenges internal assumptions
    for (const { targetId: extId, edge: extEdge } of externalConnections) {
      const extEntity = entityById.get(extId);
      if (!extEntity) continue;

      // Tension indicators: low confidence, negative polarity, or tradeoff
      const isTense =
        extEdge.confidence < 0.5 ||
        extEdge.polarity === "negative" ||
        extEdge.polarity === "conditional" ||
        extEdge.is_tradeoff;

      if (!isTense) continue;

      // Find the strongest internal assertion to contrast against
      const strongest = internalAssertions.reduce(
        (best, curr) =>
          curr.edge.confidence > best.edge.confidence ? curr : best,
        internalAssertions[0]
      );
      const strongestTarget = entityById.get(strongest.targetId);

      // Find mediating conceptual entity if any
      let mediator: { entity_id: string; name: string } | null = null;
      for (const cnId of conceptualNeighborIds) {
        const cnNeighbors = adj.get(cnId) ?? [];
        const connectsToExt = cnNeighbors.some(
          ({ targetId }) => targetId === extId
        );
        if (connectsToExt) {
          const cn = entityById.get(cnId);
          if (cn) {
            mediator = { entity_id: cn.entity_id, name: cn.name };
            break;
          }
        }
      }

      tensions.push({
        id: `lt_${tensionId++}`,
        internal_claim: {
          entity_id: ie.entity_id,
          name: ie.name,
          claim: strongestTarget
            ? `${ie.name} ${strongest.edge.relationship_type} ${strongestTarget.name} (confidence: ${strongest.edge.confidence})`
            : `${ie.name} has high-confidence internal assertion`,
        },
        external_counter: {
          entity_id: extEntity.entity_id,
          name: extEntity.name,
          claim: `${extEntity.name} ${extEdge.polarity === "negative" ? "contradicts" : "questions"} via ${extEdge.relationship_type} (confidence: ${extEdge.confidence})`,
        },
        mediating_mechanism: mediator,
        severity: extEdge.polarity === "negative"
          ? "high"
          : extEdge.confidence < 0.3
            ? "high"
            : "medium",
      });
    }
  }

  // Dedup by internal+external entity pair, keep highest severity
  const seen = new Map<string, LayerTension>();
  for (const t of tensions) {
    const key = `${t.internal_claim.entity_id}↔${t.external_counter.entity_id}`;
    const existing = seen.get(key);
    if (
      !existing ||
      severityRank(t.severity) > severityRank(existing.severity)
    ) {
      seen.set(key, t);
    }
  }

  return [...seen.values()].slice(0, 10);
}

// ── Helpers ──

function inferDirection(
  edge: Edge
): "validates" | "challenges" | "neutral" {
  if (edge.polarity === "negative") return "challenges";
  if (edge.polarity === "positive" && edge.confidence >= 0.6)
    return "validates";
  return "neutral";
}

function severityRank(severity: string): number {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}
