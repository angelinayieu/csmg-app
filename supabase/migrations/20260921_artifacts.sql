-- ── Artifacts — the persistent "final products" layer ─────────────────
--
-- ARTIFACTS_DOCK_PLAN.md §1. Terminal deliverables the user takes away
-- (prototype | notebook | document | image | social_post | custom),
-- produced on demand from the Artifact Dock and CONTINUOUSLY UPDATED.
--
-- Reuses the `apps` pattern (config/state/stale_reason/versions) WITHOUT
-- widening `apps` itself — apps stay locked to intervention-clusters
-- (20260428_apps_and_interventions.sql); artifacts are the generic layer.
--
-- ADDITIVE + idempotent (`create … if not exists`). object_type / status /
-- stale_reason are FREE-TEXT (documented sets, NOT CHECKs) to avoid the
-- migration-clobber trap while parallel sessions are mid-migration.
-- updated_at is set in app code (lib/objective-canvas/artifacts.ts), matching
-- library_objects — no trigger.

create table if not exists artifacts (
  id                uuid primary key default gen_random_uuid(),
  space_id          uuid not null references spaces(id) on delete cascade,
  user_id           uuid not null,
  -- WHAT it is. set: prototype|notebook|document|image|social_post|custom.
  artifact_type     text not null,
  -- Which dock engine produced it (stable id: build_prototype|notebook|…).
  engine_key        text not null,
  title             text not null default 'Untitled',
  -- generating|ready|error|archived
  status            text not null default 'generating',
  -- Standardized template/settings for this artifact (design language, voice…).
  config            jsonb,
  -- The artifact body (html | notebook blocks | image_url+meta | post text | …).
  content           jsonb,
  -- Source lineage.
  source_object_ids uuid[],          -- library_objects this was built from
  source_shape_ids  text[],          -- board shapes selected at build time
  board_shape_id    text,            -- the card handle on the canvas
  -- Freshness / continuous update (copied from apps).
  stale_reason      text,            -- source_changed|user_edit|manual_refresh|null
  stale_since       timestamptz,
  last_refreshed_at timestamptz,
  last_updated_by   text,            -- user|agent:<engine>
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Idempotent per dock-run handle — re-running an engine into the same board
-- card updates the same row.
create unique index if not exists artifacts_engine_handle
  on artifacts (space_id, engine_key, coalesce(board_shape_id, ''));
create index if not exists artifacts_space      on artifacts (space_id);
create index if not exists artifacts_space_type on artifacts (space_id, artifact_type);

create table if not exists artifact_versions (
  id               uuid primary key default gen_random_uuid(),
  artifact_id      uuid not null references artifacts(id) on delete cascade,
  version          int not null,
  content_snapshot jsonb,
  config_snapshot  jsonb,
  change_type      text not null default 'generated', -- generated|user_edit|agent_update|refresh
  change_summary   text,
  changed_by       text,
  changed_at       timestamptz not null default now(),
  unique (artifact_id, version)
);
create index if not exists artifact_versions_artifact
  on artifact_versions (artifact_id, version desc);

-- RLS — per-user ownership (matches library_objects).
alter table artifacts         enable row level security;
alter table artifact_versions enable row level security;

drop policy if exists artifacts_owner on artifacts;
create policy artifacts_owner on artifacts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists artifact_versions_owner on artifact_versions;
create policy artifact_versions_owner on artifact_versions
  for all using (
    exists (select 1 from artifacts a where a.id = artifact_versions.artifact_id and a.user_id = auth.uid())
  ) with check (
    exists (select 1 from artifacts a where a.id = artifact_versions.artifact_id and a.user_id = auth.uid())
  );
