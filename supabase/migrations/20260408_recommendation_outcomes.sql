-- Track whether recommendations/action items actually worked
-- Enables outcome tracking (Layer 15) and recommendation accuracy computation

ALTER TABLE public.goal_recommendations
  ADD COLUMN outcome TEXT
    CHECK (outcome IS NULL OR outcome IN ('effective', 'ineffective', 'partial', 'not_tested')),
  ADD COLUMN outcome_notes TEXT,
  ADD COLUMN outcome_recorded_at TIMESTAMPTZ;

-- Add status tracking to action_items (currently has no status column)
ALTER TABLE public.action_items
  ADD COLUMN status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  ADD COLUMN completed_at TIMESTAMPTZ;
