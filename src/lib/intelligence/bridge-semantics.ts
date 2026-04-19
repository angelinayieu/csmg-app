/**
 * Bridge-Like Edge Semantics
 *
 * Central helper replacing scattered `knowledge_layer === "bridge"` checks.
 *
 * Problem: Discovered edges from intelligence-feedback.ts are materialized
 * with `knowledge_layer: "internal"`, making them invisible to bridge-count
 * metrics, ring assignment, and suggested-bridge suppression. This helper
 * recognizes bridge-LIKE edges from BOTH the knowledge_layer tag AND the
 * provenance.edge_role field.
 */

import type { Edge, Entity } from "@/types";
import type { EdgeRole, EdgeProvenanceV2 } from "@/types/intelligence-v2";
import { isUserOrConceptualLayer, isBridgeLayer } from "@/lib/intelligence/layer-semantics";

// ── Core predicate ──

/**
 * Returns true if an edge functions as a bridge between internal and external
 * entities, regardless of how it was originally tagged.
 *
 * Matches:
 * 1. knowledge_layer === "bridge" (original explicit bridges)
 * 2. provenance.edge_role in {"bridge", "discovered"} (feedback-loop edges)
 * 3. Cross-layer edges (one endpoint internal, other external/bridge)
 */
export function isBridgeLikeEdge(
  edge: Edge,
  entityLayerMap?: Map<string, string>
): boolean {
  // Early exit: expansion materialization edges (has_component, internal_pathway,
  // inherited_connection) are structural composition, NOT inter-domain bridges.
  // They connect parent entities to sub-components and should stay in internal edges.
  const edgeProv = edge.provenance as Record<string, unknown> | null;
  const isExpansionMat = edgeProv?.source_type === "expansion_materialization";
  const relType = edge.relationship_type ?? "";
  const isStructuralComposition =
    relType === "has_component" ||
    relType === "internal_pathway" ||
    relType === "inherited_connection";
  if (isExpansionMat || isStructuralComposition) return false;

  // Check 1: Explicit bridge tag
  if (edge.knowledge_layer === "bridge") return true;

  // Check 2: Provenance edge_role
  const prov = edgeProv;
  if (prov) {
    const edgeRole = prov.edge_role as EdgeRole | undefined;
    if (edgeRole === "bridge" || edgeRole === "discovered") return true;

    // Also check nested v2 provenance
    const v2 = prov.v2 as EdgeProvenanceV2 | undefined;
    if (v2?.edge_role === "bridge" || v2?.edge_role === "discovered") return true;
  }

  // Check 3: Cross-layer detection (requires entity layer map)
  // Any two DIFFERENT layers = cross-layer = bridge-like
  if (entityLayerMap) {
    const srcLayer = entityLayerMap.get(edge.source_entity_id);
    const tgtLayer = entityLayerMap.get(edge.target_entity_id);
    if (srcLayer && tgtLayer && srcLayer !== tgtLayer) {
      return true;
    }
  }

  return false;
}

/**
 * Filter all bridge-like edges from a full edge set.
 * More robust than `edges.filter(e => e.knowledge_layer === "bridge")`.
 */
export function getBridgeLikeEdges(
  edges: Edge[],
  entities: Entity[]
): Edge[] {
  // Build entity layer map for cross-layer detection
  const entityLayerMap = new Map<string, string>();
  for (const e of entities) {
    entityLayerMap.set(e.entity_id, e.knowledge_layer ?? "internal");
    entityLayerMap.set(e.id, e.knowledge_layer ?? "internal");
  }

  return edges.filter((edge) => isBridgeLikeEdge(edge, entityLayerMap));
}

/**
 * Get the set of external entity IDs that are bridged (have at least one
 * bridge-like edge connecting them to internal entities).
 */
export function getBridgedExternalIds(
  edges: Edge[],
  entities: Entity[]
): Set<string> {
  const bridgeLike = getBridgeLikeEdges(edges, entities);

  // Build sets for classification
  const externalIds = new Set<string>();
  const internalIds = new Set<string>();
  for (const e of entities) {
    const layer = e.knowledge_layer ?? "internal";
    if (layer === "external") {
      externalIds.add(e.entity_id);
      externalIds.add(e.id);
    } else if (isUserOrConceptualLayer(layer) || isBridgeLayer(layer)) {
      internalIds.add(e.entity_id);
      internalIds.add(e.id);
    }
  }

  const bridgedExternalEntityIds = new Set<string>();
  for (const edge of bridgeLike) {
    const srcIsExternal = externalIds.has(edge.source_entity_id);
    const tgtIsExternal = externalIds.has(edge.target_entity_id);
    const srcIsInternal = internalIds.has(edge.source_entity_id);
    const tgtIsInternal = internalIds.has(edge.target_entity_id);

    if (srcIsExternal && tgtIsInternal) {
      bridgedExternalEntityIds.add(edge.source_entity_id);
    }
    if (tgtIsExternal && srcIsInternal) {
      bridgedExternalEntityIds.add(edge.target_entity_id);
    }
  }

  // Normalize: map UUIDs back to entity_ids
  const result = new Set<string>();
  for (const e of entities) {
    if (e.knowledge_layer === "external") {
      if (bridgedExternalEntityIds.has(e.entity_id) || bridgedExternalEntityIds.has(e.id)) {
        result.add(e.entity_id);
      }
    }
  }

  return result;
}

/**
 * Compute edge provenance v2 from an existing edge's metadata.
 * Used when writing new edges to include v2 provenance fields.
 */
export function buildEdgeProvenanceV2(params: {
  edge_role: EdgeRole;
  discovery_source: "manual" | "research" | "intersection" | "link_prediction" | "pipeline";
  evidence_level?: "stated" | "inferred" | "predicted";
  confidence_explainer?: string;
  source_refs?: string[];
}): EdgeProvenanceV2 {
  return {
    edge_role: params.edge_role,
    discovery_source: params.discovery_source,
    evidence_level: params.evidence_level ?? "inferred",
    confidence_explainer: params.confidence_explainer,
    source_refs: params.source_refs ?? [],
  };
}
