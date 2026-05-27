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
  /** Sub-objective room id. Nullable post-Phase-10a — space-scoped
   *  events (stage transitions, constraints, finding curation, theme
   *  distillation, concept branching) leave this null. */
  sub_objective_id?: string | null;
  /** Sub-objective TITLE — populated by the GET handler enrichment
   *  so the All-rooms (space-scoped) view can render "in Room X"
   *  without a second lookup. */
  sub_objective_title?: string | null;
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
  /** Phase 11.1 — which evaluation tier produced top_score /
   *  effectiveness_score. Surfaces as the MethodBadge in notebook
   *  rows so the user always sees the method behind the number. */
  evaluation_method?:
    | "heuristic"
    | "rubric"
    | "evidence"
    | "simulation"
    | "tested";
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
  // ── Phase 10a system event metadata ──
  /** room_generated — counts per layer to render "Room born: 4 pains, 5 mechanisms, 3 outcomes". */
  room_layer_counts?: { pain?: number; features?: number; outcomes?: number };
  /** item_expanded — surface how many variations + whether research backed it. */
  variation_count?: number;
  had_research?: boolean;
  /** expansion_spawned — title of the new node + which attach point it grew from. */
  expansion_node_title?: string;
  attach_point?: string;
  /** prototype_status_changed — prior + new lifecycle state + optional result_summary on concluded. */
  prototype_status?: "planned" | "running" | "concluded" | "abandoned" | null;
  prior_prototype_status?: "planned" | "running" | "concluded" | "abandoned" | null;
  result_summary?: string;
  /** finding_* — what was acknowledged/dismissed/resolved. */
  finding_id?: string;
  finding_title?: string;
  finding_category?: string;
  finding_severity?: string;
  /** theme_distilled — theme + the new sub-objective it spawned. */
  theme_title?: string;
  spawned_sub_objective_id?: string;
  spawned_sub_objective_title?: string;
  /** concept_branched — canonical concept that seeded a new room. */
  canonical_code?: string;
  canonical_display_name?: string;
  prior_entity_count?: number;
  /** constraints_set — short human-readable summary like "time=3mo, budget=low, team=2". */
  constraints_summary?: string;
  /** stage_transitioned — clarifying → picking, picking → main. */
  stage_from?: "clarifying" | "picking" | "main" | "done";
  stage_to?: "clarifying" | "picking" | "main" | "done";
  /** autopilot_run — how many chains the user kicked off in this session. */
  chain_count?: number;
  chain_ids?: string[];
  // ── Phase 11.2 — proxy-indicator breakdown for `score` events ──
  /** Top 3 indicators touched by this scoring run, sorted by avg
   *  score desc across all graded variations. `min_confidence` is the
   *  lowest proxy-confidence we saw for that indicator across the
   *  variations — flag "shaky proxy" when ≤0.4 so the user can
   *  reconsider what they're measuring rather than chase a number
   *  on an unreliable signal. Empty array when the target room had
   *  no proxy indicators on its outcomes. */
  indicator_breakdown?: Array<{
    indicator: string;
    avg_score: number;
    min_confidence: number;
    outcome_name: string;
  }>;
  /** Total distinct indicators graded in this scoring run — gives
   *  the user a sense of "scored across 5 proxies" even when only
   *  3 fit in the breakdown chip set. */
  indicator_count?: number;
  // ── Phase 11.4 — chain enrichment ──────────────────────────────
  /** chains_enriched — total chains the run enriched (existing
   *  triplets that received narrative + mediators + chain_strength). */
  enriched_chain_count?: number;
  /** chains_enriched — net-new chains the complementary proposer
   *  added for previously-orphaned items. Renders as "+ 2 new chains"
   *  on the timeline event. */
  new_chains_count?: number;
  /** chains_enriched — mean of chain_strength across all enriched
   *  chains. Surfaces as the headline number on the timeline
   *  ("enriched chains · avg strength 0.71"). */
  avg_chain_strength?: number;
  /** chains_enriched — count of items in lanes that had no edges
   *  before this run and now have at least one. The Portfolio strip
   *  reads this to know when its orphan list shrinks. */
  orphans_closed?: number;
  // ── Phase 11.6 — indicator baselines ──────────────────────────
  /** baseline_set — which indicator received the new baseline. */
  indicator_name?: string;
  /** baseline_set — the baseline value as a string (it can be a
   *  number, range, percentage, or even a self-rating like "8/10").
   *  Stored as string for flexibility; client renders as-is. */
  baseline_value?: string;
  /** baseline_set — the target value the user / LLM wants to hit. */
  target_value?: string;
  /** baseline_set — unit string ("minutes/day", "bpm", "score 1-10"). */
  baseline_unit?: string;
  /** baseline_set — whether the user entered the value or the LLM
   *  auto-filled it from a calibration_baseline expansion-tree node. */
  baseline_source?: "user" | "llm";
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
