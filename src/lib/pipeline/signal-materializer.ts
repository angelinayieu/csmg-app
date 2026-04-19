/**
 * Signal Materializer
 *
 * Converts hidden signals and cross-context insights from metadata
 * into real entities and edges in the knowledge graph.
 *
 * Hidden signals are the LLM's highest-value output — mediating variables,
 * structural risks, missing metrics — but they're stored as JSONB metadata
 * and never become visible graph objects. This module materializes them.
 *
 * Cross-context insights identify relationships between external and internal
 * entities but never create the actual bridge edges. This module hydrates them.
 */

import type { Entity, Edge } from "@/types";

// ── Types (matching research route interfaces) ──

export interface HiddenSignal {
  signal_name: string;
  signal_type:
    | "mediating_variable"
    | "analogous_dynamic"
    | "structural_risk"
    | "missing_metric";
  description: string;
  trajectory_impact: number;
  related_internal_entities?: string[];
  detection_method: string;
  analogous_precedent?: string | null;
}

export interface CrossContextInsight {
  insight: string;
  external_entities_involved?: string[];
  internal_entities_involved?: string[];
  confidence?: "high" | "moderate" | "low";
  type?: "validation" | "challenge" | "opportunity" | "risk";
}

export interface MaterializationConfig {
  /** Minimum trajectory_impact to materialize a hidden signal (1-10 scale). Default: 6 */
  min_trajectory_impact: number;
  /** Minimum insight confidence to create bridge edges. Default: "moderate" */
  min_insight_confidence: "high" | "moderate" | "low";
  /** Maximum entities to materialize from hidden signals. Default: 8 */
  max_materialized_entities: number;
}

export interface MaterializedEntity {
  entity_id: string;
  name: string;
  source: "hidden_signal" | "cross_context_insight";
  signal_type?: string;
}

export interface MaterializedEdge {
  source_entity_id: string;
  target_entity_id: string;
  type: string;
  source: "hidden_signal" | "cross_context_insight";
}

export interface MaterializationResult {
  entities_created: MaterializedEntity[];
  edges_created: MaterializedEdge[];
  skipped: Array<{ name: string; reason: string }>;
}

// ── Defaults ──

const DEFAULT_CONFIG: MaterializationConfig = {
  min_trajectory_impact: 4,
  min_insight_confidence: "low",
  max_materialized_entities: 999, // No effective cap — keep everything the LLM produces
};

const CONFIDENCE_ORDER: Record<string, number> = {
  high: 3,
  moderate: 2,
  low: 1,
};

// ── Helpers ──

function sanitizeEntityId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function nameMatchesExisting(
  name: string,
  existingEntities: Entity[]
): boolean {
  const lower = name.toLowerCase().trim();
  return existingEntities.some((e) => {
    const eName = (e.name ?? "").toLowerCase().trim();
    return eName === lower || eName.includes(lower) || lower.includes(eName);
  });
}

function edgeExists(
  sourceId: string,
  targetId: string,
  existingEdges: Edge[]
): boolean {
  return existingEdges.some(
    (e) =>
      (e.source_entity_id === sourceId && e.target_entity_id === targetId) ||
      (e.source_entity_id === targetId && e.target_entity_id === sourceId)
  );
}

function strengthFromConfidence(
  confidence: "high" | "moderate" | "low" | undefined
): number {
  switch (confidence) {
    case "high":
      return 0.8;
    case "moderate":
      return 0.6;
    case "low":
      return 0.4;
    default:
      return 0.5;
  }
}

// ── Signal Type → Entity/Edge Config ──

interface SignalMaterializationSpec {
  entity_category: string;
  relationship_type: string;
  dimension: string;
  polarity: string;
  min_impact: number;
}

const SIGNAL_SPECS: Record<string, SignalMaterializationSpec> = {
  mediating_variable: {
    entity_category: "epistemic",
    relationship_type: "mediates",
    dimension: "causal",
    polarity: "positive",
    min_impact: 6,
  },
  structural_risk: {
    entity_category: "relational",
    relationship_type: "risk_source",
    dimension: "causal",
    polarity: "negative",
    min_impact: 7,
  },
  missing_metric: {
    entity_category: "concrete",
    relationship_type: "measures",
    dimension: "epistemic",
    polarity: "positive",
    min_impact: 6,
  },
  // analogous_dynamic: insights only, not materialized as entities
};

