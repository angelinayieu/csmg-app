-- ── Synergy Phase 5c-3 — synergy_room_identity_reveals realtime ──
--
-- Add the reveals table to the supabase_realtime publication so both
-- members' clients receive a CDC event when either side reveals (or
-- withdraws within the 24h window). The client uses these events to
-- swap the anonymous abstract-avatar for the partner's real avatar +
-- display_name without a page refresh, once mutual reveal is achieved.
--
-- Mirrors the C-2 setup for plan_step_checkins (20260814) and the
-- existing pattern in 20260806 for synergy_room_nodes.

alter table public.synergy_room_identity_reveals replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'synergy_room_identity_reveals'
  ) then
    alter publication supabase_realtime
      add table public.synergy_room_identity_reveals;
  end if;
end$$;
