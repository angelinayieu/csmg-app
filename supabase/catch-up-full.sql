-- ============================================================================
-- Full catch-up: migrations 20260401 → 20260427, excluding pieces already in
--                catch-up-phase-b.sql (which you should run FIRST).
-- ============================================================================
--
-- Run ORDER:
--   1. supabase/catch-up-phase-b.sql   (goal tables + Phase A agents + Phase B binding)
--   2. THIS FILE (everything else from the migrations dir)
--
-- Idempotent — safe to re-run. Every CREATE/ALTER is guarded with
-- IF NOT EXISTS, DROP IF EXISTS, or a DO-block existence check. Re-applying
-- this script on a DB that's already current will be a no-op.
--
-- EXPLICITLY EXCLUDED (already in catch-up-phase-b.sql):
--   - 20260407_goal_hierarchy.sql       (folded into improvement_goals CREATE)
--   - 20260407_goal_source.sql          (folded into improvement_goals CREATE)
--   - 20260418_agent_runtime.sql        (Phase A)
--   - 20260419_goal_agent_binding.sql   (Phase B)
-- ============================================================================


-- ============================================================================
-- 20260401_atomic_credits.sql — credit deduction/addition functions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id UUID, p_amount INT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_balance INT;
BEGIN
  UPDATE public.profiles
  SET credit_balance = credit_balance - p_amount
  WHERE id = p_user_id AND credit_balance >= p_amount
  RETURNING credit_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  RETURN v_new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_credits(p_user_id UUID, p_amount INT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_balance INT;
BEGIN
  UPDATE public.profiles
  SET credit_balance = credit_balance + p_amount
  WHERE id = p_user_id
  RETURNING credit_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  RETURN v_new_balance;
END;
$$;


-- ============================================================================
-- 20260408_ambiguity_type.sql — entities.ambiguity_type
-- ============================================================================

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS ambiguity_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_ambiguity_type_check') THEN
    ALTER TABLE public.entities
      ADD CONSTRAINT entities_ambiguity_type_check
      CHECK (ambiguity_type IS NULL OR ambiguity_type IN ('harmful', 'premature', 'strategic'));
  END IF;
END $$;


-- ============================================================================
-- 20260408_entity_manifold.sql — entities.manifold
-- ============================================================================

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS manifold JSONB;

COMMENT ON COLUMN public.entities.manifold IS
  'Sub-dimensional entity profile: {strategic?, operational?, epistemic?}';


-- ============================================================================
-- 20260408_recommendation_outcomes.sql — outcome cols on goal_recommendations
--                                       + status/completed_at on action_items
-- (outcome cols are already in catch-up-phase-b.sql's goal_recommendations
--  CREATE; guarded below anyway.)
-- ============================================================================

ALTER TABLE public.goal_recommendations
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS outcome_notes TEXT,
  ADD COLUMN IF NOT EXISTS outcome_recorded_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goal_recommendations_outcome_check') THEN
    ALTER TABLE public.goal_recommendations
      ADD CONSTRAINT goal_recommendations_outcome_check
      CHECK (outcome IS NULL OR outcome IN ('effective', 'ineffective', 'partial', 'not_tested'));
  END IF;
END $$;

ALTER TABLE public.action_items
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_items_status_check') THEN
    ALTER TABLE public.action_items
      ADD CONSTRAINT action_items_status_check
      CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped'));
  END IF;
END $$;


-- ============================================================================
-- 20260408_temporal_validity.sql — temporal_validity on entities + edges
-- ============================================================================

ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS temporal_validity JSONB;
ALTER TABLE public.edges    ADD COLUMN IF NOT EXISTS temporal_validity JSONB;

COMMENT ON COLUMN public.entities.temporal_validity IS
  'JSON: {valid_from?, valid_until?, decay_rate?, temporal_scope?}';
COMMENT ON COLUMN public.edges.temporal_validity IS
  'JSON: {valid_from?, valid_until?, decay_rate?, temporal_scope?}';


-- ============================================================================
-- 20260410_expansions.sql — expansions table + entity.expansion_id/is_expanded
-- ============================================================================

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

CREATE INDEX IF NOT EXISTS idx_expansions_space  ON public.expansions(space_id);
CREATE INDEX IF NOT EXISTS idx_expansions_parent ON public.expansions(parent_expansion_id);
CREATE INDEX IF NOT EXISTS idx_expansions_entity ON public.expansions(entity_id);

ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS expansion_id UUID REFERENCES public.expansions(id);
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS is_expanded BOOLEAN DEFAULT FALSE;

ALTER TABLE public.expansions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view expansions in their spaces" ON public.expansions;
CREATE POLICY "Users can view expansions in their spaces" ON public.expansions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = expansions.space_id AND spaces.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create expansions in their spaces" ON public.expansions;
CREATE POLICY "Users can create expansions in their spaces" ON public.expansions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = expansions.space_id AND spaces.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update expansions in their spaces" ON public.expansions;
CREATE POLICY "Users can update expansions in their spaces" ON public.expansions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = expansions.space_id AND spaces.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete expansions in their spaces" ON public.expansions;
CREATE POLICY "Users can delete expansions in their spaces" ON public.expansions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = expansions.space_id AND spaces.user_id = auth.uid())
  );


