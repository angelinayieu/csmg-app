/**
 * Expansion Materializer
 *
 * Converts expansion JSONB data (sub-components, internal pathways, internal dynamics)
 * into actual graph entities and edges. This is the critical missing link between
 * the expansion system and graph density — without materialization, expansion data
 * stays locked in a side table and never becomes visible graph topology.
 *
 * Each sub-component becomes a child entity linked to its parent via "has_component".
 * Each internal pathway becomes an edge between child entities.
 * Each internal dynamic (bottleneck, gate, feedback loop) becomes a special edge.
 *
 * Pattern follows signal-materializer.ts for consistency.
 */

import type { Entity, Edge } from "@/types";
import type { SubComponent, InternalPathway, InternalDynamic } from "@/types/expansion";

// ── Types ──

export interface ExpansionRow {
  id: string;
  entity_id: string;
  space_id: string;
  depth_level: number;
  sub_components: SubComponent[];
  internal_pathways: InternalPathway[];
  internal_dynamics: InternalDynamic[];
  materialized_at?: string | null;
}

export interface MaterializedEntity {
  entity_id: string; // SC_{parentEntityId}_{scId}
  name: string;
  description: string;
  parent_entity_id: string; // UUID of parent
  parent_entity_string_id: string; // string entity_id of parent
  expansion_id: string;
  component_type: string;
  importance: "critical" | "important" | "moderate" | "minor";
  probability: number;
  manifold?: {
    controllability: "direct" | "indirect" | "uncontrollable";
    visibility: "observable" | "latent" | "hidden";
    volatility: "stable" | "fluctuating" | "chaotic";
  };
  sc_local_id: string; // original SC id (e.g. "SC1")
}

export interface MaterializedEdge {
  source_entity_string_id: string;
  target_entity_string_id: string;
  relationship_type: string;
  dimension: string;
  strength: number;
  confidence: number;
  polarity: string;
  conditions: string | null;
  dynamics: string | null;
  mechanism?: string;
  failure_mode?: string | null;
  source_type: "internal_pathway" | "internal_dynamic" | "has_component" | "inherited_connection";
}

export interface ExpansionMaterializationResult {
  entities: MaterializedEntity[];
  edges: MaterializedEdge[];
  parent_component_edges: MaterializedEdge[];
  stats: {
    expansions_processed: number;
    expansions_skipped: number;
    entities_produced: number;
    pathway_edges_produced: number;
    dynamic_edges_produced: number;
    component_edges_produced: number;
    inherited_edges_produced: number;
  };
}

// ── Config ──

const MAX_SUBCOMPONENTS_PER_ENTITY = Infinity; // No output cap — keep all sub-components

// Map expansion dynamics to valid edge dynamics
const DYNAMICS_MAP: Record<string, string> = {
  sequential: "linear",
  parallel: "linear",
  conditional: "threshold",
  probabilistic: "step_function",
};

// Map internal dynamic types to edge relationship types and dimensions
const DYNAMIC_TYPE_MAP: Record<string, { relationship_type: string; dimension: string; polarity: string }> = {
  bottleneck: { relationship_type: "constrains", dimension: "structural", polarity: "negative" },
  feedback_loop: { relationship_type: "reinforces", dimension: "causal", polarity: "positive" },
  gate: { relationship_type: "gates", dimension: "causal", polarity: "conditional" },
  amplifier: { relationship_type: "amplifies", dimension: "causal", polarity: "positive" },
  decay: { relationship_type: "decays", dimension: "temporal", polarity: "negative" },
};

// ── Core Computation ──

/**
 * Compute all entities and edges to create from expansion data.
 * Pure function — no DB access.
 *
 * When existingEdges are provided, also creates "inherited" edges that connect
 * each expanded entity's sub-components back to the parent's neighbors.
 * This prevents expansion from creating isolated islands in the graph.
 */
