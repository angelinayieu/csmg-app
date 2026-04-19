-- Sprint 2 — search_memory_items RPC
--
-- HNSW cosine-distance search over memory_items, gated by owner and
-- optional scope/kind filters. Used by lib/memory/retrieve.ts.
--
-- Returns rows ordered by distance ascending (most similar first).
-- Caller converts distance → similarity (1 - distance) and applies
-- recency + salience post-processing before returning to the UI.
--
-- Security: the function runs with SECURITY INVOKER so RLS on
-- memory_items enforces owner isolation regardless of how it's called.
-- The p_owner_id parameter is kept for explicit filtering (allows a
-- service-role key to scope queries without bypassing the intent).

create or replace function public.search_memory_items(
  p_owner_id uuid,
  p_query_embedding vector(1536),
  p_k int default 20,
  p_kinds text[] default null,         -- null = all kinds
  p_scopes text[] default null,        -- null = all scopes
  p_scope_ref_ids uuid[] default null, -- null = no ref filter
  p_min_salience float default 0,
  p_embedding_version int default 1
)
returns table (
  id uuid,
  owner_id uuid,
  kind text,
  ref_id uuid,
  scope text,
  scope_ref_id uuid,
  text text,
  salience float,
  last_seen_at timestamptz,
  embedding_model text,
  embedding_version int,
  created_at timestamptz,
  updated_at timestamptz,
  distance float
)
language sql
stable
security invoker
as $$
  select
    m.id,
    m.owner_id,
    m.kind,
    m.ref_id,
    m.scope,
    m.scope_ref_id,
    m.text,
    m.salience,
    m.last_seen_at,
    m.embedding_model,
    m.embedding_version,
    m.created_at,
    m.updated_at,
    (m.embedding <=> p_query_embedding)::float as distance
  from public.memory_items m
  where m.owner_id = p_owner_id
    and m.embedding_version = p_embedding_version
    and m.embedding is not null
    and m.salience >= p_min_salience
    and (p_kinds is null or m.kind = any(p_kinds))
    and (p_scopes is null or m.scope = any(p_scopes) or m.scope is null)
    and (
      p_scope_ref_ids is null
      or m.scope_ref_id = any(p_scope_ref_ids)
      or m.scope_ref_id is null
    )
  order by m.embedding <=> p_query_embedding
  limit greatest(p_k, 1);
$$;

comment on function public.search_memory_items is
  'ANN search over memory_items using HNSW cosine distance. Filters by '
  'owner (required), kind, scope, scope_ref_id, salience, and embedding '
  'version. Caller applies recency decay + salience boost on top.';

-- Grant execute to authenticated users so the route handler can call
-- this via the Supabase anon+JWT client (RLS on memory_items still
-- enforces the owner check).
grant execute on function public.search_memory_items(
  uuid, vector(1536), int, text[], text[], uuid[], float, int
) to authenticated;
