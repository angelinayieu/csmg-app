/**
 * Intelligence Feedback Engine
 *
 * Takes computed intelligence (probability space intersections, link predictions,
 * high-risk failure points) and materializes them back into the knowledge graph
 * as new edges and novel connections. This closes the feedback loop:
 *
 *   Graph → Probability Spaces → Intersections → NEW Edges → Denser Graph
 *
 * Each intersection between probability spaces reveals a hidden shared variable
 * connecting two seemingly unrelated edges. When materialized, this creates
 * a "discovered_connection" edge between the entities involved.
 */

import type { Entity, Edge } from "@/types";
import type {
  ProbabilitySpace,
  SpaceIntersection,
  FailurePoint,
} from "@/types/probability-space";
import { isCrossLayer } from "@/lib/intelligence/layer-semantics";

// ── Types ──

export interface IntelligenceFeedbackResult {
  // New edges to create from intersection discoveries
  discovered_edges: DiscoveredEdge[];
  // Novel connections for the novel_connections table
  novel_connections: NovelConnectionRecord[];
  // Risk-flagged entities from failure point analysis
  risk_flags: RiskFlag[];
  // Summary for display
  summary: IntelligenceSummary;
}

export interface DiscoveredEdge {
  source_entity_id: string; // UUID
  target_entity_id: string; // UUID
  source_entity_name: string;
  target_entity_name: string;
  relationship_type: string;
  dimension: string;
  strength: number;
  confidence: number;
  reasoning: string;
  discovery_source: "intersection" | "failure_cascade" | "link_prediction";
  intersection_id?: string;
  shared_variables: string[];
  novelty_score: number;
  impact_score: number;
  innovation_potential: string;
}

export interface NovelConnectionRecord {
  space_id: string;
  source_entity_id: string; // entity_id string (not UUID)
  target_entity_id: string;
  relationship_type: string;
  strength: "strong" | "moderate" | "speculative";
  reasoning: string;
}

export interface RiskFlag {
  entity_id: string;
  entity_name: string;
  risk_type: "systemic_failure" | "cascading_failure" | "bottleneck_exposure";
  severity: number; // 0-1
  description: string;
  mitigation_hint: string;
}

export interface IntelligenceSummary {
  intersections_analyzed: number;
  high_potential_intersections: number;
  edges_discovered: number;
  risk_flags_raised: number;
  key_discoveries: string[];
  density_impact: {
    current_edges: number;
    new_edges: number;
    density_increase_pct: number;
  };
}

// ── Core Engine ──

/**
 * Analyze probability spaces and intersections to produce graph feedback.
 * Pure function — no DB access.
 */
