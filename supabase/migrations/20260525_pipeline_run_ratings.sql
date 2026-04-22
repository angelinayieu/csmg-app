-- ── Pipeline run ratings (Phase 2E · PR 6.1) ──
--
-- Stage 1 of the self-improvement loop: capture a 1-5 star rating
-- (+ optional free-text note) from the user when they review a
-- completed run. Ratings ≥4 trigger candidate-capture into
-- axis_candidate_exemplars; lower ratings are telemetry-only but
-- still persisted for calibration analysis.
--
-- One row per (user, pipeline_run). A user can update their rating
-- after the fact (e.g., "I rated this 3 but after using the output
-- for a week it's clearly a 5") — unique constraint + upsert on the
-- endpoint side.
--
-- No RLS on delete: ratings are audit trail. Users can change their
-- mind but not disappear their rating; the scorer needs the audit
-- trail to detect ratings that flipped sign (common in adversarial
-- cases where a user rates to game the library, then walks it back).

CREATE TABLE IF NOT EXISTS pipeline_run_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 1..5. Ratings ≥4 flag this run for candidate capture. We store
  -- the full 1-5 so future calibration analysis can see the
  -- distribution (not just the promotion-triggering tail).
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),

  -- Optional "what stood out / what missed?" free-text.
  note text,

  -- Tracks whether the candidate-capture step has already fired for
  -- this rating. Prevents duplicate candidates when a user updates
  -- an already-rated run (we re-run capture only if rating crossed
  -- the ≥4 boundary from below).
  candidates_captured_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (run_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_run_ratings_user
  ON pipeline_run_ratings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_run_ratings_run
  ON pipeline_run_ratings (run_id);

ALTER TABLE pipeline_run_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_run_ratings_owner_select"
  ON pipeline_run_ratings
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "pipeline_run_ratings_owner_insert"
  ON pipeline_run_ratings
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "pipeline_run_ratings_owner_update"
  ON pipeline_run_ratings
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE pipeline_run_ratings IS
  'User ratings (1-5) on completed pipeline runs. Ratings ≥4 trigger axis candidate capture for the self-improvement loop.';
COMMENT ON COLUMN pipeline_run_ratings.candidates_captured_at IS
  'Non-null once candidate capture has fired for this rating. Prevents duplicate axis_candidate_exemplars rows on rating updates.';
