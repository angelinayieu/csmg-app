-- ── Synergy shared rooms (Phase 4d) ──
--
-- The post-accept co-creation canvas. One synergy_rooms row per
-- accepted match_request; the two users co-edit synergy_room_nodes
-- with author attribution. Realtime sync via postgres_changes on
-- the room_nodes table.
--
-- Idempotent DDL — same pattern as the prior synergy migrations.

create table if not exists public.synergy_rooms (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  component_a uuid not null references public.brainstorm_components(id) on delete cascade,
  component_b uuid not null references public.brainstorm_components(id) on delete cascade,
  match_request_id uuid references public.match_requests(id) on delete set null,
  -- AI-inferred "what are we collaborating on together" — populated
  -- lazily on first room load (Phase 4d+1; for now stays null until
  -- the inference endpoint lands).
  intersection_objective text,
  -- Either user can archive the room (signals "we're done"). When
  -- archived_at is set, the room is read-only.
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Canonical user ordering — prevents duplicate-room creation when
  -- both users hold pending requests to each other. A constraint of
  -- user_a < user_b would also work but adds dependency on uuid
  -- ordering at insert time. We instead canonicalize in the API.
  unique (component_a, component_b)
);

alter table public.synergy_rooms
  drop constraint if exists synergy_rooms_not_self_check;
alter table public.synergy_rooms
  add constraint synergy_rooms_not_self_check
  check (user_a <> user_b);

create index if not exists synergy_rooms_user_a_idx
  on public.synergy_rooms(user_a, archived_at);
create index if not exists synergy_rooms_user_b_idx
  on public.synergy_rooms(user_b, archived_at);

-- ── Room nodes ──
-- Per-node CRUD with author_id stamped. Realtime postgres_changes
-- fires on every insert/update/delete; both members' clients
-- subscribe to the channel filtered by room_id.

create table if not exists public.synergy_room_nodes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.synergy_rooms(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  parent_id uuid references public.synergy_room_nodes(id) on delete set null,
  kind text not null,
  label text not null,
  meta text,
  x double precision not null,
  y double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.synergy_room_nodes
  drop constraint if exists synergy_room_nodes_kind_check;
alter table public.synergy_room_nodes
  add constraint synergy_room_nodes_kind_check
  check (kind in (
    'core','branch','insight','question','action',
    'variation','ranking','plan','synergy','anchor'
  ));

create index if not exists synergy_room_nodes_room_idx
  on public.synergy_room_nodes(room_id);
create index if not exists synergy_room_nodes_author_idx
  on public.synergy_room_nodes(author_id);

-- ── RLS ──
--
-- Both members can read; both can insert (with their own author_id);
-- both can update + delete any node in their room (full mutual edit
-- access matches the collab UX).
--
-- Cross-member edits intentionally allowed — co-creation requires
-- low-friction "yes, I can move your sticky" affordances.

alter table public.synergy_rooms enable row level security;
alter table public.synergy_room_nodes enable row level security;

drop policy if exists "synergy_rooms_members_read" on public.synergy_rooms;
create policy "synergy_rooms_members_read"
  on public.synergy_rooms for select
  using (user_a = (select auth.uid()) OR user_b = (select auth.uid()));

drop policy if exists "synergy_rooms_members_update" on public.synergy_rooms;
create policy "synergy_rooms_members_update"
  on public.synergy_rooms for update
  using (user_a = (select auth.uid()) OR user_b = (select auth.uid()))
  with check (user_a = (select auth.uid()) OR user_b = (select auth.uid()));

drop policy if exists "synergy_room_nodes_members_all" on public.synergy_room_nodes;
create policy "synergy_room_nodes_members_all"
  on public.synergy_room_nodes for all
  using (room_id in (
    select id from public.synergy_rooms
    where user_a = (select auth.uid()) OR user_b = (select auth.uid())
  ))
  with check (room_id in (
    select id from public.synergy_rooms
    where user_a = (select auth.uid()) OR user_b = (select auth.uid())
  ));

-- ── updated_at trigger ──

create or replace function public.synergy_room_nodes_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists synergy_room_nodes_updated_at_trg on public.synergy_room_nodes;
create trigger synergy_room_nodes_updated_at_trg
before update on public.synergy_room_nodes
for each row execute function public.synergy_room_nodes_set_updated_at();

-- ── Realtime publication ──
--
-- Supabase Realtime listens to the `supabase_realtime` publication.
-- For postgres_changes events to fire on synergy_room_nodes, the
-- table must be in the publication AND have `replica identity full`
-- (so DELETE payloads include the row contents for UI cleanup).
-- Both are idempotent operations.

alter table public.synergy_room_nodes replica identity full;

do $$
begin
  -- Add to publication only if not already a member. ALTER PUBLICATION
  -- ... ADD TABLE is not idempotent in older Postgres, so we guard it.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'synergy_room_nodes'
  ) then
    alter publication supabase_realtime add table public.synergy_room_nodes;
  end if;
end$$;

comment on table public.synergy_rooms is
  'Synergy Phase 4d: post-accept co-edit room. One per accepted match_request.';
comment on table public.synergy_room_nodes is
  'Synergy Phase 4d: co-edit nodes inside a room. Author-tagged, realtime-published.';