-- ============================================================================
-- 20260412_deep_research_evidence.sql — claims + evidence + junction
-- ============================================================================

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  claim_text text not null,
  claim_type text not null default 'assertion'
    check (claim_type in ('mechanism', 'assertion', 'prediction', 'assumption', 'finding')),
  status text not null default 'proposed'
    check (status in ('proposed', 'supported', 'contested', 'refuted')),
  confidence numeric default 0.5 check (confidence >= 0 and confidence <= 1),
  source_entity_id uuid references public.entities(id) on delete set null,
  source_edge_id uuid references public.edges(id) on delete set null,
  source_type text default 'deep_research'
    check (source_type in ('deep_research', 'fast_research', 'synthesis', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  url text,
  title text,
  source_type text default 'unknown'
    check (source_type in ('academic', 'news', 'government', 'blog', 'earnings', 'social', 'organization', 'unknown')),
  published_at timestamptz,
  quote text,
  span_start int,
  span_end int,
  reliability_prior numeric default 0.5 check (reliability_prior >= 0 and reliability_prior <= 1),
  recency_score numeric default 0.5 check (recency_score >= 0 and recency_score <= 1),
  extraction_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.claim_evidence_links (
  claim_id uuid not null references public.claims(id) on delete cascade,
  evidence_id uuid not null references public.evidence_items(id) on delete cascade,
  support_type text not null default 'supports'
    check (support_type in ('supports', 'contradicts', 'contextualizes')),
  primary key (claim_id, evidence_id)
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'contradictions' and column_name = 'claim_a_id'
  ) then
    alter table public.contradictions add column claim_a_id uuid references public.claims(id) on delete set null;
    alter table public.contradictions add column claim_b_id uuid references public.claims(id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'theory_type'
  ) then
    alter table public.entities add column theory_type text
      check (theory_type is null or theory_type in ('mechanism', 'assumption', 'mediator', 'constraint', 'observable_test'));
    alter table public.entities add column falsifiability_score numeric
      check (falsifiability_score is null or (falsifiability_score >= 0 and falsifiability_score <= 1));
    alter table public.entities add column evidence_strength numeric
      check (evidence_strength is null or (evidence_strength >= 0 and evidence_strength <= 1));
  end if;
end $$;

create index if not exists idx_claims_space             on public.claims(space_id);
create index if not exists idx_claims_status            on public.claims(space_id, status);
create index if not exists idx_evidence_space           on public.evidence_items(space_id);
create index if not exists idx_evidence_url             on public.evidence_items(url);
create index if not exists idx_claim_evidence_claim    on public.claim_evidence_links(claim_id);
create index if not exists idx_claim_evidence_evidence on public.claim_evidence_links(evidence_id);

alter table public.claims                enable row level security;
alter table public.evidence_items        enable row level security;
alter table public.claim_evidence_links  enable row level security;

drop policy if exists "claims_select" on public.claims;
create policy "claims_select" on public.claims for select using (
  space_id in (select id from public.spaces where user_id = auth.uid())
);
drop policy if exists "claims_insert" on public.claims;
create policy "claims_insert" on public.claims for insert with check (
  space_id in (select id from public.spaces where user_id = auth.uid())
);
drop policy if exists "claims_update" on public.claims;
create policy "claims_update" on public.claims for update using (
  space_id in (select id from public.spaces where user_id = auth.uid())
);
drop policy if exists "claims_delete" on public.claims;
create policy "claims_delete" on public.claims for delete using (
  space_id in (select id from public.spaces where user_id = auth.uid())
);

drop policy if exists "evidence_select" on public.evidence_items;
create policy "evidence_select" on public.evidence_items for select using (
  space_id in (select id from public.spaces where user_id = auth.uid())
);
drop policy if exists "evidence_insert" on public.evidence_items;
create policy "evidence_insert" on public.evidence_items for insert with check (
  space_id in (select id from public.spaces where user_id = auth.uid())
);
drop policy if exists "evidence_delete" on public.evidence_items;
create policy "evidence_delete" on public.evidence_items for delete using (
  space_id in (select id from public.spaces where user_id = auth.uid())
);

drop policy if exists "claim_evidence_select" on public.claim_evidence_links;
create policy "claim_evidence_select" on public.claim_evidence_links for select using (
  claim_id in (select id from public.claims where space_id in (select id from public.spaces where user_id = auth.uid()))
);
drop policy if exists "claim_evidence_insert" on public.claim_evidence_links;
create policy "claim_evidence_insert" on public.claim_evidence_links for insert with check (
  claim_id in (select id from public.claims where space_id in (select id from public.spaces where user_id = auth.uid()))
);
drop policy if exists "claim_evidence_delete" on public.claim_evidence_links;
create policy "claim_evidence_delete" on public.claim_evidence_links for delete using (
  claim_id in (select id from public.claims where space_id in (select id from public.spaces where user_id = auth.uid()))
);


-- ============================================================================
-- 20260412_expansion_materialization.sql — expansions.materialized_at
-- ============================================================================

ALTER TABLE public.expansions ADD COLUMN IF NOT EXISTS materialized_at TIMESTAMPTZ;


-- ============================================================================
-- 20260413_conceptual_layer.sql — extend knowledge_layer + backfill
-- (schema.sql already has the 4-value constraint; guarded re-apply + backfill.)
-- ============================================================================

ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_knowledge_layer_check;
ALTER TABLE public.entities ADD CONSTRAINT entities_knowledge_layer_check
  CHECK (knowledge_layer IN ('internal', 'conceptual', 'external', 'bridge'));

ALTER TABLE public.edges DROP CONSTRAINT IF EXISTS edges_knowledge_layer_check;
ALTER TABLE public.edges ADD CONSTRAINT edges_knowledge_layer_check
  CHECK (knowledge_layer IN ('internal', 'conceptual', 'external', 'bridge'));

UPDATE public.entities
SET knowledge_layer = 'conceptual'
WHERE entity_id LIKE 'SC\_%'
  AND knowledge_layer = 'internal'
  AND (
    provenance->>'source_type' = 'expansion_materialization'
    OR provenance IS NULL
  );

UPDATE public.edges
SET knowledge_layer = 'conceptual'
WHERE knowledge_layer = 'internal'
  AND provenance->>'source_type' = 'expansion_materialization'
  AND relationship_type != 'has_component';

UPDATE public.edges
SET knowledge_layer = 'bridge'
WHERE knowledge_layer = 'internal'
  AND relationship_type = 'has_component'
  AND provenance->>'source_type' = 'expansion_materialization';


-- ============================================================================
-- 20260415_loop_metrics.sql — kg_metrics_snapshots + loop_cycle_records
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kg_metrics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  cycle_id TEXT,
  captured_at TIMESTAMPTZ DEFAULT now(),
  metrics JSONB NOT NULL,
  trigger_type TEXT DEFAULT 'loop_cycle'
);

CREATE INDEX IF NOT EXISTS idx_metrics_space_time
  ON public.kg_metrics_snapshots(space_id, captured_at);

CREATE TABLE IF NOT EXISTS public.loop_cycle_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  cycle_number INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',
  trigger_type TEXT DEFAULT 'cron',
  depth_used TEXT DEFAULT 'standard',
  phases JSONB DEFAULT '[]',
  delta JSONB DEFAULT '{}',
  error_message TEXT,
  credits_used INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_loop_cycles_space
  ON public.loop_cycle_records(space_id, started_at);

ALTER TABLE public.kg_metrics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loop_cycle_records   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own metrics" ON public.kg_metrics_snapshots;
CREATE POLICY "Users see own metrics" ON public.kg_metrics_snapshots
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users see own loop cycles" ON public.loop_cycle_records;
CREATE POLICY "Users see own loop cycles" ON public.loop_cycle_records
  FOR ALL USING (user_id = auth.uid());


-- ============================================================================
-- 20260416_claim_source_quote.sql — claims.source_quote
-- ============================================================================

alter table public.claims add column if not exists source_quote text;

create index if not exists idx_claims_source_quote_not_null
  on public.claims (source_entity_id)
  where source_quote is not null;


-- ============================================================================
-- 20260416_entity_enrichment.sql — entities.causal_role + claim indexes
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'causal_role'
  ) then
    alter table public.entities add column causal_role text
      check (causal_role is null or causal_role in (
        'truth', 'evidence', 'deliverable', 'application', 'outcome', 'goal'));
  end if;
