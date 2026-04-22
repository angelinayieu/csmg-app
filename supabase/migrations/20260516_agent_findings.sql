-- Wave D — agent_findings table + intervention audit columns.
--
-- This closes three gaps:
--
--   1. agent_findings — a user-facing log of what agents discovered,
--      distinct from agent_runs (which is run metadata) and from
--      reasoning_results (which is raw agent output). Every agent write-
--      back path calls recordAgentFinding() so the user has a single
--      reviewable queue.
--
--   2. interventions.resolved_at / resolved_by / resolution_note —
--      audit columns for the Wave D L1 intervention lifecycle. The
--      existing completed_at column is reused; these three add the
--      missing "who resolved it, when, and why" lineage.
--
--   3. Realtime enabling for user_events + agent_findings + apps so
--      Wave D's Pulse module's useRealtime* hooks have publications
--      to subscribe to.

-- ──────────────────────────────────────────────────────────────────────
-- 1. agent_findings
-- ──────────────────────────────────────────────────────────────────────

create table if not exists public.agent_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Which agent produced this finding (nullable because some findings
  -- — e.g. surprise deviations — are produced by the predictions-resolve
  -- cron, not by a named agent).
  agent_id uuid references public.agents(id) on delete set null,
  agent_run_id uuid references public.agent_runs(id) on delete set null,

  space_id uuid references public.spaces(id) on delete set null,

  finding_kind text not null
    check (finding_kind in (
      'entity_discovered',
      'entity_refined',
      'objective_proposed',
      'bridge_suggested',
      'contradiction_found',
      'prediction_surprise',
      'pattern_detected',
      'risk_flagged'
    )),

  -- Polymorphic ref to the subject the finding is about.
  ref_kind text,
  ref_id uuid,

  summary text not null,
  rationale text,
  confidence numeric not null default 0.7
    check (confidence >= 0 and confidence <= 1),

  severity text check (severity is null or severity in ('info', 'notable', 'urgent')),

  status text not null default 'unread'
    check (status in ('unread', 'reviewed', 'acted_on', 'dismissed')),

  payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_agent_findings_user_created
  on public.agent_findings(user_id, created_at desc);
create index if not exists idx_agent_findings_user_unread
  on public.agent_findings(user_id)
  where status = 'unread';
create index if not exists idx_agent_findings_severity
  on public.agent_findings(user_id, severity, created_at desc)
  where severity in ('notable', 'urgent');
create index if not exists idx_agent_findings_space
  on public.agent_findings(space_id, created_at desc)
  where space_id is not null;
create index if not exists idx_agent_findings_kind_user
  on public.agent_findings(user_id, finding_kind, created_at desc);

-- Bump events_since_last_digest counter like user_events does, so the
-- Wave C digest cron also learns from agent-driven signals. Same
-- trigger pattern as the Wave C user_events insert trigger.
create or replace function public.tg_bump_profile_event_count_from_findings()
returns trigger language plpgsql security definer as $$
begin
  update public.profiles
    set events_since_last_digest = coalesce(events_since_last_digest, 0) + 1
    where id = new.user_id;
  return new;
end $$;

drop trigger if exists trg_bump_profile_event_count_from_findings on public.agent_findings;
create trigger trg_bump_profile_event_count_from_findings
  after insert on public.agent_findings
  for each row execute function public.tg_bump_profile_event_count_from_findings();

-- Mark resolved_at on status transition out of 'unread'.
create or replace function public.tg_touch_agent_finding_reviewed_at()
returns trigger language plpgsql as $$
begin
  if new.status <> 'unread'
     and (old.status = 'unread' or old.status is null)
     and new.reviewed_at is null then
    new.reviewed_at = now();
  end if;
  return new;
end $$;

drop trigger if exists trg_touch_agent_finding_reviewed_at on public.agent_findings;
create trigger trg_touch_agent_finding_reviewed_at
  before insert or update on public.agent_findings
  for each row execute function public.tg_touch_agent_finding_reviewed_at();

-- RLS
alter table public.agent_findings enable row level security;

drop policy if exists "owner_all_agent_findings" on public.agent_findings;
create policy "owner_all_agent_findings" on public.agent_findings
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────
-- 2. Intervention audit columns (Wave D L1)
-- ──────────────────────────────────────────────────────────────────────
-- completed_at already exists on interventions (20260428). Add the
-- lifecycle writer's "who / why" fields. The lifecycle writer currently
-- only touches completed_at for compatibility; these fields can be
-- populated once the writer is updated in a follow-up.

alter table public.interventions
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid
    references auth.users(id) on delete set null,
  add column if not exists resolution_note text;

create index if not exists idx_interventions_status_space
  on public.interventions(space_id, status);

-- ──────────────────────────────────────────────────────────────────────
-- 3. Realtime publication (for Wave D subscriber hooks)
-- ──────────────────────────────────────────────────────────────────────
-- Supabase exposes realtime via the supabase_realtime publication.
-- Add the tables the Pulse module subscribes to. Idempotent — ALTER
-- PUBLICATION ... ADD TABLE errors if the table is already in the set,
-- but we guard each with a DO block.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'agent_findings'
  ) then
    execute 'alter publication supabase_realtime add table public.agent_findings';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_events'
  ) then
    execute 'alter publication supabase_realtime add table public.user_events';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'apps'
  ) then
    execute 'alter publication supabase_realtime add table public.apps';
  end if;
end $$;

comment on table public.agent_findings is
  'User-facing log of notable agent discoveries. Written by '
  'recordAgentFinding (Wave D) from every agent write-back path. Read '
  'by the dashboard Pulse module + AgentActivityBell. Distinct from '
  'agent_runs (run metadata) and reasoning_results (raw agent output).';
