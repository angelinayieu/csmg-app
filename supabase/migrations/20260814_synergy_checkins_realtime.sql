-- ── Synergy Phase 5c-2 — plan_step_checkins realtime ──
--
-- Add plan_step_checkins to the supabase_realtime publication so the
-- parallel-room client receives postgres CDC events when either
-- member checks off, edits, or undoes a check-in. Mirrors the
-- existing synergy_room_nodes realtime setup from 20260806.
--
-- Two parts:
--   1. replica identity full  — so UPDATE / DELETE events include
--      the old row's full payload (the client matches by id which
--      lives in the old row on DELETE)
--   2. add table to publication — idempotent (guarded by a
--      pg_publication_tables check)

alter table public.plan_step_checkins replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'plan_step_checkins'
  ) then
    alter publication supabase_realtime add table public.plan_step_checkins;
  end if;
end$$;
