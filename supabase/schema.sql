-- ============================================
-- CSMG Database Schema (v2 — matches database.types.ts)
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
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'team')),
  credit_balance INTEGER DEFAULT 100
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
-- CREDIT LEDGER
-- ============================================

CREATE TABLE public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  space_id UUID,
  balance_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

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
  synthesis_data JSONB,
  entity_count INTEGER DEFAULT 0,
  edge_count INTEGER DEFAULT 0,
  orphan_count INTEGER DEFAULT 0,
  cycle_count INTEGER DEFAULT 0,
  maturity TEXT DEFAULT 'actionable_now'
    CHECK (maturity IN ('actionable_now', 'waiting_on_dependency', 'theoretical', 'blocked')),
  activation_dependencies TEXT[],
  analysis_tier TEXT DEFAULT 'quick',
  user_role TEXT,
  primary_goal TEXT,
  context_type TEXT,
  credits_used INTEGER DEFAULT 0,
  agent_count INTEGER DEFAULT 0,
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
  is_master_bottleneck BOOLEAN DEFAULT false,
  blast_radius INTEGER DEFAULT 0,
  centrality_rank INTEGER,
  is_shared_variable BOOLEAN DEFAULT false,
  is_decomposable BOOLEAN DEFAULT false,
  has_sub_space BOOLEAN DEFAULT false,
  sub_space_id UUID REFERENCES public.spaces(id),
  graph_x FLOAT,
  graph_y FLOAT,
  knowledge_layer TEXT DEFAULT 'internal'
    CHECK (knowledge_layer IN ('internal', 'conceptual', 'external', 'bridge')),
  provenance JSONB DEFAULT '{}',
  authority_level TEXT DEFAULT 'moderate'
    CHECK (authority_level IN ('high', 'moderate', 'low', 'unverified')),
  ambiguity_type TEXT CHECK (ambiguity_type IS NULL OR ambiguity_type IN ('harmful', 'premature', 'strategic')),
  temporal_validity JSONB,
  manifold JSONB,
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
  is_tradeoff BOOLEAN DEFAULT false,
  resolved_by_entity_id UUID REFERENCES public.entities(id),
  is_part_of_cycle BOOLEAN DEFAULT false,
  cycle_id TEXT,
  dynamics TEXT CHECK (dynamics IS NULL OR dynamics IN (
    'threshold', 'linear', 'compounding', 'exponential',
    'logarithmic', 'decay', 'step_function', 'delayed')),
  dynamics_properties JSONB,
  utility JSONB,  -- {failure_consequence, propagation_speed, actionability, information_value}
  is_low_confidence BOOLEAN DEFAULT false,
  knowledge_layer TEXT DEFAULT 'internal'
    CHECK (knowledge_layer IN ('internal', 'conceptual', 'external', 'bridge')),
  provenance JSONB DEFAULT '{}',
  requires_user_approval BOOLEAN DEFAULT false,
  approved_at TIMESTAMPTZ,
  temporal_validity JSONB
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
  intervention_description TEXT,
  description TEXT,
  growth_type TEXT CHECK (growth_type IS NULL OR growth_type IN (
    'additive', 'multiplicative', 'accelerating', 'decelerating')),
  cycle_time TEXT,
  estimated_multiplier FLOAT
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
  proposition_type TEXT DEFAULT 'probable'
    CHECK (proposition_type IN ('certain', 'probable', 'possible', 'speculative', 'irreducible')),
  confidence FLOAT DEFAULT 1.0,
  depends_on TEXT[],
  entity_ids TEXT[]
);

-- ============================================
-- NOVEL CONNECTIONS
-- ============================================

CREATE TABLE public.novel_connections (
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

-- ============================================
-- CONTRADICTIONS
-- ============================================

CREATE TABLE public.contradictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_a_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  space_b_id UUID REFERENCES public.spaces(id) ON DELETE SET NULL,
  assumption_text TEXT NOT NULL,
  conclusion_text TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'moderate', 'minor')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- SCENARIOS
-- ============================================

CREATE TABLE public.scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  conditions TEXT NOT NULL,
  outcome_label TEXT NOT NULL,
  outcome_value TEXT NOT NULL,
  probability TEXT CHECK (probability IN ('likely', 'possible', 'unlikely')),
  sort_order INTEGER DEFAULT 0
);

-- ============================================
-- ACTION ITEMS
-- ============================================

CREATE TABLE public.action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('today', 'this_week', 'this_month', 'after_validation')),
  path_label TEXT DEFAULT 'builder',
  action_text TEXT NOT NULL,
  why_text TEXT,
  derived_from_entity_id UUID REFERENCES public.entities(id),
  tags JSONB DEFAULT '[]',
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  completed_at TIMESTAMPTZ
);

-- ============================================
-- SPACE CHANGELOG
-- ============================================

