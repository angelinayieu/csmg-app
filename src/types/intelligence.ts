/**
 * Strategic Intelligence Radar — Type Definitions
 *
 * Powers the "World View" module that surfaces external landscape context
 * as a first-class interactive experience rather than burying it in synthesis.
 *
 * Zero new database tables — all stored in existing entities/edges tables
 * (filtered by knowledge_layer) + synthesis_data JSONB accumulation.
 */

// ── External entity categories (from research Agent 7 provenance) ──

export type ExternalCategory =
  | "competitor"
  | "framework"
  | "pattern"
  | "data_point"
  | "analogy"
  | "risk_pattern"
  | "resource";

export type AuthorityLevel = "high" | "moderate" | "low" | "unverified";
export type ResearchDepth = "training" | "light" | "standard" | "deep";

// ── Epistemological node types (Knowledge Stack dual taxonomy) ──

export type EpistemicNodeType =
  | "claim"
  | "evidence"
  | "hypothesis"
  | "pattern"
  | "question"
  | "actor";

// ── Combined credibility model ──

export interface SourceCredibility {
  /** Source authority score (0-1), mapped from AuthorityLevel */
  source_authority: number;
  /** Claim corroboration (0-1), how many independent sources agree */
  claim_corroboration: number;
  /** Temporal freshness (0-1) */
  recency: number;
  /** Composite: authority × 0.4 + corroboration × 0.35 + recency × 0.25 */
  effective_confidence: number;
}

// ── Research agent identity ──

export interface ResearchAgent {
  id: string;
  name: string;
  focus_areas: string[];
  status: "idle" | "running" | "completed" | "error" | "sweeping" | "analyzing";
  last_run_at: string | null;
  findings_count: number;
  entity_ids: string[];
  derived_from:
    | "focus_area"
    | "continuation_signal"
    | "research_trigger"
    | "sub_objective"
    | "goal_tracking";
  source_trigger_id?: string;
  /** "ATLAS-04" style callsign */
  callsign?: string;
  /** Short specialty label ("Regulatory specialist", "Market scanner") */
  specialty?: string;
  /** 24 hourly counts for sparkline */
  sparkline?: number[];
  /** Number of signals produced today */
  signals_today?: number;
  /** ID of the sub-objective or goal this agent tracks (for trace-back) */
  source_objective_id?: string;
  source_goal_id?: string;
}

export interface AgentFleet {
  agents: ResearchAgent[];
  last_fleet_update: string;
}

// ── Per-agent overrides (user-edited config stored in synthesis_data.agent_overrides) ──

export interface AgentOverrides {
  /** Agent ID these overrides apply to */
  agent_id: string;
  /** User-provided display name (overrides auto-generated name) */
  name?: string;
  /** User-provided callsign (overrides auto-generated) */
  callsign?: string;
  /** User-provided specialty description */
  specialty?: string;
  /** Additional focus areas beyond the derived ones */
  extra_focus_areas?: string[];
  /** Focus areas to exclude from auto-derivation */
  excluded_focus_areas?: string[];
  /** Per-agent depth override (falls back to schedule.depth) */
  depth?: ResearchDepth;
  /** Per-agent cadence override ("inherit" = use schedule.cadence) */
  cadence?: "inherit" | "manual" | "daily" | "weekly" | "biweekly" | "monthly";
  /** Per-run cost cap in USD */
  budget_per_run?: number;
  /** Monthly budget cap in USD */
  budget_monthly?: number;
  /** Lifecycle state — agents can be paused or archived */
  lifecycle: "active" | "paused" | "archived";
  /** Free-text prompt augmentation appended to research calls */
  prompt_addendum?: string;
  /** Domains to avoid during research */
  avoid_domains?: string[];
  /** Required sources (user-curated) */
  required_sources?: string[];
  /** Last time this override was updated */
  updated_at: string;
  /** Who last updated (for audit — e.g., "user" or "auto-retune") */
  updated_by?: string;
}

// ── Intelligence tiers ──

