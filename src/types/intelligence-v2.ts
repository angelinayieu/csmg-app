/**
 * Intelligence Radar v2 Types
 *
 * Backward-compatible extension types intended for synthesis_data.intelligence_radar payloads.
 * These types do NOT require immediate DB schema changes.
 */

export type EvidenceLevel = "stated" | "inferred" | "predicted";

export type EdgeRole =
  | "bridge"
  | "discovered"
  | "causal"
  | "interaction"
  | "structural";

export type DiscoverySource =
  | "manual"
  | "research"
  | "intersection"
  | "link_prediction"
  | "pipeline";

export interface PhaseWeight {
  now: number;   // 0-1
  next: number;  // 0-1
  later: number; // 0-1
}

export interface EdgeProvenanceV2 {
  edge_role?: EdgeRole;
  discovery_source?: DiscoverySource;
  evidence_level?: EvidenceLevel;
  phase_weight?: PhaseWeight;
  confidence_explainer?: string;
  source_refs?: string[];
}

export type DecisionDueWindow = "now" | "this_week" | "this_month";

export interface DecisionOption {
  id: string;
  label: string;
  description: string;
  upside?: string;
  downside?: string;
  effort?: "low" | "medium" | "high";
  reversibility?: "high" | "medium" | "low";
}

export interface PriorityDecisionV2 {
  id: string;
  entity_id: string;
  entity_name: string;

  decision_question: string;
  options: DecisionOption[]; // 2-4 options preferred
  tradeoffs: string[];

  recommended_option_id: string;
  recommended_reason: string;
  next_action: string;
  due_window: DecisionDueWindow;

  confidence: number; // 0-1
  evidence_level: EvidenceLevel;
  evidence_refs: string[];

  affected_entities: string[];
  core_tension_alignment: number; // 0-1
}

export interface CoreTension {
  title: string;
  description: string;
  entity_ids: string[];
}

export interface UnknownItem {
  id: string;
  question: string;
  impact: "low" | "medium" | "high";
  owner?: string;
  next_probe: string;
  status?: "open" | "investigating" | "resolved";
}

export interface ContradictionItem {
  id: string;
  a: string;
  b: string;
  why_it_matters: string;
  resolution_paths: string[];
  confidence?: number; // 0-1
}

export type TriadPatternType =
  | "mediator"
  | "moderator"
  | "common_cause"
  | "feedback_triad";

export interface TriadFinding {
  id: string;
  a: string;
  b: string;
  c: string;
  pattern_type: TriadPatternType;
  confidence: number; // 0-1
  rationale?: string;
}

export type ArchetypeName =
  | "flywheel"
  | "bottleneck"
  | "cold_start"
  | "principal_agent"
  | "network_effects";

export interface ArchetypeMatch {
  id: string;
  name: ArchetypeName;
  fit_score: number; // 0-1
  evidence: string[];
  counterevidence: string[];
}

// ── Temporal Intelligence ──

export interface SignalVelocity {
  /** New signals per period, bucketed by type */
  by_type: Record<string, number>;
  /** Total signals in current period */
  current_period_count: number;
  /** Total signals in previous period */
  previous_period_count: number;
  /** Ratio: current/previous — >1 means accelerating, <1 means decelerating */
  acceleration: number;
  period_days: number;
  computed_at: string;
}

export interface EntityStaleness {
  entity_id: string;
  entity_name: string;
  days_since_last_touch: number;
  last_touched_by: "research" | "signal" | "bridge" | "authority_update" | "manual";
  stale: boolean; // true if >staleness_threshold_days
}

export interface CoverageTrajectory {
  /** Historical coverage scores (max ~10 snapshots) */
  snapshots: Array<{ score: number; date: string }>;
  /** Direction: improving, stable, degrading */
  trend: "improving" | "stable" | "degrading";
  /** Coverage change per period */
  delta_per_period: number;
}

export interface CadenceRecommendation {
  current_cadence: string;
  recommended_cadence: string;
  reason: string;
  landscape_volatility: "high" | "medium" | "low";
}

export interface TemporalIntelligence {
  signal_velocity: SignalVelocity;
  stale_entities: EntityStaleness[];
  coverage_trajectory: CoverageTrajectory;
  cadence_recommendation: CadenceRecommendation | null;
  computed_at: string;
}

// ── Coverage Improvement ──

export interface CoverageImprovementRec {
  action: "create_bridge" | "research_category" | "upgrade_authority" | "add_entity";
  description: string;
  target_entity_id?: string;
  target_entity_name?: string;
  internal_entity_id?: string;
  internal_entity_name?: string;
  estimated_coverage_gain: number; // 0-100 points
  effort: "low" | "medium" | "high";
  priority: number; // 1 = highest
}