const INSIGHT_RELATIONSHIP_MAP: Record<string, string> = {
  validation: "validates_bridge",
  challenge: "challenges_bridge",
  opportunity: "extends_bridge",
  risk: "risk_bridge",
};

// ── Main Function ──

/**
 * Materialize hidden signals and cross-context insights into real graph objects.
 *
 * This function is SYNCHRONOUS and returns the entities/edges to create.
 * The caller (research route) handles the actual DB inserts.
 */
export function computeMaterializations(
  spaceId: string,
  hiddenSignals: HiddenSignal[],
  crossContextInsights: CrossContextInsight[],
  existingEntities: Entity[],
  existingEdges: Edge[],
  configOverrides?: Partial<MaterializationConfig>
): MaterializationResult {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const result: MaterializationResult = {
    entities_created: [],
    edges_created: [],
    skipped: [],
  };

  // Track what we create so we don't duplicate within this run
  const createdEntityIds = new Set<string>();

  // ── A. Materialize hidden signals ──

  // Sort by trajectory_impact descending — materialize highest impact first
  const sortedSignals = [...hiddenSignals].sort(
    (a, b) => b.trajectory_impact - a.trajectory_impact
  );

  for (const signal of sortedSignals) {
    // Check entity cap
    if (result.entities_created.length >= config.max_materialized_entities) {
      result.skipped.push({
        name: signal.signal_name,
        reason: `Entity cap reached (${config.max_materialized_entities})`,
      });
      continue;
    }

    // Check signal type has a materialization spec
    const spec = SIGNAL_SPECS[signal.signal_type];
    if (!spec) {
      result.skipped.push({
        name: signal.signal_name,
        reason: `Signal type "${signal.signal_type}" not materialized as entity`,
      });
      continue;
    }

    // Check trajectory impact threshold
    if (signal.trajectory_impact < Math.max(spec.min_impact, config.min_trajectory_impact)) {
      result.skipped.push({
        name: signal.signal_name,
        reason: `Impact ${signal.trajectory_impact} below threshold ${Math.max(spec.min_impact, config.min_trajectory_impact)}`,
      });
      continue;
    }

    // Check dedup against existing entities
    if (nameMatchesExisting(signal.signal_name, existingEntities)) {
      result.skipped.push({
        name: signal.signal_name,
        reason: "Duplicate: entity with similar name already exists",
      });
      // Still create edges even if entity is a duplicate
      const existingMatch = existingEntities.find(
        (e) => (e.name ?? "").toLowerCase().trim() === signal.signal_name.toLowerCase().trim()
      );
      if (existingMatch && signal.related_internal_entities?.length) {
        for (const internalId of signal.related_internal_entities) {
          if (!edgeExists(existingMatch.entity_id, internalId, existingEdges)) {
            result.edges_created.push({
              source_entity_id: existingMatch.entity_id,
              target_entity_id: internalId,
              type: spec.relationship_type,
              source: "hidden_signal",
            });
          }
        }
      }
      continue;
    }

    // Create entity
    const entityId = `XSIG_${sanitizeEntityId(signal.signal_name)}`;

    if (createdEntityIds.has(entityId)) {
      result.skipped.push({
        name: signal.signal_name,
        reason: "Duplicate entity_id within this run",
      });
      continue;
    }

    createdEntityIds.add(entityId);

    result.entities_created.push({
      entity_id: entityId,
      name: signal.signal_name,
      source: "hidden_signal",
      signal_type: signal.signal_type,
    });

    // Create bridge edges to related internal entities
    if (signal.related_internal_entities?.length) {
      for (const internalId of signal.related_internal_entities) {
        if (!edgeExists(entityId, internalId, existingEdges)) {
          result.edges_created.push({
            source_entity_id: entityId,
            target_entity_id: internalId,
            type: spec.relationship_type,
            source: "hidden_signal",
          });
        }
      }
    }
  }

  // ── B. Materialize cross-context insights as bridge edges ──

  const minConfLevel = CONFIDENCE_ORDER[config.min_insight_confidence] ?? 2;

  for (const insight of crossContextInsights) {
    const confLevel = CONFIDENCE_ORDER[insight.confidence ?? "low"] ?? 1;
    if (confLevel < minConfLevel) continue;

    const externalIds = insight.external_entities_involved ?? [];
    const internalIds = insight.internal_entities_involved ?? [];

    // Only materialize if both sides are populated
    if (externalIds.length === 0 || internalIds.length === 0) continue;

    const relationshipType =
      INSIGHT_RELATIONSHIP_MAP[insight.type ?? "validation"] ?? "relates_to_bridge";
    const strength = strengthFromConfidence(insight.confidence);

    // Create bridge edges for each external↔internal pair
    for (const extId of externalIds) {
      for (const intId of internalIds) {
        // Check if this edge already exists
        if (
          edgeExists(extId, intId, existingEdges) ||
          result.edges_created.some(
            (e) =>
              (e.source_entity_id === extId && e.target_entity_id === intId) ||
              (e.source_entity_id === intId && e.target_entity_id === extId)
          )
        ) {
          continue;
        }

        result.edges_created.push({
          source_entity_id: extId,
          target_entity_id: intId,
          type: relationshipType,
          source: "cross_context_insight",
        });
      }
    }
  }

  return result;
}

