-- ── Synergy room events (Phase 5 R2 — author history + timeline rail) ──
--
-- Append-only event log keyed by room_id. Each row is one human or
-- AI action attributable to a user (actor_id). The room's Timeline
-- rail reads from this table chronologically and live-updates via
-- Realtime postgres_changes.
--
-- We did NOT add this table when we shipped synergy_room_nodes in
-- 20260806 because we hadn't decided whether to derive timeline from
-- current state vs. log it explicitly. R2 commits to explicit logs:
-- edits and deletions are material context for collaboration, and
-- you can't reconstruct them from the current node state.
--
-- Idempotent DDL throughout — same `IF NOT EXISTS` / `DROP IF EXISTS`
-- pattern as 20260806_synergy_rooms.sql.

create table if not exists public.synergy_room_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.synergy_rooms(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  -- The event verb. Kept tight for now — additions can be made
  -- additively without breaking the rail (unknown kinds render as
  -- the generic "did something" line).
  kind text not null,
  -- Optional pointer to the affected node. NULL for free-form notes
  -- or for events whose target was subsequently deleted.
  target_node_id uuid,
  -- Short human-readable description (≤500 chars) — drives the rail
  -- row primary text. We compose this server-side at write time so
  -- the client doesn't need to re-derive on every render.
  summary text not null,
  -- Kind-specific extras (e.g. {"old_label": "...", "new_label": "..."}
  -- on a node_edited event). Schema is non-strict on purpose so we
  -- can iterate without migrations.
  payload jsonb,
  created_at timestamptz not null default now()
);

-- Tight kind constraint — drop+recreate so this migration is
-- idempotent against re-runs that may want to extend the list later.
alter table public.synergy_room_events
  drop constraint if exists synergy_room_events_kind_check;
alter table public.synergy_room_events
  add constraint synergy_room_events_kind_check
  check (kind in (
    'node_added',
    'node_edited',
    'node_moved',
    'node_deleted',
    'node_linked',
    'note'
  ));

alter table public.synergy_room_events
  drop constraint if exists synergy_room_events_summary_len_check;
alter table public.synergy_room_events
  add constraint synergy_room_events_summary_len_check
  check (char_length(summary) between 1 and 500);

create index if not exists synergy_room_events_room_idx
  on public.synergy_room_events(room_id, created_at desc);

create index if not exists synergy_room_events_target_idx
  on public.synergy_room_events(target_node_id)
  where target_node_id is not null;

-- ── Realtime ──
-- Surface this table on the Realtime publication so the room client
-- can subscribe to live event inserts.
alter publication supabase_realtime add table public.synergy_room_events;

-- ── RLS ──
-- Both room members can read every event in their room. Inserts must
-- (a) come from an authenticated user who is a member of the room,
-- and (b) stamp actor_id with their own auth.uid().

alter table public.synergy_room_events enable row level security;

drop policy if exists synergy_room_events_read on public.synergy_room_events;
create policy synergy_room_events_read on public.synergy_room_events
  for select
  using (
    room_id in (
      select id from public.synergy_rooms
      where user_a = (select auth.uid())
         or user_b = (select auth.uid())
    )
  );

drop policy if exists synergy_room_events_insert on public.synergy_room_events;
create policy synergy_room_events_insert on public.synergy_room_events
  for insert
  with check (
    actor_id = (select auth.uid())
    and room_id in (
      select id from public.synergy_rooms
      where user_a = (select auth.uid())
         or user_b = (select auth.uid())
    )
  );

-- No update or delete policies — events are append-only. Cascades from
-- the parent synergy_rooms.id delete clean everything up.

comment on table public.synergy_room_events is
  'Append-only collab event log per synergy room. Drives the Timeline rail '
  'in /app/synergy/room/[id]. Inserted server-side from the room node '
  'API routes after each successful CRUD operation.';
