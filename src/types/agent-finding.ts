/**
 * Wave D types — agent_findings.
 * Source of truth: supabase/migrations/20260516_agent_findings.sql.
 */

export type AgentFindingKind =
  | "entity_discovered"
  | "entity_refined"
  | "objective_proposed"
  | "bridge_suggested"
  | "contradiction_found"
  | "prediction_surprise"
  | "pattern_detected"
  | "risk_flagged";

export type AgentFindingSeverity = "info" | "notable" | "urgent";

export type AgentFindingStatus = "unread" | "reviewed" | "acted_on" | "dismissed";

export interface AgentFinding {
  id: string;
  user_id: string;
  agent_id: string | null;
  agent_run_id: string | null;
  space_id: string | null;
  finding_kind: AgentFindingKind;
  ref_kind: string | null;
  ref_id: string | null;
  summary: string;
  rationale: string | null;
  confidence: number;
  severity: AgentFindingSeverity | null;
  status: AgentFindingStatus;
  payload: Record<string, unknown>;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface RecordAgentFindingInput {
  user_id: string;
  finding_kind: AgentFindingKind;
  summary: string;
  agent_id?: string | null;
  agent_run_id?: string | null;
  space_id?: string | null;
  ref_kind?: string | null;
  ref_id?: string | null;
  rationale?: string | null;
  confidence?: number;
  severity?: AgentFindingSeverity | null;
  payload?: Record<string, unknown>;
}

/** POST /api/agent-findings/[id]/review body */
export interface ReviewAgentFindingInput {
  action: "review" | "act" | "dismiss";
  note?: string;
}
