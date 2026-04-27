// ── D2 · Discovery proposal types ─────────────────────────────────────
//
// D2 in docs/KG_DEPTH_CRITIQUE.md: closes the simulation→KG loop by
// auto-promoting high-confidence simulation outputs (today: convergent
// points; soon: what-if findings, combination-panel emergent reactions,
// interaction-effect probes) into proposed entity/edge mutations the
// user can approve into the live KG.
//
// Design notes
// ─────────────
// Per the audit (docs/KG_DEPTH_CRITIQUE.md §9 D2), discovery proposals
// reuse the existing `twin_proposals` table rather than introducing a
// parallel `kg_discovery_proposals` substrate. Two new columns
// (migration 20260610_twin_proposals_discovery_source.sql):
//
//   - twin_proposals.discovery_source : text (nullable, check)
//   - twin_proposals.convergent_point_id : uuid FK (nullable, ON DELETE
//     SET NULL)
//
// The `justification` JSONB column becomes a discriminated union:
//
//   - When discovery_source IS NULL  → TwinProposalJustification (strategy)
//   - When discovery_source IS NOT NULL → DiscoveryProposalJustification (D2)
//
// This avoids polluting the strategy proposal type with discovery
// fields and keeps reads on either path narrow.
//
// Why reuse vs new table:
//   The user's stored memory (feedback_check_existing_first.md) calls
//   out the recurring fear of "parallel/orphaned subsystems making
//   things messier." The audit confirmed twin_proposals already has
//   the lifecycle, audit fields, RLS, and JSONB flexibility we need.
//   A new table would create exactly the structure-creep we're
//   avoiding.

import type { ScenarioAction } from "./scenario";

// ── Discovery source enum ─────────────────────────────────────────────

export const DISCOVERY_SOURCES = [
  /** Promoted from a `convergent_points` row whose
   *  composite (confidence × probability) cleared the propose
   *  threshold. The interactor → focal-entity relationship gets
   *  promoted to one or more edges. */
  "convergent_point",
  /** Promoted from a What-If simulation whose `affected_entities`
   *  list named high-impact propagations not already represented in
   *  the KG as edges. */
  "what_if",
  /** Promoted from the combination panel when novelty="emergent"
   *  named an intersection that should become a new edge or
   *  reaction-shaped entity. */
  "combination",
  /** D4 follow-up: multi-way interaction-effect probes (A∩B∩C
   *  yields outcome that A+B+C marginals don't predict). */
  "interaction_probe",
] as const;

export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export function isDiscoverySource(x: unknown): x is DiscoverySource {
  return (
    typeof x === "string" &&
    (DISCOVERY_SOURCES as readonly string[]).includes(x)
  );
}

// ── Discovery proposal justification (the JSONB payload) ──────────────

/**
 * Shape stored in `twin_proposals.justification` when
 * `discovery_source` is non-null. Strategy-proposal rows continue to
 * use TwinProposalJustification (src/types/strategy.ts) — these are
 * kept as separate, mutually-exclusive shapes inside the same JSONB
 * column.
 */
export interface DiscoveryProposalJustification {
  discovery_source: DiscoverySource;

  /** Back-ref into the source row when applicable. For
   *  convergent_point discoveries this is the convergent_points.id;
   *  for what_if it's the scenarios.id (the what-if persists there);
   *  for combination it's null today (combinations are ephemeral —
   *  see KG_DEPTH_CRITIQUE.md §5). */
  source_row_id: string | null;

  /** Composite signal that triggered the propose. Format depends on
   *  discovery_source — convergent_point uses
   *  { confidence, probability, alignment }, what_if uses
   *  { p50, ci_width }, etc. Stored as free-form JSONB so each
   *  source can describe its own triggering signal honestly. */
  signal: Record<string, unknown>;

  /** One-paragraph human-readable explanation of why this discovery
   *  was promoted. Surfaced in the review UI verbatim. */
  rationale: string;

  /** Ordered list of mutations to apply IF the user approves. The
   *  approval route (D2 phase 2) takes this, creates a `scenarios`
   *  row, and runs commit-scenario.ts. Today this is a typed
   *  ScenarioAction[] using only `add_entity` + `add_edge` kinds —
   *  the discovery semantic comes from the per-action `rationale`
   *  + the parent twin_proposal's discovery_source column, not from
   *  a new action kind. */
  proposed_action_list: ScenarioAction[];

  /** When this proposal was materialized by the discovery pipeline
   *  (ISO). Distinct from twin_proposals.generated_at (DB column);
   *  redundant for back-compat with strategy proposals' inline
   *  timestamp convention. */
  generated_at: string;
}

// ── Threshold tuning ──────────────────────────────────────────────────

/**
 * Default propose-thresholds for converting a `convergent_points` row
 * into a discovery proposal. Tunable per call. Below the propose
 * threshold the row is silently ignored (no proposal, no spam).
 *
 * These are MEDIUM-confidence thresholds — the proposal lands in
 * `twin_proposals.user_status = 'proposed'` for human review, not
 * auto-applied to live KG. A future "auto-materialize" path with
 * tighter thresholds is intentionally NOT in this first cut: writing
 * to live entities/edges without explicit user approval would be a
 * structural commitment we're not ready to make.
 */
export const DEFAULT_CONVERGENT_POINT_PROPOSE_THRESHOLDS = {
  /** Minimum confidence on the convergent point itself (the engine's
   *  certainty in the description). 0..1. */
  confidence: 0.75,
  /** Minimum probability of the outcome given the interactor set
   *  (likelihood under the modeled interaction). 0..1. */
  probability: 0.65,
  /** Minimum max alignment to ANY active objective. 0..1. Skips
   *  high-confidence-but-irrelevant convergent points. */
  objective_alignment: 0.6,
} as const;

export interface ConvergentPointProposeThresholds {
  confidence: number;
  probability: number;
  objective_alignment: number;
}

// ── Source-tag value used on inserted rows ────────────────────────────
//
// Per the audit, source_tag is treated as free text in some call
// sites (commit-scenario.ts already writes "scenario_commit"). For
// D2 we adopt a discriminator that downstream UIs and analyzers can
// filter on cleanly:

export const DISCOVERED_BY_SIM_SOURCE_TAG = "discovered_by_sim" as const;
