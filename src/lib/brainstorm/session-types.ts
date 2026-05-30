// ── Brainstorm Session Types ────────────────────────────────────────
//
// TypeScript shapes for the brainstorm_sessions table (migration
// 20260907_brainstorm_sessions.sql). One row = one user press of the
// `Brainstorm` button; captures the whole pipeline atomically as JSONB.
//
// Spec: BRAINSTORM_MODULE_SPEC.md §5.
//
// Phase 1 = picker target only. Phase 6 generalises to room_feature +
// annotation via target_kind. All consumers should switch on target_kind
// rather than assume picker semantics.

import type { SubObjectiveIntent } from "@/lib/objective-canvas/sub-objective-state";

// ── Target ──────────────────────────────────────────────────────────

/** WHAT the brainstorm is operating on. Phase 1 = picker; Phase 6 adds
 *  room_feature (per-feature variation lab) + annotation (lens deepen). */
export type BrainstormTargetKind =
  | "sub_objective_picker"
  | "room_feature"
  | "annotation";

// ── Plan (Stage 1) ──────────────────────────────────────────────────

/** Why a given intent was chosen for this session's plan. Drives the
 *  3 swappable chips in the panel header so the user understands +
 *  can override the choice before the runner fires. */
export type IntentReason =
  | { source: "gap_fill"; uncovered_lens: number[] }
  | { source: "user_preference"; elect_rate: number; n_observed: number }
  | { source: "default"; fallback_for: "no_history" | "low_signal" }
  | { source: "user_override"; replaced: SubObjectiveIntent };

/** The 3-intent plan computed at Stage 1 (Runner reads lens-coverage
 *  + decision_log preference rate). User may swap any intent before
 *  Start. After Start the plan is locked + persisted. */
export interface BrainstormPlan {
  /** Ordered list of intents the runner will execute, one batch per. */
  intents: SubObjectiveIntent[];
  /** Per-intent rationale shown in the chip tooltip. Key = intent. */
  reasons: Partial<Record<SubObjectiveIntent, IntentReason>>;
  /** ISO timestamp when the user pressed Start (= plan locked). */
  locked_at: string;
}

// ── Generations (Stage 2) ───────────────────────────────────────────

/** One candidate produced by a divergence batch. Mirrors the shape
 *  /sub-objectives/propose returns, plus the intent of origin so the
 *  panel can colour-code + the critique can trace lineage. */
export interface BrainstormCandidate {
  proposal_id: string;
  title: string;
  summary: string;
  rationale?: string;
  /** LLM self-reported, 0..1. */
  confidence: number;
  /** 1-based indices into the parent objective's annotation lens. */
  lens_coverage: number[];
  /** Which intent produced this candidate (for colour + critique). */
  intent_of_origin: SubObjectiveIntent;
}

/** One batch result. The runner produces N of these (N = plan.intents.length). */
export interface BrainstormGeneration {
  intent: SubObjectiveIntent;
  /** 1-based, order within this session. */
  generation_number: number;
  /** FK to /propose's batch (sub_objectives.batches[].id). */
  batch_id: string;
  candidates: BrainstormCandidate[];
  generated_at: string;
  latency_ms: number;
}

// ── Cleanup (Stage 3) ───────────────────────────────────────────────

export interface BrainstormCluster {
  /** LLM-named theme of the cluster. */
  theme: string;
  /** All proposal_ids that fell into this cluster. */
  proposal_ids: string[];
  /** The cluster's strongest member (highest confidence or coverage). */
  representative_id: string;
}

export interface BrainstormDuplicatePair {
  a: string;
  b: string;
  similarity: number;
}

export interface BrainstormCleanup {
  clusters: BrainstormCluster[];
  duplicates: BrainstormDuplicatePair[];
  /** Pairs the cluster pass flagged as soft-overlap (vs. hard duplicate);
   *  the panel uses these to nudge cards together spatially without
   *  collapsing them into one. */
  soft_overlaps: BrainstormDuplicatePair[];
  ran_at: string;
}

// ── Ranking (Stage 4) ───────────────────────────────────────────────

/** Composite-score breakdown per BRAINSTORM_MODULE_SPEC.md §3 stage 4.
 *  Weights: coverage 0.40 · diversity 0.25 · preference 0.20 · critique 0.15. */