export function computeExpansionMaterializations(
  expansions: ExpansionRow[],
  parentEntities: Entity[],
  existingEntities: Entity[],
  existingEdges?: Edge[],
): ExpansionMaterializationResult {
  const parentMap = new Map<string, Entity>();
  for (const e of parentEntities) parentMap.set(e.id, e);

  // Track existing materialized entity_ids to prevent duplication
  const existingEntityIds = new Set(existingEntities.map((e) => e.entity_id));

  const allEntities: MaterializedEntity[] = [];
  const allEdges: MaterializedEdge[] = [];
  const allParentEdges: MaterializedEdge[] = [];

  // Track parent UUID → list of sub-component entity_ids (sorted by importance)
  const parentUuidToScs = new Map<string, string[]>();
  // Track parent UUID → parent entity_id string
  const parentUuidToEntityId = new Map<string, string>();

  let expansionsProcessed = 0;
  let expansionsSkipped = 0;

  // Importance ordering for sub-component sorting
  const impRank: Record<string, number> = { critical: 0, important: 1, moderate: 2, minor: 3 };

  for (const expansion of expansions) {
    const parent = parentMap.get(expansion.entity_id);
    if (!parent) {
      expansionsSkipped++;
      continue;
    }

    const scs = Array.isArray(expansion.sub_components) ? expansion.sub_components : [];
    if (scs.length < 2) {
      expansionsSkipped++;
      continue;
    }

    // Check if already materialized by looking for existing child entities
    const prefix = `SC_${parent.entity_id}_`;
    const alreadyMaterialized = existingEntities.some((e) => e.entity_id.startsWith(prefix));
    if (alreadyMaterialized) {
      expansionsSkipped++;
      continue;
    }

    // ── Materialize sub-components as entities ──

    const cappedScs = scs.slice(0, MAX_SUBCOMPONENTS_PER_ENTITY);
    const scEntityIdMap = new Map<string, string>(); // local SC id → full entity_id
    const scImportanceList: Array<{ entityId: string; importance: string }> = [];

    for (const sc of cappedScs) {
      const localId = sc.id || `SC${cappedScs.indexOf(sc) + 1}`;
      const entityId = `${prefix}${localId}`;

      if (existingEntityIds.has(entityId)) continue;
      existingEntityIds.add(entityId);

      scEntityIdMap.set(localId, entityId);
      scImportanceList.push({ entityId, importance: sc.importance || "moderate" });

      allEntities.push({
        entity_id: entityId,
        name: sc.name,
        description: sc.description || `Internal component of ${parent.name}`,
        parent_entity_id: parent.id,
        parent_entity_string_id: parent.entity_id,
        expansion_id: expansion.id,
        component_type: sc.component_type || "variable",
        importance: sc.importance || "moderate",
        probability: typeof sc.probability === "number" ? sc.probability : 0.5,
        manifold: sc.manifold,
        sc_local_id: localId,
      });

      // Create has_component edge from parent
      allParentEdges.push({
        source_entity_string_id: parent.entity_id,
        target_entity_string_id: entityId,
        relationship_type: "has_component",
        dimension: "structural",
        strength: 0.9,
        confidence: 0.85,
        polarity: "positive",
        conditions: null,
        dynamics: null,
        source_type: "has_component",
      });
    }

    // Sort sub-components by importance for inherited edge selection
    scImportanceList.sort((a, b) => (impRank[a.importance] ?? 2) - (impRank[b.importance] ?? 2));
    const sortedScIds = scImportanceList.map((s) => s.entityId);
    if (sortedScIds.length > 0) {
      parentUuidToScs.set(parent.id, sortedScIds);
      parentUuidToEntityId.set(parent.id, parent.entity_id);
    }

    // ── Materialize internal pathways as edges ──

    const pathways = Array.isArray(expansion.internal_pathways) ? expansion.internal_pathways : [];
    for (const pw of pathways) {
      const srcId = scEntityIdMap.get(pw.source_id);
      const tgtId = scEntityIdMap.get(pw.target_id);
      if (!srcId || !tgtId) continue;

      allEdges.push({
        source_entity_string_id: srcId,
        target_entity_string_id: tgtId,
        relationship_type: "internal_pathway",
        dimension: "causal",
        strength: typeof pw.strength === "number" ? pw.strength : 0.6,
        confidence: typeof pw.probability === "number" ? pw.probability : 0.5,
        polarity: "positive",
        conditions: pw.conditions ?? null,
        dynamics: DYNAMICS_MAP[pw.dynamics] ?? null,
        mechanism: pw.mechanism,
        failure_mode: pw.failure_mode ?? null,
        source_type: "internal_pathway",
      });
    }

    // ── Materialize internal dynamics as special edges ──

    const dynamics = Array.isArray(expansion.internal_dynamics) ? expansion.internal_dynamics : [];
    for (const dyn of dynamics) {
      const mapping = DYNAMIC_TYPE_MAP[dyn.type] ?? DYNAMIC_TYPE_MAP.bottleneck;
      const compIds = Array.isArray(dyn.component_ids) ? dyn.component_ids : [];

      if (dyn.type === "feedback_loop" && compIds.length >= 2) {
        // Create cycle edges between consecutive components
        for (let i = 0; i < compIds.length; i++) {
          const srcId = scEntityIdMap.get(compIds[i]);
          const tgtId = scEntityIdMap.get(compIds[(i + 1) % compIds.length]);
          if (!srcId || !tgtId) continue;

          allEdges.push({
            source_entity_string_id: srcId,
            target_entity_string_id: tgtId,
            relationship_type: mapping.relationship_type,
            dimension: mapping.dimension,
            strength: 0.7,
            confidence: 0.6,
            polarity: mapping.polarity,
            conditions: dyn.description,
            dynamics: "compounding",
            source_type: "internal_dynamic",
          });
        }
      } else if (compIds.length >= 2) {
        // For bottleneck/gate/amplifier/decay — edge from first to second component
        const srcId = scEntityIdMap.get(compIds[0]);
        const tgtId = scEntityIdMap.get(compIds[1]);
        if (srcId && tgtId) {
          allEdges.push({
            source_entity_string_id: srcId,
            target_entity_string_id: tgtId,
            relationship_type: mapping.relationship_type,
            dimension: mapping.dimension,
            strength: 0.65,
            confidence: 0.6,
            polarity: mapping.polarity,
            conditions: dyn.description,
            dynamics: dyn.type === "bottleneck" ? "threshold" : null,
            source_type: "internal_dynamic",
          });
        }
      }
    }

    expansionsProcessed++;
  }

  // ── Create inherited edges: connect sub-components to parent's existing neighbors ──
  // This prevents expansions from creating isolated islands. For each edge involving
  // an expanded parent, we create a reduced-strength "inherited_connection" edge from
  // the parent's most important sub-component to the neighbor entity.

  let inheritedEdgesProduced = 0;

  if (existingEdges && existingEdges.length > 0 && parentUuidToScs.size > 0) {
    // Map UUID → entity_id string for all entities in the space
    const uuidToEntityIdStr = new Map<string, string>();
    for (const e of existingEntities) {
      uuidToEntityIdStr.set(e.id, e.entity_id);
    }
    for (const e of parentEntities) {
      uuidToEntityIdStr.set(e.id, e.entity_id);
    }

    // Track already-created inherited edges to avoid duplicates
    const inheritedPairs = new Set<string>();

    for (const edge of existingEdges) {
      const srcIsExpanded = parentUuidToScs.has(edge.source_entity_id);
      const tgtIsExpanded = parentUuidToScs.has(edge.target_entity_id);

      if (!srcIsExpanded && !tgtIsExpanded) continue;

      // Skip existing composition edges — don't create inherited edges for them
      const edgeRel = edge.relationship_type ?? "";
      if (edgeRel === "has_component" || edgeRel === "internal_pathway" || edgeRel === "inherited_connection") continue;

      const origStrength = typeof edge.strength === "number" ? edge.strength : 0.5;
      const origConf = typeof edge.confidence === "number" ? edge.confidence : 0.5;
      const inheritedStrength = origStrength * 0.6;
      const inheritedConf = Math.min(origConf, 0.65);

      if (srcIsExpanded && tgtIsExpanded) {
        // Both expanded → connect their top sub-components (cross-expansion edge)
        const srcScs = parentUuidToScs.get(edge.source_entity_id)!;
        const tgtScs = parentUuidToScs.get(edge.target_entity_id)!;
        const pairKey = `${srcScs[0]}-${tgtScs[0]}`;
        if (!inheritedPairs.has(pairKey)) {
          inheritedPairs.add(pairKey);
          allEdges.push({
            source_entity_string_id: srcScs[0],
            target_entity_string_id: tgtScs[0],
            relationship_type: "inherited_connection",
            dimension: edge.dimension ?? "structural",
            strength: inheritedStrength,
            confidence: inheritedConf,
            polarity: edge.polarity ?? "positive",
            conditions: null,
            dynamics: null,
            source_type: "inherited_connection",
          });
          inheritedEdgesProduced++;
        }
      } else if (srcIsExpanded) {
        // Source expanded, target is regular entity → connect top SC to target
        const srcScs = parentUuidToScs.get(edge.source_entity_id)!;
        const targetEntityIdStr = uuidToEntityIdStr.get(edge.target_entity_id);
        if (targetEntityIdStr) {
          const pairKey = `${srcScs[0]}-${targetEntityIdStr}`;
          if (!inheritedPairs.has(pairKey)) {
            inheritedPairs.add(pairKey);
            allEdges.push({
              source_entity_string_id: srcScs[0],
              target_entity_string_id: targetEntityIdStr,
              relationship_type: "inherited_connection",
              dimension: edge.dimension ?? "structural",
              strength: inheritedStrength,
              confidence: inheritedConf,
              polarity: edge.polarity ?? "positive",
              conditions: null,
              dynamics: null,
              source_type: "inherited_connection",
            });
            inheritedEdgesProduced++;
          }
        }
      } else if (tgtIsExpanded) {
        // Target expanded, source is regular entity → connect source to target's top SC
        const tgtScs = parentUuidToScs.get(edge.target_entity_id)!;
        const sourceEntityIdStr = uuidToEntityIdStr.get(edge.source_entity_id);
        if (sourceEntityIdStr) {
          const pairKey = `${sourceEntityIdStr}-${tgtScs[0]}`;
          if (!inheritedPairs.has(pairKey)) {
            inheritedPairs.add(pairKey);
            allEdges.push({
              source_entity_string_id: sourceEntityIdStr,
              target_entity_string_id: tgtScs[0],
              relationship_type: "inherited_connection",
              dimension: edge.dimension ?? "structural",
              strength: inheritedStrength,
              confidence: inheritedConf,
              polarity: edge.polarity ?? "positive",
              conditions: null,
              dynamics: null,
              source_type: "inherited_connection",
            });
            inheritedEdgesProduced++;
          }
        }
      }
    }

    if (inheritedEdgesProduced > 0) {
      console.log(`[expansion-materializer] Created ${inheritedEdgesProduced} inherited edges connecting sub-components to parent neighbors`);
    }
  }

  return {
    entities: allEntities,
    edges: allEdges,
    parent_component_edges: allParentEdges,
    stats: {
      expansions_processed: expansionsProcessed,
      expansions_skipped: expansionsSkipped,
      entities_produced: allEntities.length,
      pathway_edges_produced: allEdges.filter((e) => e.source_type === "internal_pathway").length,
      dynamic_edges_produced: allEdges.filter((e) => e.source_type === "internal_dynamic").length,
      component_edges_produced: allParentEdges.length,
      inherited_edges_produced: inheritedEdgesProduced,
    },
  };
}

