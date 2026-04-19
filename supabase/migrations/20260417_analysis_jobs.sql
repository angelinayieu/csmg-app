-- Inngest migration: analysis job graph
-- One analysis_jobs row per user submission.
-- job_events rows stream progress updates to the client via Supabase Realtime.

-- ── analysis_jobs ──
create table if not exists analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid references spaces(id) on delete set null,
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

create index if not exists idx_analysis_jobs_user on analysis_jobs(user_id, created_at desc);
create index if not exists idx_analysis_jobs_space on analysis_jobs(space_id);
create index if not exists idx_analysis_jobs_status on analysis_jobs(status, created_at desc);

-- ── job_events ──
create table if not exists job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references analysis_jobs(id) on delete cascade,
  event_type text not null,
  artifact_kind text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_events_job_created on job_events(job_id, created_at);

-- ── RLS ──
alter table analysis_jobs enable row level security;
alter table job_events enable row level security;

drop policy if exists "analysis_jobs_select_own" on analysis_jobs;
create policy "analysis_jobs_select_own" on analysis_jobs
  for select using (user_id = auth.uid());

drop policy if exists "job_events_select_own" on job_events;
create policy "job_events_select_own" on job_events
  for select using (
    job_id in (select id from analysis_jobs where user_id = auth.uid())
  );

-- Service role bypasses RLS automatically; no insert policies needed for the Inngest writer.

-- ── Realtime publication ──
-- Enable Realtime push notifications for these tables so the client can subscribe to live updates.
-- If the tables are already present in the publication, "add table" raises — so we guard it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'job_events'
  ) then
    execute 'alter publication supabase_realtime add table job_events';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'analysis_jobs'
  ) then
    execute 'alter publication supabase_realtime add table analysis_jobs';
  end if;
end $$;