/**
 * Build entity insert records from materialization results.
 * Caller handles the actual DB insert.
 */
export function buildMaterializedEntityRecords(
  spaceId: string,
  entities: MaterializedEntity[],
  hiddenSignals: HiddenSignal[]
): Array<Record<string, unknown>> {
  return entities.map((me) => {
    const signal = hiddenSignals.find(
      (s) => sanitizeEntityId(s.signal_name) === me.entity_id.replace("XSIG_", "")
    );
    const spec = signal ? SIGNAL_SPECS[signal.signal_type] : null;

    return {
      space_id: spaceId,
      entity_id: me.entity_id,
      name: me.name,
      description: signal?.description ?? `Materialized from ${me.source}`,
      entity_type: me.signal_type ?? "signal",
      entity_category: spec?.entity_category ?? "epistemic",
      knowledge_layer: "external",
      source_tag: "assumed",
      importance: "moderate",
      authority_level: "unverified",
      confidence: 0.4,
      provenance: {
        source_type: "signal_materialization",
        signal_type: me.signal_type,
        intelligence_tier: "embedded", // materialized signals are always embedded
        detection_method: signal?.detection_method ?? "structural_analysis",
        analogous_precedent: signal?.analogous_precedent ?? null,
        trajectory_impact: signal?.trajectory_impact ?? null,
      },
    };
  });
}

// ── Sub-Component & Interaction Materialization ──

export interface SubComponentEntity {
  entity_id: string;
  name: string;
  role: string;
  parent_entity_id: string;
  parent_name: string;
}

export interface InteractionEdge {
  source_entity_id: string;
  target_entity_id: string;
  interaction_type: string;
  combined_effect: string;
}

export interface CausalEdge {
  source_entity_id: string;
  target_entity_id: string;
  direction: "upstream" | "downstream";
}

export interface DecompositionResult {
  sub_component_entities: SubComponentEntity[];
  sub_component_edges: MaterializedEdge[];
  interaction_edges: InteractionEdge[];
  causal_edges: CausalEdge[];
}

/**
 * Extract sub-components, interaction effects, and causal chains from entity
 * provenance data and produce entities/edges to materialize them in the graph.
 *
 * This turns the hidden JSON metadata into real graph topology.
 */
