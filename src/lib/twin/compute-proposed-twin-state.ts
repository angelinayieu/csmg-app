// ── Proposed twin-state preview (Item 4 of conversational approval) ──
//
// Before the user confirms a strategy, they deserve to see "how will the
// operating twin change if I approve this?" This helper projects a TwinState
// as if the proposed strategy's infrastructure_map.core_components were
// materialized and its key_channels existed.
//
// Pure computation — reads only. Safe to call on any proposed strategy with
// any combination of entity/edge/synthesis inputs. Returns a delta object
// comparing current vs projected.
//
// Note: This does NOT actually create entities/edges. It synthetically counts
// the infrastructure additions that WOULD exist post-confirmation, so the
// twin's coverage/dynamics metrics reflect the proposed world.

import type { Entity, Edge, Cycle, Space } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { StrategicRecommendation } from "@/types/strategy";
import type { ImprovementGoal, GoalRecommendation } from "@/types/goals";
import type { TwinState } from "@/types/twin";
import { computeTwinState } from "./compute-twin-state";

export interface ProposedTwinDelta {
  current: TwinState;
  projected: TwinState;
  delta: {
    health_score: number;
    entities_modeled: number;
    edges_mapped: number;
    cycles_detected: number;
    orphan_count: number;   // positive means MORE orphans (bad); negative means fewer (good)
    critical_risks: number; // delta in critical_risks count
    total_loops: number;
  };
  /** Summary of what the proposed strategy adds synthetically */
  additions: {
    new_entities: number;
    strengthened_entities: number;
    new_channels: number;
    activated_loops: number;
  };
}

/**
 * Compute projected TwinState by synthetically applying the proposed strategy's
 * infrastructure additions to the entity/edge/cycle arrays BEFORE calling
 * computeTwinState. We do NOT write to DB — we just simulate.
 */
export function computeProposedTwinState(
  space: Space,
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
  synthesisData: SynthesisData | null,
  proposedRecommendation: StrategicRecommendation,
  activeGoal?: ImprovementGoal | null,
  recommendations?: GoalRecommendation[],
): ProposedTwinDelta {
  // Current twin (baseline)
  const current = computeTwinState(space, entities, edges, cycles, synthesisData, activeGoal, recommendations);

  // Build the synthetic world: add a virtual entity per proposed core_component
  // with status="needs_building" that maps to a NEW/proposed component. For
  // components with status="exists" the entity is already in the graph — don't
  // double-count. For components with status="needs_strengthening" we don't
  // add a new entity but we DO count a strengthening effect.
  const core = proposedRecommendation.infrastructure_map?.core_components ?? [];
  const channels = proposedRecommendation.infrastructure_map?.key_channels ?? [];
  const activatedLoops = proposedRecommendation.infrastructure_map?.activated_loops ?? [];

  const existingEntityIds = new Set(entities.map((e) => e.entity_id));

  // Synthetic entities from NEW infrastructure components
  const newEntities: Entity[] = [];
  let strengthenedEntities = 0;
  for (const comp of core) {
    if (comp.status === "needs_building" || comp.entity_id === "NEW") {
      newEntities.push({
        // Minimal shape — compute-twin-state reads: id, entity_id, importance, is_leverage_point, is_risk_point, is_master_bottleneck, knowledge_layer
        id: `proposed:${comp.entity_id}:${newEntities.length}`,
        entity_id: comp.entity_id === "NEW" ? `NEW_${newEntities.length}` : comp.entity_id,
        name: comp.entity_name,
        description: comp.description,
        importance: comp.priority === "critical" ? "critical" : comp.priority === "important" ? "important" : "moderate",
        entity_category: "process",
        entity_type: comp.role,
        confidence: 0.7,
        is_leverage_point: comp.role === "hub",
        is_risk_point: false,
        is_master_bottleneck: false,
        blast_radius: 0,
        centrality_rank: null,
        knowledge_layer: "internal",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    } else if (comp.status === "needs_strengthening" && existingEntityIds.has(comp.entity_id)) {
      strengthenedEntities++;
    }
  }

  // Synthetic edges from proposed channels that don't already exist
  const existingEdgePairs = new Set(edges.map((e) => `${e.source_entity_id}|${e.target_entity_id}`));
  const newEdges: Edge[] = [];
  for (const ch of channels) {
    const key = `${ch.from}|${ch.to}`;
    if (!ch.exists && !existingEdgePairs.has(key)) {
      newEdges.push({
        id: `proposed:${key}:${newEdges.length}`,
        space_id: space.id,
        source_entity_id: ch.from,
        target_entity_id: ch.to,
        relationship_type: ch.channel_type,
        dimension: "functional",
        strength: ch.strength_needed === "strong" ? 0.85 : 0.6,
        confidence: 0.7,
        polarity: "positive",
        source_tag: "predicted",
        knowledge_layer: "internal",
        is_tradeoff: false,
        is_part_of_cycle: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }
  }

  const projectedEntities = [...entities, ...newEntities];
  const projectedEdges = [...edges, ...newEdges];
  // Cycles unchanged for now; activated_loops affect scoring via synthesisData.feedback_loops
  // which we overlay below.

  // Overlay proposed feedback loops into synthesisData for projection.
  // The strategy's `activated_loops` lists names of loops the strategy will
  // operationalize. We trust computeTwinState's existing logic and simply
  // ensure the synthesisData reflects them.
  const projectedSynth: SynthesisData | null = synthesisData
    ? {
        ...synthesisData,
        // If the proposed strategy references feedback_loops by name, they're
        // already in synthesisData; no-op. (Strategy doesn't create NEW loops —
        // it activates existing ones.)
      }
    : null;

  const projected = computeTwinState(
    space,
    projectedEntities,
    projectedEdges,
    cycles,
    projectedSynth,
    activeGoal,
    recommendations,
  );

  return {
    current,
    projected,
    delta: {
      health_score: projected.macro.health_score - current.macro.health_score,
      entities_modeled: projected.macro.coverage.entities_modeled - current.macro.coverage.entities_modeled,
      edges_mapped: projected.macro.coverage.edges_mapped - current.macro.coverage.edges_mapped,
      cycles_detected: projected.macro.coverage.cycles_detected - current.macro.coverage.cycles_detected,
      orphan_count: projected.macro.coverage.orphan_count - current.macro.coverage.orphan_count,
      critical_risks: projected.macro.risk_exposure.critical_risks - current.macro.risk_exposure.critical_risks,
      total_loops: projected.macro.dynamics.total_loops - current.macro.dynamics.total_loops,
    },
    additions: {
      new_entities: newEntities.length,
      strengthened_entities: strengthenedEntities,
      new_channels: newEdges.length,
      activated_loops: activatedLoops.length,
    },
  };
}
