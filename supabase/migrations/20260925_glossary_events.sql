-- ── Glossary build-history — append-only event log ────────────────────
--
-- Powers the "how your glossary was built" timeline with PRECISE forward-
-- looking events (term defined / redefined / pinned / source upgraded), so a
-- term's meaning has an auditable provenance trail instead of a single
-- overwrite-in-place updated_at.
--
-- ADDITIVE + soft: the timeline reader (lib/objective-canvas/glossary-timeline.ts)
-- reconstructs a coarse story from existing stamps WITHOUT this table; logged
-- rows simply sharpen it. First + only writer today is apply-resolutions.ts
-- (the user's answers → pinned terms — the highest-signal taste events).
--
-- event_kind / origin / source are FREE-TEXT (documented set, no CHECK) to
-- avoid the migration-clobber trap while parallel sessions are mid-migration.

create table if not exists glossary_events (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces(id) on delete cascade,
  user_id        uuid not null,
  -- cross-surface concept identity (same namespace as glossary + annotations).
  concept_slug   text,
  term           text,
  -- term_defined | term_redefined | pinned | resolved | source_upgraded
  event_kind     text not null,
  -- resolution | sharpening | decompose | manual | reference
  origin         text,
  -- glossary authority at write time: user|annotation|entity|llm.
  source         text,
  old_definition text,
  new_definition text,
  created_at     timestamptz not null default now()
);

create index if not exists glossary_events_space
  on glossary_events (space_id, created_at);
create index if not exists glossary_events_slug
  on glossary_events (space_id, concept_slug);

-- RLS — per-user ownership, matching library_objects_owner.
alter table glossary_events enable row level security;

drop policy if exists glossary_events_owner on glossary_events;
create policy glossary_events_owner on glossary_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