end $$;

create index if not exists idx_claims_source_entity       on public.claims(source_entity_id);
create index if not exists idx_claims_space_source       on public.claims(space_id, source_entity_id);


-- ============================================================================
-- 20260417_analysis_jobs.sql — analysis_jobs + job_events + Realtime
-- (You already have these tables; guarded for idempotency.)
-- ============================================================================

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete set null,
  tier text not null,
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed','cancelled')),
  current_phase text,
  input_text text,
  intent jsonb,
  reservation_id uuid,
  inngest_run_id text,
  error_message text,
  artifacts_ready text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_analysis_jobs_user   on public.analysis_jobs(user_id, created_at desc);
create index if not exists idx_analysis_jobs_space  on public.analysis_jobs(space_id);
create index if not exists idx_analysis_jobs_status on public.analysis_jobs(status, created_at desc);

create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.analysis_jobs(id) on delete cascade,
  event_type text not null,
  artifact_kind text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_events_job_created on public.job_events(job_id, created_at);

alter table public.analysis_jobs enable row level security;
alter table public.job_events    enable row level security;

drop policy if exists "analysis_jobs_select_own" on public.analysis_jobs;
create policy "analysis_jobs_select_own" on public.analysis_jobs
  for select using (user_id = auth.uid());

drop policy if exists "job_events_select_own" on public.job_events;
create policy "job_events_select_own" on public.job_events
  for select using (
    job_id in (select id from public.analysis_jobs where user_id = auth.uid())
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'job_events'
  ) then
    execute 'alter publication supabase_realtime add table public.job_events';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'analysis_jobs'
  ) then
    execute 'alter publication supabase_realtime add table public.analysis_jobs';
  end if;
