// ── Lab option types (Phase 2 / Sprint W4.4) ─────────────────────────
//
// TIER: 3 (situation-specialized causal model) — lab options are the
//       committed-experimental-design layer of the situation twin.
//
// What a LabConfigOption is:
//   A stance-flavored proposal for HOW to design the experiment that
//   tests the user's chosen problem framing. Five stances diverge on
//   what counts as "the right" experimental design:
//
//     • tight_experimentalist — optimizes internal validity
//       (strict RCT, single IV, blinded; sacrifices ecological validity)
//     • naturalistic_observer — optimizes external validity
//       (minimal disruption, behavioral telemetry; sacrifices causal precision)
//     • adaptive_designer — optimizes statistical efficiency
//       (Bayesian / sequential / stop-when-evidence-sufficient)
//     • pragmatist — optimizes feasibility
//       (what's actually achievable given subject access + time budget)
//     • mechanistic_prober — optimizes hypothesis testing
//       (designs probes specifically to test the chosen framing's
//        load-bearing assumption)
//
// Each stance produces ONE LabConfigOption per intake. The 5 options
// land in twin_proposals(kind='lab_twin', lab_payload.options[]).
// The user picks one via /app/space/[id]/lab/pick; the chosen option
// then derives a row in the existing lab_scaffolds table so the
// downstream wizard + subject-materialization pipeline keeps working
// unchanged.
//
// Persistence: twin_proposals.lab_payload (see
// 20260717_twin_proposals_lab_twin.sql). The shape mirrors
// frame_payload's `options[] + chosen_rank + rejected_options[]` so
// the same re-rank UX works.

import type { PipelineStage, LabStanceLensId } from "./pipeline-events";

// Re-export so callers can import lab types from a single place.
export type { LabStanceLensId };

// ── Design types ────────────────────────────────────────────────────

/**
 * What kind of experimental architecture this option proposes.
 * Drives the lab_scaffolds materialization (W4.10) — different
 * design types map to different subject + measurement scaffolds.
 *
 * Open enum: future research designs (e.g., factorial, crossover,
 * cluster-randomized) get added as new string literals. Code that
 * branches on design_type should default to 'observational' on
 * unknown values.
 */
export type LabDesignType =
  | "rct" // Randomized controlled trial
  | "observational" // Observe without intervention
  | "single_subject" // N-of-1 / case study
  | "sequential" // Sequential / adaptive sampling
  | "ab_compare" // A/B test between variants
  | "what_if" // Counterfactual simulation only (no real subjects)
  | "mixed_methods"; // Qualitative + quantitative combined

/**
 * How often measurements are taken. Drives the metric_tracker
 * cadence in lab_scaffolds materialization.
 */
export type LabMeasurementCadence =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "event_triggered"; // Measure on event (e.g., post-intervention)

// LabStanceLensId is re-exported above from pipeline-events.ts where
// it lives alongside the lab events that reference it. Co-locating
// it there keeps the event-union types self-contained.

// ── LabConfigOption — the per-stance proposal ───────────────────────

/**
 * One stance-flavored lab design proposal. Five of these land in
 * lab_payload.options[]; the user picks one.
 *
 * The shape mirrors `LensWholeFraming` (problem-framing equivalent)
 * for visual + structural parallelism: same "title / chosen_approach
 * / when_it_wins / when_it_fails / confidence / lens_id" shape so
 * the picker UI can reuse the framing-pick-client's card structure.
 */
export interface LabConfigOption {
  /** Stable slug for this option. Examples: 'tight_rct_8week_blinded',
   *  'naturalistic_telemetry_quarterly', 'sequential_bayesian_stopping'.
   *  Snake_case; sortable; dedupable across re-runs of the same intake. */
  lab_id: string;
  /** 3-6 word headline rendered in the picker card. */
  lab_title: string;
  /** 1-2 sentence summary of the lab design and what it optimizes. */
  chosen_approach: string;
  /** The design architecture. */
  design_type: LabDesignType;
  /** Proposed subjects to enroll. Names + brief rationale per
   *  subject. Materialization (W4.10) maps these to rows in the
   *  existing `subjects` table via the lab_scaffolds bridge. */
  subjects: Array<{
    /** Display name (e.g., "Cohort A: caffeine consumers"). */
    name: string;
    /** Why this subject group. ≤200 chars. */
    rationale: string;
    /** Estimated count (range or single number — open string). */
    estimated_count?: string;
  }>;
  /** Lab features to enable. Maps to lab_scaffolds.proposed_features
   *  on materialization. Examples: monte_carlo, what_if, ab_compare,
   *  deepen_kg, baseline_tracking, deviation_capture. */
  features: string[];
  /** How often measurements should occur. */
  measurement_cadence: LabMeasurementCadence;
  /** Estimated wall-clock duration to gather sufficient evidence. */
  duration_estimate_weeks: number;
  /** Primary independent variable — the lever this lab manipulates
   *  or observes for variation. Entity ID from the KG when resolvable;
   *  free-text name when the lab targets a concept that doesn't yet
   *  have an entity row. */
  primary_iv: { entity_id?: string; name: string };
  /** Primary dependent variable — the outcome this lab measures. */
  primary_dv: { entity_id?: string; name: string };
  /** When this lab design wins over the others. Short phrase. */
  when_it_wins: string;
  /** When this lab design fails / is wrong fit. Short phrase. */
  when_it_fails: string;
  /** 0..1 — confidence this design is the right one for the user's
   *  chosen problem framing. Separate from the stance's overall
   *  confidence; this one is per-option. */
  confidence: number;
  /** Which stance produced this option. */
  lens_id: LabStanceLensId;
}

/**
 * The lab_payload shape on twin_proposals(kind='lab_twin'). Mirrors
 * frame_payload's structure so the existing `select_alternative`
 * re-rank UX works for both.
 */
export interface LabPayload {
  /** All N stance-flavored lab options. Typically 5 (one per
   *  stance) but a stance can decline (returns null in the lib) so
   *  the count varies. */
  options: LabConfigOption[];
  /** 1-based index into options[] of the currently-chosen option.
   *  Initially populated by the lab-generation library (highest-
   *  confidence option wins). User can re-rank via /lab/select. */
  chosen_rank: number;
  /** Audit trail of options the user demoted. Same shape as
   *  problem_twin's rejected_options. */
  rejected_options: Array<{
    lab_id: string;
    lab_title: string;
    rejected_at: string;
    why_rejected: string;
    previous_rank: number;
  }>;
  /** ISO timestamp the lab options were generated. */
  generated_at: string;
}

// ── Event types ─────────────────────────────────────────────────────
//
// LabProposedEvent / LabApprovedEvent / LabSelectedEvent are defined
// in src/types/pipeline-events.ts and re-exported below for callers
// that want a single import location for lab types.

export type {
  LabProposedEvent,
  LabApprovedEvent,
  LabSelectedEvent,
} from "./pipeline-events";

// ── Pipeline stage convenience ──────────────────────────────────────

/**
 * The PipelineStage value lab events report when they fire. Today
 * the events don't carry stage explicitly (the painter routes by
 * event type), but this constant is exported for any future use
 * (e.g., room-layout.ts mapping lab events to the "lab" stage room).
 */
export const LAB_PIPELINE_STAGE: PipelineStage = "lab";
