-- Sprint 0 / Step 5 — concept_proposals: durable proposal queue
--
-- Today ambient detection is ephemeral — results come back in the HUD
-- rail, and if the user refreshes they're gone. For the Sprint 3 approve/
-- reject sidebar UX to work (grouped by note → by span, keyboard nav,
-- "pending vs resolved" counters), proposals must survive the request.
--
-- A proposal is the full record of "we think entity X may relate to
-- span Y in note Z." The user acts on it via /api/proposals/:id/resolve
-- which flips status and writes the resolution into note_entity_spans
-- (accept) or bridges (cross-canvas accept) or just closes it (reject).
--
-- Upstream producer: /api/canvas/ambient (Sprint 3) — one row per detected
--                    (span, candidate entity) pair.
-- Downstream consumer: ProposalRail component (Sprint 3), feeds into
--                      note_entity_spans on accept, bridges on cross-canvas accept.

create table if not exists public.concept_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  -- Where the proposal applies
  canvas_id uuid not null references public.canvases(id) on delete cascade,
  note_id text not null,                   -- tldraw shape id inside canvas snapshot
  span_id uuid references public.note_entity_spans(id) on delete cascade,
  -- span_id may be null if the proposal is a "note-level" fallback
  -- (e.g. concept clearly present but we couldn't pinpoint a single span).

  -- Span range (denormalized so proposals can be fetched without joining
  -- note_entity_spans; primary for UI highlighting).
  start_offset int check (start_offset is null or start_offset >= 0),
  end_offset int check (end_offset is null or end_offset > coalesce(start_offset, -1)),
  anchored_text text,                      -- snapshot of the actual text

  -- What's being proposed
  entity_id uuid references public.entities(id) on delete cascade,
  -- New-entity proposal: if retrieval found no close match, the ambient
  -- route can still propose "create a new concept named X" so the user
  -- can materialize novel concepts without leaving the canvas.
  proposed_entity_name text,
  proposed_entity_description text,

  -- Cross-canvas linkage — if the candidate entity lives on a *different*
  -- canvas than this one, accepting the proposal creates a bridges row.
  target_canvas_id uuid references public.canvases(id) on delete set null,

  -- Reasoning surfaced to the user (1-line "why we think this")
  rationale text,

  -- Ranking
  confidence float not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  source text not null
    check (source in ('ambient','weave','hierarchical','manual')),

  -- Lifecycle
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','dismissed','expired','superseded')),
  -- expired = older than N hours and never resolved; the UI auto-cleans these.
  -- superseded = a newer proposal for the same span replaced this one.

  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,

  -- Must propose something concrete
  constraint proposal_has_target check (
    entity_id is not null or proposed_entity_name is not null
  )
);

create index if not exists idx_proposals_canvas_note_pending
  on public.concept_proposals(canvas_id, note_id)
  where status = 'pending';
create index if not exists idx_proposals_owner_pending
  on public.concept_proposals(owner_id, created_at desc)
  where status = 'pending';
create index if not exists idx_proposals_span
  on public.concept_proposals(span_id) where span_id is not null;
create index if not exists idx_proposals_entity
  on public.concept_proposals(entity_id) where entity_id is not null;
create index if not exists idx_proposals_created
  on public.concept_proposals(created_at desc);
-- Prevent thrashing: same (canvas, note, span-range, entity) can only have
-- one pending proposal at a time. Ambient re-runs on keystroke must upsert
-- rather than create duplicates.
create unique index if not exists uq_proposals_pending_unique
  on public.concept_proposals(
    canvas_id, note_id,
    coalesce(start_offset, -1),
    coalesce(end_offset, -1),
    coalesce(entity_id::text, proposed_entity_name)
  )
  where status = 'pending';

-- Touch resolved_at on transition out of pending
create or replace function public.tg_touch_proposal_resolved_at()
returns trigger language plpgsql as $$
begin
  if new.status <> 'pending' and (old.status = 'pending' or old.status is null) then
    new.resolved_at = now();
  end if;
  return new;
end $$;

drop trigger if exists trg_touch_proposal_resolved_at on public.concept_proposals;
create trigger trg_touch_proposal_resolved_at
  before insert or update on public.concept_proposals
  for each row execute function public.tg_touch_proposal_resolved_at();

-- RLS
alter table public.concept_proposals enable row level security;

drop policy if exists "owner_all_proposals" on public.concept_proposals;
create policy "owner_all_proposals" on public.concept_proposals
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

comment on table public.concept_proposals is
  'Durable queue of AI-surfaced concept detections awaiting user accept/reject. '
  'One row per (span, candidate) pair produced by ambient detection (Sprint 3). '
  'Accepting writes to note_entity_spans (and bridges if target_canvas_id is set); '
  'rejecting keeps the row as audit + "do not resurface" signal.';
