-- ============================================
-- CSMG v2 Migration
-- Run this in Supabase SQL Editor AFTER the initial schema.sql
-- Adds: 4 new tables + 4 new columns on existing tables
-- ============================================

-- ============================================
-- ALTER EXISTING TABLES
-- ============================================

-- Entities: add master bottleneck flag
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS is_master_bottleneck BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_entities_bottleneck ON public.entities(space_id) WHERE is_master_bottleneck = true;

-- Edges: add tradeoff tracking
ALTER TABLE public.edges ADD COLUMN IF NOT EXISTS is_tradeoff BOOLEAN DEFAULT false;
ALTER TABLE public.edges ADD COLUMN IF NOT EXISTS resolved_by_entity_id UUID REFERENCES public.entities(id);
CREATE INDEX IF NOT EXISTS idx_edges_tradeoff ON public.edges(space_id) WHERE is_tradeoff = true;

-- Cycles: add intervention description
ALTER TABLE public.cycles ADD COLUMN IF NOT EXISTS intervention_description TEXT;

-- ============================================
-- NEW TABLE: Novel Connections
-- ============================================

CREATE TABLE IF NOT EXISTS public.novel_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  strength TEXT NOT NULL CHECK (strength IN ('strong', 'moderate', 'speculative')),
  reasoning TEXT NOT NULL,
  crosses_spaces BOOLEAN DEFAULT false,
  target_space_id UUID REFERENCES public.spaces(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.novel_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own novels" ON public.novel_connections
  FOR ALL USING (space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid()));

-- ============================================
-- NEW TABLE: Contradictions
-- ============================================

CREATE TABLE IF NOT EXISTS public.contradictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_a_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  space_b_id UUID REFERENCES public.spaces(id),
  assumption_text TEXT NOT NULL,
  conclusion_text TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'moderate', 'minor')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.contradictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own contradictions" ON public.contradictions
  FOR ALL USING (space_a_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid()));

-- ============================================
-- NEW TABLE: Scenarios
-- ============================================

CREATE TABLE IF NOT EXISTS public.scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  conditions TEXT NOT NULL,
  outcome_label TEXT NOT NULL,
  outcome_value TEXT NOT NULL,
  probability TEXT CHECK (probability IN ('likely', 'possible', 'unlikely')),
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_scenarios_space ON public.scenarios(space_id);

ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own scenarios" ON public.scenarios
  FOR ALL USING (space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid()));

-- ============================================
-- NEW TABLE: Action Items
-- ============================================

CREATE TABLE IF NOT EXISTS public.action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('today', 'this_week', 'this_month', 'after_validation')),
  action_text TEXT NOT NULL,
  derived_from_entity_id TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_actions_space ON public.action_items(space_id);

ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own actions" ON public.action_items
  FOR ALL USING (space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid()));
