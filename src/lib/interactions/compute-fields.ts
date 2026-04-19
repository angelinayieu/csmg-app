/**
 * Layer 7: Interaction Field Computation
 *
 * Pure graph computation — no LLM calls.
 * For each entity, computes how much influence it exerts on the system
 * and how much it receives, accounting for edge strength, polarity,
 * dynamics, and cycle amplification.
 *
 * Runs post-critique, pre-synthesis inside synthesize/route.ts.
 */

import type { Entity, Edge, Cycle } from "@/types";
import type {
  InteractionField,
  EntityInfluence,
  StrategicCorridor,
  TensionZone,
} from "@/types/interactions";

// ── Adjacency structure ──

interface AdjEdge {
  targetUuid: string;
  strength: number;
  /** +1 for positive/neutral, -1 for negative, 0.5 for conditional */
  polaritySign: number;
  dynamics: string | null;
  relationshipType: string;
}

function polarityToSign(polarity: string | null): number {
  if (polarity === "negative") return -1;
  if (polarity === "conditional") return 0.5;
  return 1; // positive, neutral, null
}

function dynamicsMultiplier(dynamics: string | null): number {
  switch (dynamics) {
    case "compounding":
    case "exponential":
      return 1.3;
    case "threshold":
    case "step_function":
      return 1.1;
    case "decay":
    case "logarithmic":
      return 0.8;
    case "delayed":
      return 0.9;
    default:
      return 1.0; // linear, null
  }
}

function buildAdjacency(
  edges: Edge[],
  entityUuids: Set<string>
): Map<string, AdjEdge[]> {
  const adj = new Map<string, AdjEdge[]>();
  for (const uuid of entityUuids) adj.set(uuid, []);

  for (const e of edges) {
    if (!entityUuids.has(e.source_entity_id) || !entityUuids.has(e.target_entity_id)) continue;
    const list = adj.get(e.source_entity_id);
    if (list) {
      list.push({
        targetUuid: e.target_entity_id,
        strength: typeof e.strength === "number" ? e.strength : 0.5,
        polaritySign: polarityToSign(e.polarity),
        dynamics: e.dynamics ?? null,
        relationshipType: e.relationship_type,
      });
    }
  }
  return adj;
}

// ── Cycle amplification ──

function computeCycleAmplification(
  entityUuid: string,
  cycles: Cycle[],
  uuidToId: Map<string, string>
): number {
  const entityId = uuidToId.get(entityUuid);
  if (!entityId) return 1.0;

  let maxAmp = 1.0;
  for (const cycle of cycles) {
    const ids = cycle.entity_ids ?? [];
    if (!ids.includes(entityId)) continue;

    // Reinforcing cycles amplify, balancing cycles dampen
    if (cycle.classification === "reinforcing_positive") {
      const mult = cycle.estimated_multiplier ?? 1.2;
      maxAmp = Math.max(maxAmp, mult);
    } else if (cycle.classification === "reinforcing_negative") {
      const mult = cycle.estimated_multiplier ?? 1.15;
      maxAmp = Math.max(maxAmp, mult);
    }
    // Balancing cycles don't amplify (they stabilize)
  }
  return maxAmp;
}

// ── 2-hop influence propagation ──

interface InfluenceEntry {
  targetUuid: string;
  influence: number; // signed: positive = enabling, negative = constraining
  pathway: string;
  hops: number;
}

