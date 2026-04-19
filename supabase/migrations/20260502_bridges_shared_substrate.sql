-- Sprint 0 / Step 3 — promote `bridges` to the shared cross-scope substrate
--
-- Today `bridges` is populated only by the bilateral /api/weave endpoint
-- and read only by the Weave page + Synthesis cross-area section.
-- We're promoting it to the canonical table for *any* cross-scope concept
-- link — weave output, user-drawn links on the universal canvas, and
-- high-confidence ambient detections that get promoted.
--
-- Additions:
--   canvas_id     — which canvas surfaced/originated this bridge (nullable:
--                   weave-only bridges have no canvas of origin).
--   origin        — 'weave' (default, bilateral analysis),
--                   'universal_canvas' (user drew link on universal canvas),
--                   'ambient_promoted' (ambient detection confirmed by user).
--   status        — 'active' (default — show in all surfaces),
--                   'user_confirmed' (user explicitly approved),
--                   'user_rejected' (dismissed; kept for audit + "don't resurface").
--   created_at    — was missing; added so feeds can subscribe to new bridges.
--   created_by    — user that produced the bridge (null for weave jobs).
--
-- Upstream producers (post-Sprints 3-5):
--   /api/weave           → origin='weave', status='active'
--   /api/proposals/:id/resolve (when accepted concept is cross-canvas)
--                        → origin='ambient_promoted', status='user_confirmed'
--   /api/canvases/:id/bridges (manual user link on universal canvas)
--                        → origin='universal_canvas', status='user_confirmed'
--
-- Downstream consumers:
--   Synthesis view "Cross-Area Connections"
--   Universal canvas edge layer
--   CanvasCard connectedness Ring

alter table public.bridges
  add column if not exists canvas_id uuid
    references public.canvases(id) on delete set null,
  add column if not exists origin text
    default 'weave'
    check (origin in ('weave','universal_canvas','ambient_promoted','manual')),
  add column if not exists status text
    default 'active'
    check (status in ('active','user_confirmed','user_rejected')),
  add column if not exists created_at timestamptz
    default now(),
  add column if not exists created_by uuid
    references auth.users(id) on delete set null,
  add column if not exists rationale text;

-- Backfill: everything that exists today came from the weave endpoint.
update public.bridges
  set origin = 'weave', status = 'active'
  where origin is null or status is null;

-- Tighten NOT NULL now that backfill is safe
alter table public.bridges
  alter column origin set not null,
  alter column status set not null,
  alter column created_at set not null;

create index if not exists idx_bridges_canvas
  on public.bridges(canvas_id) where canvas_id is not null;
create index if not exists idx_bridges_status
  on public.bridges(status) where status <> 'user_rejected';
create index if not exists idx_bridges_origin_created
  on public.bridges(origin, created_at desc);
create index if not exists idx_bridges_source_space
  on public.bridges(source_space_id);
create index if not exists idx_bridges_target_space
  on public.bridges(target_space_id);
-- For the "which canvases is entity X bridged to?" query that powers the
-- CanvasCard connectedness Ring and the universal canvas edge layer.
create index if not exists idx_bridges_source_entity_active
  on public.bridges(source_entity_id) where status <> 'user_rejected';
create index if not exists idx_bridges_target_entity_active
  on public.bridges(target_entity_id) where status <> 'user_rejected';

-- Deduplication guard: prevent re-runs of weave from piling up identical
-- bridges. A bridge is considered duplicate if it has the same
-- (source_entity, target_entity, bridge_type) and is currently active.
-- Enforced via partial unique index; user-rejected rows are excluded so
-- re-proposing a rejected bridge is possible after the user explicitly
-- un-rejects it.
create unique index if not exists uq_bridges_active_triple
  on public.bridges(source_entity_id, target_entity_id, bridge_type)
  where status <> 'user_rejected';

-- RLS — bridges inherits from source_space RLS; align on owner access.
-- The existing policy (if any) is preserved; add an owner-scoped policy
-- if none exists yet.
alter table public.bridges enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bridges' and policyname = 'owner_all_bridges'
  ) then
    execute $p$
      create policy "owner_all_bridges" on public.bridges
      for all using (
        source_space_id in (select id from public.spaces where user_id = auth.uid())
        or target_space_id in (select id from public.spaces where user_id = auth.uid())
      )
      with check (
        source_space_id in (select id from public.spaces where user_id = auth.uid())
        or target_space_id in (select id from public.spaces where user_id = auth.uid())
      )
    $p$;
  end if;
end $$;

comment on column public.bridges.canvas_id is
  'Canvas on which this bridge was surfaced/created. NULL for bridges produced '
  'by a weave job that was not triggered from a canvas context.';
comment on column public.bridges.origin is
  'How this bridge came to exist: weave (LLM bilateral analysis), '
  'universal_canvas (user drew link), ambient_promoted (ambient detection '
  'confirmed by user), manual (direct API).';
comment on column public.bridges.status is
  'active = default, visible in synthesis + canvas; user_confirmed = user '
  'explicitly approved; user_rejected = dismissed, kept for dedup + "do not resurface".';
