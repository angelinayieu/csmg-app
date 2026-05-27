// ── Lab Notebook Event Types ──────────────────────────────────────
//
// Phase 9 — shared shape between the GET /sub-objectives/[id]/decisions
// API route and the LabNotebookPanel UI. The API server-side enriches
// raw decision rows (which carry IDs) into these events (which carry
// display strings). The UI just renders.

import type { DecisionAction } from "./decision-log";

/** Notebook events derive their visual role from the underlying
 *  decision action. The DB action column is open-ended after the
 *  Phase 9 migration; this is the discriminator the UI uses to
 *  pick icon + label + lane color. */
export type NotebookAction = DecisionAction;

export interface NotebookEventSubject {
  /** Sub-objective room id. Always present — events are scoped. */
  sub_objective_id?: string | null;
  /** Entity (typically a feature) the event acted on. */
  entity_id?: string | null;
  entity_name?: string | null;
  /** Variation id when applicable (elect/reject/refine outputs). */
  variation_id?: string | null;
  variation_name?: string | null;
  /** Chain id when the event is chain-scoped (approve_bet). */
  chain_id?: string | null;
  chain_label?: string | null;
}

export interface NotebookEventMeta {
  /** Score-shaped metadata. */
  lift_pct?: number | null;
  placebo_verdict?: "pass" | "fail" | "skip" | null;
  top_score?: number;
  effectiveness_score?: number;
  /** For elect/reject — the prior state if known. */
  prior_disposition?: "elected" | "rejected" | "deferred" | null;
  /** R&D / refine fields. */
  target_root_cause?: string;
  candidate_count?: number;
  /** Compose fields. */
  conflicts_open_count?: number;
  integration_points_count?: number;
  /** Approve fields. */
  approved?: boolean;
  /** Generic display blurb the UI can use when nothing else fits. */
  blurb?: string;
}

export interface NotebookEvent {
  id: string;
  action: NotebookAction;
  created_at: string;
  subject: NotebookEventSubject;
  meta: NotebookEventMeta;
}

/** Cursor-paginated response shape. */
export interface NotebookEventPage {
  events: NotebookEvent[];
  /** ISO timestamp of the OLDEST event in this page — pass back as
   *  `cursor` for the next page. Null when no more pages. */
  next_cursor: string | null;
  /** Total event count for this sub-objective (NOT this page). */
  total: number;
}
