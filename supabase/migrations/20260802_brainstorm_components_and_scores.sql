-- ── Brainstorm components + node scores (Synergy track, Phase 3) ──
--
-- Two new tables that the processing screen and the Phase 4 matcher
-- both depend on:
--
--   brainstorm_components — typed extraction output. Each row is a
--     "core idea / upstream need / downstream output / polished
--     product" with a public label, public description, private
--     description, and an embedding. Owner-only in Phase 3; Phase 4
--     adds cross-user SELECT access scoped to match candidates whose
--     components complement this one.
--
--   brainstorm_node_scores — promise scoring cache. Keyed on
--     (session_id, node_id) so re-running scoring upserts in place.
--     Avoids re-spending the LLM call on every processing-page mount.
--
-- pgvector is already installed (confirmed via pg_extension). Embedding
-- dimension is 1536 (text-embedding-3-small from
-- src/lib/embeddings.ts:DEFAULT_EMBEDDING_MODEL).
--
-- Idempotent throughout — same pattern as 20260801: every CREATE uses
-- IF NOT EXISTS, every policy uses DROP IF EXISTS + CREATE.

-- ── pgvector ──
-- The extension is already enabled in this project, but we guard the
-- migration so it's safe to apply to a fresh environment too.
create extension if not exists vector;

-- ── brainstorm_components ──

create table if not exists public.brainstorm_components (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.brainstorm_sessions(id) on delete cascade,
  kind text not null,
  subkind text,
  label_public text not null,
  description_public text not null,
  description_private text not null default '',
  embedding vector(1536),
  visibility text not null default 'matchable_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brainstorm_components
  drop constraint if exists brainstorm_components_kind_check;
alter table public.brainstorm_components
  add constraint brainstorm_components_kind_check
  check (kind in ('core_idea','upstream','downstream','polished_product'));

alter table public.brainstorm_components
  drop constraint if exists brainstorm_components_visibility_check;
alter table public.brainstorm_components
  add constraint brainstorm_components_visibility_check
  check (visibility in ('private','matchable_only','public'));

create index if not exists brainstorm_components_owner_idx
  on public.brainstorm_components(owner_id, created_at desc);
create index if not exists brainstorm_components_session_idx
  on public.brainstorm_components(session_id);
create index if not exists brainstorm_components_kind_idx
  on public.brainstorm_components(kind);

-- Vector index for Phase 4 cross-user matching. ivfflat with 100 lists
-- is a reasonable starting point at our scale (< 100k components); we
-- can revisit lists count or switch to HNSW when the table grows.
-- Cosine ops because text-embedding-3-small embeddings live on the
-- unit sphere — cosine is the canonical distance for that model.
create index if not exists brainstorm_components_embedding_idx
  on public.brainstorm_components
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ── brainstorm_node_scores ──
--
-- Composite PK (session_id, node_id) so the upsert in /score's
-- POST handler can use onConflict='session_id,node_id'.

create table if not exists public.brainstorm_node_scores (
  session_id uuid not null references public.brainstorm_sessions(id) on delete cascade,
  node_id uuid not null references public.brainstorm_nodes(id) on delete cascade,
  score double precision not null,
  why text not null default '',
  child_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (session_id, node_id)
);

alter table public.brainstorm_node_scores
  drop constraint if exists brainstorm_node_scores_score_check;
alter table public.brainstorm_node_scores
  add constraint brainstorm_node_scores_score_check
  check (score >= 0 and score <= 100);

create index if not exists brainstorm_node_scores_session_score_idx
  on public.brainstorm_node_scores(session_id, score desc);

-- ── RLS ──
--
-- Phase 3: owner-only access on both tables. Phase 4 will add a
-- cross-user "matched candidates can SELECT public columns" policy
-- on brainstorm_components (gated by a row in component_matches).

alter table public.brainstorm_components enable row level security;
alter table public.brainstorm_node_scores enable row level security;

drop policy if exists "brainstorm_components_owner_all" on public.brainstorm_components;
create policy "brainstorm_components_owner_all"
  on public.brainstorm_components for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "brainstorm_node_scores_owner_all" on public.brainstorm_node_scores;
create policy "brainstorm_node_scores_owner_all"
  on public.brainstorm_node_scores for all
  using (session_id in (
    select id from public.brainstorm_sessions where owner_id = (select auth.uid())
  ))
  with check (session_id in (
    select id from public.brainstorm_sessions where owner_id = (select auth.uid())
  ));

-- ── Triggers ──
--
-- Touch brainstorm_components.updated_at on edits so a future
-- "what changed since" diff can sort efficiently. Pinned search_path
-- per advisor guidance (matches what 20260801 does on its functions).

create or replace function public.brainstorm_components_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists brainstorm_components_updated_at_trg on public.brainstorm_components;
create trigger brainstorm_components_updated_at_trg
before update on public.brainstorm_components
for each row execute function public.brainstorm_components_set_updated_at();

-- Same touch behavior on scores so the processing page can show a
-- "last scored at" timestamp.
drop trigger if exists brainstorm_node_scores_updated_at_trg on public.brainstorm_node_scores;
create trigger brainstorm_node_scores_updated_at_trg
before update on public.brainstorm_node_scores
for each row execute function public.brainstorm_components_set_updated_at();

comment on table public.brainstorm_components is
  'Synergy track Phase 3: typed extraction output from a brainstorm '
  'session. Phase 4 will use the embedding column for cross-user '
  'component matching.';
comment on table public.brainstorm_node_scores is
  'Synergy track Phase 3: cached promise scores against the session '
  'objective. Composite PK enables upsert-in-place when re-scored.';
