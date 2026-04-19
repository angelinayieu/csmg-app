-- ============================================================================
-- Catch-up script: unblock Phase B on a DB that only ran part of schema.sql
-- ============================================================================
--
-- Run this ONCE in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Brings the DB up to the state Phase B assumes by adding:
--   1. strategy_snapshots   (base schema, was missing)
--   2. improvement_goals    (base schema, was missing)
--   3. goal_progress        (base schema, was missing)
--   4. goal_recommendations (base schema, was missing)
--   5. agents + agent_runs  (Phase A migration 20260418_agent_runtime.sql)
--   6. Phase B agent-binding splits (migration 20260419_goal_agent_binding.sql)
--
-- All indexes + RLS policies + realtime publication hooks are included.
-- After this runs, creating a goal in the app will spawn a bound researcher
-- and the coordinator-tick Inngest cron will prioritize research per-goal.
--
-- Note: the 20260407 goal_hierarchy + goal_source migrations are folded into
-- the improvement_goals CREATE below (their columns already live there in
-- schema.sql), so you do NOT need to run those two migrations separately.
-- ============================================================================


-- ── 1. strategy_snapshots ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.strategy_snapshots (
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

CREATE INDEX IF NOT EXISTS idx_strategy_snapshots_space
  ON public.strategy_snapshots(space_id);

ALTER TABLE public.strategy_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own strategy_snapshots" ON public.strategy_snapshots;
CREATE POLICY "Users see own strategy_snapshots" ON public.strategy_snapshots
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );


-- ── 2. improvement_goals (includes 20260407 migrations inline) ────────────

CREATE TABLE IF NOT EXISTS public.improvement_goals (
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

CREATE INDEX IF NOT EXISTS idx_goals_space ON public.improvement_goals(space_id);
CREATE INDEX IF NOT EXISTS idx_goals_user  ON public.improvement_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_active ON public.improvement_goals(space_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_goals_parent ON public.improvement_goals(parent_goal_id) WHERE parent_goal_id IS NOT NULL;

ALTER TABLE public.improvement_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own goals" ON public.improvement_goals;
CREATE POLICY "Users see own goals" ON public.improvement_goals
  FOR ALL USING (auth.uid() = user_id);


-- ── 3. goal_progress ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.goal_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES public.improvement_goals(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ DEFAULT now(),
  value NUMERIC NOT NULL,
  note TEXT,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'ai_estimated', 'integration'))
);

CREATE INDEX IF NOT EXISTS idx_goal_progress_goal ON public.goal_progress(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_progress_time ON public.goal_progress(goal_id, recorded_at);

ALTER TABLE public.goal_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own goal_progress" ON public.goal_progress;
CREATE POLICY "Users see own goal_progress" ON public.goal_progress
  FOR ALL USING (
    goal_id IN (SELECT id FROM public.improvement_goals WHERE user_id = auth.uid())
  );


-- ── 4. goal_recommendations ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.goal_recommendations (
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

CREATE INDEX IF NOT EXISTS idx_goal_recommendations_goal ON public.goal_recommendations(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_recommendations_rank ON public.goal_recommendations(goal_id, rank);

ALTER TABLE public.goal_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own goal_recommendations" ON public.goal_recommendations;
CREATE POLICY "Users see own goal_recommendations" ON public.goal_recommendations
  FOR ALL USING (
    goal_id IN (SELECT id FROM public.improvement_goals WHERE user_id = auth.uid())
  );


-- ── 5. agents + agent_runs (Phase A: 20260418_agent_runtime.sql) ──────────

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'decomposer','critic','augmenter','researcher','synthesizer',
    'strategist','twin','bridge','expansion','coordinator',
    'reasoner','reevaluator','incremental_analyzer','chat'
  )),
  name text not null,
  callsign text,
  specialty text,
  focus_areas text[] not null default '{}',
  status text not null default 'idle' check (status in (
    'idle','queued','running','paused','error','retired'
  )),
  last_run_at timestamptz,
  next_run_at timestamptz,
  source_objective_id text,
  source_goal_id uuid references public.improvement_goals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, kind)
);

create index if not exists idx_agents_space on public.agents(space_id);
create index if not exists idx_agents_status on public.agents(space_id, status);
create index if not exists idx_agents_goal on public.agents(source_goal_id) where source_goal_id is not null;

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  job_id uuid references public.analysis_jobs(id) on delete set null,
  inngest_run_id text,
  step_id text,
  trigger_event text,
  trigger_data jsonb,
  status text not null default 'running' check (status in (
    'running','completed','failed','cancelled'
  )),
  findings_count int not null default 0,
  artifacts_produced text[] not null default '{}',
  entity_ids_discovered uuid[] not null default '{}',
  cost_credits int not null default 0,
  heartbeat_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text
);

create index if not exists idx_agent_runs_agent  on public.agent_runs(agent_id, started_at desc);
create index if not exists idx_agent_runs_space  on public.agent_runs(space_id, started_at desc);
create index if not exists idx_agent_runs_job    on public.agent_runs(job_id);
create index if not exists idx_agent_runs_status on public.agent_runs(space_id, status);

create or replace function public.agent_run_sync_parent() returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update public.agents
    set status = new.status,
        last_run_at = new.started_at,
        updated_at = now()
    where id = new.agent_id;
  elsif TG_OP = 'UPDATE' and (old.status <> new.status or old.completed_at is distinct from new.completed_at) then
    update public.agents
    set status = case
                   when new.status in ('completed','failed','cancelled') then 'idle'
                   else new.status
                 end,
        last_run_at = coalesce(new.completed_at, new.started_at),
        updated_at = now()
    where id = new.agent_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists agent_run_sync_parent_trg on public.agent_runs;
create trigger agent_run_sync_parent_trg
  after insert or update on public.agent_runs
  for each row execute function public.agent_run_sync_parent();

alter table public.agents     enable row level security;
alter table public.agent_runs enable row level security;

drop policy if exists "agents_select_own" on public.agents;
create policy "agents_select_own" on public.agents for select
  using (user_id = auth.uid());

drop policy if exists "agent_runs_select_own" on public.agent_runs;
create policy "agent_runs_select_own" on public.agent_runs for select
  using (space_id in (select id from public.spaces where user_id = auth.uid()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'agents'
  ) then
    execute 'alter publication supabase_realtime add table public.agents';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'agent_runs'
  ) then
    execute 'alter publication supabase_realtime add table public.agent_runs';
  end if;
end $$;


-- ── 6. Phase B binding (20260419_goal_agent_binding.sql) ──────────────────

alter table public.agents
  drop constraint if exists agents_source_goal_id_fkey;

alter table public.agents
  add constraint agents_source_goal_id_fkey
    foreign key (source_goal_id)
    references public.improvement_goals(id)
    on delete cascade;

alter table public.agents drop constraint if exists agents_space_id_kind_key;

create unique index if not exists agents_space_kind_unbound_unique
  on public.agents(space_id, kind)
  where source_goal_id is null;

create unique index if not exists agents_space_kind_goal_unique
  on public.agents(space_id, kind, source_goal_id)
  where source_goal_id is not null;


-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify:
--   select table_name from information_schema.tables
--     where table_schema='public' and table_name in
--       ('improvement_goals','goal_progress','goal_recommendations','agents','agent_runs');
-- Expected: 5 rows.
