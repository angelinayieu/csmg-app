// Interaction Fields & Field Intersections
// Computed post-critique, pre-synthesis — Layer 7 & 8 of the 16-layer architecture
// Pure graph computation, no LLM calls

// ── Per-entity interaction field ──

export interface EntityInfluence {
  target_entity_id: string;
  target_name: string;
  /** Positive = enabling, negative = constraining */
  net_influence: number;
  /** "direct" or "via C3 → C5" */
  pathway: string;
  /** Number of hops (1 = direct) */
  hops: number;
}

export interface InteractionField {
  entity_id: string;
  entity_name: string;
  /** Total outward influence this entity exerts (0-1 normalized) */
  field_strength: number;
  /** Number of entities influenced (direct + indirect within 2 hops) */
  field_reach: number;
  /** >1 if entity participates in reinforcing cycles */
  amplification_factor: number;
  /** Total inward influence from other entities */
  receptivity: number;
  /** field_strength / receptivity — high = driver, low = driven */
  autonomy_ratio: number;
  /** Top influences sorted by |net_influence| descending */
  top_influences: EntityInfluence[];
}

// ── Strategic corridors: high-influence paths through the system ──

export interface StrategicCorridor {
  /** Ordered entity IDs along the corridor */
  path: string[];
  /** Entity names for display */
  path_names: string[];
  /** Product of edge strengths along the path */
  total_strength: number;
  /** Entity ID of weakest link */
  bottleneck_at: string | null;
  /** Does this corridor pass through a reinforcing cycle? */
  amplified: boolean;
  /** Net polarity: all-positive = enabling, mixed = complex */
  polarity: "enabling" | "constraining" | "complex";
}

// ── Field intersections: where multiple high-influence fields overlap ──

export interface FieldIntersection {
  entity_a_id: string;
  entity_a_name: string;
  entity_b_id: string;
  entity_b_name: string;
  /** Entities influenced by BOTH A and B */
  overlap_entities: string[];
  overlap_names: string[];
  /** synergistic = aligned, antagonistic = opposing, complex = mixed */
  classification: "synergistic" | "antagonistic" | "complex";
  /** Sum of combined influence in the overlap zone */
  combined_influence: number;
  /** Computed description of the interaction */
  insight: string;
}

// ── Tension zone: where opposing forces create inherent tradeoffs ──

export interface TensionZone {
  /** The entity under tension */
  entity_id: string;
  entity_name: string;
  /** Entities pushing in positive direction */
  positive_drivers: string[];
  /** Entities pushing in negative direction */
  negative_drivers: string[];
  /** Magnitude of the tension (higher = more conflicted) */
  tension_magnitude: number;
}

// ── Cross-category convergence: shared elements across importance tiers ──

export type ConvergenceDepth = "L1" | "L2" | "L3" | "L4";

export interface ConvergenceBranch {
  entity_id: string;
  name: string;
  category: string;
  /** Entity IDs from this branch's root → the shared element */
  path_to_shared: string[];
}

export interface ConvergenceInsight {
  id: string;
  /** Depth tier where the convergence occurs */
  depth: ConvergenceDepth;
  /** Human label: "L1 Outcome", "L2 Method", "L3 Logic", "L4 Invariant" */
  depth_label: string;
  /** The shared element where branches converge */
  shared_element: {
    entity_id: string;
    name: string;
    importance: string;
    category: string;
  };
  /** Branches from different categories that converge here */
  converging_branches: ConvergenceBranch[];
  /** 0-1, higher for deeper (rarer) convergence. L4=1.0, L1=0.25 */
  structural_value: number;
  /** Computed explanation of why this convergence matters */
  explanation: string;
}

// ── Full interaction metadata (stored in synthesis_data) ──

export interface InteractionMetadata {
  /** Per-entity interaction fields, sorted by field_strength descending */
  fields: InteractionField[];
  /** Top field intersections */
  intersections: FieldIntersection[];
  /** Top strategic corridors through the system */
  strategic_corridors: StrategicCorridor[];
  /** Entities under tension from opposing forces */
  tension_zones: TensionZone[];
  /** Cross-category convergence insights (entities from different categories sharing a common element) */
  convergences?: ConvergenceInsight[];
  /** Computation timestamp */
  computed_at: string;
}

// ── Skill registry types ──

export interface SkillDescriptor {
  id: string;
  name: string;
  description: string;
  /** What data this skill requires */
  inputs: string[];
  /** What data this skill produces */
  outputs: string[];
  /** Other skills that must run first */
  depends_on: string[];
  /** Computational cost estimate */
  cost: "trivial" | "light" | "moderate" | "heavy";
  /** Whether this skill calls an LLM */
  requires_llm: boolean;
}

export interface SkillResult<T = unknown> {
  skill_id: string;
  success: boolean;
  data: T | null;
  error?: string;
  duration_ms: number;
}
