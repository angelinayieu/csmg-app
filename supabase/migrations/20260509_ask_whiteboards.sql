-- Ask whiteboards — cross-whiteboard Q&A surface.
--
-- Adds:
--   1. spaces.kind ('analysis' default, 'ask')
--   2. entities.is_reference + origin_{entity,space}_id for ghost-clones
--   3. entities.search_tsv FTS column + GIN index
--   4. RPC: search_user_entities(user, query, limit, exclude_space)
--
-- Upstream producer: POST /api/ask/start → inngest ask-cross-space function.
-- Downstream consumer: /app/space/[askSpaceId] — same canvas renders ref entities.
-- The ref entity rows carry origin_entity_id + origin_space_id so clicking
-- through can deep-link back to the source whiteboard (future Sprint).

-- ── 1. spaces.kind ──────────────────────────────────────────────────────
alter table public.spaces
  add column if not exists kind text not null default 'analysis';

-- Constraint added separately so re-runs don't duplicate it
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'spaces_kind_check'
  ) then
    alter table public.spaces
      add constraint spaces_kind_check check (kind in ('analysis','ask'));
  end if;
end $$;

create index if not exists idx_spaces_user_kind
  on public.spaces(user_id, kind);

-- ── 2. entities: reference metadata ─────────────────────────────────────
alter table public.entities
  add column if not exists is_reference boolean not null default false,
  add column if not exists origin_entity_id uuid,
  add column if not exists origin_space_id uuid;

-- FKs added separately for idempotency
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'entities_origin_entity_fk'
  ) then
    alter table public.entities
      add constraint entities_origin_entity_fk
      foreign key (origin_entity_id) references public.entities(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'entities_origin_space_fk'
  ) then
    alter table public.entities
      add constraint entities_origin_space_fk
      foreign key (origin_space_id) references public.spaces(id) on delete set null;
  end if;
end $$;

create index if not exists idx_entities_origin_entity
  on public.entities(origin_entity_id)
  where origin_entity_id is not null;
create index if not exists idx_entities_is_reference
  on public.entities(space_id)
  where is_reference = true;

-- ── 3. FTS column + GIN index for cross-whiteboard retrieval ────────────
alter table public.entities
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector(
      'english',
      coalesce(name, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(entity_type, '')
    )
  ) stored;

create index if not exists idx_entities_search_tsv
  on public.entities using gin(search_tsv);

-- ── 4. RPC: search_user_entities ────────────────────────────────────────
-- Retrieves the top-N entities across all of a user's *analysis* spaces
-- that match a plainto_tsquery. Excludes reference entities and (optionally)
-- one space (the ask space itself).
create or replace function public.search_user_entities(
  p_user_id uuid,
  p_query text,
  p_limit int default 20,
  p_exclude_space_id uuid default null
)
returns table (
  id uuid,
  space_id uuid,
  space_name text,
  entity_id text,
  name text,
  description text,
  entity_type text,
  entity_category text,
  importance text,
  is_leverage_point boolean,
  is_risk_point boolean,
  rank real
)
language sql
stable
security invoker
as $$
  select
    e.id,
    e.space_id,
    s.name as space_name,
    e.entity_id,
    e.name,
    e.description,
    e.entity_type,
    e.entity_category::text,
    e.importance::text,
    e.is_leverage_point,
    e.is_risk_point,
    ts_rank(e.search_tsv, plainto_tsquery('english', p_query)) as rank
  from public.entities e
  join public.spaces s on s.id = e.space_id
  where s.user_id = p_user_id
    and coalesce(s.kind, 'analysis') <> 'ask'
    and (p_exclude_space_id is null or e.space_id <> p_exclude_space_id)
    and coalesce(e.is_reference, false) = false
    and e.search_tsv @@ plainto_tsquery('english', p_query)
  order by rank desc, e.confidence desc nulls last
  limit greatest(1, least(p_limit, 100));
$$;

grant execute on function public.search_user_entities(uuid, text, int, uuid)
  to authenticated, service_role;

comment on function public.search_user_entities is
  'Cross-whiteboard entity retrieval for the Ask feature. FTS over name/description/type, '
  'scoped to the caller-provided user, skipping ask-kind spaces and reference entities.';
