-- ── P3 · Cross-paper entity dedup substrate ──────────────────────────
--
-- Mirrors `edges.literature_sources` from migration
-- 20260619_edges_literature_sources.sql onto entities. When paper B is
-- ingested and produces an entity matching a name already in the
-- space (extracted from paper A), the asset-preextractor REUSES the
-- existing entity row and APPENDs paper B's asset id to this column —
-- instead of creating a duplicate node.
--
-- Why this exists: today every PDF gets its own copy of every entity
-- it mentions, so 5 PDFs that all reference "working memory" produce
-- 5 separate "Working Memory" / "working memory" / "WM" entities.
-- The KG fragments. P2 made edges paper-attributable; without P3 the
-- entity graph itself stays paper-fragmented.
--
-- Soft-fail philosophy: empty array is the universal safe default for
-- legacy rows + entities created outside the asset pipeline (manually
-- added, decompose-emitted, etc.).
--
-- Different from `source_tag`: source_tag remains the FIRST asset that
-- introduced the entity (singular, unchanged). literature_sources is
-- the FULL set of papers that contributed to or referenced it (plural,
-- append-only).

alter table public.entities
  add column if not exists literature_sources text[]
  not null default '{}'::text[];

-- Cheap "find every entity referenced by paper X" lookup. GIN partial
-- index keeps the index small for the common case of empty arrays
-- (entities not from any asset).
create index if not exists entities_literature_sources_gin_idx
  on public.entities using gin (literature_sources)
  where cardinality(literature_sources) > 0;

comment on column public.entities.literature_sources is
  'Asset ids (matching ingested_files.id) that contributed to or referenced this entity. Append-only across asset commits. Empty array = entity is not paper-derived (manual / decompose / template seed).';

-- One-time backfill: for every entity whose source_tag starts with
-- "asset:", seed its literature_sources with that single asset id so
-- the badge count is correct on day one for already-extracted papers.
update public.entities
  set literature_sources = array[substring(source_tag from 7)]
  where source_tag like 'asset:%'
    and cardinality(literature_sources) = 0;
