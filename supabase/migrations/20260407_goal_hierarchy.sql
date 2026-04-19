-- Add objective hierarchy support to improvement_goals
-- parent_goal_id creates macro/micro relationships
-- objective_type captures what the system detected (maximize, minimize, etc.)

ALTER TABLE public.improvement_goals
  ADD COLUMN parent_goal_id UUID REFERENCES public.improvement_goals(id) ON DELETE SET NULL,
  ADD COLUMN objective_type TEXT DEFAULT 'maximize'
    CHECK (objective_type IN ('maximize', 'minimize', 'maintain', 'explore', 'avoid'));

-- Index for fast child lookups
CREATE INDEX idx_goals_parent ON public.improvement_goals(parent_goal_id)
  WHERE parent_goal_id IS NOT NULL;

-- Comment for clarity
COMMENT ON COLUMN public.improvement_goals.parent_goal_id IS
  'FK to parent objective — creates macro/micro hierarchy. NULL = top-level objective.';
COMMENT ON COLUMN public.improvement_goals.objective_type IS
  'Type of objective: maximize, minimize, maintain, explore, avoid. Informs how progress is interpreted.';
