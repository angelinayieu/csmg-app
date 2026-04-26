-- ── Target outcome on pipeline_runs (Phase 3 §4.1) ──
--
-- Adds a `target_outcome jsonb` column so the frame extractor can
-- persist the focal outcome it identified for this run via
-- extractTargetOutcome() (src/lib/pipeline/target-outcome-extractor.ts).
-- Downstream stages (MC simulator, strategy ranker, rail UI) read this
-- column to make outcome-aware decisions instead of treating every
-- entity as equally important.
--
-- Shape (matches TargetOutcome interface):
--   {
--     "name": "<3-8 word outcome label>",
--     "direction": "maximize" | "minimize" | "maintain",
--     "metric_kind": "binary" | "continuous" | "distribution" | "qualitative",
--     "horizon": "immediate" | "short_term" | "medium_term" | "long_term" | null,
--     "confidence": <0..1>,
--     "rationale": "<one sentence why this is the focal outcome>"
--   }
--
-- Nullable: when the extractor fails / the input is too thin to extract
-- a meaningful outcome, the column stays NULL and downstream stages
-- gracefully degrade to outcome-agnostic ranking.

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS target_outcome jsonb;

COMMENT ON COLUMN pipeline_runs.target_outcome IS
  'Focal outcome identified by extractTargetOutcome() at frame-extractor time. NULL when no extractable outcome.';
