// Hypothesis ladders — structured falsifiable claims derived from the
// strategic-recommendation pre_mortem. Mirrors the `hypothesis_ladders`
// table from migration 20260707.
//
// Each ladder is a 4-rung structure:
//   ① CLAIM       — the implicit assumption the strategy rests on
//   ② MECHANISM   — the causal chain (entity walk) the claim relies on
//   ③ FALSIFIER   — observable that would refute the claim
//   ④ VERDICT     — current state: pending | supported | refuted | contested

export type HypothesisLadderSource = "llm" | "manual";

export type HypothesisLadderVerdict =
  | "pending"
  | "supported"
  | "refuted"
  | "contested";

export type HypothesisLadderStatus = "active" | "archived" | "superseded";

/**
 * pre_mortem.category vocabulary from strategic-recommendation.ts.
 * Drives canvas tinting (e.g., interaction failures get a different
 * accent than internal failures so users can scan by category).
 */
export type HypothesisLadderCategory =
  | "internal"
  | "structural"
  | "competitive"
  | "timing"
  | "interaction";

export type HypothesisLadderSeverity = "catastrophic" | "major" | "moderate";
export type HypothesisLadderProbability = "high" | "moderate" | "low";

/**
 * One step in the causal chain underpinning the claim. Walked
 * left-to-right reads as "X → Y → Z".
 */
export interface MechanismChainStep {
  entity_id: string;
  entity_name: string;
  /** Optional role hint, e.g. "trigger", "mediator", "outcome". */
  role?: string;
}

export interface HypothesisLadder {
  id: string;
  space_id: string;
  user_id: string;
  source: HypothesisLadderSource;
  source_strategy_version: number | null;
  source_category: HypothesisLadderCategory | null;
  claim: string;
  mechanism_chain: MechanismChainStep[];
  falsifier: string | null;
  verdict: HypothesisLadderVerdict;
  verdict_rationale: string | null;
  verdict_at: string | null;
  severity: HypothesisLadderSeverity | null;
  probability: HypothesisLadderProbability | null;
  related_entity_ids: string[];
  user_status: HypothesisLadderStatus;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Shape returned by the extractor before DB insert. The DB fills
 * `id`, `user_id`, `verdict_at` (always null at insert time),
 * timestamps, and the user_status default.
 */
export type HypothesisLadderDraft = Omit<
  HypothesisLadder,
  | "id"
  | "user_id"
  | "verdict_at"
  | "user_status"
  | "generated_at"
  | "created_at"
  | "updated_at"
>;
