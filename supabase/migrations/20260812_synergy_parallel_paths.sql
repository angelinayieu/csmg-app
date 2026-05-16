-- ── Synergy Phase 5 — Parallel-Path Rooms (Phase 5a: data + matcher) ──
--
-- Adds a SECOND axis of matching to the Synergy track. Today the matcher
-- finds COMPLEMENTARY fits between brainstorm_components (peg-in-hole:
-- your upstream need ↔ their downstream output). This migration adds
-- PARALLEL fits between whole synergy_strategies (convergent goal,
-- possibly divergent routine — peer / accountability fit).
--
-- Conceptual model:
--   - synergy_strategies.embedding    — 1536-dim vector over
--       statement + pitch + each plan_step block's title/body
--   - strategy_matches                — cached cross-user pair scores
--   - parallel_path_requests          — invitations to form a room
--   - synergy_rooms.room_kind         — 'collaboration' | 'parallel_path'
--   - plan_step_checkins              — per-user, per-step completion +
--       reflection note (read-only for the other member)
--   - room_digests                    — weekly aggregate written by cron
--
-- All additive. No existing data is touched. Idempotent (CREATE IF NOT
-- EXISTS / DROP CONSTRAINT IF EXISTS / etc.). RLS uses the
-- (select auth.uid()) subquery form to match existing policies.
--
-- Indexing: ivfflat with (lists = 100) — mirrors brainstorm_components.
-- HNSW would be marginally faster at high cardinality but the existing
-- index choice is what the matcher infrastructure already expects, and
-- strategy counts will be O(sessions) which is smaller than component
-- counts.

-- ── 1. Strategy-level embedding column ──

alter table public.synergy_strategies
  add column if not exists embedding vector(1536);
alter table public.synergy_strategies
  add column if not exists matchable boolean not null default true;
alter table public.synergy_strategies
  add column if not exists last_embedded_at timestamptz;

create index if not exists synergy_strategies_embedding_idx
  on public.synergy_strategies
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

comment on column public.synergy_strategies.embedding is
  'text-embedding-3-small over statement + pitch + plan_step blocks. '
  'Used for parallel-path matching. NULL until the matcher embed pass '
  'has run.';
comment on column public.synergy_strategies.matchable is
  'Owner opt-out switch. False = excluded from cross-user strategy '
  'matching, even if the strategy is otherwise published.';

-- ── 2. strategy_matches — cached cross-user pair scores ──

create table if not exists public.strategy_matches (
  id uuid primary key default gen_random_uuid(),
  strategy_a uuid not null
    references public.synergy_strategies(id) on delete cascade,
  strategy_b uuid not null
    references public.synergy_strategies(id) on delete cascade,
  -- Pass 1 raw vector similarity (0-1).
  cosine_sim real not null,
  -- Pass 2 LLM judgment (0-100). >= 60 means we persisted.
  rerank_score int not null,
  -- One short noun phrase naming what the two strategies share at the
  -- GOAL level (e.g. "Daily cognitive-modeling research routines").
  shared_theme text not null,
  -- 1-3 short noun phrases naming the GOAL-LEVEL overlap. These are the
  -- chips that render in the parallel-path room header.
  shared_pillars text[] not null default '{}',
  -- One sentence on how the two strategies DIVERGE in execution
  -- (different routines reaching the same goal). Persisted because it's
  -- expensive to regenerate and immutable per strategy revision.
  divergence_summary text,
  -- Final score combines cosine + rerank (0-100):
  --   final_score = 0.5 * (cosine_sim * 100) + 0.5 * rerank_score
  -- Stored so the discovery feed can sort + threshold without recompute.
  final_score real not null,
  computed_at timestamptz not null default now(),
  -- Canonical ordering: strategy_a's UUID sorts BEFORE strategy_b's.
  -- Guarantees one row per unordered pair regardless of which side
  -- triggered the match.
  constraint strategy_matches_canonical_order check (strategy_a < strategy_b),
  unique (strategy_a, strategy_b)
);

