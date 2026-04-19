// Operating Twin — premium "command center" view computed from existing data.
// All data is aggregated client-side from TwinState + SynthesisData + Goals + Strategy.
// No new database table. See src/components/operating-twin/hooks/use-operating-twin-data.ts.

import type { ImprovementGoal } from "./goals";

// ── Lab cards ──

export type LabCategory =
  | "leverage"
  | "perspective"
  | "objective"
  | "risk"
  | "bottleneck"
  | "process";

export type LabSourceType =
  | "leverage_point"
  | "strategy_perspective"
  | "goal"
  | "risk_point"
  | "master_bottleneck"
  | "feedback_loop";

export type LabStatus = "healthy" | "warning" | "critical" | "building" | "idle";

export type TrendDirection = "up" | "down" | "stable" | "unknown";

export type LabMode = "lab" | "tracker" | "draft";

export interface LabMetric {
  label: string;
  value: string;          // pre-formatted display value (e.g., "82.4", "68%", "2.8 hr")
  unit?: string;
  trend: TrendDirection;
  trend_delta?: string;   // e.g., "↑ 4.2" or "↓ 12%"
  target?: string;
}

export interface LabCard {
  id: string;
  name: string;
  category: LabCategory;
  description?: string;
  mode: LabMode;
  metrics: LabMetric[];                  // primary metric first
  contribution_pct: number;              // -100 to +100
  contribution_abs: number;              // for sorting (absolute value)
  confidence: number;                    // 0-1
  status: LabStatus;
  entity_ids: string[];                  // linked KG entities (for click-through)
  primary_entity_id?: string | null;     // for NodeDetail
  source_type: LabSourceType;
  source_id: string;                     // ID of the source object (leverage_point.entity_id etc.)
  has_update?: boolean;                  // "1 new" badge
  // Layout — computed by use-lab-layout.ts
  position?: { x: number; y: number; angle: number };
  size?: "xl" | "l" | "m" | "s";
}

// ── Active frame (current objective) ──

export interface ActiveFrame {
  goal: ImprovementGoal;
  progress_pct: number;
  gap_remaining: number;
  trajectory_weeks: number | null;
  trajectory_confidence?: "high" | "moderate" | "low";
  contributing_labs_count: number;
  total_labs_count: number;
  day_count: number;                     // days since goal created
}

// ── Approval queue (pending objectives, strategy changes) ──

export type ApprovalType = "objective" | "strategy" | "change_proposal" | "research_finding";

export interface ApprovalItem {
  id: string;
  type: ApprovalType;
  tag_label: string;                     // e.g., "Lab proposal", "Tracker update", "Research finding"
  title: string;
  summary: string;
  confidence: number;
  priority: number;
  time_label: string;                    // e.g., "2m", "14m", "38m", "2d"
  created_at: string;
  action_url?: string;                   // where to navigate on click
}

// ── Recent insights ──

export type InsightType =
  | "connection"
  | "contradiction"
  | "cross_context"
  | "hidden_signal"
  | "worth_considering";

export type InsightBadgeKind = "full" | "partial" | "new";

export interface InsightItem {
  id: string;
  type: InsightType;
  name: string;
  meta: string;                          // e.g., "load-bearing · spawned 1 lab"
  severity: "high" | "medium" | "low";
  confidence: number;                    // 0-1, for display as ".91"
  timestamp: string;
  entity_ids: string[];
  badge: InsightBadgeKind;
  badge_text: string;                    // e.g., "3/3", "2/3"
}

// ── Connected services (data sources / integrations) ──

export type ServiceStatus = "connected" | "stale" | "pending";

export interface ServiceConnection {
  id: string;
  name: string;
  source_type: "research" | "external_entity" | "integration" | "deep_research";
  status: ServiceStatus;
  entity_count: number;
  last_sync?: string;
}

// ── System pulse ──

export interface SystemPulseState {
  // Connected services summary
  connected_count: number;
  total_possible: number;                // max services you could integrate
  connected_ok: boolean;

  // Scheduled research
  scheduled_research_count: number;
  next_research_label: string | null;    // "tonight 11pm", "tomorrow", etc.

  // Data points
  data_points_today: number;             // entity count changes + edge changes + claims (rough proxy)

  // Freshness
  freshness: "fresh" | "aging" | "stale";
  last_synthesis_at: string | null;
}

// ── Build state machine ──

export type TwinBuildMode = "interactive" | "auto" | "pending" | "none";

export type TwinBuildStage =
  | "not_started"       // objectives not yet confirmed
  | "chooser"           // showing mode chooser
  | "insufficient"      // insufficient data, show panel
  | "proposing"         // (Mode B) showing system proposal modal
  | "building"          // actively creating labs (Mode A step-by-step OR Mode B auto)
  | "ready";            // twin is built and ready to view

export interface TwinBuildState {
  stage: TwinBuildStage;
  mode: TwinBuildMode;
  current_step?: number;                 // for Mode A interactive (0-indexed)
  total_steps?: number;                  // total labs to propose
  approved_lab_ids: string[];            // labs already approved (persist in localStorage)
  skipped_lab_ids: string[];
}

// ── Insufficient data detection ──

export interface DataSufficiencyReport {
  sufficient: boolean;                   // overall
  lab_count: number;                     // labs that could be built today
  min_labs_recommended: number;          // e.g., 3
  missing: Array<{
    kind: "leverage_points" | "perspectives" | "goals" | "risk_points" | "entities" | "synthesis";
    have: number;
    need: number;
    label: string;                       // "Only 2 leverage points detected — 4+ recommended"
  }>;
  actions_available: Array<"deep_research" | "enrich_kg" | "continue_chat">;
}

// ── Identity ──

export interface TwinIdentity {
  name: string;                          // space name
  avatar_letter: string;                 // first letter of name
  day_count: number;                     // days since space created
  label: string;                         // "healthy" / "developing" / etc.
  total_labs: number;
  total_atoms: number;                   // entities
  total_claims: number;                  // claims + propositions combined
}

// ── Aggregated model ──

export interface OperatingTwinModel {
  identity: TwinIdentity;
  health_score: number;                  // 0-100
  health_label: "strong" | "developing" | "fragile" | "critical";
  health_delta_30d?: number;             // optional trend delta

  active_frame: ActiveFrame | null;
  labs: LabCard[];
  approvals: ApprovalItem[];
  recent_insights: InsightItem[];
  connected_services: ServiceConnection[];
  system_pulse: SystemPulseState;

  sufficiency: DataSufficiencyReport;
}
