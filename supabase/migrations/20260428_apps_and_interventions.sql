-- Sprint 1: Apps + Interventions as first-class entities
-- Converts the pipeline from "analysis-only" (prose + JSONB in synthesis_data)
-- to producing persistent, updatable Apps that reasoning agents, research loops,
-- and whiteboard activity can continuously refine.
--
-- Upstream producer: strategy-refresh route calls generate-apps after storing strategy.
-- Downstream consumers: new dashboard, per-app whiteboard routes (Sprint 2),
-- agent write-back paths + whiteboard staleness triggers (Sprint 3).

-- ──────────────────────────────────────────────────────────────────────
-- 1. interventions — materialized from strategy's micro_tactics[]
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.interventions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Source provenance — we keep the tactic id so regen can upsert stably
  source_tactic_id text,                -- micro_tactic.id from strategy JSONB (stable within a strategy version)
  source_strategy_version int,          -- strategy_snapshots.version at time of materialization

  -- Definition (mirrors MicroTactic)
  title text not null,
  description text,
  target_entity_id uuid references public.entities(id) on delete set null,
  target_entity_code text,              -- C-prefixed / X-prefixed entity_id, survives entity rekeying
  macro_link text,                      -- which macro strategy element this serves
  infrastructure_action text
    check (infrastructure_action is null or infrastructure_action in
      ('build','strengthen','connect','monitor','configure')),

  -- Ranking / shape
  priority int not null default 999,
  effort text check (effort is null or effort in ('low','medium','high')),
  impact text check (impact is null or impact in ('low','medium','high')),
  timeframe text check (timeframe is null or timeframe in
    ('now','short_term','medium_term','long_term')),

  -- Metric this intervention is expected to move
  metric_name text,
  metric_target text,
  metric_unit text,

  -- Lifecycle
  status text not null default 'proposed'
    check (status in ('proposed','active','completed','superseded','abandoned')),

  -- Cluster assignment — filled by generate-apps
  app_id uuid,                          -- FK declared after apps table exists (see ADD CONSTRAINT below)

  -- Graph of interventions (execution order)
  depends_on_intervention_ids uuid[] not null default '{}',

  -- Implementation intention (Gollwitzer if-then, present in MicroTactic)
  implementation_trigger text,
  implementation_action text,
  implementation_category text
    check (implementation_category is null or implementation_category in
      ('proactive','reactive','course_correction')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  -- Stable identity: regen upserts on (space_id, source_tactic_id)
  unique(space_id, source_tactic_id)
);

create index if not exists idx_interventions_space
  on public.interventions(space_id);
create index if not exists idx_interventions_user
  on public.interventions(user_id);
create index if not exists idx_interventions_app
  on public.interventions(app_id) where app_id is not null;
create index if not exists idx_interventions_target_entity
  on public.interventions(target_entity_id) where target_entity_id is not null;
create index if not exists idx_interventions_space_status
  on public.interventions(space_id, status);

