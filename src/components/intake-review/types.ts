// ── IntakeReview types (Arc 5C.2 / P0.2) ───────────────────────────────
//
// Shared state passed between the 4 steps of the intake-review wizard.
// The user's deferral choices are collected here and then submitted as
// `deferred_*` arrays on the strategy-refresh confirm action so the
// backend filters materialization accordingly.

export interface IntakeReviewState {
  /** Tracker `source_key` values the user toggled off (won't be created). */
  deferredTrackerKeys: Set<string>;
  /** infrastructure_proposal.id values the user toggled off (won't become apps). */
  deferredProposalIds: Set<string>;
  /** micro_tactic.id values the user toggled off (won't become interventions). */
  deferredTacticIds: Set<string>;
  /** Per-tactic priority overrides (tactic.id → new priority). Sparse. */
  tacticPriorityOverrides: Map<string, number>;
  /** Per-tracker target_value overrides (source_key → new target). Sparse. */
  trackerTargetOverrides: Map<string, string>;
}

export type IntakeStep = "metrics" | "apps" | "tactics" | "confirm";

export const STEP_ORDER: IntakeStep[] = ["metrics", "apps", "tactics", "confirm"];

export const STEP_LABELS: Record<IntakeStep, string> = {
  metrics: "Metrics plan",
  apps: "Apps & features",
  tactics: "Tactics & timeline",
  confirm: "Review & confirm",
};

export const STEP_SUBTITLES: Record<IntakeStep, string> = {
  metrics: "Choose which metrics we'll track, with targets and cadence.",
  apps: "See what apps we'll build and which you want to defer.",
  tactics: "Reorder tactics, defer any that feel premature.",
  confirm: "Final look before we materialize everything.",
};

export function emptyIntakeReviewState(): IntakeReviewState {
  return {
    deferredTrackerKeys: new Set(),
    deferredProposalIds: new Set(),
    deferredTacticIds: new Set(),
    tacticPriorityOverrides: new Map(),
    trackerTargetOverrides: new Map(),
  };
}
