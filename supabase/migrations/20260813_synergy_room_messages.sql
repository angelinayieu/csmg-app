-- ── Synergy room messages (Phase 5 R3 — chat thread in the room) ──
--
-- Append-only chat per synergy_rooms row. Both members can read; either
-- can insert their own messages. Messages are distinct from
-- synergy_room_events (which describe canvas mutations) — they capture
-- the meta-conversation around the canvas, including voice transcripts
-- and (later) AI-generated summaries.
--
-- Idempotent DDL throughout — same pattern as the prior synergy
-- migrations.

create table if not exists public.synergy_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.synergy_rooms(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  -- Message kind. Kept tight; extensions land additively.
  kind text not null,
  -- The visible message text. Voice transcripts and AI summaries also
  -- store their primary content here so the renderer has one path.
  body text not null,
  -- Kind-specific extras (e.g. voice confidence, source AI run id, etc.)
  meta jsonb,
  created_at timestamptz not null default now()
);

alter table public.synergy_room_messages
  drop constraint if exists synergy_room_messages_kind_check;
alter table public.synergy_room_messages
  add constraint synergy_room_messages_kind_check
  check (kind in ('text', 'voice_transcript', 'ai_summary'));

alter table public.synergy_room_messages
  drop constraint if exists synergy_room_messages_body_len_check;
alter table public.synergy_room_messages
  add constraint synergy_room_messages_body_len_check
  check (char_length(body) between 1 and 4000);

create index if not exists synergy_room_messages_room_idx
  on public.synergy_room_messages(room_id, created_at desc);

-- ── Realtime ──
alter publication supabase_realtime add table public.synergy_room_messages;

-- ── RLS ──
-- Both room members read; either inserts their own.

alter table public.synergy_room_messages enable row level security;

drop policy if exists synergy_room_messages_read on public.synergy_room_messages;
create policy synergy_room_messages_read on public.synergy_room_messages
  for select
  using (
    room_id in (
      select id from public.synergy_rooms
      where user_a = (select auth.uid())
         or user_b = (select auth.uid())
    )
  );

drop policy if exists synergy_room_messages_insert on public.synergy_room_messages;
create policy synergy_room_messages_insert on public.synergy_room_messages
  for insert
  with check (
    author_id = (select auth.uid())
    and room_id in (
      select id from public.synergy_rooms
      where user_a = (select auth.uid())
         or user_b = (select auth.uid())
    )
  );

-- No update / delete policies in v1 — chat is append-only. We can add
-- soft-delete later without breaking the renderer.

comment on table public.synergy_room_messages is
  'Chat thread per synergy room. Separate from synergy_room_events. '
  'Carries text, voice transcripts, and (R5+) AI summaries.';
