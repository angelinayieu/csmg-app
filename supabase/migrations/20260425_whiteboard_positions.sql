-- Whiteboard node position persistence
--
-- When users drag entities around on the whiteboard, the new positions are
-- saved here so the layout survives across sessions. Positions are stored
-- per (space, entity) with a single owner (space owner); collaborators see
-- the same positions.
--
-- If no row exists for an entity, the whiteboard falls back to the
-- deterministic layout engine (layer bands + weight ordering). Missing rows
-- are fine — they just mean "use default position."

create table if not exists public.whiteboard_positions (
  space_id uuid not null references public.spaces(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,

  -- Canvas coordinates. Integers because CSS translate uses pixel values and
  -- sub-pixel precision here would just be drag-jitter noise.
  x integer not null,
  y integer not null,

  -- Who moved this node and when. Useful for "recently rearranged" hints.
  moved_by uuid references auth.users(id) on delete set null,
  moved_at timestamptz not null default now(),

  primary key (space_id, entity_id)
);

create index if not exists whiteboard_positions_space_idx on public.whiteboard_positions (space_id);

alter table public.whiteboard_positions enable row level security;

-- Read: anyone who can read the space
drop policy if exists "users_read_whiteboard_positions" on public.whiteboard_positions;
create policy "users_read_whiteboard_positions" on public.whiteboard_positions
  for select using (
    exists (
      select 1 from public.spaces s
      where s.id = whiteboard_positions.space_id and s.user_id = auth.uid()
    )
  );

-- Write: only space owner
drop policy if exists "owner_write_whiteboard_positions" on public.whiteboard_positions;
create policy "owner_write_whiteboard_positions" on public.whiteboard_positions
  for all using (
    exists (
      select 1 from public.spaces s
      where s.id = whiteboard_positions.space_id and s.user_id = auth.uid()
    )
  );