function computeInfluences(
  sourceUuid: string,
  adj: Map<string, AdjEdge[]>,
  uuidToId: Map<string, string>,
  uuidToName: Map<string, string>
): InfluenceEntry[] {
  const influences = new Map<string, InfluenceEntry>();

  // Hop 1: direct edges
  const directEdges = adj.get(sourceUuid) ?? [];
  for (const edge of directEdges) {
    const influence = edge.strength * edge.polaritySign * dynamicsMultiplier(edge.dynamics);
    const existing = influences.get(edge.targetUuid);
    if (!existing || Math.abs(influence) > Math.abs(existing.influence)) {
      influences.set(edge.targetUuid, {
        targetUuid: edge.targetUuid,
        influence,
        pathway: "direct",
        hops: 1,
      });
    }
  }

  // Hop 2: indirect (source → intermediate → target)
  for (const edge1 of directEdges) {
    const hop2Edges = adj.get(edge1.targetUuid) ?? [];
    for (const edge2 of hop2Edges) {
      if (edge2.targetUuid === sourceUuid) continue; // skip loops back to source

      const intermediateName = uuidToId.get(edge1.targetUuid) ?? "?";
      const influence =
        edge1.strength * edge1.polaritySign * dynamicsMultiplier(edge1.dynamics) *
        edge2.strength * edge2.polaritySign * dynamicsMultiplier(edge2.dynamics) *
        0.7; // decay factor for indirect influence

      const existing = influences.get(edge2.targetUuid);
      // Only add hop-2 if stronger than existing or no direct path
      if (!existing || (existing.hops > 1 && Math.abs(influence) > Math.abs(existing.influence))) {
        influences.set(edge2.targetUuid, {
          targetUuid: edge2.targetUuid,
          influence,
          pathway: `via ${intermediateName}`,
          hops: 2,
        });
      }
    }
  }

  return Array.from(influences.values());
}

// ── Main: compute interaction fields for all entities ──