// ── Record Builders (for DB insertion) ──

/**
 * Build entity records ready for DB insert.
 */
export function buildExpansionEntityRecords(
  spaceId: string,
  materializedEntities: MaterializedEntity[],
): Array<Record<string, unknown>> {
  return materializedEntities.map((me) => ({
    space_id: spaceId,
    entity_id: me.entity_id,
    name: me.name,
    description: me.description,
    entity_type: me.component_type,
    entity_category: mapComponentTypeToCategory(me.component_type),
    knowledge_layer: "conceptual",
    source_tag: "implicit",
    importance: me.importance,
    authority_level: "moderate",
    confidence: me.probability,
    blast_radius: me.importance === "critical" ? 60 : me.importance === "important" ? 40 : 20,
    is_leverage_point: false,
    is_risk_point: false,
    is_master_bottleneck: false,
    is_shared_variable: false,
    is_decomposable: false,
    has_sub_space: false,
    manifold: me.manifold ?? null,
    provenance: {
      source_type: "expansion_materialization",
      parent_entity_id: me.parent_entity_id,
      parent_entity_string_id: me.parent_entity_string_id,
      expansion_id: me.expansion_id,
      component_type: me.component_type,
      sc_local_id: me.sc_local_id,
    },
  }));
}

/**
 * Build edge records ready for DB insert.
 * Requires entityIdToUuid map (string entity_id → UUID) for foreign key resolution.
 */
