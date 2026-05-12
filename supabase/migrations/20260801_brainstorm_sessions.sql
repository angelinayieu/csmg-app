-- ── Brainstorm sessions (Synergy track, Phase 1) ──
--
-- Lightweight surface for voice-augmented solo brainstorming,
-- deliberately decoupled from the Space/Twin/Strategy machinery
-- (spaces, entities, edges). One owner, flat node list with parent
-- pointers, free-form ink strokes.
--
-- ── Idempotency note ──
-- These tables were originally applied to live Supabase outside the
-- migrations table (list_migrations returned []) so the very first
-- `supabase db push` errored on duplicate table. This file is now
-- written as fully idempotent DDL — every CREATE uses IF NOT EXISTS
-- and every constraint/policy uses DROP IF EXISTS + CREATE so it
-- can run cleanly against:
--   - A fresh environment (creates everything)
--   - The current production DB (no-ops; result is identical)
--   - Any re-run (still no-ops)
--
-- Phase 1 (this migration): solo whiteboard only — session + nodes +
-- strokes. Phase 3 will add `brainstorm_components` (typed extraction
-- output) and Phase 4 will add `component_matches`, `match_requests`,
-- and `synergy_rooms` for the cross-user matching marketplace.
--
-- The `objective_*` columns on brainstorm_sessions are populated by
-- the Phase 3 processing screen (AI infers what the user is actually
-- chasing, then offers editable constraints + success_criteria). They
-- are nullable in Phase 1 — a fresh session has no inferred objective.

-- ── Tables ──

create table if not exists public.brainstorm_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled brainstorm',
  objective_statement text,
  objective_constraints text[] not null default '{}',
  objective_success_criteria text[] not null default '{}',
  objective_detected_at timestamptz,
  state text not null default 'drafting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rebuild the state check so the allowed values stay authoritative even
-- if a prior version of this migration didn't include the constraint.
alter table public.brainstorm_sessions
  drop constraint if exists brainstorm_sessions_state_check;
alter table public.brainstorm_sessions
  add constraint brainstorm_sessions_state_check
  check (state in ('drafting','processed','published','archived'));

-- Node kinds mirror the idea-synthesizer schema:
--   core / branch / insight / question / action / user / variation / ranking
create table if not exists public.brainstorm_nodes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.brainstorm_sessions(id) on delete cascade,
  parent_id uuid references public.brainstorm_nodes(id) on delete set null,
  kind text not null,
  label text not null,
  meta text,
  x double precision not null,
  y double precision not null,
  created_at timestamptz not null default now()
);

alter table public.brainstorm_nodes
  drop constraint if exists brainstorm_nodes_kind_check;
alter table public.brainstorm_nodes
  add constraint brainstorm_nodes_kind_check
  check (kind in ('core','branch','insight','question','action','user','variation','ranking'));

-- Pen strokes: world-coord polylines. Stored as jsonb array of [x,y]
-- pairs so the canvas can render with a single fetch. No editing
-- after creation; the eraser tool deletes whole strokes.
create table if not exists public.brainstorm_strokes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.brainstorm_sessions(id) on delete cascade,
  points jsonb not null,
  color text not null default '#7dd3fc',
  created_at timestamptz not null default now()
);

-- ── Indexes ──

create index if not exists brainstorm_sessions_owner_idx
  on public.brainstorm_sessions(owner_id, updated_at desc);

create index if not exists brainstorm_nodes_session_idx
  on public.brainstorm_nodes(session_id);
create index if not exists brainstorm_nodes_parent_idx
  on public.brainstorm_nodes(parent_id);

create index if not exists brainstorm_strokes_session_idx
  on public.brainstorm_strokes(session_id);

-- ── RLS ──
--
-- Owner-only across all three tables. Cross-user access lands in
-- Phase 4 via synergy_rooms. `alter table ... enable row level
-- security` is idempotent in Postgres (no-op if already enabled).

alter table public.brainstorm_sessions enable row level security;
alter table public.brainstorm_nodes enable row level security;
alter table public.brainstorm_strokes enable row level security;

drop policy if exists "brainstorm_sessions_owner_all" on public.brainstorm_sessions;
create policy "brainstorm_sessions_owner_all"
  on public.brainstorm_sessions for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "brainstorm_nodes_owner_all" on public.brainstorm_nodes;
create policy "brainstorm_nodes_owner_all"
  on public.brainstorm_nodes for all
  using (session_id in (
    select id from public.brainstorm_sessions where owner_id = (select auth.uid())
  ))
  with check (session_id in (
    select id from public.brainstorm_sessions where owner_id = (select auth.uid())
  ));

drop policy if exists "brainstorm_strokes_owner_all" on public.brainstorm_strokes;
create policy "brainstorm_strokes_owner_all"
  on public.brainstorm_strokes for all
  using (session_id in (
    select id from public.brainstorm_sessions where owner_id = (select auth.uid())
  ))
  with check (session_id in (
    select id from public.brainstorm_sessions where owner_id = (select auth.uid())
  ));

-- ── Triggers ──
--
-- `create or replace function` is naturally idempotent. Triggers use
-- DROP IF EXISTS + CREATE so re-runs don't pile up duplicates.

-- `set search_path = ''` pins identifier resolution at definition time
-- so the function is immune to schema-shadowing attacks. Identifiers
-- inside the body must be fully qualified (we already qualify
-- `public.brainstorm_*` everywhere). Satisfies the
-- `function_search_path_mutable` advisor.
create or replace function public.brainstorm_sessions_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists brainstorm_sessions_updated_at_trg on public.brainstorm_sessions;
create trigger brainstorm_sessions_updated_at_trg
before update on public.brainstorm_sessions
for each row execute function public.brainstorm_sessions_set_updated_at();

-- Bump session.updated_at when nodes/strokes change too, so "recently
-- worked on" surfaces the correct top-of-list session even when only
-- the canvas (not the title) changed.
create or replace function public.brainstorm_touch_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sid uuid;
begin
  sid := coalesce(new.session_id, old.session_id);
  update public.brainstorm_sessions set updated_at = now() where id = sid;
  return coalesce(new, old);
end;
$$;

drop trigger if exists brainstorm_nodes_touch_session_trg on public.brainstorm_nodes;
create trigger brainstorm_nodes_touch_session_trg
after insert or update or delete on public.brainstorm_nodes
for each row execute function public.brainstorm_touch_session();

drop trigger if exists brainstorm_strokes_touch_session_trg on public.brainstorm_strokes;
create trigger brainstorm_strokes_touch_session_trg
after insert or update or delete on public.brainstorm_strokes
for each row execute function public.brainstorm_touch_session();

comment on table public.brainstorm_sessions is
  'Synergy track Phase 1: solo voice-augmented brainstorm sessions. '
  'Decoupled from spaces — promotion path lands in Phase 3.';
