-- ── Probability space runs (Phase 2E · Tier 2) ──
--
-- Records the frame extractor's decision for each pipeline run —
-- which axes apply to the user's input + the rationale per axis.
-- Drives the "spaces fork out" visualization: each row here becomes
-- a glass shell on the canvas during the run, and subsequent
-- `space_entity_added` events fill it.
--
-- This table is the LIGHTWEIGHT side of the new flow. The
-- per-axis generation (which entities go in which space, pre-
-- merge) will land in a follow-up migration once the generator
-- endpoints ship. For now we only persist the frame itself so the
-- canvas has a ground truth for which shells should appear even
-- if the user reloads mid-run.

CREATE TABLE IF NOT EXISTS probability_space_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ── Axis metadata ────────────────────────────────────────────────
  -- One row per (run_id, axis) — unique constraint enforces this so
  -- we don't accidentally open the same axis twice in a single run.
  axis text NOT NULL CHECK (axis IN (
    'financial',
    'timeline',
    'actors',
    'causal_scenarios',
    'evidence',
    'assumptions',
    'risk',
    'cultural'
  )),

  -- Why the frame extractor opened this axis (shown on tooltip).
  rationale text NOT NULL DEFAULT '',

  -- Stable display order within the run. The frame extractor
  -- returns axes in relevance order; lower order_index = more
  -- relevant / sits closer to the origin card on canvas.
  order_index int NOT NULL DEFAULT 0,

  -- ── Generation state ────────────────────────────────────────────
  -- Follows the familiar pipeline_runs status pattern. 'pending'
  -- = shell opened, awaiting generator. 'generating' = generator
  -- in flight, emitting space_entity_added. 'merged' = merge phase
  -- complete, entities are now in the main KG. 'failed' = generator
  -- soft-failed; shell stays for debugging but is visually muted.
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'generating',
    'merged',
    'failed'
  )),

  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text,

  -- Entity counts for fast header rendering. Backfilled during
  -- per-axis generation + updated at merge time.
  entities_generated int NOT NULL DEFAULT 0,
  entities_merged int NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (run_id, axis)
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_probability_space_runs_run
  ON probability_space_runs (run_id, order_index);
CREATE INDEX IF NOT EXISTS idx_probability_space_runs_space_recent
  ON probability_space_runs (space_id, created_at DESC);

-- ── RLS ──
ALTER TABLE probability_space_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "probability_space_runs_owner_select"
  ON probability_space_runs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "probability_space_runs_owner_insert"
  ON probability_space_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "probability_space_runs_owner_update"
  ON probability_space_runs
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "probability_space_runs_owner_delete"
  ON probability_space_runs
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE probability_space_runs IS
  'Frame-extractor output per pipeline run. One row per (run_id, axis). Drives the "spaces fork out" canvas visualization.';
COMMENT ON COLUMN probability_space_runs.axis IS
  'One of 8 canonical axes (see src/lib/probability-space/axis-catalog.ts).';
COMMENT ON COLUMN probability_space_runs.status IS
  'Lifecycle: pending (shell only) → generating (entities streaming) → merged (absorbed into KG) → failed (soft error).';