export interface BrainstormSubScores {
  coverage: number;
  diversity: number;
  preference: number;
  critique: number;
}

/** The critique LLM's per-candidate reasoning. Surfaces inline on the
 *  card so the user sees WHY a candidate is ranked where it is — the
 *  load-bearing UX move that separates this from "more candidates". */
export interface BrainstormReasoning {
  why_strong: string;
  where_stretches: string;
  whats_missing: string;
  /** proposal_id of the closest neighbour in the existing elected set
   *  (so the user can spot near-duplicates of work they've already done). */
  closest_neighbor: string | null;
}

/** Visual ribbon. green = top 3 ready-to-elect; amber = explore lane;
 *  tray = bottom collapsed group (recoverable, never hard-deleted). */
export type BrainstormRibbon = "green" | "amber" | "tray";

export interface BrainstormRankedCandidate {
  proposal_id: string;
  composite_score: number;
  sub_scores: BrainstormSubScores;
  ribbon: BrainstormRibbon;
  reasoning: BrainstormReasoning;
}

export interface BrainstormRanking {
  candidates: BrainstormRankedCandidate[];
  ranked_at: string;
  /** Total wall-clock for the critique pass — surfaced in the
   *  brainstorm_completed decision_log metadata. */
  latency_ms: number;
}

// ── User-added ideas (Stage 5) ──────────────────────────────────────

/** A sticky-note the user dropped on the brainstorm tldraw page. Scored
 *  on the same axes as LLM candidates so they're directly comparable,
 *  but never demoted below the tray — always at least amber per
 *  decision #4. */
export interface BrainstormUserIdea {
  id: string;
  title: string;
  body: string;
  added_at: string;
  /** True once the critique pass has scored this idea. Newly added
   *  ideas during a session show "scoring..." until this flips. */
  scored_with_session: boolean;
  sub_scores?: BrainstormSubScores;
  composite_score?: number;
  /** Protected: never lower than "amber" per decision #4. */
  ribbon?: BrainstormRibbon;
}

// ── Lifecycle ───────────────────────────────────────────────────────

/** running  — runner is mid-pipeline (stages 1-4)
 *  settled  — critique pass complete, user can interact (stage 5)
 *  abandoned — user closed the panel before settle OR runner errored hard */
export type BrainstormSessionStatus = "running" | "settled" | "abandoned";

// ── The full row ────────────────────────────────────────────────────

/** Mirror of the brainstorm_sessions row. JSONB columns typed via the
 *  shapes above. */
export interface BrainstormSession {
  id: string;
  space_id: string;
  user_id: string;

  target_kind: BrainstormTargetKind;
  sub_objective_id: string | null;
  entity_id: string | null;

  plan: BrainstormPlan | Record<string, never>; // {} before Stage 1 commits
  generations: BrainstormGeneration[];
  cleanup: BrainstormCleanup | null;
  ranking: BrainstormRanking | null;
  user_added_ideas: BrainstormUserIdea[];

  tldraw_page_id: string | null;

  pinned: boolean;
  title: string | null;
  outcome_summary: string | null;

  status: BrainstormSessionStatus;
  started_at: string;
  settled_at: string | null;
  updated_at: string;
}

// ── decision_log metadata shapes ────────────────────────────────────
//
// Logged via logDecision() in src/lib/objective-canvas/decision-log.ts.
// Typed here for callers — keep these in sync with the action comments
// in decision-log.ts and the migration constraint commentary.

export interface BrainstormStartedMetadata {
  session_id: string;
  target_kind: BrainstormTargetKind;
  planned_intents: SubObjectiveIntent[];
  intent_reasons: Partial<Record<SubObjectiveIntent, IntentReason>>;
}

export interface BrainstormCompletedMetadata {
  session_id: string;
  n_candidates: number;
  n_top: number;
  n_explore: number;
  n_tray: number;
  latency_ms: number;
}

export interface BrainstormElectedMetadata {
  session_id: string;
  proposal_id: string;
  ribbon: BrainstormRibbon;
  composite_score: number;
  intent_of_origin: SubObjectiveIntent;
}