-- ──────────────────────────────────────────────────────────────────────
-- 2. apps — first-class persistent apps (the dashboard's final column)
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.apps (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Definition
  name text not null,
  description text,
  app_type text not null default 'dashboard'
    check (app_type in ('dashboard','workflow','tool','monitor','integration')),

  -- Source provenance — which strategy generation produced this
  source_strategy_version int,
  source_perspective text,                            -- BSC perspective name
  source_infrastructure_proposal_id text,             -- InfrastructureProposal.id from strategy JSONB

  -- The "dominant factors" column in the new dashboard:
  -- top entities this app consolidates / acts on (controls a cluster of sub-objectives)
  dominant_entity_ids uuid[] not null default '{}',
  dominant_entity_codes text[] not null default '{}', -- code-form ids (survive rekeying)

  -- Per-app whiteboard: leverages existing sub_space plumbing
  sub_space_id uuid references public.spaces(id) on delete set null,

  -- What this app serves
  serves_goal_id uuid references public.improvement_goals(id) on delete set null,
  serves_sub_objective_ids uuid[] not null default '{}',

  -- Metrics this app tracks (soft ref to metric_trackers — avoid hard FK to preserve app on tracker churn)
  tracked_metric_tracker_ids uuid[] not null default '{}',

  -- Agent-updatable payload
  config jsonb not null default '{}'::jsonb,          -- app-specific configuration
  state jsonb not null default '{}'::jsonb,           -- runtime state (agent outputs, derived values)

  -- Lifecycle
  status text not null default 'proposed'
    check (status in ('proposed','approved','active','paused','retired')),
  health_score numeric check (health_score is null or (health_score >= 0 and health_score <= 100)),

  -- Staleness + continuous-update loop (hydrated in Sprint 3)
  stale_reason text
    check (stale_reason is null or stale_reason in
      ('kg_changed','new_research','user_feedback','strategy_regen','whiteboard_edit')),
  stale_since timestamptz,
  last_refreshed_at timestamptz,
  last_updated_by text,                               -- 'user' | 'agent:<name>' | 'pipeline:<stage>'

  -- Ranking / shape
  priority int not null default 999,
  complexity text check (complexity is null or complexity in ('low','medium','high')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Stable identity across regens: same perspective + proposal id stays the same app
  unique(space_id, source_infrastructure_proposal_id)
);

create index if not exists idx_apps_space
  on public.apps(space_id);
create index if not exists idx_apps_user
  on public.apps(user_id);
create index if not exists idx_apps_space_active
  on public.apps(space_id) where status in ('approved','active');
create index if not exists idx_apps_stale
  on public.apps(space_id) where stale_reason is not null;
create index if not exists idx_apps_goal
  on public.apps(serves_goal_id) where serves_goal_id is not null;
-- GIN index on dominant_entity_ids for reverse lookups (which apps depend on this entity?)
create index if not exists idx_apps_dominant_entities_gin
  on public.apps using gin (dominant_entity_ids);

-- Now declare the deferred FK from interventions.app_id -> apps.id
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'interventions_app_id_fkey'
  ) then
    alter table public.interventions
      add constraint interventions_app_id_fkey
      foreign key (app_id) references public.apps(id) on delete set null;
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────
-- 3. app_versions — append-only audit for Sprint 3 agent write-back
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.app_versions (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  version int not null,

  -- Snapshots captured at the time of change
  config_snapshot jsonb not null default '{}'::jsonb,
  state_snapshot jsonb not null default '{}'::jsonb,

  -- What changed and who did it
  change_summary text,
  change_type text not null
    check (change_type in ('generated','user_edit','agent_update','pipeline_regen','staleness_refresh')),
  changed_by text not null,                           -- 'user' | 'agent:<name>' | 'pipeline:<stage>'
  change_payload jsonb,                               -- diff/patch info for debugging

  changed_at timestamptz not null default now(),

  unique(app_id, version)
);

create index if not exists idx_app_versions_app_ver
  on public.app_versions(app_id, version desc);
create index if not exists idx_app_versions_changed_at
  on public.app_versions(changed_at desc);

-- ──────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ──────────────────────────────────────────────────────────────────────
alter table public.interventions enable row level security;
alter table public.apps enable row level security;
alter table public.app_versions enable row level security;

drop policy if exists "interventions_owner" on public.interventions;
create policy "interventions_owner" on public.interventions
  for all using (auth.uid() = user_id);

drop policy if exists "apps_owner" on public.apps;
create policy "apps_owner" on public.apps
  for all using (auth.uid() = user_id);

drop policy if exists "app_versions_owner" on public.app_versions;
create policy "app_versions_owner" on public.app_versions
  for all using (
    app_id in (select id from public.apps where user_id = auth.uid())
  );

-- ──────────────────────────────────────────────────────────────────────
-- 5. updated_at triggers (mirrors existing pattern)
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.set_interventions_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_interventions_updated_at on public.interventions;
create trigger trg_interventions_updated_at
  before update on public.interventions
  for each row execute function public.set_interventions_updated_at();

create or replace function public.set_apps_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_apps_updated_at on public.apps;
create trigger trg_apps_updated_at
  before update on public.apps
  for each row execute function public.set_apps_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 6. Changelog convention
-- space_changelog.change_type already accepts free strings. New values introduced:
--   'apps_generated'      — generate-apps produced / refreshed apps for a space
--   'app_refreshed'       — single app was recomputed (Sprint 3)
--   'app_marked_stale'    — staleness signal recorded (Sprint 3)
--   'intervention_completed'
-- (no schema change needed)

comment on table public.apps is
  'First-class persistent apps generated from strategy recommendations. '
  'Updated continuously by reasoning agents, deep research, and user whiteboard activity. '
  'Each app owns dominant entity factors, a sub-space whiteboard, and a cluster of interventions.';

comment on table public.interventions is
  'First-class interventions materialized from strategy.micro_tactics[]. '
  'Assigned to an App via app_id after clustering. Carries target entity, metric, effort/impact.';

comment on table public.app_versions is
  'Append-only change history for apps. Enables audit of who/what updated each app. '
  'Populated by generate-apps, user edits, and Sprint 3 agent write-back.';
