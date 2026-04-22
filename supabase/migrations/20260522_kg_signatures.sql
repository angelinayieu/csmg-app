-- ── KG structural signatures (Phase 2H — cross-domain analogy) ──
--
-- Stores a structural "shape" signature per space (and optionally
-- per cluster within a space) so cross-domain analog search can find
-- graphs with similar STRUCTURE regardless of domain. This is the
-- invention mechanism — a churn loop in a B2B SaaS can be
-- structurally isomorphic to a habit-formation cycle in behavioral
-- science. Today that connection is impossible to discover; after
-- this, it lands as a `structural_analog_found` SSE event.
--
-- Two vectors per signature:
--   • structural_vector (dim 32) — pure graph-topology features
--     (importance distribution, edge dynamics frequencies, cycle
--     counts, mean degree, clustering). Same domain-independent
--     signature regardless of whether the KG is about pricing or
--     about medication adherence.
--   • semantic_centroid (dim 1536) — averaged entity embedding so
--     we can also match within-domain analogs (same shape + similar
--     vocabulary).
--
-- HNSW indexes on both for fast approximate-NN search.
--
-- RLS: users see their OWN signatures plus anonymized cross-user
-- signatures flagged for aggregation. The aggregation path doesn't
-- leak original text — only structural features + semantic centroid
-- (which can't reconstruct entity names).

create table if not exists kg_signatures (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  user_id uuid references auth.users(id),

  -- Optional cluster scope. NULL = whole-space signature.
  -- Populated only when the generator produces sub-cluster
  -- signatures (e.g., one per probability-space axis).
  cluster_id text,

  -- Structural vector — the ~30 features the extractor produces,
  -- padded to 32 for HNSW index alignment.
  structural_vector vector(32),

  -- Semantic centroid — mean of all entity embeddings in the
  -- cluster. Lets "same shape + same domain" queries surface
  -- intra-domain analogs (useful for a user exploring variations
  -- of the same problem over time).
  semantic_centroid vector(1536),

  -- Concatenated vector for one-hit blended search. Weighted
  -- structural + semantic per query (the retriever normalizes
  -- before the ANN call). Kept pre-computed so HNSW can index it
  -- directly — building on-the-fly would be slow for large sets.
  combined_vector vector(1568),

  -- Display metadata — what the UI shows when surfacing an analog
  summary_text text,                    -- "Churn → MRR compounding loop with pricing mediator"
  entity_count int default 0,
  edge_count int default 0,
  cycle_count int default 0,
  has_master_bottleneck boolean default false,

  -- Cross-user anonymization flag — when true, this signature can
  -- match against OTHER users' queries. The signatures themselves
  -- don't expose entity names or the source prompt; the UI links
  -- back to the owner's space only if they've opted into sharing.
  is_anonymized_for_cross_user boolean default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- HNSW indexes for approximate nearest-neighbor. Cosine because
-- embedding-space similarity is angle-based; magnitude carries no
-- signal. ef_construction/m are left at pgvector defaults (64/16)
-- which are fine for our scale; tune later if the index fills up.
create index if not exists idx_kg_signatures_combined_hnsw
  on kg_signatures using hnsw (combined_vector vector_cosine_ops);

create index if not exists idx_kg_signatures_structural_hnsw
  on kg_signatures using hnsw (structural_vector vector_cosine_ops);

create index if not exists idx_kg_signatures_semantic_hnsw
  on kg_signatures using hnsw (semantic_centroid vector_cosine_ops);

-- Lookup helpers for maintenance queries
create index if not exists idx_kg_signatures_user_created
  on kg_signatures(user_id, created_at desc);
create index if not exists idx_kg_signatures_space
  on kg_signatures(space_id);

-- RLS: users see own + anonymized-for-cross-user
alter table kg_signatures enable row level security;

create policy kg_signatures_select_own on kg_signatures for select
  using (user_id = auth.uid() or is_anonymized_for_cross_user = true);

create policy kg_signatures_insert_own on kg_signatures for insert
  with check (user_id = auth.uid());

create policy kg_signatures_update_own on kg_signatures for update
  using (user_id = auth.uid());

create policy kg_signatures_delete_own on kg_signatures for delete
  using (user_id = auth.uid());

-- ── Analog-retrieval RPCs ──
--
-- Two variants so the caller can choose the match axis at query time:
--   • match_kg_signatures_structural — pure topology match. Cross-
--     domain analogy: "any graph with this shape, regardless of
--     vocabulary". Feeds the `structural_analog_found` discovery flow.
--   • match_kg_signatures_blended — structural + semantic via the
--     pre-concatenated combined_vector. Used when the caller wants
--     "similar shape AND overlapping subject matter" (e.g. surfacing
--     the user's own prior spaces on related problems).
--
-- Both exclude the source space, respect RLS (own + anonymized),
-- and return cosine distance so the caller can convert to similarity.
create or replace function match_kg_signatures_structural(
  query_vector vector(32),
  exclude_space_id uuid,
  match_count int default 10
) returns table (
  id uuid,
  space_id uuid,
  user_id uuid,
  cluster_id text,
  summary_text text,
  entity_count int,
  edge_count int,
  cycle_count int,
  has_master_bottleneck boolean,
  is_anonymized_for_cross_user boolean,
  distance float
)
language sql stable
as $$
  select
    s.id, s.space_id, s.user_id, s.cluster_id, s.summary_text,
    s.entity_count, s.edge_count, s.cycle_count,
    s.has_master_bottleneck, s.is_anonymized_for_cross_user,
    (s.structural_vector <=> query_vector)::float as distance
  from kg_signatures s
  where s.space_id <> exclude_space_id
    and s.structural_vector is not null
  order by s.structural_vector <=> query_vector
  limit match_count
$$;

create or replace function match_kg_signatures_blended(
  query_vector vector(1568),
  exclude_space_id uuid,
  match_count int default 10
) returns table (
  id uuid,
  space_id uuid,
  user_id uuid,
  cluster_id text,
  summary_text text,
  entity_count int,
  edge_count int,
  cycle_count int,
  has_master_bottleneck boolean,
  is_anonymized_for_cross_user boolean,
  distance float
)
language sql stable
as $$
  select
    s.id, s.space_id, s.user_id, s.cluster_id, s.summary_text,
    s.entity_count, s.edge_count, s.cycle_count,
    s.has_master_bottleneck, s.is_anonymized_for_cross_user,
    (s.combined_vector <=> query_vector)::float as distance
  from kg_signatures s
  where s.space_id <> exclude_space_id
    and s.combined_vector is not null
  order by s.combined_vector <=> query_vector
  limit match_count
$$;
