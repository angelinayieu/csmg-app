-- Add source field to track whether objective was manually created or auto-detected
ALTER TABLE public.improvement_goals
  ADD COLUMN source TEXT DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto_detected'));

COMMENT ON COLUMN public.improvement_goals.source IS
  'Whether this objective was created manually by user or auto-detected from synthesis.';
