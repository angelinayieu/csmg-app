-- ── Collaborative whiteboards: sharing + membership ──────────────────
--
-- Lets a space owner share an objective whiteboard by email. Invitees
-- sign in/up to accept, which creates a space_members row. Membership
-- grants read (viewer) or read+write (editor) access to the board, and
-- — via the realtime.messages policy below — the right to join the
-- private `board:{spaceId}` Supabase Realtime channel for live
-- multiplayer (presence cursors + shape deltas).
--
-- Reads/writes from app code mostly go through the SERVICE ROLE client
-- (which bypasses RLS) after an explicit verifySpaceAccess() check, but
-- we still ship tight RLS as defense-in-depth and to back the realtime
-- authorization policy.

-- ── space_members ──
create table if not exists public.space_members (
  space_id   uuid not null references public.spaces(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'viewer' check (role in ('editor', 'viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create index if not exists space_members_user_id_idx on public.space_members (user_id);

-- ── space_invites ──
create table if not exists public.space_invites (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references public.spaces(id) on delete cascade,
  invitee_email text not null,
  role          text not null default 'viewer' check (role in ('editor', 'viewer')),
  token         text not null unique,
  invited_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  expires_at    timestamptz not null default (now() + interval '7 days')
);

create index if not exists space_invites_space_id_idx on public.space_invites (space_id);
create index if not exists space_invites_email_idx on public.space_invites (lower(invitee_email));

-- ── Access helper (SECURITY DEFINER so it can read the tables free of
-- RLS, and so it never recurses into space_members' own policy). ──
create or replace function public.has_space_access(p_space_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.spaces s
    where s.id = p_space_id and s.user_id = p_user_id
  ) or exists (
    select 1 from public.space_members m
    where m.space_id = p_space_id and m.user_id = p_user_id
  );
$$;

-- Safe topic→access check for the realtime policy. Returns false for any
-- topic that isn't a well-formed `board:<uuid>` (the cast is guarded so a
-- malformed topic can never raise inside the RLS evaluation).
create or replace function public.can_access_board_topic(p_topic text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  sid uuid;
begin
  if p_topic !~ '^board:' then
    return false;
  end if;
  begin
    sid := substring(p_topic from 7)::uuid;
  exception when others then
    return false;
  end;
  return public.has_space_access(sid, auth.uid());
end;
$$;

-- ── RLS: space_members ──
alter table public.space_members enable row level security;

drop policy if exists "space members readable by participants" on public.space_members;
create policy "space members readable by participants"
  on public.space_members for select to authenticated
  using (public.has_space_access(space_id, auth.uid()));

-- A member may remove themselves (leave). Owners revoke via the service
-- role client, so no broad delete policy for authenticated users.
drop policy if exists "members can leave" on public.space_members;
create policy "members can leave"
  on public.space_members for delete to authenticated
  using (user_id = auth.uid());

-- ── RLS: space_invites (owner-only visibility) ──
alter table public.space_invites enable row level security;

drop policy if exists "invites readable by space owner" on public.space_invites;
create policy "invites readable by space owner"
  on public.space_invites for select to authenticated
  using (
    exists (
      select 1 from public.spaces s
      where s.id = space_invites.space_id and s.user_id = auth.uid()
    )
  );

-- ── Realtime authorization for the private board channel ──
-- Only owners/members of the space may SELECT (receive) or INSERT (send)
-- broadcast + presence messages on `board:{spaceId}`. Scoped to board:%
-- topics so it never affects other channels.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'realtime' and table_name = 'messages'
  ) then
    execute 'drop policy if exists "board topic read" on realtime.messages';
    execute $p$
      create policy "board topic read"
        on realtime.messages for select to authenticated
        using (public.can_access_board_topic((select realtime.topic())))
    $p$;

    execute 'drop policy if exists "board topic write" on realtime.messages';
    execute $p$
      create policy "board topic write"
        on realtime.messages for insert to authenticated
        with check (public.can_access_board_topic((select realtime.topic())))
    $p$;
  end if;
end $$;
