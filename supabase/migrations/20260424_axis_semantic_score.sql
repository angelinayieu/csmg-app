-- ── Axis semantic score on probability_space_runs (Phase 1.4) ──
--
-- Adds a `axis_semantic_score jsonb` column so the per-axis route can
-- persist the 5-dimension peer-review breakdown produced by
-- `scoreAxisCandidate()` (src/lib/probability-space/axis-semantic-scorer.ts).
-- The score was previously computed only by the offline self-improvement
-- loop's promote-from-pending cron; surfacing it on the live run row
-- means the probability-space UI can show a per-axis "rigor: X.X/5"
-- pill without an extra round-trip.
--
-- Shape:
--   {
--     "score": <0..1, weighted sum>,
--     "breakdown": {
--       "specificity": <0..1>,
--       "mechanism_depth": <0..1>,
--       "distinctness": <0..1>,
--       "coverage": <0..1>,
--       "insight_density": <0..1>
--     },
--     "notes": "<reviewer comment>"
--   }
--
-- Nullable: thin / failed axis runs skip scoring (no signal to grade)
-- and old rows haven't been backfilled. UI treats null as "not scored".

ALTER TABLE probability_space_runs
  ADD COLUMN IF NOT EXISTS axis_semantic_score jsonb;

COMMENT ON COLUMN probability_space_runs.axis_semantic_score IS
  'SemanticScoreResult from scoreAxisCandidate(). NULL when axis was thin/failed or scorer wasnt run.';