create index if not exists strategy_matches_strategy_a_idx
  on public.strategy_matches(strategy_a);
create index if not exists strategy_matches_strategy_b_idx
  on public.strategy_matches(strategy_b);
create index if not exists strategy_matches_final_score_idx
  on public.strategy_matches(final_score desc);

comment on table public.strategy_matches is
  'Synergy Phase 5: cached cross-user strategy-pair scores for '
  'parallel-path matching. Canonical ordering (strategy_a < strategy_b).';

-- ── 3. parallel_path_requests — invitations ──

create table if not exists public.parallel_path_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id),
  to_user uuid not null references auth.users(id),
  from_strategy uuid not null
    references public.synergy_strategies(id) on delete cascade,
  to_strategy uuid not null
    references public.synergy_strategies(id) on delete cascade,
  message text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  responded_at timestamptz
);

alter table public.parallel_path_requests
  drop constraint if exists parallel_path_requests_status_check;
alter table public.parallel_path_requests
  add constraint parallel_path_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'expired'));

alter table public.parallel_path_requests
  drop constraint if exists parallel_path_requests_no_self;
alter table public.parallel_path_requests
  add constraint parallel_path_requests_no_self
  check (from_user <> to_user);

create index if not exists parallel_path_requests_to_user_idx
  on public.parallel_path_requests(to_user, status);
create index if not exists parallel_path_requests_from_user_idx
  on public.parallel_path_requests(from_user, status);

comment on table public.parallel_path_requests is
  'Synergy Phase 5: invitations to form a parallel-path room. Mirrors '
  'match_requests but at the strategy granularity.';

-- ── 4. Extend synergy_rooms with room_kind + parallel-path columns ──
--
-- room_kind = 'collaboration' (existing, default) for component-match
-- rooms; 'parallel_path' for the new strategy-match rooms.
--
-- strategy_a_id / strategy_b_id reference each user's OWN strategy,
-- canonical-ordered. Nullable to preserve compatibility with existing
-- rows (which are all 'collaboration' kind and have no strategy refs).

alter table public.synergy_rooms
  add column if not exists room_kind text not null default 'collaboration';
alter table public.synergy_rooms
  add column if not exists strategy_a_id uuid
    references public.synergy_strategies(id);
alter table public.synergy_rooms
  add column if not exists strategy_b_id uuid
    references public.synergy_strategies(id);
alter table public.synergy_rooms
  add column if not exists shared_theme text;
alter table public.synergy_rooms
  add column if not exists shared_pillars text[];

alter table public.synergy_rooms
  drop constraint if exists synergy_rooms_kind_check;
alter table public.synergy_rooms
  add constraint synergy_rooms_kind_check
  check (room_kind in ('collaboration', 'parallel_path'));

-- Parallel-path rooms must carry strategy refs + theme. Collaboration
-- rooms must NOT (they use component_a / component_b instead). This
-- shape constraint keeps the two room kinds cleanly disjoint at the
-- data layer.
alter table public.synergy_rooms
  drop constraint if exists synergy_rooms_kind_shape_check;
alter table public.synergy_rooms
  add constraint synergy_rooms_kind_shape_check
  check (
    (room_kind = 'collaboration'
       and strategy_a_id is null
       and strategy_b_id is null)
    or
    (room_kind = 'parallel_path'
       and strategy_a_id is not null
       and strategy_b_id is not null
       and shared_theme is not null)
  );

create index if not exists synergy_rooms_room_kind_idx
  on public.synergy_rooms(room_kind);

comment on column public.synergy_rooms.room_kind is
  'collaboration = built from a component_match (complementary fit). '
  'parallel_path = built from a strategy_match (convergent goal, divergent routine).';

-- ── 5. plan_step_checkins — per-user, per-step completion + reflection ──