export function computeInteractionFields(
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
  expansions?: Array<{ entity_id: string; result_data: Record<string, unknown> }> | null
): { fields: InteractionField[]; corridors: StrategicCorridor[]; tensionZones: TensionZone[] } {
  if (entities.length === 0) {
    return { fields: [], corridors: [], tensionZones: [] };
  }

  const entityUuids = new Set(entities.map((e) => e.id));
  const uuidToId = new Map<string, string>();
  const uuidToName = new Map<string, string>();
  const idToUuid = new Map<string, string>();
  for (const e of entities) {
    uuidToId.set(e.id, e.entity_id);
    uuidToName.set(e.id, e.name);
    idToUuid.set(e.entity_id, e.id);
  }

  const adj = buildAdjacency(edges, entityUuids);

  // Compute per-entity fields
  const fields: InteractionField[] = [];
  // Track inbound influence per entity for receptivity
  const inboundInfluence = new Map<string, number>();

  for (const entity of entities) {
    const influences = computeInfluences(entity.id, adj, uuidToId, uuidToName);
    const amplification = computeCycleAmplification(entity.id, cycles, uuidToId);

    // Field strength: sum of absolute outward influences, amplified by cycles
    const rawStrength = influences.reduce((sum, inf) => sum + Math.abs(inf.influence), 0);
    const amplifiedStrength = rawStrength * amplification;

    // Track inbound for receptivity
    for (const inf of influences) {
      inboundInfluence.set(
        inf.targetUuid,
        (inboundInfluence.get(inf.targetUuid) ?? 0) + Math.abs(inf.influence)
      );
    }

    // Top influences sorted by absolute magnitude
    const topInfluences: EntityInfluence[] = influences
      .sort((a, b) => Math.abs(b.influence) - Math.abs(a.influence))
      .slice(0, 8)
      .map((inf) => ({
        target_entity_id: uuidToId.get(inf.targetUuid) ?? "?",
        target_name: uuidToName.get(inf.targetUuid) ?? "Unknown",
        net_influence: Math.round(inf.influence * 1000) / 1000,
        pathway: inf.pathway,
        hops: inf.hops,
      }));

    fields.push({
      entity_id: entity.entity_id,
      entity_name: entity.name,
      field_strength: 0, // normalized later
      field_reach: influences.length,
      amplification_factor: Math.round(amplification * 100) / 100,
      receptivity: 0, // filled after all entities computed
      autonomy_ratio: 0, // filled after receptivity
      top_influences: topInfluences,
      _raw_strength: amplifiedStrength, // temp, stripped before return
    } as InteractionField & { _raw_strength: number });
  }

  // ── Expansion enrichment pass: boost field strength for internally-rich entities ──
  if (expansions && expansions.length > 0) {
    // Build expansion lookup keyed by BOTH UUID and short entity_id
    // exp.entity_id is a UUID (FK to entities.id), so we also index by the short ID
    const expansionMap = new Map<string, Record<string, unknown>>();
    for (const exp of expansions) {
      expansionMap.set(exp.entity_id, exp.result_data); // UUID key
      // Also index by short entity_id (e.g. "C1") for direct field.entity_id matching
      const shortId = uuidToId.get(exp.entity_id);
      if (shortId) expansionMap.set(shortId, exp.result_data);
    }

    for (const field of fields) {
      // field.entity_id is "C1" style, look up directly or via UUID
      const uuid = idToUuid.get(field.entity_id) ?? "";
      const expData = expansionMap.get(field.entity_id) ?? expansionMap.get(uuid);
      if (!expData) continue;

      const subComponents = Array.isArray(expData.sub_components) ? expData.sub_components : [];
      const internalPathways = Array.isArray(expData.internal_pathways) ? expData.internal_pathways : [];
      const internalDynamics = Array.isArray(expData.internal_dynamics) ? expData.internal_dynamics : [];

      // Internal complexity multiplier: entities with rich internal structure
      // exert more influence because they contain more causal mechanisms
      const pathwayMultiplier = 1 + Math.min(internalPathways.length * 0.08, 0.4);
      const dynamicsMultiplier = 1 + internalDynamics.length * 0.1;
      const componentMultiplier = 1 + Math.min(subComponents.length * 0.04, 0.2);

      // Check for internal bottlenecks — bottlenecked entities are MORE influential
      // because they concentrate causal flow
      const hasInternalBottleneck = internalDynamics.some(
        (d: any) => d.type === "bottleneck"
      );
      const bottleneckMultiplier = hasInternalBottleneck ? 1.15 : 1;

      const totalMultiplier = pathwayMultiplier * dynamicsMultiplier * componentMultiplier * bottleneckMultiplier;
      (field as any)._raw_strength *= totalMultiplier;
    }
  }

  // Normalize field_strength to 0-1 and fill receptivity
  const maxStrength = Math.max(...fields.map((f) => (f as any)._raw_strength), 0.001);
  for (const field of fields) {
    const uuid = idToUuid.get(field.entity_id) ?? "";
    field.field_strength = Math.round(((field as any)._raw_strength / maxStrength) * 100) / 100;
    field.receptivity = Math.round((inboundInfluence.get(uuid) ?? 0) / maxStrength * 100) / 100;
    field.autonomy_ratio = field.receptivity > 0
      ? Math.round((field.field_strength / field.receptivity) * 100) / 100
      : field.field_strength > 0 ? 10 : 0; // pure driver if no inbound
    delete (field as any)._raw_strength;
  }

  // Sort by field_strength descending
  fields.sort((a, b) => b.field_strength - a.field_strength);

  // ── Strategic corridors: find top paths of length 3-4 ──
  const corridors = findStrategicCorridors(adj, uuidToId, uuidToName, entities, cycles);

  // ── Tension zones: entities receiving opposing influences ──
  const tensionZones = findTensionZones(entities, edges, uuidToId, uuidToName);

  return { fields, corridors, tensionZones };
}

// ── Strategic corridor discovery ──
// DFS from high-importance entities, tracking path strength

