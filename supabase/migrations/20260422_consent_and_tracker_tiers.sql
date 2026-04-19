-- Phase 4a: User consent manifest + depth-tier/data-category columns on metric_trackers.
-- Foundational piece of the Unified Proxy Framework. Lets the strategy-confirm flow
-- filter out trackers whose data_category the user hasn't opted into.

-- ── 1. user_consent_manifest: one row per user ──

create table if not exists public.user_consent_manifest (
  user_id uuid primary key references auth.users(id) on delete cascade,
  consent_map jsonb not null default '{}'::jsonb,  -- { [DataCategory]: boolean }
  friction_budget integer not null default 5
    check (friction_budget between 1 and 10),
  escalation_policy text not null default 'ask_each_time'
    check (escalation_policy in ('ask_each_time','auto_if_value_above_x','never_escalate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at trigger
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

-- RLS
alter table public.user_consent_manifest enable row level security;

drop policy if exists "consent_owner" on public.user_consent_manifest;
create policy "consent_owner" on public.user_consent_manifest
  for all using (auth.uid() = user_id);

-- ── 2. Extend metric_trackers with classification columns ──

alter table public.metric_trackers
  add column if not exists depth_tier text
    check (depth_tier is null or depth_tier in ('light','mid','heavy'));

alter table public.metric_trackers
  add column if not exists friction_cost integer
    check (friction_cost is null or friction_cost between 1 and 10);

alter table public.metric_trackers
  add column if not exists data_category text;
