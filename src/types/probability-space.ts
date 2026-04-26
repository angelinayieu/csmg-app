/**
 * Probability Space Types
 *
 * Models the sub-graph structure of conditions, mediators, and pathways
 * that govern each edge (connection) between two entities.
 *
 * Each edge in the knowledge graph has a "probability space" — a micro-topology
 * of variables that strengthen, weaken, gate, or mediate that connection.
 * When probability spaces from different edges share nodes, those intersections
 * reveal novel cross-domain insights.
 */

// ── Probability Space Nodes ──

export interface ProbabilityNode {
  /** Unique within this space, e.g. "PS_<edge_id>_S_SC1" */
  id: string;
  name: string;
  type: "mediator" | "condition" | "pathway_junction" | "sub_component";
  /** Which endpoint entity this node came from */
  parent_entity_id: string;
  /** Original SC id from expansion data (for tracing back) */
  source_expansion_sc_id?: string;
  /** Probability of this node being active (0-1) */
  probability?: number;
  /**
   * Provenance of `probability` — matches ProbabilityEdge.probability_source.
   * Before R6 this was always LLM-self-reported (from sub-component
   * expansion data); the field was missing, so UIs rendered all values
   * identically regardless of source.
   *
   *   "measured"  — derived from the parent entity's observable KG data
   *                 (edge degree, confidence, linked evidence). See
   *                 `computeMeasuredNodeProbability` in
   *                 src/lib/pipeline/probability-node-backing.ts.
   *   "estimated" — LLM-assigned via expansion data / pathway analyzer.
   *                 This is the honest default when no measurement exists.
   *   "default"   — synthetic placeholder (0.5/0.7/0.8). Present in legacy
   *                 rows and some fallback paths; flagged by quality tier
   *                 as speculative.
   *
   * Optional for back-compat — pre-R6 persisted spaces lack the field;
   * consumers default to "estimated" (the conservative assumption).
   */
  probability_source?: "measured" | "estimated" | "default";
  controllability?: "direct" | "indirect" | "uncontrollable";
  visibility?: "observable" | "latent" | "hidden";
  volatility?: "stable" | "fluctuating" | "chaotic";
  component_type?: string;
  importance?: "critical" | "important" | "moderate" | "minor";
  /** Optional semantic embedding carried from sub-component expansion data */
  embedding?: number[];
}

// ── Probability Space Edges ──

export interface ProbabilityEdge {
  source_id: string;
  target_id: string;
  /** Probability of this pathway being active (0-1) */
  probability: number;
  /** Provenance of probability value */
  probability_source?: "measured" | "estimated" | "default";
  conditions?: string | null;
  dynamics: "sequential" | "parallel" | "conditional" | "probabilistic";
  mechanism: string | null;
  strength: number;
  failure_mode?: string | null;
  edge_type: "internal_pathway" | "cross_entity_bridge" | "condition_gate";
}

// ── A single probability space for one edge ──

export interface ProbabilitySpace {
  id: string;
  /** The parent edge this space belongs to */
  edge_id: string;
  source_entity_id: string;
  target_entity_id: string;
  source_entity_name: string;
  target_entity_name: string;
  nodes: ProbabilityNode[];
  edges: ProbabilityEdge[];
  /** Product of probabilities along the critical path */
  total_pathway_probability: number;
  /** Confidence tier for this space's overall grounding */
  quality_tier?: "verified" | "estimated" | "speculative";
  /** Node IDs forming the highest-probability path source→target */
  critical_path: string[];
  /** Alternative viable paths (up to 3) */
  alternative_paths: string[][];
  failure_points: FailurePoint[];
  /** Human-readable conditions that must hold */
  conditions_summary: string[];
  /** Layer information for the endpoints of this space */
  layer_profile?: {
    source_layer: string;
    target_layer: string;
    is_cross_layer: boolean;
    /** Percentage of nodes from each layer */
    node_layer_distribution?: Record<string, number>;
  };
  /** Strategy layer relevance — which L1-L4 layers this space informs */
  strategy_layer_relevance?: StrategyLayerRelevance;
  /** Goal-aware impact analysis — present when computation ran with goal context */
  impact?: ImpactAnalysis;
  computed_at: string;
}