export function computeDecompositions(
  entities: Entity[],
  existingEntities: Entity[],
  existingEdges: Edge[],
): DecompositionResult {
  const result: DecompositionResult = {
    sub_component_entities: [],
    sub_component_edges: [],
    interaction_edges: [],
    causal_edges: [],
  };

  const allEntityNames = new Map<string, string>(); // lowercase name -> entity_id
  for (const e of [...entities, ...existingEntities]) {
    allEntityNames.set((e.name ?? "").toLowerCase().trim(), e.entity_id);
  }

  const createdSubIds = new Set<string>();

  for (const entity of entities) {
    const prov = (entity.provenance as Record<string, unknown>) ?? {};
    const subComponents = prov.sub_components as Array<{ name: string; role: string; sub_sub_components?: string[] }> | null;
    const interactionEffects = prov.interaction_effects as Array<{
      with_entity: string;
      combined_effect: string;
      interaction_type: string;
    }> | null;
    const causalUpstream = prov.causal_upstream as string[] | null;
    const causalDownstream = prov.causal_downstream as string[] | null;

    // A. Materialize sub-components as child entities
    if (Array.isArray(subComponents) && subComponents.length > 0) {
      for (const sc of subComponents) { // No cap — materialize ALL sub-components the LLM produced
        const scId = `SUB_${sanitizeEntityId(entity.entity_id)}_${sanitizeEntityId(sc.name)}`;
        if (createdSubIds.has(scId)) continue;
        if (nameMatchesExisting(sc.name, existingEntities)) continue;
        createdSubIds.add(scId);

        result.sub_component_entities.push({
          entity_id: scId,
          name: sc.name,
          role: sc.role,
          parent_entity_id: entity.entity_id,
          parent_name: entity.name ?? entity.entity_id,
        });

        // Edge from parent to sub-component
        result.sub_component_edges.push({
          source_entity_id: entity.entity_id,
          target_entity_id: scId,
          type: "has_component",
          source: "cross_context_insight",
        });

        // D. Level 2 decomposition: materialize sub_sub_components as even deeper children
        if (Array.isArray(sc.sub_sub_components) && sc.sub_sub_components.length > 0) {
          for (const ssc of sc.sub_sub_components) { // No cap — keep all sub-sub-components
            const sscName = typeof ssc === "string" ? ssc : String(ssc);
            if (!sscName || sscName.length < 2) continue;
            const sscId = `SUB2_${sanitizeEntityId(entity.entity_id)}_${sanitizeEntityId(sscName)}`;
            if (createdSubIds.has(sscId)) continue;
            if (nameMatchesExisting(sscName, existingEntities)) continue;
            createdSubIds.add(sscId);

            result.sub_component_entities.push({
              entity_id: sscId,
              name: sscName,
              role: `Fundamental unit of ${sc.name}`,
              parent_entity_id: scId,
              parent_name: sc.name,
            });

            // Edge from sub-component to sub-sub-component
            result.sub_component_edges.push({
              source_entity_id: scId,
              target_entity_id: sscId,
              type: "has_component",
              source: "cross_context_insight",
            });
          }
        }
      }
    }

    // B. Materialize interaction effects as edges between entities
    if (Array.isArray(interactionEffects)) {
      for (const ie of interactionEffects) {
        // Try to resolve with_entity to an actual entity_id
        const targetId = resolveEntityReference(ie.with_entity, allEntityNames, entities);
        if (!targetId || targetId === entity.entity_id) continue;

        // Check if edge already exists
        if (edgeExists(entity.entity_id, targetId, existingEdges)) continue;
        if (result.interaction_edges.some(
          (e) => (e.source_entity_id === entity.entity_id && e.target_entity_id === targetId) ||
                 (e.source_entity_id === targetId && e.target_entity_id === entity.entity_id)
        )) continue;

        result.interaction_edges.push({
          source_entity_id: entity.entity_id,
          target_entity_id: targetId,
          interaction_type: ie.interaction_type ?? "amplifying",
          combined_effect: ie.combined_effect,
        });
      }
    }

    // C. Materialize causal chains as edges
    if (Array.isArray(causalUpstream)) {
      for (const upstream of causalUpstream) {
        const sourceId = resolveEntityReference(upstream, allEntityNames, entities);
        if (!sourceId || sourceId === entity.entity_id) continue;
        if (edgeExists(sourceId, entity.entity_id, existingEdges)) continue;
        if (result.causal_edges.some(
          (e) => e.source_entity_id === sourceId && e.target_entity_id === entity.entity_id
        )) continue;

        result.causal_edges.push({
          source_entity_id: sourceId,
          target_entity_id: entity.entity_id,
          direction: "upstream",
        });
      }
    }

    if (Array.isArray(causalDownstream)) {
      for (const downstream of causalDownstream) {
        const targetId = resolveEntityReference(downstream, allEntityNames, entities);
        if (!targetId || targetId === entity.entity_id) continue;
        if (edgeExists(entity.entity_id, targetId, existingEdges)) continue;
        if (result.causal_edges.some(
          (e) => e.source_entity_id === entity.entity_id && e.target_entity_id === targetId
        )) continue;

        result.causal_edges.push({
          source_entity_id: entity.entity_id,
          target_entity_id: targetId,
          direction: "downstream",
        });
      }
    }
  }

  return result;
}

/** Try to resolve a free-text entity reference to an existing entity_id */
function resolveEntityReference(
  reference: string,
  nameMap: Map<string, string>,
  entities: Entity[],
): string | null {
  const lower = reference.toLowerCase().trim();
  // Exact name match
  const exactMatch = nameMap.get(lower);
  if (exactMatch) return exactMatch;

  // Partial match — check if reference is a substring of any entity name or vice versa
  for (const [name, id] of nameMap) {
    if (name.includes(lower) || lower.includes(name)) return id;
  }

  // Try matching entity_id directly (LLM sometimes uses X1, X2 format)
  const entity = entities.find(
    (e) => e.entity_id === reference || e.entity_id.toLowerCase() === lower
  );
  if (entity) return entity.entity_id;

  return null;
}

