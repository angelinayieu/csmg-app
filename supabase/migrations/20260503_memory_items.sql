-- Sprint 0 / Step 4 — memory_items: real semantic memory store
--
-- Replaces the lexical "fetch all entities and Jaccard-score the input"
-- pattern in /api/canvas/ambient with a proper vector store. Same table
-- indexes entities, notes, bridges, objectives, and apps so that ambient
-- retrieval during typing can return the most relevant item of any kind.
--
-- This migration enables pgvector and creates the table + HNSW index.
-- The embedding WRITER (Sprint 2) and the RETRIEVER (Sprint 2) are
-- implemented in application code — this migration only lays the store.
--
-- Rationale for single-table over one-table-per-kind:
--   - Ambient retrieval needs to union across kinds and rank by a single
--     similarity metric. A single table with a `kind` discriminator keeps
--     the query path simple (one HNSW search) and lets the scope/salience
--     filters apply uniformly.
--   - The downside (fatter rows, one index) is acceptable at our scale.
--
-- Upstream producer: embedding writer (Sprint 2) — cron + on-commit triggers
-- Downstream consumer: retrieval service lib/memory/retrieve.ts (Sprint 2),
--                      /api/canvas/ambient (Sprint 3)

create extension if not exists vector;

create table if not exists public.memory_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  -- What kind of thing this represents
  kind text not null
    check (kind in ('entity','note','bridge','objective','app','canvas')),

  -- Reference to the source row. Polymorphic — no FK.
  -- Integrity maintained by the writer (it upserts/deletes in lockstep
  -- with source changes via supabase realtime or explicit triggers added
  -- in Sprint 2).
  ref_id uuid not null,

  -- Scope metadata for retrieval filtering.
  -- scope mirrors canvases.scope when the ref is canvas-bound; for entities
  -- it's derived from the owning space's canvas. Populated by the writer.
  scope text
    check (scope is null or scope in ('universal','project','objective','app')),
  scope_ref_id uuid,    -- the space/objective/app this item belongs to

  -- Text content that was embedded (stored so retrieval can return it
  -- without a second query to the source table)
  text text not null,

  -- 1536-dim = text-embedding-3-small. If we move to a different model,
  -- add a new embedding_<model> column rather than altering dim in place.
  embedding vector(1536),

  -- Ranking signals
  salience float not null default 0.5
    check (salience >= 0 and salience <= 1),
  last_seen_at timestamptz not null default now(),

  -- Provenance: which model produced the embedding, for rebuild passes
  embedding_model text not null default 'text-embedding-3-small',
  embedding_version int not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One memory row per (kind, ref_id) per embedding version; re-embedding
  -- replaces via upsert.
  unique (kind, ref_id, embedding_version)
);

-- HNSW index on the embedding for ANN search.
-- m=16, ef_construction=64 are pgvector defaults; tune in Sprint 2 against
-- the gold retrieval set.
create index if not exists idx_memory_items_embedding_hnsw
  on public.memory_items using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_memory_items_owner_kind
  on public.memory_items(owner_id, kind);
create index if not exists idx_memory_items_scope
  on public.memory_items(owner_id, scope, scope_ref_id)
  where scope is not null;
create index if not exists idx_memory_items_last_seen
  on public.memory_items(owner_id, last_seen_at desc);
create index if not exists idx_memory_items_ref
  on public.memory_items(kind, ref_id);

-- updated_at trigger
create or replace function public.tg_touch_memory_items_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_touch_memory_items_updated_at on public.memory_items;
create trigger trg_touch_memory_items_updated_at
  before update on public.memory_items
  for each row execute function public.tg_touch_memory_items_updated_at();

-- RLS
alter table public.memory_items enable row level security;

drop policy if exists "owner_all_memory_items" on public.memory_items;
create policy "owner_all_memory_items" on public.memory_items
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

comment on table public.memory_items is
  'Unified vector memory store across entities, notes, bridges, objectives, apps, '
  'and canvases. Powers ambient retrieval during typing (Sprint 3) with HNSW ANN '
  'search + scope/salience filtering. Writer lives in lib/memory/writer.ts (Sprint 2).';
