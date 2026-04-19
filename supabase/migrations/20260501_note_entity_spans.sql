-- Sprint 0 / Step 2 — note_entity_spans: character-range anchoring
--
-- The structural fix for multi-concept notes. Every AI-surfaced concept
-- (from ambient detection, weave, or hierarchical deepen) must tie back
-- to a specific character range in a sticky note. Without this, a note
-- like "I've been thinking about retention AND onboarding" can only
-- carry note-level tags — the UI can't show which underline = which
-- entity, and the user can't reject one without rejecting both.
--
-- Notes are stored inside the tldraw snapshot (public.space_canvases.snapshot
-- and public.canvases.snapshot). The snapshot is opaque JSON, so we can't
-- FK note_id into it. Instead note_id is a string (the tldraw shape id)
-- scoped to (canvas_id, note_id). Integrity is maintained by the canvas
-- write path which prunes span rows whose note_id no longer exists in
-- the snapshot on autosave (implemented in Sprint 1).
--
-- Upstream producer: /api/canvas/ambient (Sprint 3), /api/proposals/:id/resolve
-- Downstream consumer: ProposalRail, Synthesis cross-area section.

create table if not exists public.note_entity_spans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  -- Where the span lives
  canvas_id uuid not null references public.canvases(id) on delete cascade,
  note_id text not null,              -- tldraw shape id inside canvas snapshot

  -- Which concept it binds to
  entity_id uuid references public.entities(id) on delete cascade,
  -- Proposed-but-not-yet-materialized concept: carries a name, no entity yet.
  -- When the user accepts and the app creates the entity, this becomes non-null.
  proposed_entity_name text,

  -- Character range within the note's plain-text content (inclusive start,
  -- exclusive end; start < end; both >= 0).
  start_offset int not null check (start_offset >= 0),
  end_offset int not null check (end_offset > start_offset),

  -- Lifecycle
  status text not null default 'proposed'
    check (status in ('proposed','accepted','rejected','dismissed','stale')),
  -- 'stale' = the note text changed and the span no longer maps to a valid range.
  --           Set by the canvas write path; UI shows these muted.

  source text not null
    check (source in ('ambient','weave','manual','hierarchical','ambient_promoted')),
  confidence float check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- Snapshot of the anchored text at resolution time (for stale detection + audit)
  anchored_text text,

  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,

  -- At least one of entity_id / proposed_entity_name must be set
  constraint span_has_target check (
    entity_id is not null or proposed_entity_name is not null
  )
);

create index if not exists idx_spans_canvas_note
  on public.note_entity_spans(canvas_id, note_id);
create index if not exists idx_spans_owner
  on public.note_entity_spans(owner_id);
create index if not exists idx_spans_entity
  on public.note_entity_spans(entity_id) where entity_id is not null;
create index if not exists idx_spans_status
  on public.note_entity_spans(canvas_id, status) where status in ('proposed','accepted');
create index if not exists idx_spans_created
  on public.note_entity_spans(created_at desc);
-- One accepted span per (canvas, note, entity, range). Multiple proposed
-- spans with the same range allowed until user resolves them.
create unique index if not exists uq_spans_accepted
  on public.note_entity_spans(canvas_id, note_id, entity_id, start_offset, end_offset)
  where status = 'accepted' and entity_id is not null;

-- Touch resolved_at automatically when status moves away from 'proposed'
create or replace function public.tg_touch_span_resolved_at()
returns trigger language plpgsql as $$
begin
  if new.status <> 'proposed' and (old.status = 'proposed' or old.status is null) then
    new.resolved_at = now();
  end if;
  return new;
end $$;

drop trigger if exists trg_touch_span_resolved_at on public.note_entity_spans;
create trigger trg_touch_span_resolved_at
  before insert or update on public.note_entity_spans
  for each row execute function public.tg_touch_span_resolved_at();

-- RLS
alter table public.note_entity_spans enable row level security;

drop policy if exists "owner_all_spans" on public.note_entity_spans;
create policy "owner_all_spans" on public.note_entity_spans
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

comment on table public.note_entity_spans is
  'Character-range anchors tying AI-detected concepts to specific spans inside '
  'sticky note text. Enables per-span accept/reject, distinct inline underlines '
  'per concept in multi-concept notes, and clean synthesis cross-references. '
  'Pruned on canvas autosave when note text changes invalidate the offsets.';