/**
 * Goal-aware impact analysis for a probability space.
 *
 * Attaches a "how much does this relationship matter to reaching the goals"
 * score to each edge's probability space. Distinct from
 * `total_pathway_probability`, which measures the internal likelihood of the
 * pathway itself firing — impact layers goal-context propagation on top.
 */
export interface ImpactAnalysis {
  /** Aggregate impact probability on the goal context (0-1). */
  impact_probability: number;
  /**
   * "direct"   — at least one endpoint of this space IS a goal entity
   * "indirect" — endpoints reach a goal transitively through graph edges
   * "none"     — no reachable goal within max-hop budget
   */
  impact_direction: "direct" | "indirect" | "none";
  /** Per-goal reachability breakdown. Empty array when goalEntityIds was empty. */
  per_goal: ImpactPerGoal[];
  /** Goal entity id with the highest combined reachability, for UI highlight. */
  closest_goal_entity_id: string | null;
  /** Min hop count from any endpoint to the closest goal. null when unreachable. */
  closest_goal_hops: number | null;
  /** True when source or target IS a goal entity. */
  direct: boolean;
  computed_at: string;
}

export interface ImpactPerGoal {
  goal_entity_id: string;
  /** Probability of propagation from source endpoint → goal via graph edges */
  reachability_from_source: number;
  /** Probability of propagation from target endpoint → goal via graph edges */
  reachability_from_target: number;
  /** max(source, target) */
  combined: number;
  /** Shortest path length in hops (or -1 if unreachable within budget) */
  distance_hops: number;
}

export type StrategyLayer = "L1" | "L2" | "L3" | "L4";

export interface StrategyLayerRelevance {
  /** All layers this space is relevant to */
  layers: StrategyLayer[];
  /** Strongest classification */
  primary_layer: StrategyLayer;
  /** Why this classification was assigned */
  classification_signals: string[];
}

export interface StrategyLayerBridge {
  /** Which strategy layers this intersection bridges */
  layers_bridged: StrategyLayer[];
  /** Primary bridge direction, e.g. "L4→L3" */
  primary_bridge: string;
  /** What kind of cross-layer connection this represents */
  bridge_type: "cross_layer_integration" | "same_layer_alternative" | "hidden_connection";
}

export interface FailurePoint {
  node_id: string;
  node_name: string;
  failure_mode: string;
  /** Probability of failure (0-1) */
  failure_probability: number;
  blast_radius: "local" | "cascading" | "systemic";
  /** True when classification used goal-aware logic */
  goal_aware?: boolean;
  /** Short explanation of why this blast radius was assigned */
  classification_rationale?: string;
}

// ── Intersections between probability spaces ──

export interface SpaceIntersection {
  id: string;
  space_a_id: string;
  space_b_id: string;
  /** The edge IDs whose spaces intersect */
  space_a_edge_id: string;
  space_b_edge_id: string;
  /** Entity names for display */
  space_a_label: string;
  space_b_label: string;
  shared_nodes: SharedNode[];
  /** 0-1: higher = parent entities are more distant in graph (more novel) */
  novelty_score: number;
  /** 0-1: based on probability and controllability of shared nodes */
  impact_score: number;
  /** Generated description of why this intersection matters */
  insight: string;
  innovation_potential: "high" | "medium" | "low";
  /** Whether this intersection spans different knowledge layers */
  layer_crossing?: {
    is_cross_layer: boolean;
    layers_involved: string[];
    /** Cross-layer intersections get novelty bonus */
    cross_layer_novelty_bonus: number;
  };
  /** Strategy layer bridge — which L1-L4 layers this intersection connects */
  strategy_layer_bridge?: StrategyLayerBridge;
}

export interface SharedNode {
  node_a_id: string;
  node_b_id: string;
  similarity: number;
  name: string;
  match_type: "exact_entity" | "name_similarity" | "semantic_overlap";
}

// ── Aggregate layer ──

export interface ProbabilitySpaceLayer {
  spaces: ProbabilitySpace[];
  intersections: SpaceIntersection[];
  computed_at: string;
}

// ── Edge condition (from domain-expert prompt enrichment) ──

export interface EdgeCondition {
  internal_entity_id: string;
  condition_type: "strengthens" | "weakens" | "gates" | "mediates";
  condition_description: string;
  when_active: string;
  probability: number;
  controllability: "direct" | "indirect" | "uncontrollable";
}