function findStrategicCorridors(
  adj: Map<string, AdjEdge[]>,
  uuidToId: Map<string, string>,
  uuidToName: Map<string, string>,
  entities: Entity[],
  cycles: Cycle[]
): StrategicCorridor[] {
  const corridors: StrategicCorridor[] = [];
  const cycleEntityIds = new Set<string>();
  for (const c of cycles) {
    for (const id of c.entity_ids ?? []) cycleEntityIds.add(id);
  }

  // Start from leverage points and high-importance entities
  const seeds = entities.filter(
    (e) => e.is_leverage_point || e.importance === "fundamental" || e.importance === "critical"
  );

  for (const seed of seeds) {
    const paths = dfsCorridors(seed.id, adj, 4, new Set());
    for (const path of paths) {
      if (path.length < 3) continue;

      let totalStrength = 1;
      let minStrength = 1;
      let bottleneckUuid: string | null = null;
      let hasNegative = false;

      for (let i = 0; i < path.length - 1; i++) {
        const edgesFrom = adj.get(path[i]) ?? [];
        const edge = edgesFrom.find((e) => e.targetUuid === path[i + 1]);
        if (!edge) continue;

        const s = edge.strength * dynamicsMultiplier(edge.dynamics);
        totalStrength *= s;
        if (s < minStrength) {
          minStrength = s;
          bottleneckUuid = path[i + 1];
        }
        if (edge.polaritySign < 0) hasNegative = true;
      }

      const amplified = path.some((uuid) => cycleEntityIds.has(uuidToId.get(uuid) ?? ""));

      corridors.push({
        path: path.map((uuid) => uuidToId.get(uuid) ?? "?"),
        path_names: path.map((uuid) => uuidToName.get(uuid) ?? "Unknown"),
        total_strength: Math.round(totalStrength * 1000) / 1000,
        bottleneck_at: bottleneckUuid ? (uuidToId.get(bottleneckUuid) ?? null) : null,
        amplified,
        polarity: hasNegative ? "complex" : "enabling",
      });
    }
  }

  // Deduplicate and take top corridors by strength
  const seen = new Set<string>();
  const unique = corridors.filter((c) => {
    const key = c.path.join("→");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique
    .sort((a, b) => b.total_strength - a.total_strength)
    .slice(0, 10);
}

function dfsCorridors(
  current: string,
  adj: Map<string, AdjEdge[]>,
  maxDepth: number,
  visited: Set<string>
): string[][] {
  if (maxDepth <= 0) return [[current]];
  visited.add(current);

  const paths: string[][] = [[current]]; // path of just this node
  const neighbors = adj.get(current) ?? [];

  for (const edge of neighbors) {
    if (visited.has(edge.targetUuid)) continue;
    if (edge.strength < 0.3) continue; // skip weak edges

    const subPaths = dfsCorridors(edge.targetUuid, adj, maxDepth - 1, new Set(visited));
    for (const sp of subPaths) {
      if (sp.length >= 2) { // only extend if subpath has substance
        paths.push([current, ...sp]);
      }
    }
  }

  return paths;
}

// ── Tension zone detection ──

function findTensionZones(
  entities: Entity[],
  edges: Edge[],
  uuidToId: Map<string, string>,
  uuidToName: Map<string, string>
): TensionZone[] {
  const zones: TensionZone[] = [];

  // Build inbound edge map per target
  const inbound = new Map<string, Array<{ sourceUuid: string; influence: number }>>();
  for (const e of edges) {
    const sign = polarityToSign(e.polarity);
    const influence = (typeof e.strength === "number" ? e.strength : 0.5) * sign;
    const list = inbound.get(e.target_entity_id) ?? [];
    list.push({ sourceUuid: e.source_entity_id, influence });
    inbound.set(e.target_entity_id, list);
  }

  for (const entity of entities) {
    const incoming = inbound.get(entity.id) ?? [];
    if (incoming.length < 2) continue;

    const positive = incoming.filter((i) => i.influence > 0);
    const negative = incoming.filter((i) => i.influence < 0);

    if (positive.length === 0 || negative.length === 0) continue;

    const posSum = positive.reduce((s, i) => s + i.influence, 0);
    const negSum = Math.abs(negative.reduce((s, i) => s + i.influence, 0));
    const tension = Math.min(posSum, negSum) * 2; // tension = overlap of opposing forces

    if (tension < 0.3) continue; // below threshold

    zones.push({
      entity_id: entity.entity_id,
      entity_name: entity.name,
      positive_drivers: positive.map((p) => uuidToId.get(p.sourceUuid) ?? "?"),
      negative_drivers: negative.map((n) => uuidToId.get(n.sourceUuid) ?? "?"),
      tension_magnitude: Math.round(tension * 100) / 100,
    });
  }

  return zones
    .sort((a, b) => b.tension_magnitude - a.tension_magnitude)
    .slice(0, 8);
}
