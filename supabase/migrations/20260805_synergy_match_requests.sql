-- ── Synergy match requests (Phase 4c) ──
--
-- The request/accept handshake that bridges anonymous matches into
-- revealed collaborators. Two-way visibility:
--   - When status='pending': both from_user and to_user can read the
--     row. Profile reveal happens at this point — the receiver needs
--     to know who's reaching out to make an informed accept/decline.
--   - When status='accepted': both sides see each other indefinitely;
--     downstream Phase 4d creates a shared synergy_room on this row.
--   - When status='declined' / 'expired' / 'withdrawn': read-only
--     for both sides; no further state transitions.
--
-- Idempotent DDL — same pattern as 20260801/02/03/04.

create table if not exists public.match_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  from_component uuid not null references public.brainstorm_components(id) on delete cascade,
  to_component uuid not null references public.brainstorm_components(id) on delete cascade,
  message text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  -- One request per component-pair. Re-requesting after a decline
  -- requires deleting the prior row; we surface this as "request
  -- already exists" on the create endpoint.
  unique (from_component, to_component)
);

alter table public.match_requests
  drop constraint if exists match_requests_status_check;
alter table public.match_requests
  add constraint match_requests_status_check
  check (status in ('pending','accepted','declined','expired','withdrawn'));

alter table public.match_requests
  drop constraint if exists match_requests_message_len_check;
alter table public.match_requests
  add constraint match_requests_message_len_check
  check (message is null or char_length(message) <= 500);

alter table public.match_requests
  drop constraint if exists match_requests_not_self_check;
alter table public.match_requests
  add constraint match_requests_not_self_check
  check (from_user <> to_user);

create index if not exists match_requests_from_idx
  on public.match_requests(from_user, status, created_at desc);
create index if not exists match_requests_to_idx
  on public.match_requests(to_user, status, created_at desc);
create index if not exists match_requests_components_idx
  on public.match_requests(from_component, to_component);

-- ── RLS ──
--
-- Either party can read their own requests. INSERT: only as from_user.
-- UPDATE: from_user can transition pending → withdrawn; to_user can
-- transition pending → accepted/declined. Status enforcement happens
-- in the API layer (RLS just gates row access).

alter table public.match_requests enable row level security;

drop policy if exists "match_requests_read" on public.match_requests;
create policy "match_requests_read"
  on public.match_requests for select
  using (
    from_user = (select auth.uid())
    OR to_user = (select auth.uid())
  );

drop policy if exists "match_requests_insert_from_user" on public.match_requests;
create policy "match_requests_insert_from_user"
  on public.match_requests for insert
  with check (from_user = (select auth.uid()));

drop policy if exists "match_requests_update_either" on public.match_requests;
create policy "match_requests_update_either"
  on public.match_requests for update
  using (
    from_user = (select auth.uid())
    OR to_user = (select auth.uid())
  )
  with check (
    from_user = (select auth.uid())
    OR to_user = (select auth.uid())
  );

drop policy if exists "match_requests_delete_from_user" on public.match_requests;
create policy "match_requests_delete_from_user"
  on public.match_requests for delete
  using (from_user = (select auth.uid()));

-- ── responded_at maintenance ──
-- Stamp responded_at when status transitions out of pending.

create or replace function public.match_requests_stamp_responded()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    new.responded_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists match_requests_stamp_responded_trg on public.match_requests;
create trigger match_requests_stamp_responded_trg
before update on public.match_requests
for each row execute function public.match_requests_stamp_responded();

comment on table public.match_requests is
  'Synergy Phase 4c: connection requests between matched users. '
  'Profile reveal happens when a request lands (pending or accepted) '
  'so the receiver can make an informed accept/decline.';
