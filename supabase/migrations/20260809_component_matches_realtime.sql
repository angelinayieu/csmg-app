-- ── component_matches realtime publication (Phase 4d+3) ──
--
-- Adds component_matches to the supabase_realtime publication so
-- clients can subscribe to INSERT events and react when a fresh
-- match lands (without re-polling /api/synergy/matches).
--
-- Use case: User A publishes components. User B publishes
-- complementary components 3 days later → the matcher computes a
-- new component_matches row → A's open browser session receives
-- the postgres_changes INSERT event → A gets a toast + bell-badge
-- bump immediately.
--
-- Idempotent — adds to publication only if not already a member.
-- replica identity full so the payload carries enough context for
-- the client to render a row without a follow-up fetch.

alter table public.component_matches replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'component_matches'
  ) then
    alter publication supabase_realtime add table public.component_matches;
  end if;
end$$;

comment on table public.component_matches is
  'Synergy Phase 4: cached cross-user component-pair scores. Computed '
  'by the matcher endpoint (on-demand). Canonical ordering ensures one '
  'row per pair. Realtime-published so clients receive new-match '
  'arrivals without polling (Phase 4d+3).';