export function computeIntelligenceFeedback(
  spaces: ProbabilitySpace[],
  intersections: SpaceIntersection[],
  entities: Entity[],
  edges: Edge[],
  spaceId: string,
): IntelligenceFeedbackResult {
  const entityByStringId = new Map<string, Entity>();
  const entityByUuid = new Map<string, Entity>();
  for (const e of entities) {
    entityByStringId.set(e.entity_id, e);
    entityByUuid.set(e.id, e);
  }

  // Track existing edge keys to avoid duplicates
  const existingEdgeKeys = new Set(
    edges.map((e) => `${e.source_entity_id}→${e.target_entity_id}`)
  );

  const discoveredEdges: DiscoveredEdge[] = [];
  const novelConnections: NovelConnectionRecord[] = [];
  const riskFlags: RiskFlag[] = [];
  const keyDiscoveries: string[] = [];

  // ── 1. Materialize high-value intersections as edges ──

  const sortedIntersections = [...intersections].sort(
    (a, b) => (b.novelty_score * b.impact_score) - (a.novelty_score * a.impact_score)
  );

  for (const intersection of sortedIntersections) {
    // Find the edges these spaces belong to
    const spaceA = spaces.find((s) => s.id === intersection.space_a_id);
    const spaceB = spaces.find((s) => s.id === intersection.space_b_id);
    if (!spaceA || !spaceB) continue;

    // Get the entities at the endpoints of each space's parent edge
    // Create discovered edge between entities from different spaces
    const entitiesA = [
      entityByStringId.get(spaceA.source_entity_id) ?? entityByUuid.get(spaceA.source_entity_id),
      entityByStringId.get(spaceA.target_entity_id) ?? entityByUuid.get(spaceA.target_entity_id),
    ].filter(Boolean) as Entity[];

    const entitiesB = [
      entityByStringId.get(spaceB.source_entity_id) ?? entityByUuid.get(spaceB.source_entity_id),
      entityByStringId.get(spaceB.target_entity_id) ?? entityByUuid.get(spaceB.target_entity_id),
    ].filter(Boolean) as Entity[];

    // Connect the most relevant entity pair (highest centrality from each side)
    const bestA = entitiesA.sort((a, b) => (a.centrality_rank ?? 999) - (b.centrality_rank ?? 999))[0];
    const bestB = entitiesB.sort((a, b) => (a.centrality_rank ?? 999) - (b.centrality_rank ?? 999))[0];

    if (!bestA || !bestB || bestA.id === bestB.id) continue;

    const edgeKey = `${bestA.id}→${bestB.id}`;
    const reverseKey = `${bestB.id}→${bestA.id}`;
    if (existingEdgeKeys.has(edgeKey) || existingEdgeKeys.has(reverseKey)) continue;
    existingEdgeKeys.add(edgeKey);

    const sharedVarNames = intersection.shared_nodes.map((sn) => sn.name);
    const confidence = Math.min(0.9, 0.4 + intersection.impact_score * 0.5);
    const strength = Math.min(0.9, 0.3 + intersection.novelty_score * 0.4 + intersection.impact_score * 0.3);

    // Determine relationship type from shared variables
    const relType = inferRelationshipType(intersection, sharedVarNames);

    discoveredEdges.push({
      source_entity_id: bestA.id,
      target_entity_id: bestB.id,
      source_entity_name: bestA.name,
      target_entity_name: bestB.name,
      relationship_type: relType,
      dimension: "correlational",
      strength,
      confidence,
      reasoning: intersection.insight && !intersection.insight.includes("Analysis pending") ? intersection.insight : `Shared variables (${sharedVarNames.join(", ")}) connect ${bestA.name} and ${bestB.name} across different pathways.`,
      discovery_source: "intersection",
      intersection_id: intersection.id,
      shared_variables: sharedVarNames,
      novelty_score: intersection.novelty_score,
      impact_score: intersection.impact_score,
      innovation_potential: intersection.innovation_potential,
    });

    // Also record as novel connection
    const strengthLabel: "strong" | "moderate" | "speculative" =
      intersection.innovation_potential === "high" ? "strong"
      : intersection.innovation_potential === "medium" ? "moderate"
      : "speculative";

    novelConnections.push({
      space_id: spaceId,
      source_entity_id: bestA.entity_id,
      target_entity_id: bestB.entity_id,
      relationship_type: relType,
      strength: strengthLabel,
      reasoning: intersection.insight && !intersection.insight.includes("Analysis pending") ? intersection.insight : `Shared variables (${sharedVarNames.join(", ")}) bridge these pathways.`,
    });

    if (intersection.innovation_potential === "high") {
      keyDiscoveries.push(
        `Hidden connection: ${bestA.name} ↔ ${bestB.name} via shared ${sharedVarNames.slice(0, 2).join(", ")} (novelty: ${(intersection.novelty_score * 100).toFixed(0)}%)`
      );
    }
  }

  // ── 2. Analyze failure points for risk flags ──

  for (const space of spaces) {
    for (const fp of space.failure_points) {
      if (fp.blast_radius === "systemic" || fp.blast_radius === "cascading") {
        // Find which entity this failure point belongs to
        const sourceEntity = entityByStringId.get(space.source_entity_id) ?? entityByUuid.get(space.source_entity_id);
        const targetEntity = entityByStringId.get(space.target_entity_id) ?? entityByUuid.get(space.target_entity_id);
        const affectedEntity = sourceEntity ?? targetEntity;
        if (!affectedEntity) continue;

        riskFlags.push({
          entity_id: affectedEntity.id,
          entity_name: affectedEntity.name,
          risk_type: fp.blast_radius === "systemic" ? "systemic_failure" : "cascading_failure",
          severity: fp.failure_probability,
          description: fp.failure_mode,
          mitigation_hint: `Strengthen the ${space.source_entity_name} → ${space.target_entity_name} pathway`,
        });
      }
    }
  }

  // Deduplicate risk flags by entity
  const seenRiskEntities = new Set<string>();
  const dedupedRisks = riskFlags.filter((rf) => {
    if (seenRiskEntities.has(rf.entity_id)) return false;
    seenRiskEntities.add(rf.entity_id);
    return true;
  });

  return {
    discovered_edges: discoveredEdges,
    novel_connections: novelConnections,
    risk_flags: dedupedRisks,
    summary: {
      intersections_analyzed: intersections.length,
      high_potential_intersections: intersections.filter((i) => i.innovation_potential === "high").length,
      edges_discovered: discoveredEdges.length,
      risk_flags_raised: dedupedRisks.length,
      key_discoveries: keyDiscoveries.slice(0, 5),
      density_impact: {
        current_edges: edges.length,
        new_edges: discoveredEdges.length,
        density_increase_pct: edges.length > 0
          ? Math.round((discoveredEdges.length / edges.length) * 100)
          : 0,
      },
    },
  };
}

