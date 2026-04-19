-- Phase A: Agent runtime foundation
-- Persists real agent activity (start/heartbeat/complete/fail) as first-class rows
-- backing the Intelligence Radar and /agents page via Supabase Realtime.

-- ── Declarative registry: one row per agent kind per space ──
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    -- Core pipeline agents
    'decomposer','critic','augmenter','researcher','synthesizer',
    'strategist','twin','bridge','expansion','coordinator',
    -- Reasoning / evaluation agents
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
  source_goal_id uuid references improvement_goals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, kind)
);

create index if not exists idx_agents_space on agents(space_id);
create index if not exists idx_agents_status on agents(space_id, status);
create index if not exists idx_agents_goal on agents(source_goal_id) where source_goal_id is not null;

-- ── Durable execution records ──
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  job_id uuid references analysis_jobs(id) on delete set null,
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

create index if not exists idx_agent_runs_agent on agent_runs(agent_id, started_at desc);
create index if not exists idx_agent_runs_space on agent_runs(space_id, started_at desc);
create index if not exists idx_agent_runs_job on agent_runs(job_id);
create index if not exists idx_agent_runs_status on agent_runs(space_id, status);

-- ── Trigger: update parent agent's status/last_run_at when a run transitions ──
create or replace function agent_run_sync_parent() returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update agents
    set status = new.status,
        last_run_at = new.started_at,
        updated_at = now()
    where id = new.agent_id;
  elsif TG_OP = 'UPDATE' and (old.status <> new.status or old.completed_at is distinct from new.completed_at) then
    update agents
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

drop trigger if exists agent_run_sync_parent_trg on agent_runs;
create trigger agent_run_sync_parent_trg
  after insert or update on agent_runs
  for each row execute function agent_run_sync_parent();

-- ── RLS ──
alter table agents enable row level security;
alter table agent_runs enable row level security;

drop policy if exists "agents_select_own" on agents;
create policy "agents_select_own" on agents for select
  using (user_id = auth.uid());

drop policy if exists "agent_runs_select_own" on agent_runs;
create policy "agent_runs_select_own" on agent_runs for select
  using (space_id in (select id from spaces where user_id = auth.uid()));

-- Service role bypasses RLS — inserts/updates flow through agent-writer helpers

-- ── Realtime publication ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'agents'
  ) then
    execute 'alter publication supabase_realtime add table agents';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'agent_runs'
  ) then
    execute 'alter publication supabase_realtime add table agent_runs';
  end if;
end $$;
