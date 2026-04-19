/**
 * Graph Structure Analysis — Pure Computation
 *
 * Computes graph-theoretic metrics from entities, edges, and cycles.
 * No LLM calls — deterministic algorithms only.
 * Pattern follows computeInteractionFields() in src/lib/interactions/compute-fields.ts
 */

import type { Entity, Edge, Cycle } from "@/types";

// ── Output types ──

export interface GraphStructure {
  /** Top entities by centrality (degree + betweenness) */
  centrality_rankings: Array<{
    entity_id: string;
    name: string;
    degree: number;
    betweenness: number;
    in_degree: number;
    out_degree: number;
  }>;
  /** Edges whose removal would disconnect components — structural weak points */
  bridge_edges: Array<{
    source: string;
    target: string;
    source_name: string;
    target_name: string;
  }>;
  /** Structured cycle summary from existing cycle data */
  cycle_summary: Array<{
    name: string;
    entity_ids: string[];
    type: string;
    length: number;
  }>;
  /** Connected component groups */
  components: Array<{
    component_id: number;
    entity_ids: string[];
    size: number;
  }>;
  /** Global metrics */
  metrics: {
    node_count: number;
    edge_count: number;
    density: number;
    avg_degree: number;
    max_degree: number;
    component_count: number;
  };
}

// ── Computation ──

