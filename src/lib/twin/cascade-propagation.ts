/**
 * Layer 14 – Cascade Propagation System
 *
 * When an entity changes (importance edit, addition/removal, synthesis re-run),
 * trace downstream structures affected through the edge graph and mark them stale.
 *
 * Key conventions in this codebase:
 *   - Entity.id         = DB UUID
 *   - Entity.entity_id  = display ID (C1, A2, etc.)
 *   - Edge.source_entity_id / target_entity_id = DB UUIDs
 *   - Cycle.entity_ids  = display IDs
 */

import type { Entity, Edge, Cycle } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CascadeHit {
  entity_id: string; // display ID (C1, A2, etc.)
  entity_uuid: string; // DB UUID
  entity_name: string;
  depth: number; // hops from source
  accumulated_strength: number; // product of edge strengths along path
  net_polarity: "positive" | "negative" | "mixed";
  pathway: string[]; // entity_ids along the path
}

export interface CascadeResult {
  source_entity_id: string;
  affected_entities: CascadeHit[];
  affected_cycle_ids: string[];
  total_reach: number; // count of affected entities
  max_depth: number;
  stale_score: number; // 0-100, how much the system might have changed
}

export interface StaleReport {
  stale_leverage_points: string[]; // entity_ids of leverage points in cascade
  stale_risk_points: string[]; // entity_ids of risk points in cascade
  stale_feedback_loops: string[]; // names of loops with affected members
  stale_action_entity_ids: string[]; // entity_ids referenced in action items
  total_stale: number;
  recommendation: "re-synthesize" | "review" | "none";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DEPTH = 4;
const MIN_STRENGTH = 0.1;

const IMPORTANCE_WEIGHT: Record<string, number> = {
  fundamental: 4,
  critical: 3,
  important: 2,
  moderate: 1,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build an adjacency list keyed by source UUID -> outgoing edges. */
function buildAdjacency(edges: Edge[]): Map<string, Edge[]> {
  const adj = new Map<string, Edge[]>();
  for (const e of edges) {
    const list = adj.get(e.source_entity_id);
    if (list) {
      list.push(e);
    } else {
      adj.set(e.source_entity_id, [e]);
    }
  }
  return adj;
}

/** Map DB UUID -> Entity for fast lookups. */
function buildEntityMap(entities: Entity[]): Map<string, Entity> {
  const m = new Map<string, Entity>();
  for (const e of entities) {
    m.set(e.id, e);
  }
  return m;
}

/** Combine two polarity states through an edge. */
function combinePolarity(
  current: "positive" | "negative" | "mixed",
  edgePolarity: string,
): "positive" | "negative" | "mixed" {
  if (current === "mixed") return "mixed";
  if (edgePolarity === "neutral" || edgePolarity === "conditional")
    return "mixed";

  // positive * positive = positive, positive * negative = negative, etc.
  if (edgePolarity === "positive") return current;
  if (edgePolarity === "negative") {
    return current === "positive" ? "negative" : "positive";
  }
  return "mixed";
}

// ---------------------------------------------------------------------------
// BFS core
// ---------------------------------------------------------------------------

interface BfsNode {
  uuid: string;
  depth: number;
  strength: number;
  polarity: "positive" | "negative" | "mixed";
  pathway: string[]; // display IDs along the path
}

function bfsFromEntity(
  startUuid: string,
  entities: Entity[],
  edges: Edge[],
): CascadeHit[] {
  const adjacency = buildAdjacency(edges);
  const entityMap = buildEntityMap(entities);
  const startEntity = entityMap.get(startUuid);
  if (!startEntity) return [];

  const visited = new Set<string>();
  visited.add(startUuid);

  const queue: BfsNode[] = [];
  const results: CascadeHit[] = [];

  // Seed: push all direct neighbors of the start entity
  const outgoing = adjacency.get(startUuid) ?? [];
  for (const edge of outgoing) {
    const target = entityMap.get(edge.target_entity_id);
    if (!target || visited.has(target.id)) continue;

    const strength = edge.strength;
    if (strength < MIN_STRENGTH) continue;

    queue.push({
      uuid: target.id,
      depth: 1,
      strength,
      polarity: combinePolarity("positive", edge.polarity),
      pathway: [startEntity.entity_id, target.entity_id],
    });
  }

  while (queue.length > 0) {
    const node = queue.shift()!;

    // Skip if already visited (another path reached it first)
    if (visited.has(node.uuid)) continue;
    visited.add(node.uuid);

    const entity = entityMap.get(node.uuid);
    if (!entity) continue;

    results.push({
      entity_id: entity.entity_id,
      entity_uuid: entity.id,
      entity_name: entity.name,
      depth: node.depth,
      accumulated_strength: Math.round(node.strength * 1000) / 1000,
      net_polarity: node.polarity,
      pathway: node.pathway,
    });

    // Stop expanding beyond MAX_DEPTH
    if (node.depth >= MAX_DEPTH) continue;

    const nextEdges = adjacency.get(node.uuid) ?? [];
    for (const edge of nextEdges) {
      if (visited.has(edge.target_entity_id)) continue;

      const nextStrength = node.strength * edge.strength;
      if (nextStrength < MIN_STRENGTH) continue;

      const target = entityMap.get(edge.target_entity_id);
      if (!target) continue;

      queue.push({
        uuid: target.id,
        depth: node.depth + 1,
        strength: nextStrength,
        polarity: combinePolarity(node.polarity, edge.polarity),
        pathway: [...node.pathway, target.entity_id],
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Find cycles affected by a set of entity display IDs
// ---------------------------------------------------------------------------

function findAffectedCycles(
  affectedDisplayIds: Set<string>,
  cycles: Cycle[],
): string[] {
  const ids: string[] = [];
  for (const c of cycles) {
    const members = c.entity_ids ?? [];
    if (members.some((eid) => affectedDisplayIds.has(eid))) {
      ids.push(c.cycle_id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Stale score computation
// ---------------------------------------------------------------------------

function computeStaleScore(
  hits: CascadeHit[],
  entityMap: Map<string, Entity>,
  affectedCycleCount: number,
): number {
  if (hits.length === 0) return 0;

  let weightedSum = 0;
  let leverageCount = 0;
  let riskCount = 0;

  for (const hit of hits) {
    const entity = entityMap.get(hit.entity_uuid);
    if (!entity) continue;

    const importanceWeight = IMPORTANCE_WEIGHT[entity.importance ?? "moderate"] ?? 1;
    // Closer entities (lower depth) matter more
    const depthFactor = 1 / hit.depth;
    weightedSum += importanceWeight * depthFactor * hit.accumulated_strength;

    if (entity.is_leverage_point) leverageCount++;
    if (entity.is_risk_point) riskCount++;
  }

  // Normalize: base from weighted entity impact
  let score = Math.min(weightedSum * 10, 60);

  // Bonus for leverage/risk point involvement
  score += leverageCount * 10;
  score += riskCount * 8;

  // Bonus for cycle involvement
  score += affectedCycleCount * 5;

  return Math.min(Math.round(score), 100);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Given a changed entity, trace all downstream effects through edges via BFS.
 */
export function computeCascadeFromEntity(
  entityId: string,
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
): CascadeResult {
  // entityId is a display ID (C1, A2) – resolve to UUID
  const sourceEntity = entities.find((e) => e.entity_id === entityId);
  if (!sourceEntity) {
    return {
      source_entity_id: entityId,
      affected_entities: [],
      affected_cycle_ids: [],
      total_reach: 0,
      max_depth: 0,
      stale_score: 0,
    };
  }

  const hits = bfsFromEntity(sourceEntity.id, entities, edges);
  const affectedDisplayIds = new Set(hits.map((h) => h.entity_id));
  // Include source itself for cycle detection
  affectedDisplayIds.add(entityId);

  const affectedCycleIds = findAffectedCycles(affectedDisplayIds, cycles);
  const entityMap = buildEntityMap(entities);
  const staleScore = computeStaleScore(hits, entityMap, affectedCycleIds.length);

  return {
    source_entity_id: entityId,
    affected_entities: hits,
    affected_cycle_ids: affectedCycleIds,
    total_reach: hits.length,
    max_depth: hits.reduce((max, h) => Math.max(max, h.depth), 0),
    stale_score: staleScore,
  };
}

/**
 * Cascade starting from the target of a changed edge.
 * Useful when an edge is added, removed, or modified.
 */
export function computeCascadeFromEdge(
  sourceUuid: string,
  targetUuid: string,
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
): CascadeResult {
  const entityMap = buildEntityMap(entities);
  const targetEntity = entityMap.get(targetUuid);
  if (!targetEntity) {
    return {
      source_entity_id: sourceUuid,
      affected_entities: [],
      affected_cycle_ids: [],
      total_reach: 0,
      max_depth: 0,
      stale_score: 0,
    };
  }

  // BFS from the target entity (it's the first thing affected by edge change)
  const hits = bfsFromEntity(targetUuid, entities, edges);

  // Include the target itself as an affected entity
  const sourceEntity = entityMap.get(sourceUuid);
  const edgeBetween = edges.find(
    (e) => e.source_entity_id === sourceUuid && e.target_entity_id === targetUuid,
  );

  const targetHit: CascadeHit = {
    entity_id: targetEntity.entity_id,
    entity_uuid: targetEntity.id,
    entity_name: targetEntity.name,
    depth: 0,
    accumulated_strength: edgeBetween?.strength ?? 1,
    net_polarity: (edgeBetween?.polarity === "positive" || edgeBetween?.polarity === "negative")
      ? edgeBetween.polarity
      : "mixed",
    pathway: [
      sourceEntity?.entity_id ?? sourceUuid,
      targetEntity.entity_id,
    ],
  };

  const allHits = [targetHit, ...hits];

  const affectedDisplayIds = new Set(allHits.map((h) => h.entity_id));
  const affectedCycleIds = findAffectedCycles(affectedDisplayIds, cycles);
  const staleScore = computeStaleScore(allHits, entityMap, affectedCycleIds.length);

  return {
    source_entity_id: sourceEntity?.entity_id ?? sourceUuid,
    affected_entities: allHits,
    affected_cycle_ids: affectedCycleIds,
    total_reach: allHits.length,
    max_depth: allHits.reduce((max, h) => Math.max(max, h.depth), 0),
    stale_score: staleScore,
  };
}

/**
 * Given a cascade result and current synthesis_data, determine which
 * synthesis findings are now stale.
 */
export function markStaleStructures(
  cascadeResult: CascadeResult,
  synthesisData: Record<string, unknown>,
): StaleReport {
  const affectedIds = new Set(
    cascadeResult.affected_entities.map((h) => h.entity_id),
  );
  // Include the source itself
  affectedIds.add(cascadeResult.source_entity_id);

  const affectedNames = new Set(
    cascadeResult.affected_entities.map((h) => h.entity_name.toLowerCase()),
  );

  // --- Leverage points ---
  const staleLeverage: string[] = [];
  const leveragePoints = Array.isArray(synthesisData.leverage_points)
    ? (synthesisData.leverage_points as Record<string, unknown>[])
    : [];
  for (const lp of leveragePoints) {
    const entityId = typeof lp.entity_id === "string" ? lp.entity_id : "";
    const entityName = typeof lp.entity_name === "string" ? lp.entity_name.toLowerCase() : "";
    if (affectedIds.has(entityId) || affectedNames.has(entityName)) {
      staleLeverage.push(entityId || entityName);
    }
  }

  // --- Risk points ---
  const staleRisk: string[] = [];
  const riskPoints = Array.isArray(synthesisData.risk_points)
    ? (synthesisData.risk_points as Record<string, unknown>[])
    : [];
  for (const rp of riskPoints) {
    const entityId = typeof rp.entity_id === "string" ? rp.entity_id : "";
    const entityName = typeof rp.entity_name === "string" ? rp.entity_name.toLowerCase() : "";
    if (affectedIds.has(entityId) || affectedNames.has(entityName)) {
      staleRisk.push(entityId || entityName);
    }
  }

  // --- Feedback loops ---
  const staleLoops: string[] = [];
  const feedbackLoops = Array.isArray(synthesisData.feedback_loops)
    ? (synthesisData.feedback_loops as Record<string, unknown>[])
    : [];
  for (const loop of feedbackLoops) {
    const loopName = typeof loop.name === "string" ? loop.name : "";
    const cycleId = typeof loop.cycle_id === "string" ? loop.cycle_id : "";
    // Check if the loop's cycle is in the affected set
    if (cascadeResult.affected_cycle_ids.includes(cycleId)) {
      staleLoops.push(loopName || cycleId);
      continue;
    }
    // Also check by member entity names
    const members = Array.isArray(loop.entity_ids)
      ? (loop.entity_ids as string[])
      : [];
    if (members.some((m) => affectedIds.has(m))) {
      staleLoops.push(loopName || cycleId);
    }
  }

  // --- Action items ---
  const staleActions: string[] = [];
  const actionItems = Array.isArray(synthesisData.action_items)
    ? (synthesisData.action_items as Record<string, unknown>[])
    : [];
  for (const ai of actionItems) {
    // Check entity references in action item text or entity_id field
    const entityId = typeof ai.entity_id === "string" ? ai.entity_id : "";
    const text = typeof ai.action === "string" ? ai.action.toLowerCase() : "";
    if (affectedIds.has(entityId)) {
      staleActions.push(entityId);
      continue;
    }
    // Fuzzy: check if any affected entity name appears in the action text
    for (const name of affectedNames) {
      if (name.length > 2 && text.includes(name)) {
        staleActions.push(entityId || name);
        break;
      }
    }
  }

  const totalStale =
    staleLeverage.length +
    staleRisk.length +
    staleLoops.length +
    staleActions.length;

  let recommendation: StaleReport["recommendation"] = "none";
  if (totalStale >= 4 || cascadeResult.stale_score >= 60) {
    recommendation = "re-synthesize";
  } else if (totalStale >= 1 || cascadeResult.stale_score >= 25) {
    recommendation = "review";
  }

  return {
    stale_leverage_points: staleLeverage,
    stale_risk_points: staleRisk,
    stale_feedback_loops: staleLoops,
    stale_action_entity_ids: staleActions,
    total_stale: totalStale,
    recommendation,
  };
}
