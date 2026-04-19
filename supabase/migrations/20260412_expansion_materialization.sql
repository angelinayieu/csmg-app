-- Track which expansions have been materialized into graph entities/edges
ALTER TABLE public.expansions ADD COLUMN IF NOT EXISTS materialized_at TIMESTAMPTZ;
