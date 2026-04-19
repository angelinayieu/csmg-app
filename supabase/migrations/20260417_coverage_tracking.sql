-- Coverage Tracking: per-entity and per-edge analysis counters
--
-- Enables exhaustive pairwise connection prospecting by tracking which
-- nodes/edges have been examined and how often. The connection prospector
-- agent prioritises least-examined nodes to guarantee every variable is
-- eventually assessed for connections (biology-KG rigor).

-- ── Entity coverage columns ──
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'analysis_count') then
    alter table entities add column analysis_count integer not null default 0;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'last_analyzed_at') then
    alter table entities add column last_analyzed_at timestamptz;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'connection_search_count') then
    alter table entities add column connection_search_count integer not null default 0;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'last_connection_search_at') then
    alter table entities add column last_connection_search_at timestamptz;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'decomposition_probed_at') then
    alter table entities add column decomposition_probed_at timestamptz;
  end if;
end $$;

-- ── Edge coverage columns ──
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_name = 'edges' and column_name = 'analysis_count') then
    alter table edges add column analysis_count integer not null default 0;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_name = 'edges' and column_name = 'last_analyzed_at') then
    alter table edges add column last_analyzed_at timestamptz;
  end if;
end $$;

-- ── Pairwise coverage table (for connection prospector) ──
-- Tracks which (entity_a, entity_b) pairs have been checked for potential edges,
-- even when no edge resulted. Prevents re-examining the same pair too often.
create table if not exists pairwise_connection_checks (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  entity_a_id uuid not null references entities(id) on delete cascade,
  entity_b_id uuid not null references entities(id) on delete cascade,
  checked_at timestamptz not null default now(),
  -- Result: whether a potential edge was identified (regardless of acceptance)
  edge_proposed boolean not null default false,
  -- If an edge was proposed, the edge id (may be null if rejected)
  resulting_edge_id uuid references edges(id) on delete set null,
  -- Canonical pair key (smaller UUID first) for dedup
  pair_key text not null,
  unique (space_id, pair_key)
);

create index if not exists idx_pairwise_checks_space on pairwise_connection_checks(space_id);
create index if not exists idx_pairwise_checks_entity_a on pairwise_connection_checks(entity_a_id);
create index if not exists idx_pairwise_checks_entity_b on pairwise_connection_checks(entity_b_id);
create index if not exists idx_pairwise_checks_recency on pairwise_connection_checks(space_id, checked_at desc);

-- ── Indexes for fast least-examined queries ──
create index if not exists idx_entities_analysis_count on entities(space_id, analysis_count asc, last_analyzed_at asc nulls first);
create index if not exists idx_entities_connection_search on entities(space_id, connection_search_count asc, last_connection_search_at asc nulls first);

-- ── Helper functions ──

-- Increment entity analysis counter atomically
create or replace function increment_entity_analysis(entity_uuid uuid)
returns void as $$
begin
  update entities
  set analysis_count = analysis_count + 1,
      last_analyzed_at = now()
  where id = entity_uuid;
end;
$$ language plpgsql;

-- Increment connection-search counter atomically
create or replace function increment_entity_connection_search(entity_uuid uuid)
returns void as $$
begin
  update entities
  set connection_search_count = connection_search_count + 1,
      last_connection_search_at = now()
  where id = entity_uuid;
end;
$$ language plpgsql;

-- Increment edge analysis counter atomically
create or replace function increment_edge_analysis(edge_uuid uuid)
returns void as $$
begin
  update edges
  set analysis_count = analysis_count + 1,
      last_analyzed_at = now()
  where id = edge_uuid;
end;
$$ language plpgsql;
