-- Phase 2: Strategy commitment + metric tracking infrastructure
-- Makes "Approve & launch" a real event that creates durable tracker rows
-- and flips DB-backed gates for the digital/operating twin.

-- ── 1. Columns on spaces for commit + twin state ──

alter table public.spaces
  add column if not exists strategy_committed_at timestamptz;

alter table public.spaces
  add column if not exists digital_twin_state text not null default 'not_started';

-- Add check constraint for digital_twin_state (drop-if-exists pattern for idempotency)
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

-- ── 2. metric_trackers: definitions (one per distinct metric) ──

create table if not exists public.metric_trackers (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- stable identity (survives strategy regen when names match)
  source_kind text not null check (source_kind in (
    'goal',
    'target_objective',
    'perspective_key_metric',
    'micro_tactic_metric',
    'leading_indicator',
    'lagging_indicator'
  )),
  source_key text not null,          -- e.g. "tactic:{tactic_id}" or "perspective:growth-scale"
  source_id text,                    -- original ID when stable (micro_tactic.id, goal.id)

  -- display
  label text not null,               -- "Growth & Scale — Revenue"
  measurement_method text,           -- from leading_indicator.measurement_method
  unit text,
  cadence text default 'adhoc' check (cadence in ('daily','weekly','biweekly','monthly','adhoc')),

  -- baseline & target (pre-filled from strategy, editable later)
  baseline_value numeric,
  current_value numeric,
  target_value numeric,
  baseline_text text,                -- when value is qualitative
  current_text text,
  target_text text,

  -- thresholds (from leading_indicators green/yellow/red)
  green_reading text,
  yellow_reading text,
  red_reading text,

  -- user-confirmation gate (Phase 2b: checklist sets this)
  user_confirmed boolean not null default false,
  measurability text check (measurability is null or measurability in ('easy','medium','hard','impossible')),

  -- provenance
  strategy_generated_at timestamptz,
  supersedes_tracker_id uuid references public.metric_trackers(id) on delete set null,
  status text not null default 'active' check (status in ('active','superseded','archived')),

  metric_definition jsonb,            -- snapshot for regen safety

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(space_id, source_kind, source_key)
);

create index if not exists idx_metric_trackers_space_active
  on public.metric_trackers(space_id) where status = 'active';
create index if not exists idx_metric_trackers_user
  on public.metric_trackers(user_id);
create index if not exists idx_metric_trackers_source
  on public.metric_trackers(space_id, source_kind);

-- ── 3. metric_observations: time-series values ──

create table if not exists public.metric_observations (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.metric_trackers(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  value numeric,
  value_text text,
  note text,
  source text not null default 'manual'
    check (source in ('manual','ai_estimated','integration','seed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_metric_obs_tracker_time
  on public.metric_observations(tracker_id, recorded_at desc);

-- ── 4. RLS ──

alter table public.metric_trackers enable row level security;
alter table public.metric_observations enable row level security;

drop policy if exists "metric_trackers_owner" on public.metric_trackers;
create policy "metric_trackers_owner" on public.metric_trackers
  for all using (auth.uid() = user_id);

drop policy if exists "metric_observations_owner" on public.metric_observations;
create policy "metric_observations_owner" on public.metric_observations
  for all using (
    tracker_id in (select id from public.metric_trackers where user_id = auth.uid())
  );

-- ── 5. updated_at trigger for metric_trackers ──

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

-- ── 6. Extend space_changelog with new change_types ──
-- The existing table already accepts arbitrary strings for change_type.
-- New values introduced by code: 'strategy_committed', 'twin_initialized'.
-- (No schema change needed.)
