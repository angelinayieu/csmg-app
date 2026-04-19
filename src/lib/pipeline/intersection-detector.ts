/**
 * Intersection Detector
 *
 * Finds where probability spaces from different edges OVERLAP — shared mediating
 * variables that create novel cross-domain insights. When Connection A and Connection B
 * both depend on the same underlying variable, changes to that variable simultaneously
 * affect both relationships — this is where innovative solutions emerge.
 */

import type { Entity, Edge } from "@/types";
import type {
  ProbabilitySpace,
  ProbabilityNode,
  SpaceIntersection,
  SharedNode,
} from "@/types/probability-space";
import { getIntersectionThresholds, type IntersectionThresholds } from "@/lib/pipeline/intersection-thresholds";

// ── Utility: Tokenize for similarity ──

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Graph distance computation ──

export function computeGraphDistance(
  entityA: string,
  entityB: string,
  edges: Edge[]
): number {
  if (entityA === entityB) return 0;

  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.source_entity_id)) adj.set(e.source_entity_id, new Set());
    if (!adj.has(e.target_entity_id)) adj.set(e.target_entity_id, new Set());
    adj.get(e.source_entity_id)!.add(e.target_entity_id);
    adj.get(e.target_entity_id)!.add(e.source_entity_id);
  }

  // BFS
  const visited = new Set<string>();
  const queue: Array<{ id: string; dist: number }> = [{ id: entityA, dist: 0 }];
  visited.add(entityA);

  while (queue.length > 0) {
    const { id, dist } = queue.shift()!;
    if (id === entityB) return dist;
    for (const neighbor of adj.get(id) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, dist: dist + 1 });
      }
    }
  }

  return Infinity;
}

// ── Find shared nodes between two probability spaces ──

function findSharedNodes(
  spaceA: ProbabilitySpace,
  spaceB: ProbabilitySpace,
  thresholds: IntersectionThresholds
): SharedNode[] {
  const shared: SharedNode[] = [];
  const NAME_SIM_THRESHOLD = thresholds.name_similarity;
  const EMBEDDING_SIM_THRESHOLD = thresholds.embedding_similarity;
  const ROLE_SIM_THRESHOLD = thresholds.role_similarity;

  for (const nodeA of spaceA.nodes) {
    for (const nodeB of spaceB.nodes) {
      // Skip if same parent entity (trivial overlap)
      if (nodeA.parent_entity_id === nodeB.parent_entity_id) continue;

      // Check 1: Exact same expansion source
      if (
        nodeA.source_expansion_sc_id &&
        nodeB.source_expansion_sc_id &&
        nodeA.source_expansion_sc_id === nodeB.source_expansion_sc_id &&
        nodeA.parent_entity_id === nodeB.parent_entity_id
      ) {
        shared.push({
          node_a_id: nodeA.id,
          node_b_id: nodeB.id,
          similarity: 1.0,
          name: nodeA.name,
          match_type: "exact_entity",
        });
        continue;
      }

      // Check 2: Name similarity
      // Check 1.5: Embedding similarity (preferred when available)
      if (Array.isArray(nodeA.embedding) && Array.isArray(nodeB.embedding)) {
        const semSim = cosineSimilarity(nodeA.embedding, nodeB.embedding);
        if (semSim >= EMBEDDING_SIM_THRESHOLD) {
          shared.push({
            node_a_id: nodeA.id,
            node_b_id: nodeB.id,
            similarity: semSim,
            name: semSim > 0.88 ? nodeA.name : `${nodeA.name} ≈ ${nodeB.name}`,
            match_type: "semantic_overlap",
          });
          continue;
        }
      }

      // Check 2: Name similarity
      const nameTokensA = tokenize(nodeA.name);
      const nameTokensB = tokenize(nodeB.name);
      const nameSim = jaccardSimilarity(nameTokensA, nameTokensB);

      if (nameSim >= NAME_SIM_THRESHOLD) {
        shared.push({
          node_a_id: nodeA.id,
          node_b_id: nodeB.id,
          similarity: nameSim,
          name: nameSim > 0.7 ? nodeA.name : `${nodeA.name} ≈ ${nodeB.name}`,
          match_type: nameSim > 0.7 ? "name_similarity" : "semantic_overlap",
        });
        continue;
      }

      // Check 3: Component type + role overlap (weaker signal)
      if (
        nodeA.component_type &&
        nodeB.component_type &&
        nodeA.component_type === nodeB.component_type
      ) {
        const roleA = tokenize(nodeA.name + " " + (nodeA.component_type ?? ""));
        const roleB = tokenize(nodeB.name + " " + (nodeB.component_type ?? ""));
        const roleSim = jaccardSimilarity(roleA, roleB);
        if (roleSim >= ROLE_SIM_THRESHOLD) {
          shared.push({
            node_a_id: nodeA.id,
            node_b_id: nodeB.id,
            similarity: roleSim * 0.8,
            name: `${nodeA.name} ↔ ${nodeB.name}`,
            match_type: "semantic_overlap",
          });
        }
      }
    }
  }

  // Deduplicate: keep highest similarity per node pair
  const bestMap = new Map<string, SharedNode>();
  for (const s of shared) {
    const key = [s.node_a_id, s.node_b_id].sort().join("|");
    const existing = bestMap.get(key);
    if (!existing || s.similarity > existing.similarity) {
      bestMap.set(key, s);
    }
  }

  return Array.from(bestMap.values()).sort((a, b) => b.similarity - a.similarity);
}

// ── Generate intersection insight ──

/**
 * Generate a minimal structural placeholder for intersection insight.
 * This is just a factual label — the real analysis comes from
 * intersection-insights.ts LLM enrichment which replaces this text.
 */
export function generateIntersectionInsight(
  sharedNodes: SharedNode[],
  spaceA: ProbabilitySpace,
  spaceB: ProbabilitySpace
): string {
  const sharedNames = sharedNodes.slice(0, 3).map((s) => s.name).join(", ");
  return (
    `${spaceA.source_entity_name} → ${spaceA.target_entity_name} and ` +
    `${spaceB.source_entity_name} → ${spaceB.target_entity_name} share: ${sharedNames}.`
  );
}

// ── Main: Detect all intersections ──

export function detectIntersections(
  spaces: ProbabilitySpace[],
  entities: Entity[],
  graphEdges: Edge[],
  maxIntersections: number = 15,
  thresholds?: IntersectionThresholds
): SpaceIntersection[] {
  const intersections: SpaceIntersection[] = [];
  const MAX_GRAPH_DISTANCE = 8;
  const effectiveThresholds = thresholds ?? getIntersectionThresholds();

  // Compare each pair of spaces
  for (let i = 0; i < spaces.length; i++) {
    for (let j = i + 1; j < spaces.length; j++) {
      const spaceA = spaces[i];
      const spaceB = spaces[j];

      // Skip if spaces share an endpoint entity (trivial overlap)
      if (
        spaceA.source_entity_id === spaceB.source_entity_id ||
        spaceA.source_entity_id === spaceB.target_entity_id ||
        spaceA.target_entity_id === spaceB.source_entity_id ||
        spaceA.target_entity_id === spaceB.target_entity_id
      ) {
        // Still detect, but with reduced novelty
      }

      const sharedNodes = findSharedNodes(spaceA, spaceB, effectiveThresholds);
      if (sharedNodes.length === 0) continue;

      // Compute novelty score based on graph distance between the spaces' entities
      const distAB = Math.min(
        computeGraphDistance(spaceA.source_entity_id, spaceB.source_entity_id, graphEdges),
        computeGraphDistance(spaceA.source_entity_id, spaceB.target_entity_id, graphEdges),
        computeGraphDistance(spaceA.target_entity_id, spaceB.source_entity_id, graphEdges),
        computeGraphDistance(spaceA.target_entity_id, spaceB.target_entity_id, graphEdges)
      );
      const noveltyScore = Math.min(1, distAB / MAX_GRAPH_DISTANCE);

      // Compute impact score based on probability and controllability
      let impactSum = 0;
      for (const sn of sharedNodes) {
        const nodeA = spaceA.nodes.find((n) => n.id === sn.node_a_id);
        const nodeB = spaceB.nodes.find((n) => n.id === sn.node_b_id);
        const prob = Math.max(nodeA?.probability ?? 0.5, nodeB?.probability ?? 0.5);
        const controlWeight =
          (nodeA?.controllability ?? nodeB?.controllability) === "direct" ? 1.0 :
          (nodeA?.controllability ?? nodeB?.controllability) === "indirect" ? 0.5 : 0.2;
        impactSum += prob * controlWeight * sn.similarity;
      }
      const impactScore = Math.min(1, impactSum / sharedNodes.length);

      // Innovation potential
      const innovationPotential: "high" | "medium" | "low" =
        noveltyScore > 0.7 && impactScore > 0.5 ? "high" :
        noveltyScore > 0.4 || impactScore > 0.6 ? "medium" : "low";

      const insight = generateIntersectionInsight(sharedNodes, spaceA, spaceB);

      // Compute layer crossing
      const spaceAProfile = spaceA.layer_profile;
      const spaceBProfile = spaceB.layer_profile;
      const layersInvolved = new Set<string>();
      if (spaceAProfile) {
        layersInvolved.add(spaceAProfile.source_layer);
        layersInvolved.add(spaceAProfile.target_layer);
      }
      if (spaceBProfile) {
        layersInvolved.add(spaceBProfile.source_layer);
        layersInvolved.add(spaceBProfile.target_layer);
      }

      const isCrossLayerIntersection = layersInvolved.size > 1;
      const crossLayerBonus = isCrossLayerIntersection ? 0.15 : 0;

      // Apply cross-layer bonus to novelty
      const adjustedNoveltyScore = Math.min(1, noveltyScore + crossLayerBonus);

      intersections.push({
        id: `int_${spaceA.id}_${spaceB.id}`,
        space_a_id: spaceA.id,
        space_b_id: spaceB.id,
        space_a_edge_id: spaceA.edge_id,
        space_b_edge_id: spaceB.edge_id,
        space_a_label: `${spaceA.source_entity_name} → ${spaceA.target_entity_name}`,
        space_b_label: `${spaceB.source_entity_name} → ${spaceB.target_entity_name}`,
        shared_nodes: sharedNodes,
        novelty_score: adjustedNoveltyScore,
        impact_score: impactScore,
        insight,
        innovation_potential: innovationPotential,
        layer_crossing: {
          is_cross_layer: isCrossLayerIntersection,
          layers_involved: [...layersInvolved],
          cross_layer_novelty_bonus: crossLayerBonus,
        },
      });
    }
  }

  // Sort by combined score, cap at maxIntersections
  return intersections
    .sort((a, b) => (b.novelty_score * b.impact_score) - (a.novelty_score * a.impact_score))
    .slice(0, maxIntersections);
}
