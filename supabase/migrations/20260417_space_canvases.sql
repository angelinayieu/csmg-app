-- Canvas snapshot persistence
--
-- The freeform tldraw canvas stores its full document (shapes, bindings,
-- page state, camera) as a JSON snapshot, one per space. Separate from
-- whiteboard_positions so the canvas is free to version/replace wholesale
-- without disturbing the existing layered whiteboard which is position-only.
--
-- Only one snapshot per space. Overwritten on autosave. If you want version
-- history later, replace with an append-only table + snapshot_index.

create table if not exists public.space_canvases (
  space_id uuid primary key references public.spaces(id) on delete cascade,

  -- Full tldraw document snapshot (shapes, bindings, assets, page, camera).
  -- Shape entityId fields link back to public.entities(id) so the canvas
  -- can rehydrate KG-node shapes from current DB state on open.
  snapshot jsonb not null,

  -- Schema version of the snapshot payload. Bump when the shape util
  -- migration can't keep up and we need a resync.
  schema_version integer not null default 1,

  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists space_canvases_updated_at_idx on public.space_canvases (updated_at desc);

alter table public.space_canvases enable row level security;

-- Read: only space owner (RLS — future collab broadens this)
drop policy if exists "owner_read_space_canvases" on public.space_canvases;
create policy "owner_read_space_canvases" on public.space_canvases
  for select using (
    exists (
      select 1 from public.spaces s
      where s.id = space_canvases.space_id and s.user_id = auth.uid()
    )
  );

-- Write: only space owner
drop policy if exists "owner_write_space_canvases" on public.space_canvases;
create policy "owner_write_space_canvases" on public.space_canvases
  for all using (
    exists (
      select 1 from public.spaces s
      where s.id = space_canvases.space_id and s.user_id = auth.uid()
    )
  );

-- Maintain updated_at on row updates
create or replace function public.tg_touch_space_canvases_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_space_canvases_updated_at on public.space_canvases;
create trigger trg_touch_space_canvases_updated_at
  before update on public.space_canvases
  for each row execute function public.tg_touch_space_canvases_updated_at();
