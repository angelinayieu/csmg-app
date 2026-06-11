-- Trove: personal cross-space knowledge graph (user-scoped, NOT space-scoped).
-- Applied live 2026-06-11 via MCP (version 2026…/trove_kg).
-- kg_collections = auto-organized folder tree (Drive view) + folder-agents.
-- kg_nodes = multimodal knowledge nodes layered by depth (complexity) +
--            causal_role (driver|mechanism|outcome|condition|variable|context).
-- kg_edges = typed relations (parent_of|causes|enables|blocks|variable_of|
--            example_of|contrasts_with|sequence_next|relates_to).
-- kg_agent_messages = iMessage-style threads per agent collection.

create table if not exists public.kg_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.kg_collections(id) on delete set null,
  name text not null,
  slug text not null,
  description text,
  emoji text,
  hue int not null default 24,
  is_agent boolean not null default false,
  agent_persona text,
  agent_enabled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table if not exists public.kg_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id uuid references public.kg_collections(id) on delete set null,
  kind text not null default 'concept',
  title text not null,
  summary text,
  content text,
  media_url text,
  source_kind text not null default 'manual',
  source_ref text,
  concept_slug text,
  depth int not null default 1,
  causal_role text,
  tags text[] not null default '{}',
  hue int not null default 24,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kg_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null references public.kg_nodes(id) on delete cascade,
  target_id uuid not null references public.kg_nodes(id) on delete cascade,
  relation text not null default 'relates_to',
  label text,
  strength real not null default 0.5,
  created_at timestamptz not null default now()
);

create table if not exists public.kg_agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id uuid not null references public.kg_collections(id) on delete cascade,
  role text not null,
  body text not null,
  kind text not null default 'chat',
  created_at timestamptz not null default now()
);

create index if not exists kg_nodes_user_created_idx on public.kg_nodes (user_id, created_at desc);
create index if not exists kg_nodes_collection_idx on public.kg_nodes (collection_id);
-- Dedupe imports (sync-from-boards writes source_ref like 'libobj:<id>').
create unique index if not exists kg_nodes_user_source_ref_uidx
  on public.kg_nodes (user_id, source_ref) where source_ref is not null;
create index if not exists kg_edges_user_idx on public.kg_edges (user_id);
create index if not exists kg_edges_source_idx on public.kg_edges (source_id);
create index if not exists kg_edges_target_idx on public.kg_edges (target_id);
create index if not exists kg_collections_user_idx on public.kg_collections (user_id);
create index if not exists kg_collections_parent_idx on public.kg_collections (parent_id);
create index if not exists kg_agent_messages_thread_idx on public.kg_agent_messages (collection_id, created_at);

alter table public.kg_collections enable row level security;
alter table public.kg_nodes enable row level security;
alter table public.kg_edges enable row level security;
alter table public.kg_agent_messages enable row level security;

create policy "kg_collections_own" on public.kg_collections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "kg_nodes_own" on public.kg_nodes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "kg_edges_own" on public.kg_edges
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "kg_agent_messages_own" on public.kg_agent_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