create table if not exists public.plan_step_checkins (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null
    references public.synergy_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  -- Each user checks in on THEIR OWN strategy's plan_step blocks. The
  -- RLS WITH CHECK (below) enforces that step_block_id belongs to the
  -- user's own strategy — never the other member's column.
  step_block_id uuid not null
    references public.synergy_strategy_blocks(id) on delete cascade,
  marked_complete_at timestamptz not null default now(),
  -- Free-form reflection visible to BOTH members (read-only for the
  -- other member). 24-hour edit window enforced via RLS WITH CHECK.
  reflection text,
  updated_at timestamptz not null default now(),
  -- One check-in per (user, step) per room. Upsert pattern.
  unique (room_id, user_id, step_block_id)
);

create index if not exists plan_step_checkins_room_idx
  on public.plan_step_checkins(room_id, marked_complete_at desc);
create index if not exists plan_step_checkins_user_idx
  on public.plan_step_checkins(user_id);

comment on table public.plan_step_checkins is
  'Synergy Phase 5: per-user, per-plan_step check-ins inside a '
  'parallel-path room. Each user writes their own column; both can '
  'read both columns.';

-- ── 6. room_digests — weekly aggregate ──

create table if not exists public.room_digests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null
    references public.synergy_rooms(id) on delete cascade,
  week_starting date not null,
  summary text not null,
  -- Both denormalized counts so the UI can render the digest line
  -- without re-aggregating check-ins.
  user_a_completions int not null default 0,
  user_b_completions int not null default 0,
  created_at timestamptz not null default now(),
  unique (room_id, week_starting)
);

create index if not exists room_digests_room_idx
  on public.room_digests(room_id, week_starting desc);

comment on table public.room_digests is
  'Synergy Phase 5: weekly aggregate of plan_step_checkins per '
  'parallel-path room. Written by the parallel-digest-weekly cron.';

-- ── 7. updated_at triggers ──
--
-- plan_step_checkins.reflection edits must bump updated_at so the
-- 24-hour edit window check is reliable.

create or replace function public.plan_step_checkins_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists plan_step_checkins_updated_at
  on public.plan_step_checkins;
create trigger plan_step_checkins_updated_at
  before update on public.plan_step_checkins
  for each row execute function public.plan_step_checkins_set_updated_at();

-- ── 8. RLS — policies ──

alter table public.strategy_matches enable row level security;
alter table public.parallel_path_requests enable row level security;
alter table public.plan_step_checkins enable row level security;
alter table public.room_digests enable row level security;

-- strategy_matches: visible to either side's owner. No writes from
-- clients — the matcher uses service_role.
drop policy if exists strategy_matches_owner_read on public.strategy_matches;
create policy strategy_matches_owner_read
  on public.strategy_matches for select
  using (
    exists (
      select 1
      from public.synergy_strategies s
      join public.brainstorm_sessions sess on sess.id = s.session_id
      where s.id in (strategy_matches.strategy_a, strategy_matches.strategy_b)
        and sess.owner_id = (select auth.uid())
    )
  );

-- parallel_path_requests: visible to from_user and to_user. Insert by
-- the from_user; update only by the to_user (accept/decline).
drop policy if exists parallel_path_requests_participants_read
  on public.parallel_path_requests;
create policy parallel_path_requests_participants_read
  on public.parallel_path_requests for select
  using (
    from_user = (select auth.uid())
    or to_user = (select auth.uid())
  );

drop policy if exists parallel_path_requests_from_user_insert
  on public.parallel_path_requests;
create policy parallel_path_requests_from_user_insert
  on public.parallel_path_requests for insert
  with check (from_user = (select auth.uid()));

drop policy if exists parallel_path_requests_to_user_update
  on public.parallel_path_requests;
create policy parallel_path_requests_to_user_update
  on public.parallel_path_requests for update
  using (to_user = (select auth.uid()))
  with check (to_user = (select auth.uid()));

-- plan_step_checkins: both room members can read all rows; each user
-- can only insert/update rows where (a) they're the user_id and (b) the
-- step_block belongs to their own strategy. The 24-hour edit window is
-- enforced on UPDATE.
drop policy if exists plan_step_checkins_members_read
  on public.plan_step_checkins;
