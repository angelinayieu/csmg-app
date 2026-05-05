// Subsystems — typed compositional units extracted from synthesis output.
//
// A Subsystem is a recognizable functional unit composed of entities + edges +
// cycles + axioms — e.g. "the onboarding feedback loop", "the retention
// bottleneck cluster", "the L4 working-memory invariant chain". They sit
// between fine-grained atomic findings (axioms, leverage_points, convergences)
// and the strategy output, providing the LLM with a typed unit to operate on
// instead of a flat blob of entity references.
//
// Persisted at synthesis_data.subsystems[]. Re-extractable from synthesis +
// graph; no DB table.

export type SubsystemKind =
  | "loop"                 // a feedback cycle + its participants
  | "leverage_cluster"     // a leverage_point + 1-hop causal neighborhood
  | "tension"              // a tension_zone (opposing forces around an entity)
  | "invariant_chain"      // an L4 atom + its supporting axioms + evidence
  | "convergence_cluster"  // an insight_convergence with ≥3 entities
  | "bottleneck_node";     // a master_bottleneck + its blocking edges

export type SubsystemLevel = "L1" | "L2" | "L3" | "L4";

export interface SubsystemContract {
  /** What this subsystem produces when functioning */
  does: string;
  /** What inputs/preconditions it requires */
  needs: string;
  /** Observable outputs / measurable signals */
  produces: string;
}

export interface SubsystemSeed {
  kind:
    | "cycle"
    | "leverage_point"
    | "tension_zone"
    | "convergence"
    | "insight_convergence"
    | "master_bottleneck";
  /** ID of the originating structure (cycle_id, entity_id, cluster_id, etc.) */
  source_id: string;
}

export interface Subsystem {
  /** Stable ID, e.g. "sub_loop_1", "sub_lev_2" */
  id: string;
  kind: SubsystemKind;
  /** Human-readable name (LLM-supplied during enrichment) */
  name: string;
  level: SubsystemLevel;

  // Constituents — all KG-backed IDs, no free text
  constituent_entities: string[];
  constituent_edges: string[];
  constituent_cycles: string[];
  constituent_axioms: string[];
  /** Optional claim IDs (when claims table is populated) */
  evidence_links: string[];

  /** Which existing structure seeded this subsystem */
  seed: SubsystemSeed;

  /** 0–1, aggregated from constituent confidences */
  composition_confidence: number;
  /** 0–1, structural importance (1.0 for L4 invariants, 0.25 for L1 outcomes) */
  structural_value: number;

  /** Filled by LLM enrichment; default empty strings if enrichment skipped */
  contracts: SubsystemContract;
  /** 1–2 sentences explaining why these constituents belong together */
  rationale: string;

  generated_at: string;
}
