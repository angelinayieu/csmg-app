-- Create expansions table
CREATE TABLE IF NOT EXISTS public.expansions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  parent_expansion_id UUID REFERENCES public.expansions(id) ON DELETE CASCADE,
  depth_level INT NOT NULL DEFAULT 1 CHECK (depth_level BETWEEN 1 AND 5),
  summary TEXT,
  sub_components JSONB NOT NULL DEFAULT '[]'::jsonb,
  internal_pathways JSONB NOT NULL DEFAULT '[]'::jsonb,
  internal_dynamics JSONB DEFAULT '[]'::jsonb,
  llm_model TEXT,
  token_cost INT DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stale BOOLEAN DEFAULT FALSE,
  UNIQUE(entity_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_expansions_space ON public.expansions(space_id);
CREATE INDEX IF NOT EXISTS idx_expansions_parent ON public.expansions(parent_expansion_id);
CREATE INDEX IF NOT EXISTS idx_expansions_entity ON public.expansions(entity_id);

-- Add expansion tracking columns to entities
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS expansion_id UUID REFERENCES public.expansions(id);
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS is_expanded BOOLEAN DEFAULT FALSE;

-- Enable RLS
ALTER TABLE public.expansions ENABLE ROW LEVEL SECURITY;

-- RLS policies (user can only access expansions in their spaces)
CREATE POLICY "Users can view expansions in their spaces" ON public.expansions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = expansions.space_id AND spaces.user_id = auth.uid())
  );

CREATE POLICY "Users can create expansions in their spaces" ON public.expansions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = expansions.space_id AND spaces.user_id = auth.uid())
  );

CREATE POLICY "Users can update expansions in their spaces" ON public.expansions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = expansions.space_id AND spaces.user_id = auth.uid())
  );

CREATE POLICY "Users can delete expansions in their spaces" ON public.expansions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = expansions.space_id AND spaces.user_id = auth.uid())
  );
