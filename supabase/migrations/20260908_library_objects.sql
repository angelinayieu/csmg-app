-- ── Object Flow Phase 0 — library_objects + object_links ──────────────
--
-- The curation/reference layer from OBJECT_FLOW_PHASE0_DATAMODEL.md.
-- ADDITIVE: does NOT touch entities.expanded_detail or any existing table.
-- The blob stays the content; these rows are the addressable HANDLE +
-- §4 metadata + selection state + the back-half object graph.
--
-- LOCKED defaults: lazy/idempotent creation (natural-key upsert in
-- lib/objective-canvas/library-objects.ts); object_type is free-text +
-- documented set (NOT a CHECK — avoids the migration-clobber trap while
-- parallel sessions are mid-migration); layer slot lives here, not on entities.
--
-- COORDINATION: apply AFTER the in-flight 20260906_deliverable_visibility +
-- 20260907_brainstorm_sessions migrations. `create … if not exists` makes it
-- safe to apply without clobbering. Do not apply until the migration lane is clear.

create table if not exists library_objects (
  id                      uuid primary key default gen_random_uuid(),
  space_id                uuid not null references spaces(id) on delete cascade,
  user_id                 uuid not null,
  -- WHAT it is. object_type set: experiment|mechanism|feature|deliverable|
  -- insight|ui_idea|recommendation|variation|brainstorm_cluster (free-text by decision).
  object_type             text not null,
  title                   text not null,
  summary                 text,
  -- WHERE the content lives (handle into the existing blob/row world).
  source_entity_id        uuid references entities(id) on delete cascade,
  source_sub_objective_id uuid references improvement_goals(id) on delete set null,
  source_ref              text,            -- blob-local id (variation/prototype_brief id); null = entity-level
  content_snapshot        jsonb,           -- optional denormalized copy at save time
  -- §4 METADATA + selection
  blueprint_layer_ordinal int,
  rank_score              numeric,
  evaluation              jsonb,
  selection_status        text not null default 'candidate',  -- candidate|selected|rejected
  included_in_spec        boolean not null default false,
  in_strategy_brief       boolean not null default false,
  on_whiteboard           boolean not null default false,
  board_shape_id          text,            -- canonical shape↔object link
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Idempotent natural key — re-saving the same blob item upserts the same row.
create unique index if not exists library_objects_natural_key
  on library_objects (space_id, coalesce(source_entity_id::text, ''), object_type, coalesce(source_ref, ''));
create index if not exists library_objects_space on library_objects (space_id);
create index if not exists library_objects_spec  on library_objects (space_id) where included_in_spec;
create index if not exists library_objects_layer on library_objects (space_id, blueprint_layer_ordinal);

create table if not exists object_links (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces(id) on delete cascade,
  from_object_id uuid not null references library_objects(id) on delete cascade,
  to_object_id   uuid not null references library_objects(id) on delete cascade,
  -- validates(exp→mechanism)|delivers(deliverable→exp)|depends_on(feature→feature)|feeds|derived_from
  relation       text not null,
  created_at     timestamptz not null default now(),
  unique (from_object_id, to_object_id, relation)
);
create index if not exists object_links_space on object_links (space_id);
create index if not exists object_links_from  on object_links (from_object_id);

-- RLS — per-user ownership. VERIFY against the existing entities/improvement_goals
-- policies before applying (match whichever role the API client uses).
alter table library_objects enable row level security;
alter table object_links    enable row level security;

drop policy if exists library_objects_owner on library_objects;
create policy library_objects_owner on library_objects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists object_links_owner on object_links;
create policy object_links_owner on object_links
  for all using (
    exists (select 1 from spaces s where s.id = object_links.space_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from spaces s where s.id = object_links.space_id and s.user_id = auth.uid())
  );
