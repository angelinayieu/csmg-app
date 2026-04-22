-- Rigor-first intake core
-- Adds minimal tables for pre-synthesis rigor gate and ranked experiment specs.

create table if not exists public.rigor_runs (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tier text not null default 'comprehensive',
  status text not null default 'completed'
    check (status in ('queued', 'running', 'completed', 'failed')),
  rigor_score numeric
    check (rigor_score is null or (rigor_score >= 0 and rigor_score <= 1)),
  landscape_coverage jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  notes text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rigor_runs_space_created
  on public.rigor_runs(space_id, created_at desc);

create index if not exists idx_rigor_runs_user_created
  on public.rigor_runs(user_id, created_at desc);

create table if not exists public.experiment_specs (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  rigor_run_id uuid references public.rigor_runs(id) on delete set null,
  hypothesis_claim_id uuid references public.claims(id) on delete set null,
  title text not null,
  method text not null,
  required_tools jsonb not null default '[]'::jsonb,
  predicted_effect jsonb not null default '{}'::jsonb,
  rank_score numeric
    check (rank_score is null or (rank_score >= 0 and rank_score <= 1)),
  approval_status text not null default 'proposed'
    check (approval_status in ('proposed', 'approved', 'deferred', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_experiment_specs_space_rank
  on public.experiment_specs(space_id, approval_status, rank_score desc nulls last);

create index if not exists idx_experiment_specs_run
  on public.experiment_specs(rigor_run_id);

alter table public.rigor_runs enable row level security;
alter table public.experiment_specs enable row level security;

drop policy if exists "rigor_runs_owner_all" on public.rigor_runs;
create policy "rigor_runs_owner_all" on public.rigor_runs
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "experiment_specs_owner_all" on public.experiment_specs;
create policy "experiment_specs_owner_all" on public.experiment_specs
for all
using (
  space_id in (select id from public.spaces where user_id = auth.uid())
)
with check (
  space_id in (select id from public.spaces where user_id = auth.uid())
);