/**
 * Build sub-component entity insert records.
 */
export function buildSubComponentEntityRecords(
  spaceId: string,
  subComponents: SubComponentEntity[],
): Array<Record<string, unknown>> {
  return subComponents.map((sc) => ({
    space_id: spaceId,
    entity_id: sc.entity_id,
    name: sc.name,
    description: `Sub-component of ${sc.parent_name}: ${sc.role}`,
    entity_type: "sub_component",
    entity_category: "concrete",
    knowledge_layer: "external",
    source_tag: "assumed",
    importance: "moderate",
    authority_level: "unverified",
    confidence: 0.5,
    provenance: {
      source_type: "decomposition",
      parent_entity_id: sc.parent_entity_id,
      parent_name: sc.parent_name,
      component_role: sc.role,
      intelligence_tier: "embedded",
    },
  }));
}

/**
 * Build interaction + causal edge insert records.
 */
export function buildDecompositionEdgeRecords(
  spaceId: string,
  decomp: DecompositionResult,
): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];

  // Sub-component edges
  for (const edge of decomp.sub_component_edges) {
    records.push({
      space_id: spaceId,
      source_entity_id: edge.source_entity_id,
      target_entity_id: edge.target_entity_id,
      relationship_type: "has_component",
      dimension: "structural",
      strength: 0.8,
      polarity: "positive",
      confidence: 0.5,
      knowledge_layer: "external",
      source_tag: "inferred",
      conditions: "Decomposed from entity sub-component analysis",
      provenance: {
        source_type: "decomposition",
        materialization_source: "sub_component",
      },
    });
  }

  // Interaction edges
  for (const edge of decomp.interaction_edges) {
    records.push({
      space_id: spaceId,
      source_entity_id: edge.source_entity_id,
      target_entity_id: edge.target_entity_id,
      relationship_type: `interaction_${edge.interaction_type}`,
      dimension: "causal",
      strength: edge.interaction_type === "amplifying" ? 0.8 : 0.6,
      polarity: edge.interaction_type === "dampening" || edge.interaction_type === "blocking" ? "negative" : "positive",
      confidence: 0.5,
      knowledge_layer: "external",
      source_tag: "inferred",
      conditions: edge.combined_effect,
      provenance: {
        source_type: "decomposition",
        materialization_source: "interaction_effect",
        interaction_type: edge.interaction_type,
      },
    });
  }

  // Causal edges
  for (const edge of decomp.causal_edges) {
    records.push({
      space_id: spaceId,
      source_entity_id: edge.source_entity_id,
      target_entity_id: edge.target_entity_id,
      relationship_type: "causes",
      dimension: "causal",
      strength: 0.6,
      polarity: "positive",
      confidence: 0.45,
      knowledge_layer: "external",
      source_tag: "inferred",
      conditions: `Causal ${edge.direction} relationship`,
      provenance: {
        source_type: "decomposition",
        materialization_source: "causal_chain",
        causal_direction: edge.direction,
      },
    });
  }

  return records;
}

/**
 * Build edge insert records from materialization results.
 * Caller handles the actual DB insert.
 */
export function buildMaterializedEdgeRecords(
  spaceId: string,
  edges: MaterializedEdge[],
  hiddenSignals: HiddenSignal[]
): Array<Record<string, unknown>> {
  return edges.map((me) => {
    const spec =
      me.source === "hidden_signal"
        ? Object.values(SIGNAL_SPECS).find((s) => s.relationship_type === me.type)
        : null;

    return {
      space_id: spaceId,
      source_entity_id: me.source_entity_id,
      target_entity_id: me.target_entity_id,
      relationship_type: me.type,
      dimension: spec?.dimension ?? "epistemic",
      strength: me.source === "hidden_signal" ? 0.5 : 0.6,
      polarity: spec?.polarity ?? "positive",
      confidence: me.source === "hidden_signal" ? 0.4 : 0.5,
      knowledge_layer: "bridge",
      source_tag: "inferred",
      conditions: `Materialized from ${me.source}`,
      provenance: {
        source_type: "signal_materialization",
        materialization_source: me.source,
      },
    };
  });
}
