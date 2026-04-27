-- ── D8 · Hierarchical KG communities ──────────────────────────────────
--
-- Adds the operational layering substrate the system has been missing
-- (see docs/KG_DEPTH_CRITIQUE.md §3 — knowledge_layer + entity_category
-- are tags, not pipeline gates). Communities are graph-topology-derived
-- partitions that nest hierarchically: a level-0 community contains all
-- nodes; level-1 communities partition level-0 by edge density;
-- level-2 communities partition level-1 sub-communities; etc.
--
-- Pattern source: Microsoft GraphRAG paper (Edge et al. 2024) §3.1.4–
-- 3.1.5. Their pipeline runs Leiden recursively (graspologic Python),
-- then generates bottom-up community summaries that roll up from leaf
-- communities through to root summaries. We use a self-contained
-- modularity-greedy clusterer (TS, no Python service) — Louvain-class
-- output for our scale (15–50 entities typical), and the summaries
-- (LLM-generated, same prompt template the paper publishes in §E.2)
-- are where the actual operational value lives.
--
-- Schema:
--   kg_communities — one row per community at any level. Self-
--   referential parent_community_id encodes the hierarchy.
--   Relationships:
--     - level 0 has parent_community_id = NULL (root partitions)
--     - level N+1 sub-community.parent_community_id = level N parent
--     - entity_ids[]/edge_ids[] are the members at this level
--     - summary is the LLM-generated report for this community
--
-- Why nested arrays of UUIDs rather than a join table:
--   1. Communities are immutable once detected (a re-run creates new
--      rows with a fresh detection_run_id, never updates) — set-
--      semantics aren't needed
--   2. Summaries are generated bottom-up reading entity_ids+edge_ids
--      verbatim; a join would require re-grouping per summary
--   3. Postgres GIN on uuid[] is fast enough for the queries we run
--      ("which communities contain entity X" etc.)
--
-- Soft-fail throughout the pipeline: when detection fails or the
-- summary LLM call errors, the community row still exists with
-- summary = null. Downstream consumers treat null summaries as
-- "community detected, summary pending" — safer than partial trees.

-- ── Table ──

create table if not exists public.kg_communities (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  -- Parent community in the hierarchy. NULL = level 0 root partition.
  parent_community_id uuid references public.kg_communities(id) on delete cascade,
  -- 0-indexed depth. Level 0 = root partitions (no parent), level 1 =
  -- sub-communities of level 0, etc. Capped at 4 in the detector
  -- (community-detection.ts) to keep token costs bounded.
  level integer not null check (level >= 0 and level <= 4),
  -- Members at this level. entity_ids and edge_ids together name the
  -- subgraph this community summarizes. Both can be empty during
  -- detection failure modes — the detector rejects empty rows.
  entity_ids uuid[] not null default '{}'::uuid[],
  edge_ids uuid[] not null default '{}'::uuid[],
  -- LLM-generated rollup. Matches the schema GraphRAG §E.2 publishes:
  --   { title: string, summary: string, rating: number 0..10,
  --     rating_explanation: string, findings: [{summary, explanation}] }
  -- Null until the summary pass runs; a re-run replaces atomically.
  summary jsonb,
  summary_tokens integer,
  -- Track which detection run produced this row so re-runs don't
  -- collide. UUID-stamped per detection_run; consumers query the
  -- latest detection_run_id per space_id.
  detection_run_id uuid not null,
  -- Provenance + audit
  created_at timestamptz not null default now(),
  computed_at timestamptz not null default now(),
  -- Modularity score this community contributed at detection time.
  -- Ranges roughly 0..1 for well-defined communities; negative scores
  -- mean the partition is worse than random (we drop those before
  -- persisting, but the column tolerates them for diagnostic re-runs).
  modularity_contribution numeric
);

comment on table public.kg_communities is
  'Hierarchical graph-topology-derived community partitions per space, with bottom-up LLM-generated summaries. See docs/KG_DEPTH_CRITIQUE.md §9 D8 for context, src/lib/pipeline/community-detection.ts for clustering, src/lib/pipeline/community-summarize.ts for summarization, src/lib/prompts/community-summary.ts for the rollup prompt.';

comment on column public.kg_communities.parent_community_id is
  'NULL = root partition (level 0). Otherwise links to the level-(N-1) community this is a sub-community of.';

comment on column public.kg_communities.summary is
  'LLM-generated rollup matching GraphRAG §E.2 schema: { title, summary, rating, rating_explanation, findings: [{summary, explanation}] }. Null when detection succeeded but summarization is pending or failed.';

comment on column public.kg_communities.detection_run_id is
  'Stamps the detection-run that produced this row. Consumers query the latest detection_run_id per space_id to avoid mixing rows from different runs after a re-cluster.';

-- ── Indexes ──

-- Standard space lookup (most queries scope by space).
create index if not exists kg_communities_space_id_idx
  on public.kg_communities (space_id);

-- Per-space "latest detection run" lookup. Used by consumers to find
-- the active partition without scanning all historical runs.
create index if not exists kg_communities_space_detection_idx
  on public.kg_communities (space_id, detection_run_id, level);

-- Hierarchy walk: find children of a given community.
create index if not exists kg_communities_parent_idx
  on public.kg_communities (parent_community_id)
  where parent_community_id is not null;

-- "Communities containing entity X" — needed by canvas hover, by
-- /api/spaces/[id]/ask, and by the synthesize-layered route when it
-- maps a candidate entity back to its containing community at a
-- given depth tier.
create index if not exists kg_communities_entity_ids_gin_idx
  on public.kg_communities using gin (entity_ids);

create index if not exists kg_communities_edge_ids_gin_idx
  on public.kg_communities using gin (edge_ids);

-- ── RLS ──

alter table public.kg_communities enable row level security;

-- Users can read communities for spaces they own.
create policy "kg_communities select own space"
  on public.kg_communities for select
  using (
    exists (
      select 1 from public.spaces s
      where s.id = kg_communities.space_id
        and s.user_id = auth.uid()
    )
  );

-- Inserts go through the service-role pipeline (decompose route's
-- after() tail). User-level inserts blocked.
create policy "kg_communities service insert"
  on public.kg_communities for insert
  with check (false);