CREATE TABLE public.space_changelog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  version INTEGER DEFAULT 1,
  change_type TEXT NOT NULL
    CHECK (change_type IN ('initial_analysis', 'reevaluation', 'manual_edit', 'exploration', 'synthesis_refresh')),
  summary TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- STRATEGY SNAPSHOTS (audit trail for strategy versions)
-- ============================================

CREATE TABLE public.strategy_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  recommendation JSONB NOT NULL,
  ranked_strategies JSONB,
  status TEXT DEFAULT 'generated'
    CHECK (status IN ('generated', 'reviewing', 'confirmed', 'superseded')),
  trigger TEXT DEFAULT 'manual'
    CHECK (trigger IN ('manual', 'auto_chain', 'resynthesize')),
  quality_score NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(space_id, version)
);

CREATE INDEX idx_strategy_snapshots_space ON public.strategy_snapshots(space_id);

-- ============================================
-- IMPROVEMENT GOALS
-- ============================================

CREATE TABLE public.improvement_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_goal_id UUID REFERENCES public.improvement_goals(id) ON DELETE SET NULL,
  objective_type TEXT DEFAULT 'maximize'
    CHECK (objective_type IN ('maximize', 'minimize', 'maintain', 'explore', 'avoid')),
  source TEXT DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto_detected')),
  title TEXT NOT NULL,
  description TEXT,
  metric_name TEXT NOT NULL,
  metric_unit TEXT,
  target_value NUMERIC NOT NULL,
  baseline_value NUMERIC DEFAULT 0,
  current_value NUMERIC DEFAULT 0,
  deadline TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'abandoned', 'paused')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- GOAL PROGRESS (time-series)
-- ============================================

CREATE TABLE public.goal_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES public.improvement_goals(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ DEFAULT now(),
  value NUMERIC NOT NULL,
  note TEXT,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'ai_estimated', 'integration'))
);

-- ============================================
-- GOAL RECOMMENDATIONS (ranked, from synthesis)
-- ============================================

CREATE TABLE public.goal_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES public.improvement_goals(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  title TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_entity_id TEXT,
  impact_estimate TEXT CHECK (impact_estimate IN ('high', 'medium', 'low')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'dismissed')),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('effective', 'ineffective', 'partial', 'not_tested')),
  outcome_notes TEXT,
  outcome_recorded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
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
CREATE INDEX idx_action_items_space ON public.action_items(space_id);
CREATE INDEX idx_scenarios_space ON public.scenarios(space_id);
CREATE INDEX idx_changelog_space ON public.space_changelog(space_id);
CREATE INDEX idx_credit_ledger_user ON public.credit_ledger(user_id);
CREATE INDEX idx_goals_space ON public.improvement_goals(space_id);
CREATE INDEX idx_goals_user ON public.improvement_goals(user_id);
CREATE INDEX idx_goals_active ON public.improvement_goals(space_id) WHERE status = 'active';
CREATE INDEX idx_goals_parent ON public.improvement_goals(parent_goal_id) WHERE parent_goal_id IS NOT NULL;
CREATE INDEX idx_goal_progress_goal ON public.goal_progress(goal_id);
CREATE INDEX idx_goal_progress_time ON public.goal_progress(goal_id, recorded_at);
CREATE INDEX idx_goal_recommendations_goal ON public.goal_recommendations(goal_id);
CREATE INDEX idx_goal_recommendations_rank ON public.goal_recommendations(goal_id, rank);

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
ALTER TABLE public.novel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contradictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

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

-- Novel connections
CREATE POLICY "Users see own novel_connections" ON public.novel_connections
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

-- Contradictions
CREATE POLICY "Users see own contradictions" ON public.contradictions
  FOR ALL USING (
    space_a_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

-- Scenarios
CREATE POLICY "Users see own scenarios" ON public.scenarios
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

-- Action items
CREATE POLICY "Users see own action_items" ON public.action_items
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

-- Space changelog
CREATE POLICY "Users see own changelog" ON public.space_changelog
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

-- Strategy snapshots
CREATE POLICY "Users see own strategy_snapshots" ON public.strategy_snapshots
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

-- Credit ledger
CREATE POLICY "Users see own credits" ON public.credit_ledger
  FOR ALL USING (auth.uid() = user_id);

-- Improvement goals
ALTER TABLE public.improvement_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own goals" ON public.improvement_goals
  FOR ALL USING (auth.uid() = user_id);

-- Goal progress
ALTER TABLE public.goal_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own goal_progress" ON public.goal_progress
  FOR ALL USING (
    goal_id IN (SELECT id FROM public.improvement_goals WHERE user_id = auth.uid())
  );

-- Goal recommendations
ALTER TABLE public.goal_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own goal_recommendations" ON public.goal_recommendations
  FOR ALL USING (
    goal_id IN (SELECT id FROM public.improvement_goals WHERE user_id = auth.uid())
  );
