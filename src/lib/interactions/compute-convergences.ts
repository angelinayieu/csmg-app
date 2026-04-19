/**
 * Cross-Category Convergence Detection
 *
 * Finds entities that receive connections from multiple different entity categories.
 * These are "convergence points" — shared elements where separate knowledge domains
 * meet. The deeper the convergence (lower importance tier = more fundamental),
 * the higher the structural value:
 *
 * - L4 (moderate/atom): Rare first-principle invariant shared across domains → highest value
 * - L3 (important/mechanism): Shared logical fundamental → high value
 * - L2 (critical/method): Shared causal mechanism → moderate value
 * - L1 (fundamental/strategy): Shared outcome → common, lowest value
 *
 * Pure graph computation — no LLM calls.
 */

import type { Entity, Edge } from "@/types";
import type { ConvergenceInsight, ConvergenceDepth, ConvergenceBranch } from "@/types/interactions";

const DEPTH_MAP: Record<string, { depth: ConvergenceDepth; label: string; value: number }> = {
  fundamental: { depth: "L1", label: "L1 Outcome", value: 0.25 },
  critical:    { depth: "L2", label: "L2 Method", value: 0.5 },
  important:   { depth: "L3", label: "L3 Logic", value: 0.75 },
  moderate:    { depth: "L4", label: "L4 Invariant", value: 1.0 },
};

/**
 * Detect cross-category convergence points in the knowledge graph.
 *
 * Algorithm:
 * 1. Build adjacency maps (incoming edges per entity, with source category info)
 * 2. For each entity, check how many distinct categories connect to it
 * 3. Entities with 2+ source categories are convergence points
 * 4. Score by importance tier (deeper = rarer = more valuable)
 * 5. Build branch paths from each category's connecting entity back to the convergence point
 * 6. Return sorted by structural_value descending
 */
export function detectConvergences(
  entities: Entity[],
  edges: Edge[],
): ConvergenceInsight[] {
  if (entities.length < 3 || edges.length < 2) return [];

  // Build entity lookup
  const entityById = new Map<string, Entity>();
  for (const e of entities) {
    entityById.set(e.id, e);
    if (e.entity_id) entityById.set(e.entity_id, e);
  }

  // Build incoming connections: target → array of { source entity, edge }
  const incomingByTarget = new Map<string, Array<{ source: Entity; edge: Edge }>>();
  for (const edge of edges) {
    const source = entityById.get(edge.source_entity_id);
    const target = entityById.get(edge.target_entity_id);
    if (!source || !target) continue;

    if (!incomingByTarget.has(target.id)) {
      incomingByTarget.set(target.id, []);
    }
    incomingByTarget.get(target.id)!.push({ source, edge });
  }

  // Also consider outgoing connections (convergence can happen in either direction)
  const connectedByEntity = new Map<string, Array<{ neighbor: Entity; edge: Edge }>>();
  for (const edge of edges) {
    const source = entityById.get(edge.source_entity_id);
    const target = entityById.get(edge.target_entity_id);
    if (!source || !target) continue;

    // Add both directions
    if (!connectedByEntity.has(target.id)) connectedByEntity.set(target.id, []);
    connectedByEntity.get(target.id)!.push({ neighbor: source, edge });

    if (!connectedByEntity.has(source.id)) connectedByEntity.set(source.id, []);
    connectedByEntity.get(source.id)!.push({ neighbor: target, edge });
  }

  const insights: ConvergenceInsight[] = [];
  let idCounter = 0;

  // For each entity, check if it connects to entities from multiple categories
  for (const entity of entities) {
    const connections = connectedByEntity.get(entity.id);
    if (!connections || connections.length < 2) continue;

    // Group connected entities by category (excluding the entity's own category)
    const categoryNeighbors = new Map<string, Entity[]>();
    for (const { neighbor } of connections) {
      if (neighbor.entity_category === entity.entity_category) continue;
      const cat = neighbor.entity_category;
      if (!categoryNeighbors.has(cat)) categoryNeighbors.set(cat, []);
      categoryNeighbors.get(cat)!.push(neighbor);
    }

    // Need connections from 2+ different foreign categories to be a convergence
    if (categoryNeighbors.size < 2) continue;

    // Compute depth/value from importance tier
    const importance = entity.importance ?? "moderate";
    const tierInfo = DEPTH_MAP[importance] ?? DEPTH_MAP.moderate;

    // Build converging branches (one per foreign category, pick the strongest connection)
    const branches: ConvergenceBranch[] = [];
    for (const [cat, neighbors] of categoryNeighbors) {
      // Pick the neighbor with highest centrality or first one
      const bestNeighbor = neighbors.sort((a, b) =>
        (a.centrality_rank ?? 999) - (b.centrality_rank ?? 999)
      )[0];

      branches.push({
        entity_id: bestNeighbor.id,
        name: bestNeighbor.name,
        category: cat,
        path_to_shared: [bestNeighbor.id, entity.id],
      });
    }

    // Generate explanation based on depth
    const categoryNames = branches.map(b => b.category).join(" and ");
    const explanation = tierInfo.depth === "L4"
      ? `First-principle convergence: "${entity.name}" is a fundamental element shared across ${categoryNames} domains. Changes here propagate compounding effects through all connected strategies.`
      : tierInfo.depth === "L3"
      ? `Logic convergence: "${entity.name}" is a shared logical mechanism across ${categoryNames} domains. Both domains rely on this reasoning pattern.`
      : tierInfo.depth === "L2"
      ? `Method convergence: "${entity.name}" is a shared approach across ${categoryNames} domains. Both strategies employ this methodology.`
      : `Outcome convergence: "${entity.name}" is a shared strategic outcome across ${categoryNames} domains. Multiple strategies target this result.`;

    insights.push({
      id: `conv-${++idCounter}`,
      depth: tierInfo.depth,
      depth_label: tierInfo.label,
      shared_element: {
        entity_id: entity.id,
        name: entity.name,
        importance,
        category: entity.entity_category,
      },
      converging_branches: branches,
      structural_value: tierInfo.value * Math.min(1, branches.length / 3), // More branches = more valuable
      explanation,
    });
  }

  // Sort by structural value descending (deepest + most branches first)
  insights.sort((a, b) => b.structural_value - a.structural_value);

  // Cap at 20 most valuable
  return insights.slice(0, 20);
}