export function buildExpansionEdgeRecords(
  spaceId: string,
  materializedEdges: MaterializedEdge[],
  entityIdToUuid: Map<string, string>,
): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];

  for (const me of materializedEdges) {
    const srcUuid = entityIdToUuid.get(me.source_entity_string_id);
    const tgtUuid = entityIdToUuid.get(me.target_entity_string_id);
    if (!srcUuid || !tgtUuid) continue;

    records.push({
      space_id: spaceId,
      source_entity_id: srcUuid,
      target_entity_id: tgtUuid,
      relationship_type: me.relationship_type,
      dimension: me.dimension,
      source_tag: "inferred",
      strength: me.strength,
      polarity: me.polarity,
      confidence: me.confidence,
      conditions: me.conditions,
      dynamics: me.dynamics,
      // All expansion edges are internal/conceptual — NOT bridges.
      // has_component is structural parent→child, not an inter-domain bridge.
      knowledge_layer: "internal",
      is_low_confidence: me.confidence < 0.4,
      provenance: {
        source_type: "expansion_materialization",
        materialization_source: me.source_type,
        ...(me.mechanism ? { mechanism: me.mechanism } : {}),
        ...(me.failure_mode ? { failure_mode: me.failure_mode } : {}),
      },
    });
  }

  return records;
}

// ── Orphan Detection ──

/**
 * Find entities with zero edges in the graph.
 * Returns UUIDs of orphan entities.
 */
export function identifyOrphanEntities(
  entities: Entity[],
  edges: Edge[],
): string[] {
  const connectedIds = new Set<string>();
  for (const e of edges) {
    connectedIds.add(e.source_entity_id);
    connectedIds.add(e.target_entity_id);
  }

  return entities
    .filter((e) => !connectedIds.has(e.id))
    .map((e) => e.id);
}

// ── Helpers ──

function mapComponentTypeToCategory(componentType: string): string {
  switch (componentType) {
    case "milestone":
    case "metric":
      return "concrete";
    case "capability":
    case "condition":
    case "variable":
      return "abstract";
    case "process":
    case "gate":
      return "process";
    default:
      return "abstract";
  }
}
