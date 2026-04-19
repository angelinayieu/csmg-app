-- Sprint 4 — canvas_frames: universal canvas composition
--
-- A universal canvas is built by composing existing project/app/objective
-- canvases as "frames" laid out side-by-side on a single surface. Each
-- frame row references one child canvas (frame_canvas_id) and carries
-- its position/size within the parent's layout.
--
-- Only universal and objective canvases HAVE frames (project/app canvases
-- are themselves the leaf — they don't compose others). We enforce this
-- at the application layer; the DB only enforces that:
--   - frame_canvas_id != canvas_id (no self-reference)
--   - same owner (matching row-level owner_id gate)
--   - uniqueness of (canvas_id, frame_canvas_id) so the same child
--     isn't added twice.
--
-- Upstream producer: POST /api/canvases/[id]/frames
-- Downstream consumer: UniversalCanvasEditor (reads via GET /api/canvases/[id]/frames)
-- Downstream consumer: POST /api/canvases/[id]/weave (runs pairwise weave
--                      across the frames)

create table if not exists public.canvas_frames (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  -- The universal / objective canvas this frame lives on.
  canvas_id uuid not null references public.canvases(id) on delete cascade,

  -- The child canvas embedded as a frame.
  frame_canvas_id uuid not null references public.canvases(id) on delete cascade,

  -- Layout (SVG-space coords; Sprint 4's surface is a scrollable
  -- positioned-div grid, so these are measured in CSS pixels within the
  -- universal canvas viewport).
  position_x float not null default 0,
  position_y float not null default 0,
  width float not null default 320,
  height float not null default 400,

  display_order int not null default 0,

  -- Configured view of the frame: which entities to surface. Null = auto
  -- (show top entities by importance). An explicit array lets the user
  -- curate which entities show on this frame for clarity.
  pinned_entity_ids uuid[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Guards
  constraint frame_not_self check (canvas_id <> frame_canvas_id),
  unique (canvas_id, frame_canvas_id)
);

create index if not exists idx_canvas_frames_canvas
  on public.canvas_frames(canvas_id, display_order);
create index if not exists idx_canvas_frames_frame
  on public.canvas_frames(frame_canvas_id);
create index if not exists idx_canvas_frames_owner
  on public.canvas_frames(owner_id);

-- updated_at trigger
create or replace function public.tg_touch_canvas_frames_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_touch_canvas_frames_updated_at on public.canvas_frames;
create trigger trg_touch_canvas_frames_updated_at
  before update on public.canvas_frames
  for each row execute function public.tg_touch_canvas_frames_updated_at();

-- RLS
alter table public.canvas_frames enable row level security;

drop policy if exists "owner_all_canvas_frames" on public.canvas_frames;
create policy "owner_all_canvas_frames" on public.canvas_frames
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

comment on table public.canvas_frames is
  'Universal canvas composition. One row per child canvas embedded as a '
  'frame on a universal/objective canvas. Layout fields are CSS-pixel '
  'coords within the parent canvas viewport. Unique (canvas_id, '
  'frame_canvas_id) prevents double-add.';
