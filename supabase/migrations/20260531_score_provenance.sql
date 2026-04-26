-- ── Score-provenance tagging ─────────────────────────────────────────
--
-- The UI displays "aggregate_lift" / "aggregate_quality" / "confidence"
-- / "rank" as if they were numerical quantities derived from real math.
-- In practice the backing values have three very different sources:
--
--   • `mc_simulation` — real Monte Carlo output with seeded PRNG + 1000+
--     samples. p10/p50/p90 are empirical. Tier 4 math. (e.g.
--     apps.state.simulation_distribution after generation).
--
--   • `bootstrap` — empirical resampling from historical deltas. Tier 4.
--
--   • `composite_computed` — weighted sum of existing signals. Tier 3.
--
--   • `llm_review` — LLM self-rating the output of another LLM call.
--     Tier 1 cosplaying as a score. (e.g. iv-scorer's aggregate_lift).
--
--   • `llm_ordered` — LLM decided an ordering; rank is position in array.
--     Tier 1. (e.g. ranked_strategies[*].rank before this migration).
--
-- Without a provenance tag at the DB level, the UI is forced to show all
-- of these identically — which misleads users into trusting LLM self-
-- reports as if they were Monte Carlo output. This migration adds a
-- provenance column everywhere a confidence/lift/score lives, so the UI
-- can disclose honestly AND future code can gate on it (e.g. "only show
-- 'Recommended' apps whose score_provenance is mc_simulation").
--
-- All columns default to the honest value for existing rows. Nothing
-- retroactively misclaims itself as computed.

-- ── experiment_variants — aggregate_quality + aggregate_lift ─────────

alter table public.experiment_variants
  add column if not exists score_provenance text not null default 'llm_review'
    check (score_provenance in (
      'llm_review',         -- iv-scorer LLM self-rating (current default)
      'mc_lift',            -- MC p50(with variant) vs p50(baseline) — future
      'hybrid'              -- mix of both
    ));

comment on column public.experiment_variants.score_provenance is
  'Where aggregate_quality/aggregate_lift came from. llm_review = LLM self-rating (iv-scorer). mc_lift = real Monte Carlo p50 delta. hybrid = blend.';

-- ── apps — simulation_distribution is already stamped with provenance
--   via app_generator state.simulation_distribution.source; no schema
--   change needed (JSONB).

-- ── strategy_snapshots / synthesis_data.strategic_recommendation ────
-- These live inside a JSONB column (spaces.synthesis_data and
-- strategy_snapshots.recommendation_json) so we carry provenance in the
-- payload itself rather than adding a column. See ranker code for the
-- field contract:
--   ranked_strategies[*].rank_source: 'llm_ordered' | 'composite_computed'
--   ranked_strategies[*].rank_score?: number   — [0,1] when composite_computed
--   ranked_strategies[*].llm_rank?: number      — original LLM ordering (preserved for audit)
-- No DDL — enforced by TypeScript types.

-- ── reality_calibrations — audit the label ──────────────────────────
-- Kept name for back-compat (UI widgets reference it) but tag verdict
-- provenance so the UI can render "LLM Reality Audit" until a numerical
-- calibration routine exists.

alter table public.reality_calibrations
  add column if not exists verdict_provenance text not null default 'llm_audit'
    check (verdict_provenance in (
      'llm_audit',          -- current LLM-based judgment
      'numerical_recompute' -- future: walk claim ledger, recompute baselines numerically
    ));

comment on column public.reality_calibrations.verdict_provenance is
  'How each attempt.verdict was derived. llm_audit = LLM asserted whether KG reproduces baseline. numerical_recompute = deterministic recomputation from constituent entities.';

-- ── prediction_ledger — distinguish predicted_value provenance ──────
-- Existing column: predicted_value numeric, predicted_distribution jsonb.
-- Add an explicit provenance tag so the resolver and UI know whether a
-- prediction was MC-backed or LLM-estimated.

alter table public.prediction_ledger
  add column if not exists value_provenance text not null default 'llm_estimate'
    check (value_provenance in (
      'mc_simulation',
      'bootstrap',
      'llm_estimate',
      'composite_computed'
    ));

comment on column public.prediction_ledger.value_provenance is
  'Where predicted_value + predicted_distribution came from. Used by the resolver UI to distinguish MC-backed from LLM-estimated predictions when they are scored against actuals.';
