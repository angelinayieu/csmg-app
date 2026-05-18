-- ── Twin Detail Page realtime channels ──────────────────────────
--
-- Phase 2 W3 — the Twin Detail Page subscribes to postgres_changes
-- on the tables below so the page refreshes the moment a mutation
-- lands (mechanism status change, prediction insert/resolve, pain
-- metric update, twin proposal status flip, observation insert).
--
-- The check + execute pattern matches existing migrations
-- (agent_findings, pipeline_run_events). Idempotent so re-runs in
-- partial-deploy environments don't blow up.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mechanisms'
  ) then
    execute 'alter publication supabase_realtime add table public.mechanisms';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'prediction_ledger'
  ) then
    execute 'alter publication supabase_realtime add table public.prediction_ledger';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pain_metrics'
  ) then
    execute 'alter publication supabase_realtime add table public.pain_metrics';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'twin_proposals'
  ) then
    execute 'alter publication supabase_realtime add table public.twin_proposals';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'observations'
  ) then
    execute 'alter publication supabase_realtime add table public.observations';
  end if;
end $$;
