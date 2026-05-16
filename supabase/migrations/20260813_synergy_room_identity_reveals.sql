-- ── Synergy Phase 5c — Identity reveal handshake ──
--
-- Parallel-path rooms preserve anonymity until BOTH users explicitly
-- opt in. This table records each user's individual reveal action.
-- The client treats `displayName + avatarUrl` as accessible only when
-- BOTH (room_id, user_a) AND (room_id, user_b) rows exist here.
--
-- One row per (room, user). Unilateral reveal is the user's own
-- consent; the OTHER side seeing it requires their own row too.
--
-- A row may be deleted within 24h of insertion as an undo affordance
-- (enforced via RLS WITH CHECK on UPDATE/DELETE). After 24h the reveal
-- is permanent for that room.
--
-- This migration is additive and isolated — no existing tables are
-- altered. Safe to apply independently of Phase 5b.

create table if not exists public.synergy_room_identity_reveals (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null
    references public.synergy_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  revealed_at timestamptz not null default now(),
  -- One reveal per (room, user). Subsequent calls are no-ops at the
  -- API layer (idempotent POST) — the unique constraint is the
  -- backstop.
  unique (room_id, user_id)
);

create index if not exists synergy_room_identity_reveals_room_idx
  on public.synergy_room_identity_reveals(room_id);

comment on table public.synergy_room_identity_reveals is
  'Synergy Phase 5c: per-user identity-reveal records inside a '
  'parallel-path room. Reveal is mutual — both members must have a row '
  'here for the client to expose display_name/avatar_url.';

-- ── RLS ──

alter table public.synergy_room_identity_reveals enable row level security;

-- Members of the room can read both sides' reveal state.
drop policy if exists synergy_room_identity_reveals_members_read
  on public.synergy_room_identity_reveals;
create policy synergy_room_identity_reveals_members_read
  on public.synergy_room_identity_reveals for select
  using (
    exists (
      select 1
      from public.synergy_rooms r
      where r.id = synergy_room_identity_reveals.room_id
        and (r.user_a = (select auth.uid()) or r.user_b = (select auth.uid()))
    )
  );

-- A user can record their OWN reveal in a room they're a member of.
drop policy if exists synergy_room_identity_reveals_own_insert
  on public.synergy_room_identity_reveals;
create policy synergy_room_identity_reveals_own_insert
  on public.synergy_room_identity_reveals for insert
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.synergy_rooms r
      where r.id = synergy_room_identity_reveals.room_id
        and r.room_kind = 'parallel_path'
        and (r.user_a = (select auth.uid()) or r.user_b = (select auth.uid()))
    )
  );

-- 24-hour undo window — user can delete their OWN reveal record.
drop policy if exists synergy_room_identity_reveals_own_undo
  on public.synergy_room_identity_reveals;
create policy synergy_room_identity_reveals_own_undo
  on public.synergy_room_identity_reveals for delete
  using (
    user_id = (select auth.uid())
    and now() - revealed_at < interval '24 hours'
  );