end $$;


-- ============================================================================
-- 20260417_coverage_tracking.sql — per-entity/edge analysis counters + pairs
-- ============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'analysis_count') then
    alter table public.entities add column analysis_count integer not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'last_analyzed_at') then
    alter table public.entities add column last_analyzed_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'connection_search_count') then
    alter table public.entities add column connection_search_count integer not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'last_connection_search_at') then
    alter table public.entities add column last_connection_search_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'decomposition_probed_at') then
    alter table public.entities add column decomposition_probed_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_name = 'edges' and column_name = 'analysis_count') then
    alter table public.edges add column analysis_count integer not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_name = 'edges' and column_name = 'last_analyzed_at') then
    alter table public.edges add column last_analyzed_at timestamptz;
  end if;
end $$;

create table if not exists public.pairwise_connection_checks (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  entity_a_id uuid not null references public.entities(id) on delete cascade,
  entity_b_id uuid not null references public.entities(id) on delete cascade,
  checked_at timestamptz not null default now(),
  edge_proposed boolean not null default false,
  resulting_edge_id uuid references public.edges(id) on delete set null,
  pair_key text not null,
  unique (space_id, pair_key)
);

create index if not exists idx_pairwise_checks_space    on public.pairwise_connection_checks(space_id);
create index if not exists idx_pairwise_checks_entity_a on public.pairwise_connection_checks(entity_a_id);
create index if not exists idx_pairwise_checks_entity_b on public.pairwise_connection_checks(entity_b_id);
create index if not exists idx_pairwise_checks_recency  on public.pairwise_connection_checks(space_id, checked_at desc);

create index if not exists idx_entities_analysis_count       on public.entities(space_id, analysis_count asc, last_analyzed_at asc nulls first);
create index if not exists idx_entities_connection_search    on public.entities(space_id, connection_search_count asc, last_connection_search_at asc nulls first);

create or replace function public.increment_entity_analysis(entity_uuid uuid)
returns void as $$
begin
  update public.entities
  set analysis_count = analysis_count + 1,
      last_analyzed_at = now()
  where id = entity_uuid;