// ── User Feedback / Signal Verdicts ──

export type SignalVerdict = "useful" | "irrelevant" | "already_known" | "needs_research";

export interface SignalVerdictRecord {
  signal_id: string;
  entity_id: string;
  verdict: SignalVerdict;
  note?: string;
  timestamp: string;
}

export interface EntityVerdictWeight {
  entity_id: string;
  /** Cumulative weight from user verdicts: >0 = user finds relevant, <0 = user dismisses */
  relevance_weight: number;
  verdict_count: number;
  last_verdict_at: string;
}

// ── Intelligence Narrative ──

export interface IntelligenceNarrative {
  /** 2-4 sentence executive summary connecting core tension, key contradictions, and structural findings */
  executive_summary: string;
  /** What changed since last analysis */
  change_summary: string | null;
  /** Top 3 things requiring attention, in priority order */
  attention_items: Array<{
    title: string;
    reason: string;
    entity_ids: string[];
    source: "decision" | "contradiction" | "unknown" | "archetype" | "triad" | "signal";
  }>;
  generated_at: string;
}

// ── Landscape Clusters (dynamic radar chart axes) ──

export interface LandscapeCluster {
  id: string;              // e.g. "cluster_ai_integration"
  label: string;           // Human-readable: "AI Integration"
  entity_ids: string[];    // Entities belonging to this cluster
  signal_strength: number; // 0-1, relative weight/density of this cluster
  color?: string;          // Optional display color
}

// ── Knowledge Stack metrics ──

export interface StackHealth {
  /** Source diversity (0-10) */
  source_diversity: number;
  /** Average credibility across all entities (0-1) */
  avg_credibility: number;
  /** Typed edges / max possible edges (0-1) */
  connection_density: number;
  /** Insights / atoms ratio */
  insight_yield: number;
}

export interface KnowledgeStackCounts {
  sources: { total: number; avg_credibility: number };
  atoms: { total: number; verified: number };
  connections: { typed: number; floating: number };
  insights: { total: number; high_impact: number };
}

// ── Full v2 Payload ──

export interface IntelligenceRadarDataV2 {
  // Existing radar fields can remain in parallel
  priority_decisions_v2?: PriorityDecisionV2[];
  core_tension?: CoreTension;
  unknowns?: UnknownItem[];
  contradictions?: ContradictionItem[];
  triads?: TriadFinding[];
  archetype_matches?: ArchetypeMatch[];
  temporal?: TemporalIntelligence;
  coverage_improvements?: CoverageImprovementRec[];
  signal_verdicts?: SignalVerdictRecord[];
  entity_verdict_weights?: EntityVerdictWeight[];
  narrative?: IntelligenceNarrative;
  /** Cross-layer analysis results (3-Layer KG) */
  cross_layer_analysis?: {
    validation_chain_count: number;
    layer_tension_count: number;
    layer_density: Record<string, { entities: number; edges: number; density: number }>;
    top_validation_chains: Array<{
      id: string;
      external_entity: { id: string; name: string };
      conceptual_entity: { id: string; name: string } | null;
      internal_entity: { id: string; name: string };
      direction: "validates" | "challenges" | "neutral";
      chain_confidence: number;
    }>;
    top_layer_tensions: Array<{
      id: string;
      internal_claim: { entity_id: string; name: string; claim: string };
      external_counter: { entity_id: string; name: string; claim: string };
      mediating_mechanism: { entity_id: string; name: string } | null;
      severity: "high" | "medium" | "low";
    }>;
  } | null;
  /** Semantic landscape clusters for radar chart axes (LLM-generated) */
  landscape_clusters?: LandscapeCluster[];
  /** Compositional logic — emergent structures from entity combinations */
  compositions?: Array<{
    id: string;
    components: Array<{ entity_id: string; name: string; layer: string; role: string }>;
    emergent_label: string;
    emergent_description: string;
    mechanism: string;
    composition_score: number;
  }>;
}

/**
 * Runtime guard: shallow validation to protect UI from malformed payloads.
 */
export function isPriorityDecisionV2(value: unknown): value is PriorityDecisionV2 {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.entity_id === "string" &&
    typeof obj.entity_name === "string" &&
    typeof obj.decision_question === "string" &&
    Array.isArray(obj.options) &&
    Array.isArray(obj.tradeoffs) &&
    typeof obj.recommended_option_id === "string" &&
    typeof obj.next_action === "string" &&
    typeof obj.due_window === "string" &&
    typeof obj.confidence === "number" &&
    Array.isArray(obj.evidence_refs)
  );
}