/**
 * Two-tier intelligence classification:
 * - "embedded": Directly connected to user's graph via strong bridges — high strategic weight
 * - "observatory": Landscape context without strong bridges — useful for awareness, lower weight
 */
export type IntelligenceTier = "embedded" | "observatory";

// ── Orbital layout rings ──

/**
 * Determines which concentric ring an entity occupies in the orbital visualization.
 * - core: Internal high-importance entities (bottleneck, leverage, risk)
 * - conceptual: Expansion-derived mechanisms (SC_ entities, knowledge_layer="conceptual")
 * - bridge: Bridge entities connecting internal ↔ external
 * - direct: External entities with at least one bridge to internal
 * - landscape: External entities with no direct internal bridge (context-only)
 */
export type OrbitalRing = "core" | "conceptual" | "bridge" | "direct" | "landscape";

// ── Intelligence signals (what changed in the external landscape) ──

export type SignalStatus = "active" | "dismissed" | "investigating" | "escalated" | "resolved";

export interface IntelligenceSignal {
  id: string;
  type:
    | "new_entity"        // New external entity discovered
    | "authority_change"  // Entity's authority level shifted
    | "new_bridge"        // New connection from external → internal
    | "entity_removed"    // Previously tracked entity no longer relevant
    | "confidence_shift"  // Significant confidence change
    | "new_source";       // New web source discovered for existing entity
  entity_id: string;
  entity_name: string;
  category: ExternalCategory;
  description: string;
  detected_at: string;
  severity: "high" | "medium" | "low";
  /** Internal entity_ids that this signal is relevant to */
  related_internal_entities: string[];
  /** Triage status — defaults to "active" when omitted */
  status?: SignalStatus;
  dismissed_at?: string;
  escalated_at?: string;
  resolved_at?: string;
  user_note?: string;
}

// ── Filter state for the radar UI ──

export interface RadarFilterState {
  categories: Set<ExternalCategory>;
  authorityLevels: Set<AuthorityLevel>;
  ring: OrbitalRing | "all";
  sortBy: "relevance" | "authority" | "recency" | "category";
  searchQuery: string;
  tier: IntelligenceTier | "all";
}

export const DEFAULT_RADAR_FILTERS: RadarFilterState = {
  categories: new Set<ExternalCategory>([
    "competitor", "framework", "pattern", "data_point",
    "analogy", "risk_pattern", "resource",
  ]),
  authorityLevels: new Set<AuthorityLevel>(["high", "moderate", "low", "unverified"]),
  ring: "all",
  sortBy: "relevance",
  searchQuery: "",
  tier: "all",
};

// ── Connection analysis (how an external entity links to strategy) ──

export interface ConnectionPath {
  type:
    | "supports_leverage"   // Validates or strengthens a leverage point
    | "validates_risk"      // Confirms or updates a risk assessment
    | "informs_strategy"    // Provides context for a strategic decision
    | "bridges_to"          // Direct bridge to internal entity
    | "challenges"          // Contradicts or challenges an assumption
    | "precedent_for";      // Historical precedent for current approach
  internal_entity_id: string;
  internal_entity_name: string;
  reasoning: string;
  strength: number; // 0-1
}

export interface StrategyLink {
  tactic_title?: string;
  perspective_name?: string;
  infrastructure_component?: string;
  relevance: string;
}

export interface ConnectionAnalysis {
  external_entity_id: string;
  external_entity_name: string;
  ring: OrbitalRing;
  connections: ConnectionPath[];
  strategy_links: StrategyLink[];
  cross_context_insights: string[]; // insight text from cross_context_insights
}

// ── Research scheduling ──

export interface ResearchSchedule {
  cadence: "manual" | "daily" | "weekly" | "biweekly" | "monthly";
  depth: ResearchDepth;
  last_run_at: string | null;
  next_run_at: string | null;
  /** Specific areas to focus research on (category names or search terms) */
  focus_areas: string[];
  enabled: boolean;
}

