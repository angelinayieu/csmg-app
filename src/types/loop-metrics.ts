/**
 * Self-Improving Loop — Metric Types
 *
 * Types for tracking KG expansion cycles, metrics snapshots,
 * gap analysis results, and research queries.
 */

import type { StackHealth, KnowledgeStackCounts } from "./intelligence-v2";

// ── KG Metrics Snapshot ──

export interface KGMetricsSnapshot {
  entity_count: number;
  edge_count: number;
  cycle_count: number;
  bridge_count: number;
  orphan_count: number;
  coverage_score: number;
  stack_health: StackHealth;
  knowledge_stack_counts: KnowledgeStackCounts;
}

// ── Loop Cycle Record ──

export type LoopCycleStatus = "running" | "completed" | "failed" | "partial";
export type LoopTriggerType = "cron" | "manual" | "reactive";

export interface LoopCyclePhase {
  phase_name: string;
  started_at: string;
  duration_ms: number;
  result_summary: string;
}

export interface LoopDelta {
  entities_added: number;
  entities_updated: number;
  edges_added: number;
  edges_removed: number;
  cycles_added: number;
  coverage_before: number;
  coverage_after: number;
  gaps_found: number;
  gaps_closed: number;
}

export interface LoopCycleRecord {
  id: string;
  space_id: string;
  user_id: string;
  cycle_number: number;
  started_at: string;
  completed_at: string | null;
  status: LoopCycleStatus;
  trigger_type: LoopTriggerType;
  depth_used: string;
  phases: LoopCyclePhase[];
  delta: LoopDelta;
  error_message: string | null;
  credits_used: number;
}

// ── Gap Analysis ──

export type GapType =
  | "structural_hole"
  | "stale_entity"
  | "unresolved_contradiction"
  | "open_question"
  | "low_coverage_cluster"
  | "coverage_improvement";

export interface ResearchQuery {
  query_text: string;
  reason: string;
  target_gap_type: GapType;
  target_entity_ids: string[];
  priority: number; // 1 = highest
}

export interface GapAnalysisResult {
  structural_holes: string[];
  stale_entities: string[];
  unresolved_contradictions: string[];
  open_questions: string[];
  low_coverage_clusters: string[];
  recommended_queries: ResearchQuery[];
  analysis_summary: string;
  computed_at: string;
}

// ── DB Row Types (mirror Supabase tables) ──

export interface KGMetricsSnapshotRow {
  id: string;
  space_id: string;
  cycle_id: string | null;
  captured_at: string;
  metrics: KGMetricsSnapshot;
  trigger_type: string;
}

export interface LoopCycleRecordRow {
  id: string;
  space_id: string;
  user_id: string;
  cycle_number: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  trigger_type: string;
  depth_used: string;
  phases: LoopCyclePhase[];
  delta: LoopDelta;
  error_message: string | null;
  credits_used: number;
}
