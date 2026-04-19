// Unified Finding type — normalizes leverage points, risk points, convergences,
// and bottleneck into a single ranked list for the Convergence Workspace.

import type { ConvergenceInsight, ConvergenceDepth } from "./interactions";
import type { InsightStatus } from "./synthesis";

export interface PropagationStep {
  layer: ConvergenceDepth;
  label: string;
  entity_id?: string;
  status: "verified" | "inferred" | "pending";
}

export interface AtomicFloorMeta {
  /** How many times the system attempted to decompose further */
  decomposition_attempts: number;
  /** Whether the element was confirmed irreducible */
  reached_irreducible: boolean;
  /** Why decomposition stopped */
  terminal_reason: "irreducible" | "budget_limit" | "circular_reference";
  /** Number of sub-probes that confirmed the floor */
  sub_probes: number;
}

export type FindingType = "leverage" | "risk" | "convergence" | "bottleneck";

export interface Finding {
  id: string;
  rank: number;
  title: string;
  summary: string;
  finding_type: FindingType;
  /** Structural depth where this finding operates */
  layer: ConvergenceDepth;
  /** Percentage impact on master goal (0-100) */
  impact_pct: number;
  /** Confidence level (0-1) */
  confidence: number;
  /** Entity IDs that this finding is derived from */
  source_entity_ids: string[];
  /** Domain names involved (entity categories or space names) */
  domains: string[];
  /** Suggested action label for the UI */
  action_label: "Review" | "Approve" | "Skip" | "Investigate";
  /** Agent that detected this finding */
  detected_by?: string;
  /** When this finding was detected */
  detected_at?: string;
  /** User status tracking */
  insight_status?: InsightStatus;

  // ── Convergence-specific data ──
  /** Full convergence insight if finding_type === "convergence" */
  convergence_data?: ConvergenceInsight;

  // ── Propagation path ──
  /** How this finding cascades through layers (L4→L3→L2→L1) */
  propagation_path?: PropagationStep[];

  // ── Atomic floor verification ──
  /** Decomposition depth metadata */
  atomic_floor?: AtomicFloorMeta;

  // ── Source-specific extras ──
  /** Blast radius for risk/bottleneck findings */
  blast_radius?: number;
  /** Reasoning chain from synthesis */
  reasoning?: string[];
  /** Primary action recommendation */
  action_primary?: string;

  // ── Impact detail (computed by rankFindings) ──
  /** Effort estimate: "Low" | "Medium" | "High" */
  effort_estimate?: "Low" | "Medium" | "High";
  /** Effort detail e.g. "~2 weeks · reversible" */
  effort_detail?: string;
  /** Time to measurable result in days */
  time_to_result_days?: number;
  /** How many strategies this finding compounds across */
  leverage_count?: number;
  /** What percentage of the remaining goal gap this closes */
  goal_closure_pct?: number;
  /** Human-readable closure detail e.g. "closes 73% of 8% gap" */
  goal_closure_detail?: string;
}
