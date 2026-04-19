-- Sprint 0 / Step 1 — canvases registry (first-class, scope-categorized)
--
-- Replaces the 1:1 space_canvases model with a first-class canvas row
-- scoped to one of: universal | project | objective | app. Same user can
-- own many canvases at the universal level; canvases are listed in the
-- Canvas Library (Sprint 1) filterable by scope.
--
-- Back-compat strategy:
--   - space_canvases is NOT dropped. It remains authoritative for the
--     tldraw runtime which writes on autosave.
--   - A canvases row is automatically created for every space_canvases
--     row (scope='project', scope_ref_type='space'). This is the
--     default "project canvas" surfaced in the library.
--   - Bidirectional sync triggers (guarded by pg_trigger_depth()) keep
--     the snapshot blob consistent whether the writer hits space_canvases
--     (legacy path) or canvases (new path). When Sprint 1 UI migrates
--     all writes to /api/canvases/*, the legacy table + triggers can
--     be dropped in a future migration without touching row data.
--
-- Upstream producer (post-Sprint 1): POST /api/canvases, canvas autosave
-- Downstream consumer: CanvasLibrary page, universal canvas (Sprint 4),
-- concept_proposals (scoped by canvas_id).

-- ──────────────────────────────────────────────────────────────────────
-- 1. canvases table
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.canvases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  -- Scope categorization — required at creation (enforced in app layer too)
  scope text not null
    check (scope in ('universal','project','objective','app')),

  -- Polymorphic reference to the scope anchor.
  -- scope='universal' → both NULL (user-owned, cross-project surface)
  -- scope='project'   → scope_ref_type='space', scope_ref_id=spaces.id
  -- scope='objective' → scope_ref_type='improvement_goal', scope_ref_id=improvement_goals.id
  -- scope='app'       → scope_ref_type='app', scope_ref_id=apps.id
  -- FK is not enforced at the DB level because the target table varies.
  -- Application layer (create endpoint) is responsible for validating
  -- scope_ref_id exists in the expected table. A nightly integrity job
  -- can be added in Sprint 5 to catch drift.
  scope_ref_type text
    check (scope_ref_type is null or scope_ref_type in ('space','improvement_goal','app')),
  scope_ref_id uuid,

  title text not null,
  description text,

  -- Snapshot: tldraw document. Nullable because universal canvases
  -- start empty until first edit; non-universal canvases are backfilled
  -- from space_canvases and thus always have a snapshot.
  snapshot jsonb,
  schema_version integer not null default 1,

  -- Library metadata
  pinned boolean not null default false,
  archived boolean not null default false,

  -- Connectedness metric (computed in Sprint 4, surfaced on CanvasCard Ring):
  -- count of bridges whose source or target entity is rendered on this canvas.
  connectedness_score integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,

  -- Scope integrity: if scope is not universal, ref fields must be set together
  constraint canvases_scope_ref_consistency check (
    (scope = 'universal' and scope_ref_type is null and scope_ref_id is null)
    or
    (scope <> 'universal' and scope_ref_type is not null and scope_ref_id is not null)
  )
);

create index if not exists idx_canvases_owner
  on public.canvases(owner_id);
create index if not exists idx_canvases_scope
  on public.canvases(owner_id, scope) where archived = false;
create index if not exists idx_canvases_scope_ref
  on public.canvases(scope_ref_type, scope_ref_id) where scope_ref_id is not null;
create index if not exists idx_canvases_pinned
  on public.canvases(owner_id) where pinned = true and archived = false;
create index if not exists idx_canvases_updated_at
  on public.canvases(updated_at desc) where archived = false;
-- Uniqueness: at most one non-archived canvas per (scope_ref_type, scope_ref_id)
-- for project/objective/app scopes, to mirror the current 1:1 space_canvases model.
-- Universal canvases can be many per owner.
create unique index if not exists uq_canvases_scope_ref_active
  on public.canvases(scope_ref_type, scope_ref_id)
  where scope_ref_id is not null and archived = false;

-- ──────────────────────────────────────────────────────────────────────
-- 2. updated_at trigger
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.tg_touch_canvases_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_canvases_updated_at on public.canvases;
create trigger trg_touch_canvases_updated_at
  before update on public.canvases
  for each row execute function public.tg_touch_canvases_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- 3. Backfill from existing space_canvases
--    Every pre-existing space_canvases row → canvases row (scope='project').
--    If the row's space is actually a sub_space owned by an app, Sprint 1 UI
--    will offer a "reclassify as app" action; we default to 'project' here.
-- ──────────────────────────────────────────────────────────────────────
insert into public.canvases (
  id, owner_id, scope, scope_ref_type, scope_ref_id,
  title, snapshot, schema_version, created_at, updated_at, updated_by
)
select
  gen_random_uuid(),
  s.user_id,
  'project',
  'space',
  sc.space_id,
  coalesce(s.name, 'Untitled canvas'),
  sc.snapshot,
  sc.schema_version,
  sc.created_at,
  sc.updated_at,
  sc.updated_by
from public.space_canvases sc
join public.spaces s on s.id = sc.space_id
where not exists (
  select 1 from public.canvases c
  where c.scope_ref_type = 'space' and c.scope_ref_id = sc.space_id and c.archived = false
);

-- ──────────────────────────────────────────────────────────────────────
-- 4. Bidirectional sync with space_canvases (transition period)
--
-- Guard against infinite trigger recursion with pg_trigger_depth()=1:
-- only the *initiating* write propagates; the mirror update is a no-op.
-- ──────────────────────────────────────────────────────────────────────

-- space_canvases → canvases
-- Note: avoid `SELECT ... INTO var1, var2` here. Some SQL runners
-- mis-parse plpgsql multi-variable SELECT INTO inside dollar-quoted
-- bodies and treat the variable as a missing relation (42P01). Instead
-- we inline the owner/name lookup as a JOIN in the INSERT's SELECT.
create or replace function public.tg_sync_space_canvas_to_canvas()
returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    update public.canvases
      set archived = true, updated_at = now()
      where scope_ref_type = 'space'
        and scope_ref_id = old.space_id
        and archived = false;
    return old;
  end if;

  -- Try update first. ON CONFLICT on a partial unique index isn't
  -- directly usable, so we do explicit update-or-insert.
  update public.canvases
    set snapshot = new.snapshot,
        schema_version = new.schema_version,
        updated_at = new.updated_at,
        updated_by = new.updated_by
    where scope_ref_type = 'space'
      and scope_ref_id = new.space_id
      and archived = false;

  if not found then
    insert into public.canvases (
      owner_id, scope, scope_ref_type, scope_ref_id,
      title, snapshot, schema_version, created_at, updated_at, updated_by
    )
    select
      s.user_id, 'project', 'space', new.space_id,
      coalesce(s.name, 'Untitled canvas'),
      new.snapshot, new.schema_version,
      new.created_at, new.updated_at, new.updated_by
    from public.spaces s
    where s.id = new.space_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_space_canvas_to_canvas on public.space_canvases;
create trigger trg_sync_space_canvas_to_canvas
  after insert or update or delete on public.space_canvases
  for each row execute function public.tg_sync_space_canvas_to_canvas();

-- canvases → space_canvases (only when scope='project' and ref is a space)
create or replace function public.tg_sync_canvas_to_space_canvas()
returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  -- Only project-scope space-anchored canvases mirror down to legacy table
  if (coalesce(new.scope, old.scope)) <> 'project'
     or (coalesce(new.scope_ref_type, old.scope_ref_type)) <> 'space' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    delete from public.space_canvases where space_id = old.scope_ref_id;
    return old;
  end if;

  if tg_op = 'UPDATE' and new.archived = true and old.archived = false then
    -- Archiving a project canvas removes its legacy row so the space is
    -- "free" to bind to a replacement. Sprint 1 will expose this in UI.
    delete from public.space_canvases where space_id = new.scope_ref_id;
    return new;
  end if;

  -- Upsert into space_canvases. Skip if snapshot is null (universal-style
  -- empty canvas; shouldn't happen for project scope but guard anyway).
  if new.snapshot is null then
    return new;
  end if;

  insert into public.space_canvases (
    space_id, snapshot, schema_version, updated_by, updated_at, created_at
  ) values (
    new.scope_ref_id, new.snapshot, new.schema_version,
    new.updated_by, new.updated_at, coalesce(new.created_at, now())
  )
  on conflict (space_id) do update
    set snapshot = excluded.snapshot,
        schema_version = excluded.schema_version,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return new;
end $$;

drop trigger if exists trg_sync_canvas_to_space_canvas on public.canvases;
create trigger trg_sync_canvas_to_space_canvas
  after insert or update or delete on public.canvases
  for each row execute function public.tg_sync_canvas_to_space_canvas();

-- ──────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ──────────────────────────────────────────────────────────────────────
alter table public.canvases enable row level security;

drop policy if exists "owner_read_canvases" on public.canvases;
create policy "owner_read_canvases" on public.canvases
  for select using (auth.uid() = owner_id);

drop policy if exists "owner_write_canvases" on public.canvases;
create policy "owner_write_canvases" on public.canvases
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

comment on table public.canvases is
  'First-class canvas registry. Scope-categorized (universal|project|objective|app). '
  'Backs the Canvas Library (Sprint 1) and the universal canvas surface (Sprint 4). '
  'Snapshot column is the authoritative store once Sprint 1 UI ships; during transition '
  'it is kept in sync with space_canvases via bidirectional triggers.';