// ── Edge record builder for DB insertion ──

export function buildDiscoveredEdgeRecords(
  spaceId: string,
  discoveredEdges: DiscoveredEdge[],
  entityLayerMap?: Map<string, string>,
): Array<Record<string, unknown>> {
  return discoveredEdges.map((de) => {
    // Determine layer: cross-layer discoveries become bridges
    let layer: string = "internal";
    if (entityLayerMap) {
      const srcLayer = entityLayerMap.get(de.source_entity_id);
      const tgtLayer = entityLayerMap.get(de.target_entity_id);
      if (srcLayer && tgtLayer && isCrossLayer(srcLayer, tgtLayer)) {
        layer = "bridge";
      } else {
        layer = srcLayer ?? tgtLayer ?? "internal";
      }
    }
    return {
    space_id: spaceId,
    source_entity_id: de.source_entity_id,
    target_entity_id: de.target_entity_id,
    relationship_type: de.relationship_type,
    dimension: de.dimension,
    source_tag: "predicted",
    strength: de.strength,
    polarity: "positive",
    confidence: de.confidence,
    conditions: de.reasoning,
    knowledge_layer: layer,
    is_low_confidence: de.confidence < 0.5,
    provenance: {
      source_type: "intelligence_feedback",
      discovery_source: de.discovery_source,
      intersection_id: de.intersection_id,
      shared_variables: de.shared_variables,
      novelty_score: de.novelty_score,
      impact_score: de.impact_score,
      innovation_potential: de.innovation_potential,
      // v2: edge_role marks this as discoverable by bridge-like semantics
      edge_role: "discovered",
      evidence_level: de.confidence >= 0.7 ? "stated" : de.confidence >= 0.4 ? "inferred" : "predicted",
    },
  };
  });
}

// ── Helpers ──

function inferRelationshipType(
  intersection: SpaceIntersection,
  sharedVars: string[],
): string {
  // Infer from shared variable names
  const joined = sharedVars.join(" ").toLowerCase();
  if (joined.includes("depend") || joined.includes("require")) return "depends_on";
  if (joined.includes("enable") || joined.includes("support")) return "enables";
  if (joined.includes("constrain") || joined.includes("limit")) return "constrains";
  if (joined.includes("amplif") || joined.includes("reinforc")) return "amplifies";
  if (joined.includes("compet") || joined.includes("conflict")) return "competes_with";

  // Default based on innovation potential
  if (intersection.innovation_potential === "high") return "hidden_synergy";
  if (intersection.novelty_score > 0.7) return "discovered_correlation";
  return "shares_mechanism";
}
