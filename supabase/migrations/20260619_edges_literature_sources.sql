-- ── P2 · Edge → paper attribution (D14 follow-up) ────────────────────
--
-- Adds `edges.literature_sources text[]` to track which assets/papers
-- support each edge. Asset ids are stored as text (matching how
-- entities use `source_tag = "asset:<assetId>"` already).
--
-- Why this exists: the user can drop a research PDF, the asset-
-- preextractor fans entities into the KG, but currently there's no
-- way to ask "which papers support edge A→B?" because edges have no
-- citation column. The whole 74-paper CRCI template is hardcoded
-- with no per-edge source attribution. This column starts that
-- substrate.
--
-- For now the column is empty for ALL existing edges. Future passes:
--   - Extend the asset-preextractor / decompose prompts to emit
--     `literature_sources` per generated edge
--   - Backfill the cognitive template's seed_edges with CRCI source
--     references
--   - Add a `/api/edges/[id]/sources` endpoint that resolves the
--     text[] of asset ids to ingested_files rows
--
-- Soft-fail philosophy: empty array is the universal safe default.
-- UI surfaces (entity-detail drawer, future edge tooltip) only render
-- the "📚 N papers" badge when the array is non-empty.

alter table public.edges
  add column if not exists literature_sources text[]
  not null default '{}'::text[];

-- Cheap "find all edges supported by paper X" lookup. GIN partial
-- index keeps the index small for the common case of empty arrays.
create index if not exists edges_literature_sources_gin_idx
  on public.edges using gin (literature_sources)
  where cardinality(literature_sources) > 0;

comment on column public.edges.literature_sources is
  'Asset ids (matching ingested_files.id) supporting this edge. Each entry is the raw uuid; the entity source_tag convention "asset:<id>" is unwrapped for direct lookup. Empty array = unsupported / unattributed.';