create policy plan_step_checkins_members_read
  on public.plan_step_checkins for select
  using (
    exists (
      select 1
      from public.synergy_rooms r
      where r.id = plan_step_checkins.room_id
        and (r.user_a = (select auth.uid()) or r.user_b = (select auth.uid()))
    )
  );

drop policy if exists plan_step_checkins_own_insert
  on public.plan_step_checkins;
create policy plan_step_checkins_own_insert
  on public.plan_step_checkins for insert
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.synergy_strategy_blocks b
      join public.synergy_strategies s on s.id = b.strategy_id
      join public.brainstorm_sessions sess on sess.id = s.session_id
      where b.id = plan_step_checkins.step_block_id
        and sess.owner_id = (select auth.uid())
        and b.block_type = 'plan_step'
    )
    and exists (
      select 1
      from public.synergy_rooms r
      where r.id = plan_step_checkins.room_id
        and r.room_kind = 'parallel_path'
        and (r.user_a = (select auth.uid()) or r.user_b = (select auth.uid()))
    )
  );

drop policy if exists plan_step_checkins_own_update
  on public.plan_step_checkins;
create policy plan_step_checkins_own_update
  on public.plan_step_checkins for update
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and now() - marked_complete_at < interval '24 hours'
  );

drop policy if exists plan_step_checkins_own_delete
  on public.plan_step_checkins;
create policy plan_step_checkins_own_delete
  on public.plan_step_checkins for delete
  using (
    user_id = (select auth.uid())
    and now() - marked_complete_at < interval '24 hours'
  );

-- room_digests: both members can read. Writes are service_role only.
drop policy if exists room_digests_members_read on public.room_digests;
create policy room_digests_members_read
  on public.room_digests for select
  using (
    exists (
      select 1
      from public.synergy_rooms r
      where r.id = room_digests.room_id
        and (r.user_a = (select auth.uid()) or r.user_b = (select auth.uid()))
    )
  );

-- ── 9. RPC — synergy_match_strategies ──
--
-- Vector kNN over synergy_strategies.embedding, filtered to:
--   * other users (s.owner_id <> source's owner_id, joined via session)
--   * matchable = true
--   * embedding is not null
--   * (optionally) not stale
--
-- Returns top match_limit by cosine distance ascending. Mirrors
-- synergy_match_components in shape and security profile.

create or replace function public.synergy_match_strategies(
  source_strategy uuid,
  match_limit integer default 30,
  stale_days integer default 365
)
returns table (
  id uuid,
  session_id uuid,
  owner_id uuid,
  statement text,
  pitch text,
  cosine_distance double precision
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  src_embedding vector(1536);
  src_owner uuid;
begin
  -- Resolve source strategy's embedding + owner (via session).
  select s.embedding, sess.owner_id
    into src_embedding, src_owner
    from public.synergy_strategies s
    join public.brainstorm_sessions sess on sess.id = s.session_id
    where s.id = source_strategy;

  if src_embedding is null or src_owner is null then
    return;
  end if;

  return query
  select
    s.id,
    s.session_id,
    sess.owner_id,
    s.statement,
    s.pitch,
    (s.embedding <=> src_embedding) as cosine_distance
  from public.synergy_strategies s
  join public.brainstorm_sessions sess on sess.id = s.session_id
  where s.id <> source_strategy
    and sess.owner_id <> src_owner
    and s.matchable = true
    and s.embedding is not null
    and s.status = 'published'
    and s.updated_at > now() - (stale_days || ' days')::interval
  order by s.embedding <=> src_embedding
  limit match_limit;
end;
$$;

grant execute on function public.synergy_match_strategies
  to authenticated, service_role;

comment on function public.synergy_match_strategies is
  'Vector kNN over the cross-user strategy embedding index. Returns top '
  'match_limit candidates by cosine distance for parallel-path matching. '
  'Filters: other-user, matchable, published, not stale.';
