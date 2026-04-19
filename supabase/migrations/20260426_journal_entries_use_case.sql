-- Journal entries + use-case template linkage
--
-- Adds:
--   1. `use_case_template_id` column on `spaces` — which template spawned this space
--   2. `journal_entries` table — one row per daily entry, linked to a space
--      and to the entities it references

-- ── spaces.use_case_template_id ──
alter table public.spaces
  add column if not exists use_case_template_id text;

create index if not exists spaces_use_case_template_idx on public.spaces (use_case_template_id)
  where use_case_template_id is not null;

-- ── journal_entries ──
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,

  -- One entry per date typically. User can have multiple entries if they want.
  entry_date date not null,
  text text not null,
  word_count integer not null default 0,

  -- Entities this entry's decomposition referenced (either created or merged into)
  referenced_entity_ids uuid[] not null default '{}',

  -- Extracted metadata — short labels, lowercase
  emotions_mentioned text[] not null default '{}',
  values_surfaced text[] not null default '{}',
  tensions_detected text[] not null default '{}',
  flow_activities text[] not null default '{}',
  drain_activities text[] not null default '{}',

  -- LLM-generated reflection prompt for next time
  next_prompt text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists journal_entries_space_date_idx on public.journal_entries (space_id, entry_date desc);
create index if not exists journal_entries_referenced_entities_idx on public.journal_entries
  using gin (referenced_entity_ids);

alter table public.journal_entries enable row level security;

drop policy if exists "users_read_own_journal_entries" on public.journal_entries;
create policy "users_read_own_journal_entries" on public.journal_entries
  for select using (
    exists (
      select 1 from public.spaces s
      where s.id = journal_entries.space_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "users_write_own_journal_entries" on public.journal_entries;
create policy "users_write_own_journal_entries" on public.journal_entries
  for all using (
    exists (
      select 1 from public.spaces s
      where s.id = journal_entries.space_id and s.user_id = auth.uid()
    )
  );
