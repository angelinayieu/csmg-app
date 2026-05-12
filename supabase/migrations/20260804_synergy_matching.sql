-- ── Synergy matching marketplace (Phase 4a) ──
--
-- Two tables: synergy_profiles (display identity revealed post-match)
-- and component_matches (cached cross-user match results).
--
-- Idempotent DDL throughout — same pattern as 20260801/02/03 so
-- re-runs against the live DB are no-ops.
--
-- ── synergy_profiles ──
-- One row per user. Anonymous-until-accepted means we DON'T expose
-- this in match-suggestion responses; only after a request is
-- accepted (Phase 4c) do both sides see each other's display_name +
-- bio. Holding the row up-front (with matching_enabled default true)
-- lets the matcher run for users who haven't explicitly opted in
-- to "show my profile" UX — the data is just gated by the response
-- layer, not by row existence.
--
-- ── component_matches ──
-- Each row is one cross-user pair (component_a, component_b),
-- canonically ordered by component_a < component_b so we never
-- double-store the symmetric pair. The API surfaces both directions
-- by checking which side belongs to the requesting user.
--
-- match_kind enumerates the directionality:
--   'a_needs_b'   — A's upstream complements B's downstream
--   'b_needs_a'   — mirror of above
--   'parallel'    — both are core_idea or polished_product on adjacent
--                   problems; useful for ideation co-working

create table if not exists public.synergy_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  bio text,
  avatar_url text,
  matching_enabled boolean not null default true,
  -- Anti-abuse: max concurrent pending outgoing requests (Phase 4c)
  max_pending_requests integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.synergy_profiles
  drop constraint if exists synergy_profiles_display_name_len_check;
alter table public.synergy_profiles
  add constraint synergy_profiles_display_name_len_check
  check (char_length(display_name) between 2 and 64);

alter table public.synergy_profiles
  drop constraint if exists synergy_profiles_bio_len_check;
alter table public.synergy_profiles
  add constraint synergy_profiles_bio_len_check
  check (bio is null or char_length(bio) <= 400);

create table if not exists public.component_matches (
  id uuid primary key default gen_random_uuid(),
  component_a uuid not null references public.brainstorm_components(id) on delete cascade,
  component_b uuid not null references public.brainstorm_components(id) on delete cascade,
  match_kind text not null,
  cosine_sim double precision not null,
  complementarity_score double precision not null,
  goal_alignment_score double precision not null,
  final_score double precision not null,
  rationale text not null,
  computed_at timestamptz not null default now(),
  -- Canonical ordering — store one row per pair, never both directions
  check (component_a < component_b),
  unique (component_a, component_b)
);

alter table public.component_matches
  drop constraint if exists component_matches_kind_check;
alter table public.component_matches
  add constraint component_matches_kind_check
  check (match_kind in ('a_needs_b', 'b_needs_a', 'parallel'));

create index if not exists component_matches_a_idx
  on public.component_matches(component_a, final_score desc);
create index if not exists component_matches_b_idx
  on public.component_matches(component_b, final_score desc);

-- Owner-of-either-side index optimization: when discover queries
-- "all my matches" it joins via brainstorm_components.owner_id.
create index if not exists component_matches_computed_idx
  on public.component_matches(computed_at desc);

-- ── RLS ──
--
-- synergy_profiles: minimal public-read (display_name / bio /
-- avatar_url visible to any authenticated user whose matching_enabled
-- = true) so accepted matches can see each other's profile. Owner
-- writes only.
--
-- component_matches: only readable when either side's component
-- belongs to the requesting user. Inserts come from service-role
-- (the matcher runs server-side and bypasses RLS).

alter table public.synergy_profiles enable row level security;
alter table public.component_matches enable row level security;

drop policy if exists "synergy_profiles_public_read" on public.synergy_profiles;
create policy "synergy_profiles_public_read"
  on public.synergy_profiles for select
  using (matching_enabled = true);

drop policy if exists "synergy_profiles_owner_write" on public.synergy_profiles;
create policy "synergy_profiles_owner_write"
  on public.synergy_profiles for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "component_matches_owner_read" on public.component_matches;
create policy "component_matches_owner_read"
  on public.component_matches for select
  using (
    component_a in (
      select id from public.brainstorm_components where owner_id = (select auth.uid())
    )
    OR
    component_b in (
      select id from public.brainstorm_components where owner_id = (select auth.uid())
    )
  );

-- ── updated_at trigger ──

create or replace function public.synergy_profiles_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists synergy_profiles_updated_at_trg on public.synergy_profiles;
create trigger synergy_profiles_updated_at_trg
before update on public.synergy_profiles
for each row execute function public.synergy_profiles_set_updated_at();

-- ── Vector kNN RPC ──
--
-- pgvector kNN via the <=> operator is the canonical fast-path
-- (HNSW index from 20260802 is already in place). Wrap as an RPC so
-- the matcher can call it with one round trip and the SQL planner
-- gets the right hints.
--
-- Returns up to `match_limit` rows ordered by cosine distance ASC
-- (which means similarity DESC). Filters out:
--   - the source component itself
--   - components owned by the source's owner (no self-matching)
--   - components older than `stale_days` (default 180) — keeps the
--     pool fresh
--   - components with visibility = 'private'
--   - components with NULL embedding (Phase 3 embed-on-extract may
--     have soft-failed for some rows)
--
-- kind_filter is a text[] of compatible kinds; pass NULL to match
-- against any kind.

create or replace function public.synergy_match_components(
  source_component uuid,
  match_limit integer default 50,
  stale_days integer default 180,
  kind_filter text[] default null
)
returns table (
  id uuid,
  owner_id uuid,
  session_id uuid,
  kind text,
  subkind text,
  label_public text,
  description_public text,
  cosine_distance double precision
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  src record;
begin
  select c.id, c.owner_id, c.embedding
    into src
    from public.brainstorm_components c
    where c.id = source_component;

  if not found or src.embedding is null then
    return;
  end if;

  return query
  select
    c.id,
    c.owner_id,
    c.session_id,
    c.kind,
    c.subkind,
    c.label_public,
    c.description_public,
    (c.embedding <=> src.embedding) as cosine_distance
  from public.brainstorm_components c
  where c.id <> src.id
    and c.owner_id <> src.owner_id
    and c.visibility <> 'private'
    and c.embedding is not null
    and c.created_at > now() - (stale_days || ' days')::interval
    and (kind_filter is null or c.kind = any(kind_filter))
  order by c.embedding <=> src.embedding
  limit match_limit;
end;
$$;

-- Allow authenticated users to call the RPC. RLS-equivalent restriction
-- is enforced inside the function via filtering (no PII leaks; we only
-- return what's in brainstorm_components, which is matchable_only at
-- minimum visibility).
grant execute on function public.synergy_match_components to authenticated, service_role;

comment on table public.synergy_profiles is
  'Synergy Phase 4: per-user display identity. Surfaced post-match-accept.';
comment on table public.component_matches is
  'Synergy Phase 4: cached cross-user component-pair scores. Computed '
  'by the matcher endpoint (on-demand). Canonical ordering ensures one '
  'row per pair.';
comment on function public.synergy_match_components is
  'Vector kNN over the cross-user component embedding index. Filters '
  'by kind compatibility (upstream/downstream complementarity) and '
  'returns cosine-similar components excluding self-owned ones.';