end;
$$ language plpgsql;

create or replace function public.increment_entity_connection_search(entity_uuid uuid)
returns void as $$
begin
  update public.entities
  set connection_search_count = connection_search_count + 1,
      last_connection_search_at = now()
  where id = entity_uuid;
end;
$$ language plpgsql;

create or replace function public.increment_edge_analysis(edge_uuid uuid)
returns void as $$
begin
  update public.edges
  set analysis_count = analysis_count + 1,
      last_analyzed_at = now()
  where id = edge_uuid;
end;
$$ language plpgsql;


-- ============================================================================
-- 20260417_space_canvases.sql — tldraw snapshot per space
-- ============================================================================

create table if not exists public.space_canvases (
  space_id uuid primary key references public.spaces(id) on delete cascade,
  snapshot jsonb not null,
  schema_version integer not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists space_canvases_updated_at_idx on public.space_canvases (updated_at desc);

alter table public.space_canvases enable row level security;

drop policy if exists "owner_read_space_canvases" on public.space_canvases;
create policy "owner_read_space_canvases" on public.space_canvases
  for select using (
    exists (select 1 from public.spaces s where s.id = space_canvases.space_id and s.user_id = auth.uid())
  );

drop policy if exists "owner_write_space_canvases" on public.space_canvases;
create policy "owner_write_space_canvases" on public.space_canvases
  for all using (
    exists (select 1 from public.spaces s where s.id = space_canvases.space_id and s.user_id = auth.uid())
  );

create or replace function public.tg_touch_space_canvases_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_space_canvases_updated_at on public.space_canvases;
create trigger trg_touch_space_canvases_updated_at
  before update on public.space_canvases
  for each row execute function public.tg_touch_space_canvases_updated_at();


-- ============================================================================
-- 20260420_strategy_commitment.sql — spaces twin cols + metric_trackers + obs
-- ============================================================================

alter table public.spaces
  add column if not exists strategy_committed_at timestamptz;

alter table public.spaces
  add column if not exists digital_twin_state text not null default 'not_started';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'spaces_digital_twin_state_check'
  ) then
    alter table public.spaces
      add constraint spaces_digital_twin_state_check
      check (digital_twin_state in ('not_started', 'ready', 'active', 'retired'));
  end if;
end $$;

alter table public.spaces
  add column if not exists twin_initialized_at timestamptz;

create table if not exists public.metric_trackers (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check (source_kind in (
    'goal','target_objective','perspective_key_metric','micro_tactic_metric',
    'leading_indicator','lagging_indicator'
  )),
  source_key text not null,
  source_id text,
  label text not null,
  measurement_method text,
  unit text,
  cadence text default 'adhoc' check (cadence in ('daily','weekly','biweekly','monthly','adhoc')),
  baseline_value numeric,
  current_value numeric,
  target_value numeric,
  baseline_text text,
  current_text text,
  target_text text,
  green_reading text,
  yellow_reading text,
  red_reading text,
  user_confirmed boolean not null default false,
  measurability text check (measurability is null or measurability in ('easy','medium','hard','impossible')),
  strategy_generated_at timestamptz,
  supersedes_tracker_id uuid references public.metric_trackers(id) on delete set null,
  status text not null default 'active' check (status in ('active','superseded','archived')),
  metric_definition jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(space_id, source_kind, source_key)
);

create index if not exists idx_metric_trackers_space_active on public.metric_trackers(space_id) where status = 'active';
create index if not exists idx_metric_trackers_user         on public.metric_trackers(user_id);
create index if not exists idx_metric_trackers_source       on public.metric_trackers(space_id, source_kind);

