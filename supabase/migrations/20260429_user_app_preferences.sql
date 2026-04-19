-- Sprint 4: per-user App preferences.
--
-- Allows a user to override *per-app* or *per-app-type* aspects of an App's
-- rendered manifest without mutating the canonical manifest the agent
-- maintains. The renderer merges preferences on top of config.manifest at
-- render time — this keeps agent-authored manifests clean while letting
-- the user hide widgets, reorder, override theme, and set density.
--
-- Two scopes coexist:
--   * app_id IS NOT NULL  → preferences for ONE specific App
--   * app_type IS NOT NULL → preferences for every App of this type (template)
-- Unique index enforces "at most one row per (user, app_id)" and
-- "at most one row per (user, app_type)".

create table if not exists public.user_app_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Exactly one of these must be set; check constraint enforces XOR.
  app_id uuid references public.apps(id) on delete cascade,
  app_type text check (app_type is null or app_type in
    ('dashboard','workflow','tool','monitor','integration')),

  -- The preference payload — see AppPreferences in src/types/app.ts.
  -- Kept JSONB so new preference keys don't require migrations.
  preferences jsonb not null default '{}'::jsonb,

  -- Lightweight interaction-learning counters. Agents read these to decide
  -- whether to propose a new default. Keys are widget ids → counts.
  interaction_counts jsonb not null default '{}'::jsonb,
  last_interaction_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- XOR: exactly one of app_id / app_type must be set.
  constraint user_app_prefs_scope_xor check (
    (app_id is not null and app_type is null)
    or (app_id is null and app_type is not null)
  )
);

-- Uniqueness per scope — one row per (user, specific app) OR (user, type).
create unique index if not exists idx_user_app_prefs_app
  on public.user_app_preferences (user_id, app_id)
  where app_id is not null;

create unique index if not exists idx_user_app_prefs_type
  on public.user_app_preferences (user_id, app_type)
  where app_type is not null;

create index if not exists idx_user_app_prefs_user
  on public.user_app_preferences (user_id);

-- RLS
alter table public.user_app_preferences enable row level security;

drop policy if exists "user_app_prefs_owner" on public.user_app_preferences;
create policy "user_app_prefs_owner" on public.user_app_preferences
  for all using (auth.uid() = user_id);

-- updated_at trigger (mirrors existing pattern)
create or replace function public.set_user_app_prefs_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_user_app_prefs_updated_at on public.user_app_preferences;
create trigger trg_user_app_prefs_updated_at
  before update on public.user_app_preferences
  for each row execute function public.set_user_app_prefs_updated_at();

comment on table public.user_app_preferences is
  'Per-user personalization layer for Apps. Merged into config.manifest at render '
  'time — canonical manifest remains agent-authored. Scoped either to a specific '
  'app_id OR an app_type (template-wide).';
