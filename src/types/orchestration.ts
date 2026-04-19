import type { AnalysisTier } from "@/lib/tiers";

// Pipeline phases that the frontend tracks
export type PipelinePhase =
  | "idle"
  | "scope"
  | "classifying"
  | "decomposing"
  | "structuring"
  | "critiquing"
  | "augmenting"
  | "weaving"
  | "interweaving"
  | "synthesizing"
  | "reasoning"
  | "complete"
  | "error";

// Per-space progress tracking
export interface SpaceProgress {
  index: number;
  name: string;
  prefix: string;
  phase: "pending" | "decomposing" | "structuring" | "critiquing" | "augmenting" | "done" | "error";
  entityCount?: number;
  edgeCount?: number;
  addedEdges?: number;
  addedCycles?: number;
  orphanCount?: number;
}

// SSE event from /api/orchestrate
export type PipelineSSEEvent =
  | { type: "phase"; phase: PipelinePhase; status: "running" | "done" }
  | { type: "scope_done"; spaces: { name: string; prefix: string }[] }
  | { type: "space_progress"; space: SpaceProgress }
  | { type: "weave_done"; bridges: number; contradictions: number }
  | { type: "complete"; spaceIds: string[]; rootSpaceId?: string }
  | { type: "error"; message: string; phase?: string };

// Orchestration request
export interface OrchestrationRequest {
  text: string;
  tier: AnalysisTier;
}

// Scope mapper output
export interface ScopeResult {
  spaces: {
    name: string;
    prefix: string;
    description: string;
    key_concepts: string[];
    likely_connects_to: string[];
    priority: number;
  }[];
  summary: string;
}

// Critique output
export interface CritiqueResult {
  orphans: {
    entity_id: string;
    current_edge_count: number;
    importance: string;
    missing_edges: {
      target_entity_id: string;
      relationship_type: string;
      reasoning: string;
    }[];
  }[];
  centrality_corrections: {
    agrees_with_decomposition: boolean;
    corrected_ranking: {
      entity_id: string;
      rank: number;
      degree: number;
      reasoning: string;
    }[];
    explanation: string;
  };
  missed_cycles: {
    name: string;
    chain: string[];
    classification: string;
    intervention_point: string;
    reasoning: string;
  }[];
  predicted_edges: {
    source: string;
    target: string;
    relationship_type: string;
    confidence: string;
    reasoning: string;
  }[];
  density_assessment: {
    current_density: number;
    sufficient: boolean;
    estimated_missing_edges: number;
    sparse_areas: string[];
  };
  overall_quality: {
    score: "good" | "adequate" | "insufficient";
    summary: string;
  };
}

// Domain Expert (Agent 7) output
export interface DomainExpertResult {
  external_entities: {
    entity_id: string;
    name: string;
    description: string;
    entity_type: string;
    entity_category: string;
    category: "competitor" | "framework" | "pattern" | "data_point" | "analogy" | "risk_pattern" | "resource";
    confidence: number;
    authority_level: "high" | "moderate" | "low";
    relevance_to_situation: string;
    // Phase 3.4: Domain expert enrichment fields
    relevance_score?: number;
    temporal_freshness?: "current" | "recent" | "dated" | "unknown";
    connection_hints?: string[];
    risk_signal_flags?: string[];
  }[];
  external_edges: {
    source: string;
    target: string;
    relationship_type: string;
    dimension: string;
  }[];
  potential_bridges: {
    external_entity_id: string;
    likely_internal_concept: string;
    connection_type: "validates" | "challenges" | "extends" | "analogous";
    reasoning: string;
  }[];
}

// Full orchestration state for the frontend
export interface OrchestrationState {
  tier: AnalysisTier;
  phase: PipelinePhase;
  spaces: SpaceProgress[];
  streamedText: string;
  bridgeCount: number;
  contradictionCount: number;
  spaceIds: string[];
  error: string | null;
}
