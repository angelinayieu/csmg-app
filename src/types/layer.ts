/**
 * 3-Layer Knowledge Graph Types
 *
 * Canonical types for the three macro knowledge graphs:
 *   KG 1 — User Assets    (knowledge_layer = "internal")
 *   KG 2 — Concept Model  (knowledge_layer = "conceptual")
 *   KG 3 — Deep Research   (knowledge_layer = "external")
 *   Bridges                (knowledge_layer = "bridge")
 */

// ── Core Layer Type ──

/** Canonical knowledge layer values */
export type KnowledgeLayer = "internal" | "conceptual" | "external" | "bridge";

// ── Layer Profile ──

/** Layer classification for a probability space or edge */
export interface LayerProfile {
  source_layer: KnowledgeLayer;
  target_layer: KnowledgeLayer;
  is_cross_layer: boolean;
  /** Deduplicated layers involved */
  layers_involved: KnowledgeLayer[];
}

// ── Cross-Layer Analysis ──

/** Cross-layer insight discovered by analysis engine */
export interface CrossLayerInsight {
  id: string;
  type: "validation_chain" | "propagation_path" | "layer_tension" | "composition";
  /** Human-readable description */
  description: string;
  /** Entities involved, tagged by layer */
  entities: Array<{ entity_id: string; name: string; layer: KnowledgeLayer }>;
  /** The layers this insight spans */
  layers: KnowledgeLayer[];
  /** Confidence in the insight */
  confidence: number;
  /** Why this cross-layer connection matters */
  strategic_implication: string;
}

/** Validation chain: external evidence → conceptual mechanism → internal asset */
export interface ValidationChain {
  id: string;
  /** External evidence entity */
  external_entity: { id: string; name: string };
  /** Conceptual mechanism it validates/challenges */
  conceptual_entity: { id: string; name: string } | null;
  /** Internal asset affected */
  internal_entity: { id: string; name: string };
  /** The bridge edges connecting them */
  bridge_edges: Array<{ id: string; relationship_type: string; confidence: number }>;
  /** Direction of influence */
  direction: "validates" | "challenges" | "neutral";
  /** Path confidence (product of edge confidences) */
  chain_confidence: number;
}

/** Layer tension: where external evidence contradicts internal assumptions */
export interface LayerTension {
  id: string;
  /** What the internal layer assumes */
  internal_claim: { entity_id: string; name: string; claim: string };
  /** What the external layer suggests */
  external_counter: { entity_id: string; name: string; claim: string };
  /** Conceptual mechanism caught between */
  mediating_mechanism: { entity_id: string; name: string } | null;
  /** Tension severity */
  severity: "high" | "medium" | "low";
}

/** Full result of cross-layer analysis */
export interface CrossLayerAnalysisResult {
  /** Chains: external evidence → conceptual mechanism → internal asset */
  validation_chains: ValidationChain[];
  /** Layer tension: where external evidence contradicts internal assumptions */
  layer_tensions: LayerTension[];
  /** Layer density metrics */
  layer_density: Record<string, { entities: number; edges: number; density: number }>;
  /** Cross-layer edge count by pair (e.g. "internal↔conceptual": 5) */
  cross_layer_edges: Record<string, number>;
}

/** Stored subset for synthesis_data persistence */
export interface CrossLayerAnalysisSummary {
  validation_chain_count: number;
  layer_tension_count: number;
  layer_density: Record<string, { entities: number; edges: number; density: number }>;
  top_validation_chains: ValidationChain[];
  top_layer_tensions: LayerTension[];
}

// ── Compositional Logic ──

/** Result of compositional logic detection */
export interface CompositionResult {
  id: string;
  /** The component entities that combine */
  components: Array<{
    entity_id: string;
    name: string;
    layer: KnowledgeLayer;
    role: string;
  }>;
  /** The emergent capability or structure */
  emergent_label: string;
  emergent_description: string;
  /** How the composition works */
  mechanism: string;
  /** Confidence */
  confidence: number;
  /** Which intersection(s) revealed this */
  source_intersection_ids: string[];
  /** Composite score: novelty × impact × cross-layer bonus */
  composition_score: number;
}
