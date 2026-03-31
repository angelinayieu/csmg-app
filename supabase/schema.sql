-- ============================================
-- CSMG Database Schema
-- Run this in Supabase SQL Editor to set up the database
-- ============================================

-- ============================================
-- PROFILES (extends Supabase auth.users)
-- ============================================

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  usage_count INTEGER DEFAULT 0,
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'team'))
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (new.id, new.raw_user_meta_data->>'display_name');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- CONTEXT SPACES
-- ============================================

CREATE TABLE public.spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  space_prefix TEXT NOT NULL,
  parent_space_id UUID REFERENCES public.spaces(id) ON DELETE SET NULL,
  originated_from_entity_id UUID,
  depth_level INTEGER DEFAULT 0,
  input_text TEXT NOT NULL,
  raw_decomposition TEXT,
  synthesis_text TEXT,
  entity_count INTEGER DEFAULT 0,
  edge_count INTEGER DEFAULT 0,
  orphan_count INTEGER DEFAULT 0,
  cycle_count INTEGER DEFAULT 0,
  maturity TEXT DEFAULT 'actionable_now'
    CHECK (maturity IN ('actionable_now', 'waiting_on_dependency', 'theoretical', 'blocked')),
  activation_dependencies TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ENTITIES
-- ============================================

CREATE TABLE public.entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  source_tag TEXT NOT NULL CHECK (source_tag IN ('explicit', 'implicit', 'assumed')),
  entity_type TEXT NOT NULL,
  entity_category TEXT NOT NULL
    CHECK (entity_category IN ('concrete', 'abstract', 'process', 'relational', 'epistemic')),
  layer TEXT,
  importance TEXT CHECK (importance IN ('fundamental', 'critical', 'important', 'moderate')),
  confidence FLOAT DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  is_leverage_point BOOLEAN DEFAULT false,
  is_risk_point BOOLEAN DEFAULT false,
  blast_radius INTEGER DEFAULT 0,
  centrality_rank INTEGER,
  is_shared_variable BOOLEAN DEFAULT false,
  is_decomposable BOOLEAN DEFAULT false,
  has_sub_space BOOLEAN DEFAULT false,
  sub_space_id UUID REFERENCES public.spaces(id),
  graph_x FLOAT,
  graph_y FLOAT,
  UNIQUE(space_id, entity_id)
);

-- ============================================
-- EDGES
-- ============================================

CREATE TABLE public.edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  source_entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  dimension TEXT NOT NULL
    CHECK (dimension IN ('structural', 'functional', 'temporal', 'causal',
           'correlational', 'logical', 'epistemic', 'comparative', 'agentive')),
  source_tag TEXT NOT NULL CHECK (source_tag IN ('stated', 'inferred', 'predicted')),
  strength FLOAT DEFAULT 0.5 CHECK (strength >= 0 AND strength <= 1),
  polarity TEXT DEFAULT 'positive' CHECK (polarity IN ('positive', 'negative', 'neutral', 'conditional')),
  confidence FLOAT DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  conditions TEXT,
  is_part_of_cycle BOOLEAN DEFAULT false,
  cycle_id TEXT
);

-- ============================================
-- CYCLES
-- ============================================

CREATE TABLE public.cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  cycle_id TEXT NOT NULL,
  name TEXT,
  classification TEXT NOT NULL
    CHECK (classification IN ('reinforcing_positive', 'reinforcing_negative', 'balancing')),
  entity_ids TEXT[] NOT NULL,
  edge_ids UUID[],
  intervention_point_entity_id UUID REFERENCES public.entities(id),
  description TEXT
);

-- ============================================
-- BRIDGES
-- ============================================

CREATE TABLE public.bridges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  source_entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  target_space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  bridge_type TEXT NOT NULL CHECK (bridge_type IN ('identity', 'influence', 'structural')),
  coupling_strength TEXT NOT NULL CHECK (coupling_strength IN ('strong', 'moderate', 'weak')),
  coupling_direction TEXT NOT NULL CHECK (coupling_direction IN ('source_to_target', 'target_to_source', 'bidirectional')),
  shared_variable_name TEXT NOT NULL,
  description TEXT,
  discovery_method TEXT DEFAULT 'llm_reasoning'
    CHECK (discovery_method IN ('llm_reasoning', 'embedding_similarity', 'manual')),
  confidence FLOAT DEFAULT 0.8
);

-- ============================================
-- REASONING RESULTS
-- ============================================

CREATE TABLE public.reasoning_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  reasoning_type TEXT NOT NULL
    CHECK (reasoning_type IN ('centrality', 'cycles', 'cascade', 'link_prediction', 'path', 'weaving')),
  input_params JSONB,
  result_data JSONB NOT NULL,
  result_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- PROPOSITIONS
-- ============================================

CREATE TABLE public.propositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  proposition_id TEXT NOT NULL,
  statement TEXT NOT NULL,
  proposition_type TEXT DEFAULT 'derived'
    CHECK (proposition_type IN ('certain', 'probable', 'possible', 'speculative', 'irreducible')),
  confidence FLOAT DEFAULT 1.0,
  depends_on TEXT[],
  entity_ids TEXT[]
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_spaces_user ON public.spaces(user_id);
CREATE INDEX idx_spaces_parent ON public.spaces(parent_space_id);
CREATE INDEX idx_entities_space ON public.entities(space_id);
CREATE INDEX idx_entities_shared ON public.entities(space_id) WHERE is_shared_variable = true;
CREATE INDEX idx_entities_leverage ON public.entities(space_id) WHERE is_leverage_point = true;
CREATE INDEX idx_edges_space ON public.edges(space_id);
CREATE INDEX idx_edges_dimension ON public.edges(space_id, dimension);
CREATE INDEX idx_bridges_source ON public.bridges(source_space_id);
CREATE INDEX idx_bridges_target ON public.bridges(target_space_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reasoning_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.propositions ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own
CREATE POLICY "Users see own profiles" ON public.profiles
  FOR ALL USING (auth.uid() = id);

-- Spaces: users can CRUD their own
CREATE POLICY "Users see own spaces" ON public.spaces
  FOR ALL USING (auth.uid() = user_id);

-- Entities: users can CRUD entities in their own spaces
CREATE POLICY "Users see own entities" ON public.entities
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

-- Edges: users can CRUD edges in their own spaces
CREATE POLICY "Users see own edges" ON public.edges
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

-- Cycles: users can CRUD cycles in their own spaces
CREATE POLICY "Users see own cycles" ON public.cycles
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

-- Bridges: users can CRUD bridges from their own spaces
CREATE POLICY "Users see own bridges" ON public.bridges
  FOR ALL USING (
    source_space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

-- Reasoning results: users can CRUD results in their own spaces
CREATE POLICY "Users see own reasoning" ON public.reasoning_results
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

-- Propositions: users can CRUD propositions in their own spaces
CREATE POLICY "Users see own propositions" ON public.propositions
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );
