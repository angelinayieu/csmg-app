alter table public.entities
  add column if not exists expanded_detail jsonb not null default '{}'::jsonb;
alter table public.entities
  add column if not exists detail_research jsonb not null default '{}'::jsonb;
comment on column public.entities.expanded_detail is
  'LLM-generated depth surface shown in the item detail drawer. Shape: { definition, variations[], planning: { assumes[], depends_on[], risks[] }, generated_at }. Empty {} = not yet generated; drawer lazy-fetches on first open.';
comment on column public.entities.detail_research is
  'Per-item Tavily research cache. Shape: { sources[], query, fetched_at, failed }. Empty {} = not yet fetched; drawer lazy-fetches on first open.';