export const DEFAULT_RESEARCH_SCHEDULE: ResearchSchedule = {
  cadence: "weekly",
  depth: "standard",
  last_run_at: null,
  next_run_at: null,
  focus_areas: [],
  enabled: false,
};

// ── Research snapshot (for signal diffing) ──

export interface ResearchSnapshot {
  entity_ids: string[];
  authority_map: Record<string, AuthorityLevel>;
  confidence_map: Record<string, number>;
  timestamp: string;
}

// ── Persisted in synthesis_data.intelligence_radar ──

export interface IntelligenceRadarData {
  schedule: ResearchSchedule;
  last_snapshot: ResearchSnapshot | null;
  signals: IntelligenceSignal[];
  /** When the radar data was last computed */
  updated_at: string;
  /** Agent fleet state (derived from focus areas + continuation signals) */
  agent_fleet?: AgentFleet;
}

// ── Summary stats for compact display ──

export interface RadarSummary {
  total_external: number;
  total_internal: number;
  by_category: Record<string, number>;
  by_authority: Record<string, number>;
  bridge_count: number;
  signal_count: number;
  last_research_at: string | null;
  /** 0-100: How well-covered is the external landscape relative to internal complexity */
  coverage_score: number;
  /** Two-tier intelligence counts */
  embedded_count: number;
  observatory_count: number;
  promotion_candidate_count: number;
}

// ── Category display configuration ──

export const CATEGORY_CONFIG: Record<
  ExternalCategory,
  { label: string; icon: string; color: string; bg: string; stroke: string }
> = {
  competitor:   { label: "Competitive Landscape", icon: "CL", color: "text-red-600",    bg: "bg-red-50",    stroke: "#E24B4A" },
  framework:    { label: "Framework",             icon: "FW", color: "text-purple-600", bg: "bg-purple-50", stroke: "#7F77DD" },
  pattern:      { label: "Known Pattern",         icon: "KP", color: "text-blue-600",   bg: "bg-blue-50",   stroke: "#378ADD" },
  data_point:   { label: "Market Data",           icon: "MD", color: "text-green-600",  bg: "bg-green-50",  stroke: "#1D9E75" },
  analogy:      { label: "Cross-Domain Analogy",  icon: "XD", color: "text-amber-600",  bg: "bg-amber-50",  stroke: "#BA7517" },
  risk_pattern: { label: "Known Risk",            icon: "RK", color: "text-red-600",    bg: "bg-red-50",    stroke: "#D85A30" },
  resource:     { label: "Resource",              icon: "RS", color: "text-teal-600",   bg: "bg-teal-50",   stroke: "#0D9488" },
};

export const AUTHORITY_CONFIG: Record<
  AuthorityLevel,
  { label: string; color: string; bg: string }
> = {
  high:       { label: "Verified",        color: "text-green-700", bg: "bg-green-50" },
  moderate:   { label: "Likely accurate", color: "text-blue-700",  bg: "bg-blue-50" },
  low:        { label: "Training data",   color: "text-gray-600",  bg: "bg-gray-100" },
  unverified: { label: "Unverified",      color: "text-amber-700", bg: "bg-amber-50" },
};

// ── Orbital ring configuration ──

export const RING_CONFIG: Record<
  OrbitalRing,
  { label: string; radius: number; color: string; description: string }
> = {
  core:       { label: "Core System",      radius: 0,   color: "#378ADD", description: "Your internal leverage points, bottleneck, and high-importance entities" },
  conceptual: { label: "Concept Model",    radius: 100, color: "#14B8A6", description: "Expansion-derived mechanisms and sub-components" },
  bridge:     { label: "Bridge Zone",      radius: 180, color: "#EF9F27", description: "Entities connecting your system to external landscape" },
  direct:     { label: "Direct Intel",     radius: 280, color: "#7F77DD", description: "External entities with confirmed connections to your system" },
  landscape:  { label: "Landscape",        radius: 400, color: "#86868B", description: "Broader context without direct connections yet" },
};