export function computeGraphStructure(
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[]
): GraphStructure {
  // Graph edges are stored by UUID (`entity.id`). Keep UUID as internal graph key,
  // but expose semantic `entity_id` in output for prompt readability.
  const entityByUuid = new Map<string, Entity>();
  for (const e of entities) entityByUuid.set(e.id, e);

  const nodeUuids = new Set(entities.map((e) => e.id));

  // Filter edges to only those connecting known entities (UUID-based)
  const validEdges = edges.filter(
    (e) => nodeUuids.has(e.source_entity_id) && nodeUuids.has(e.target_entity_id)
  );

  // ── Degree centrality ──
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const neighbors = new Map<string, Set<string>>();

  for (const id of nodeUuids) {
    inDegree.set(id, 0);
    outDegree.set(id, 0);
    neighbors.set(id, new Set());
  }

  for (const edge of validEdges) {
    outDegree.set(edge.source_entity_id, (outDegree.get(edge.source_entity_id) ?? 0) + 1);
    inDegree.set(edge.target_entity_id, (inDegree.get(edge.target_entity_id) ?? 0) + 1);
    neighbors.get(edge.source_entity_id)?.add(edge.target_entity_id);
    neighbors.get(edge.target_entity_id)?.add(edge.source_entity_id);
  }

  // ── Betweenness centrality (BFS-based approximation) ──
  const betweenness = new Map<string, number>();
  for (const id of nodeUuids) betweenness.set(id, 0);

  // Sample up to 20 source nodes for efficiency
  const sampleNodes = [...nodeUuids].slice(0, Math.min(20, nodeUuids.size));

  for (const source of sampleNodes) {
    // BFS from source
    const queue: string[] = [source];
    const dist = new Map<string, number>([[source, 0]]);
    const paths = new Map<string, number>([[source, 1]]);
    const order: string[] = [];
    const predecessors = new Map<string, string[]>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);

      for (const neighbor of (neighbors.get(current) ?? [])) {
        if (!dist.has(neighbor)) {
          dist.set(neighbor, (dist.get(current) ?? 0) + 1);
          queue.push(neighbor);
          paths.set(neighbor, 0);
          predecessors.set(neighbor, []);
        }
        if (dist.get(neighbor) === (dist.get(current) ?? 0) + 1) {
          paths.set(neighbor, (paths.get(neighbor) ?? 0) + (paths.get(current) ?? 0));
          predecessors.get(neighbor)?.push(current);
        }
      }
    }

    // Back-propagation
    const delta = new Map<string, number>();
    for (const id of nodeUuids) delta.set(id, 0);

    for (let i = order.length - 1; i >= 0; i--) {
      const w = order[i];
      for (const v of (predecessors.get(w) ?? [])) {
        const pathsV = paths.get(v) ?? 1;
        const pathsW = paths.get(w) ?? 1;
        const contribution = (pathsV / pathsW) * (1 + (delta.get(w) ?? 0));
        delta.set(v, (delta.get(v) ?? 0) + contribution);
      }
      if (w !== source) {
        betweenness.set(w, (betweenness.get(w) ?? 0) + (delta.get(w) ?? 0));
      }
    }
  }

  // Normalize betweenness
  const n = nodeUuids.size;
  if (n > 2) {
    const scale = 1 / ((n - 1) * (n - 2));
    for (const [id, val] of betweenness) {
      betweenness.set(id, val * scale);
    }
  }

  // Build centrality rankings
  const centrality_rankings = [...nodeUuids]
    .map((id) => ({
      entity_id: entityByUuid.get(id)?.entity_id ?? id,
      name: entityByUuid.get(id)?.name ?? id,
      degree: (inDegree.get(id) ?? 0) + (outDegree.get(id) ?? 0),
      betweenness: Math.round((betweenness.get(id) ?? 0) * 1000) / 1000,
      in_degree: inDegree.get(id) ?? 0,
      out_degree: outDegree.get(id) ?? 0,
    }))
    .sort((a, b) => {
      // Sort by combined score: degree * 0.4 + betweenness * 0.6
      const scoreA = a.degree * 0.4 + a.betweenness * 100 * 0.6;
      const scoreB = b.degree * 0.4 + b.betweenness * 100 * 0.6;
      return scoreB - scoreA;
    })
    .slice(0, 10); // Top 10

  // ── Bridge edge detection (simplified: edges between different components when removed) ──
  const bridge_edges: GraphStructure["bridge_edges"] = [];

  // For small graphs, test each edge
  if (validEdges.length <= 100) {
    for (const edge of validEdges) {
      // Remove this edge and check if graph becomes more disconnected
      const tempEdges = validEdges.filter((e) => e !== edge);
      const tempComponents = findComponents(nodeUuids, tempEdges);
      const baseComponents = findComponents(nodeUuids, validEdges);
      if (tempComponents > baseComponents) {
        const src = entityByUuid.get(edge.source_entity_id);
        const tgt = entityByUuid.get(edge.target_entity_id);
        bridge_edges.push({
          source: src?.entity_id ?? edge.source_entity_id,
          target: tgt?.entity_id ?? edge.target_entity_id,
          source_name: src?.name ?? edge.source_entity_id,
          target_name: tgt?.name ?? edge.target_entity_id,
        });
      }
    }
  }

  // ── Cycle summary ──
  const cycle_summary = (cycles ?? []).map(c => ({
    name: (c as any).name ?? (c as any).cycle_name ?? "unnamed",
    entity_ids: Array.isArray((c as any).entity_ids) ? (c as any).entity_ids : [],
    type: (c as any).cycle_type ?? (c as any).type ?? "unknown",
    length: Array.isArray((c as any).entity_ids) ? (c as any).entity_ids.length : 0,
  }));

  // ── Connected components ──
  const componentMap = findComponentMap(nodeUuids, validEdges);
  const componentGroups = new Map<number, string[]>();
  for (const [id, comp] of componentMap) {
    const semanticId = entityByUuid.get(id)?.entity_id ?? id;
    if (!componentGroups.has(comp)) componentGroups.set(comp, []);
    componentGroups.get(comp)!.push(semanticId);
  }
  const components = [...componentGroups.entries()].map(([comp, ids]) => ({
    component_id: comp,
    entity_ids: ids,
    size: ids.length,
  }));

  // ── Global metrics ──
  const degrees = [...nodeUuids].map((id) => (inDegree.get(id) ?? 0) + (outDegree.get(id) ?? 0));
  const maxDeg = degrees.length > 0 ? Math.max(...degrees) : 0;
  const avgDeg = degrees.length > 0 ? degrees.reduce((a, b) => a + b, 0) / degrees.length : 0;
  const maxPossibleEdges = n * (n - 1);
  const density = maxPossibleEdges > 0 ? validEdges.length / maxPossibleEdges : 0;

  return {
    centrality_rankings,
    bridge_edges,
    cycle_summary,
    components,
    metrics: {
      node_count: n,
      edge_count: validEdges.length,
      density: Math.round(density * 1000) / 1000,
      avg_degree: Math.round(avgDeg * 100) / 100,
      max_degree: maxDeg,
      component_count: components.length,
    },
  };
}

// ── Helpers ──

function findComponents(entityIds: Set<string>, edges: Edge[]): number {
  return [...findComponentMap(entityIds, edges).values()].reduce((set, v) => set.add(v), new Set<number>()).size;
}

function findComponentMap(entityIds: Set<string>, edges: Edge[]): Map<string, number> {
  const adj = new Map<string, Set<string>>();
  for (const id of entityIds) adj.set(id, new Set());
  for (const e of edges) {
    adj.get(e.source_entity_id)?.add(e.target_entity_id);
    adj.get(e.target_entity_id)?.add(e.source_entity_id);
  }

  const visited = new Set<string>();
  const componentOf = new Map<string, number>();
  let comp = 0;

  for (const start of entityIds) {
    if (visited.has(start)) continue;
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const node = queue.shift()!;
      componentOf.set(node, comp);
      for (const neighbor of (adj.get(node) ?? [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    comp++;
  }

  return componentOf;
}
