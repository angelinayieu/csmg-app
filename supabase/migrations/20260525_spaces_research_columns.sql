alter table public.spaces
  add column if not exists surface_research jsonb not null default '{}'::jsonb;
alter table public.spaces
  add column if not exists deep_research jsonb not null default '{}'::jsonb;
comment on column public.spaces.surface_research is
  'Background research bundle from the surface pass — fired when the space is created. Shape: {status, started_at, completed_at, query, summary, sources[]}. Empty {} = not yet kicked off.';
comment on column public.spaces.deep_research is
  'Targeted research bundle from the deep pass — fired when the user completes the clarifying loop. Shape: {status, started_at, completed_at, queries, by_lens, all_sources}. Used as RAG context for downstream generation.';
