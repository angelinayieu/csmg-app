// ── Sub-component inside an expansion ──

export interface SubComponent {
  /** Local ID like "SC1", "SC2" — unique within this expansion */
  id: string;
  name: string;
  description: string;
  /** What kind of internal element: milestone, capability, condition, metric, process, variable, gate */
  component_type: string;
  /** 0-1: how likely this component is achieved/present/true in the user's situation */
  probability: number;
  importance: "critical" | "important" | "moderate" | "minor";
  /** Can this sub-component be drilled into further? */
  is_expandable: boolean;
  /** Internal manifold — simpler than entity manifold */
  manifold?: {
    controllability: "direct" | "indirect" | "uncontrollable";
    visibility: "observable" | "latent" | "hidden";
    volatility: "stable" | "fluctuating" | "chaotic";
  };
  /** Optional semantic embedding for similarity matching */
  embedding?: number[];
  embedding_model?: string;
  embedding_version?: string;
}

// ── Internal pathway between sub-components ──

export interface InternalPathway {
  source_id: string;
  target_id: string;
  /** HOW does the source lead to the target? */
  mechanism: string;
  /** 0-1: probability this pathway activates */
  probability: number;
  /** WHEN: conditions required for this pathway */
  conditions: string | null;
  /** Sequential, parallel, conditional, or probabilistic */
  dynamics: "sequential" | "parallel" | "conditional" | "probabilistic";
  /** 0-1: strength of the connection */
  strength: number;
  /** What happens if this pathway fails/breaks? */
  failure_mode: string | null;
}

// ── Internal dynamics (bottlenecks, gates, loops within the expansion) ──

export interface InternalDynamic {
  type: "bottleneck" | "feedback_loop" | "gate" | "amplifier" | "decay";
  /** Which sub-component IDs are involved */
  component_ids: string[];
  description: string;
  /** What impact does this dynamic have on the parent entity's behavior? */
  impact: string;
}

// ── Full expansion result ──

export interface Expansion {
  id: string;
  space_id: string;
  entity_id: string;
  parent_expansion_id: string | null;
  depth_level: number;
  summary: string;
  sub_components: SubComponent[];
  internal_pathways: InternalPathway[];
  internal_dynamics: InternalDynamic[];
  computed_at: string;
  stale: boolean;
}

// ── Navigation breadcrumb ──

export interface ExpansionBreadcrumb {
  entity_id: string;
  entity_name: string;
  expansion_id: string | null;
  depth_level: number;
}

// ── Depth budget ──

export interface DepthBudget {
  max_depth: number;
  current_depth: number;
  expansions_used: number;
  max_expansions: number;
}