create table if not exists public.metric_observations (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.metric_trackers(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  value numeric,
  value_text text,
  note text,
  source text not null default 'manual' check (source in ('manual','ai_estimated','integration','seed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_metric_obs_tracker_time on public.metric_observations(tracker_id, recorded_at desc);

alter table public.metric_trackers     enable row level security;
alter table public.metric_observations enable row level security;

drop policy if exists "metric_trackers_owner" on public.metric_trackers;
create policy "metric_trackers_owner" on public.metric_trackers
  for all using (auth.uid() = user_id);

drop policy if exists "metric_observations_owner" on public.metric_observations;
create policy "metric_observations_owner" on public.metric_observations
  for all using (
    tracker_id in (select id from public.metric_trackers where user_id = auth.uid())
  );

create or replace function public.set_metric_tracker_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_metric_trackers_updated_at on public.metric_trackers;
create trigger trg_metric_trackers_updated_at
  before update on public.metric_trackers
  for each row execute function public.set_metric_tracker_updated_at();


-- ============================================================================
-- 20260421_topology_and_faults.sql — edges.topology + entity_category 'fault'
-- ============================================================================

alter table public.edges add column if not exists topology text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'edges_topology_check') then
    alter table public.edges
      add constraint edges_topology_check
      check (
        topology is null or topology in (
          'inside','overlap','meets','disjoint','composes','cover','equal'
        )
      );
  end if;
end $$;

create index if not exists edges_topology_idx on public.edges (topology)
  where topology is not null;

-- Promote entity_category to include 'fault'
do $$
declare
  existing_conname text;
begin
  select c.conname into existing_conname
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  where t.relname = 'entities'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%entity_category%'
  limit 1;

  if existing_conname is not null then
    execute 'alter table public.entities drop constraint ' || quote_ident(existing_conname);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'entities_entity_category_check') then
    alter table public.entities
      add constraint entities_entity_category_check
      check (entity_category in ('concrete','abstract','process','relational','epistemic','fault'));
  end if;
end $$;


-- ============================================================================
-- 20260422_consent_and_tracker_tiers.sql — user_consent_manifest + tracker tier
-- ============================================================================

create table if not exists public.user_consent_manifest (
  user_id uuid primary key references auth.users(id) on delete cascade,
  consent_map jsonb not null default '{}'::jsonb,
  friction_budget integer not null default 5 check (friction_budget between 1 and 10),
  escalation_policy text not null default 'ask_each_time'
    check (escalation_policy in ('ask_each_time','auto_if_value_above_x','never_escalate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_user_consent_manifest_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_user_consent_manifest_updated_at on public.user_consent_manifest;
create trigger trg_user_consent_manifest_updated_at
  before update on public.user_consent_manifest
  for each row execute function public.set_user_consent_manifest_updated_at();

alter table public.user_consent_manifest enable row level security;

drop policy if exists "consent_owner" on public.user_consent_manifest;
create policy "consent_owner" on public.user_consent_manifest
  for all using (auth.uid() = user_id);

alter table public.metric_trackers
  add column if not exists depth_tier text
    check (depth_tier is null or depth_tier in ('light','mid','heavy'));

alter table public.metric_trackers
  add column if not exists friction_cost integer
    check (friction_cost is null or friction_cost between 1 and 10);

alter table public.metric_trackers
  add column if not exists data_category text;


-- ============================================================================
-- 20260422_convergent_points.sql — node probability space
-- ============================================================================

create table if not exists public.convergent_points (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  focal_entity_id uuid not null references public.entities(id) on delete cascade,
  interactor_entity_ids uuid[] not null default '{}',
  external_conditions text[] not null default '{}',
  outcome jsonb not null,
  probability real not null default 0.5 check (probability >= 0 and probability <= 1),
  confidence  real not null default 0.6 check (confidence  >= 0 and confidence  <= 1),
  generation_method text not null check (generation_method in (
    'empirical_edge','structural_derivation','analogical_mapping','domain_inference','adversarial'
  )),
  pattern_tag text,
  structural_signature jsonb,
  objective_alignment jsonb not null default '[]',
  evidence_basis jsonb not null default '[]',
  generated_at timestamptz not null default now(),
  generated_by text default 'llm',
  created_at timestamptz not null default now()
);

create index if not exists convergent_points_space_idx        on public.convergent_points (space_id);
create index if not exists convergent_points_focal_idx        on public.convergent_points (focal_entity_id);
create index if not exists convergent_points_pattern_idx      on public.convergent_points (pattern_tag) where pattern_tag is not null;
create index if not exists convergent_points_interactors_idx  on public.convergent_points using gin (interactor_entity_ids);

alter table public.convergent_points enable row level security;

drop policy if exists "users_read_own_convergent_points" on public.convergent_points;
create policy "users_read_own_convergent_points" on public.convergent_points
  for select using (
    exists (select 1 from public.spaces s where s.id = convergent_points.space_id and s.user_id = auth.uid())
  );

drop policy if exists "users_write_own_convergent_points" on public.convergent_points;
create policy "users_write_own_convergent_points" on public.convergent_points
  for all using (
    exists (select 1 from public.spaces s where s.id = convergent_points.space_id and s.user_id = auth.uid())
  );


-- ============================================================================
-- 20260423_pattern_library.sql — global pattern library + aggregated_at
-- ============================================================================

create table if not exists public.pattern_library (
  id uuid primary key default gen_random_uuid(),
  signature text unique not null,
  signature_detail jsonb not null,
  canonical_tag text not null default 'unnamed',
  tag_distribution jsonb not null default '[]',
  canonical_description text,
  example_descriptions text[] not null default '{}',
  canonical_mechanism text,
  typical_polarity text,
  typical_reversibility text,
  typical_time_horizon text,
  typical_propagation text,
  occurrence_count int not null default 0,
  avg_probability real,
  avg_confidence real,
  avg_composite_score real,
  seen_in_space_ids uuid[] not null default '{}',
  seen_on_focal_entity_ids uuid[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pattern_library_signature_idx         on public.pattern_library (signature);
create index if not exists pattern_library_occurrence_idx        on public.pattern_library (occurrence_count desc);
create index if not exists pattern_library_tag_idx               on public.pattern_library (canonical_tag);
create index if not exists pattern_library_signature_detail_idx  on public.pattern_library using gin (signature_detail);

alter table public.pattern_library enable row level security;

drop policy if exists "authenticated_read_patterns" on public.pattern_library;
create policy "authenticated_read_patterns" on public.pattern_library
  for select using (auth.role() = 'authenticated');

alter table public.convergent_points
  add column if not exists aggregated_at timestamptz;

create index if not exists convergent_points_aggregated_idx on public.convergent_points (aggregated_at)
  where aggregated_at is null;


-- ============================================================================
-- 20260424_convergent_point_feedback.sql — user feedback + pattern vote cols
-- ============================================================================

alter table public.convergent_points
  add column if not exists user_feedback text,
  add column if not exists feedback_note text,
  add column if not exists feedback_at   timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'convergent_points_user_feedback_check') then
    alter table public.convergent_points
      add constraint convergent_points_user_feedback_check
      check (user_feedback is null or user_feedback in ('useful','noise','inaccurate'));
  end if;
end $$;

create index if not exists convergent_points_feedback_idx on public.convergent_points (feedback_at)
  where user_feedback is not null;

alter table public.pattern_library
  add column if not exists useful_votes     int not null default 0,
  add column if not exists noise_votes      int not null default 0,
  add column if not exists inaccurate_votes int not null default 0;

alter table public.pattern_library
  add column if not exists feedback_quality_score real;

create index if not exists pattern_library_feedback_quality_idx on public.pattern_library (feedback_quality_score desc nulls last)
  where feedback_quality_score is not null;


-- ============================================================================
-- 20260425_whiteboard_positions.sql
-- ============================================================================

create table if not exists public.whiteboard_positions (
  space_id uuid not null references public.spaces(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  x integer not null,
  y integer not null,
  moved_by uuid references auth.users(id) on delete set null,
  moved_at timestamptz not null default now(),
  primary key (space_id, entity_id)
);

create index if not exists whiteboard_positions_space_idx on public.whiteboard_positions (space_id);

alter table public.whiteboard_positions enable row level security;

drop policy if exists "users_read_whiteboard_positions" on public.whiteboard_positions;
create policy "users_read_whiteboard_positions" on public.whiteboard_positions
  for select using (
    exists (select 1 from public.spaces s where s.id = whiteboard_positions.space_id and s.user_id = auth.uid())
  );

drop policy if exists "owner_write_whiteboard_positions" on public.whiteboard_positions;
create policy "owner_write_whiteboard_positions" on public.whiteboard_positions
  for all using (
    exists (select 1 from public.spaces s where s.id = whiteboard_positions.space_id and s.user_id = auth.uid())
  );


-- ============================================================================
-- 20260426_journal_entries_use_case.sql — spaces.use_case_template_id + journal
-- ============================================================================

alter table public.spaces
  add column if not exists use_case_template_id text;

create index if not exists spaces_use_case_template_idx on public.spaces (use_case_template_id)
  where use_case_template_id is not null;

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  entry_date date not null,
  text text not null,
  word_count integer not null default 0,
  referenced_entity_ids uuid[] not null default '{}',
  emotions_mentioned   text[] not null default '{}',
  values_surfaced      text[] not null default '{}',
  tensions_detected    text[] not null default '{}',
  flow_activities      text[] not null default '{}',
  drain_activities     text[] not null default '{}',
  next_prompt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists journal_entries_space_date_idx         on public.journal_entries (space_id, entry_date desc);
create index if not exists journal_entries_referenced_entities_idx on public.journal_entries using gin (referenced_entity_ids);

alter table public.journal_entries enable row level security;

drop policy if exists "users_read_own_journal_entries" on public.journal_entries;
create policy "users_read_own_journal_entries" on public.journal_entries
  for select using (
    exists (select 1 from public.spaces s where s.id = journal_entries.space_id and s.user_id = auth.uid())
  );

drop policy if exists "users_write_own_journal_entries" on public.journal_entries;
create policy "users_write_own_journal_entries" on public.journal_entries
  for all using (
    exists (select 1 from public.spaces s where s.id = journal_entries.space_id and s.user_id = auth.uid())
  );


-- ============================================================================
-- 20260427_router_proposals.sql — router_proposals + proposed_objectives
-- ============================================================================

create table if not exists public.router_proposals (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.spaces(id) on delete cascade,
  kind text not null,
  reason text not null,
  confidence real not null default 0.5,
  cost_estimate text not null default 'medium' check (cost_estimate in ('low','medium','high')),
  payload jsonb,
  router_trace_id text,
  triggered_by_content text,
  status text not null default 'pending' check (status in ('pending','approved','dismissed','executed','failed')),
  approved_at timestamptz,
  executed_at timestamptz,
  execution_result jsonb,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists router_proposals_space_status_idx on public.router_proposals (space_id, status) where status = 'pending';
create index if not exists router_proposals_trace_idx        on public.router_proposals (router_trace_id) where router_trace_id is not null;
create index if not exists router_proposals_kind_idx         on public.router_proposals (kind);

alter table public.router_proposals enable row level security;

drop policy if exists "users_read_router_proposals" on public.router_proposals;
create policy "users_read_router_proposals" on public.router_proposals
  for select using (
    space_id is null
    or exists (select 1 from public.spaces s where s.id = router_proposals.space_id and s.user_id = auth.uid())
  );

drop policy if exists "users_write_router_proposals" on public.router_proposals;
create policy "users_write_router_proposals" on public.router_proposals
  for all using (
    space_id is null
    or exists (select 1 from public.spaces s where s.id = router_proposals.space_id and s.user_id = auth.uid())
  );

create table if not exists public.proposed_objectives (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.spaces(id) on delete cascade,
  suggested_title text not null,
  objective_type text not null default 'maximize',
  rationale text not null,
  triggering_excerpt text,
  confidence real not null default 0.5,
  parent_objective_id uuid references public.improvement_goals(id) on delete cascade,
  router_trace_id text,
  source text,
  status text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  accepted_at timestamptz,
  dismissed_at timestamptz,
  created_goal_id uuid references public.improvement_goals(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists proposed_objectives_space_status_idx on public.proposed_objectives (space_id, status) where status = 'pending';

alter table public.proposed_objectives enable row level security;

drop policy if exists "users_read_proposed_objectives" on public.proposed_objectives;
create policy "users_read_proposed_objectives" on public.proposed_objectives
  for select using (
    space_id is null
    or exists (select 1 from public.spaces s where s.id = proposed_objectives.space_id and s.user_id = auth.uid())
  );

drop policy if exists "users_write_proposed_objectives" on public.proposed_objectives;
create policy "users_write_proposed_objectives" on public.proposed_objectives
  for all using (
    space_id is null
    or exists (select 1 from public.spaces s where s.id = proposed_objectives.space_id and s.user_id = auth.uid())
  );


-- ============================================================================
-- Done. Verify with:
--   select table_name from information_schema.tables
--     where table_schema = 'public' order by table_name;
--
-- Expected new tables (in addition to what catch-up-phase-b.sql added):
--   expansions, claims, evidence_items, claim_evidence_links,
--   kg_metrics_snapshots, loop_cycle_records,
--   space_canvases, metric_trackers, metric_observations,
--   user_consent_manifest, convergent_points, pattern_library,
--   whiteboard_positions, journal_entries,
--   router_proposals, proposed_objectives.
-- ============================================================================
