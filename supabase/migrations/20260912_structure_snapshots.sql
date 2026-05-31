-- ── Structure protection Phase A — structure_snapshots ────────────────
--
-- The load-bearing safety net for the objective canvas. Today the whole
-- objective structure (spaces → improvement_goals[objectives+rooms] →
-- entities → edges + layer_ontology + whiteboard_positions) HARD-deletes
-- via FK cascade with no undo, no lock, no whole-structure restore. A
-- single accidental room/space delete is unrecoverable; even a "saved"
-- library_objects row is itself cascade-killed (source_entity_id → entities
-- ON DELETE CASCADE), so the Library is not durable against deletion either.
--
-- This table is the durable substrate: a denormalized JSONB capture of a
-- structure (whole space, one room, or one scoped subgraph) that survives
-- deletion of its source rows. It mirrors the proven twin_snapshots design
-- (entities/edges stored as jsonb, not FKs) and generalizes it to the full
-- structural set so the capture can be RESPAWNED later.
--
-- ADDITIVE + COLLISION-SAFE by construction:
--   • brand-new table — touches NOTHING the parallel objective-canvas
--     session owns; no existing column, policy, or constraint is altered.
--   • the ONLY foreign key is space_id (cascade): a snapshot is meaningless
--     without its space, but it deliberately holds NO FK to entities /
--     improvement_goals / edges, so deleting those rows never cascades the
--     snapshot away. That is the entire point — it outlives its source.
--   • `create … if not exists` + `drop policy if exists` → safe to (re)apply.
--
-- COORDINATION: this half is safe to apply on its own the moment the
-- migration lane is clear — it changes no read/write path. The companion
-- 20260913_structure_soft_delete.sql (deleted_at/locked columns) is the
-- coordination-GATED half; keep them separate so this one can ship first.
-- Do NOT apply unilaterally while a parallel session is mid-migration.

create table if not exists structure_snapshots (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces(id) on delete cascade,
  user_id       uuid not null,

  -- WHAT was captured.
  -- scope: 'space' (whole objective structure) | 'room' (one improvement_goal
  --        sub-objective + its entities/edges) | 'subgraph' (a scoped slice,
  --        e.g. a problem→mechanism→solution KG anchored on one mechanism).
  scope         text not null default 'space',
  -- room  → improvement_goals.id; subgraph → anchor entities.id; space → null.
  scope_ref     uuid,
  scope_label   text,                         -- human label for listings
  -- why the capture was taken — drives retention + the restore affordance.
  -- 'manual' | 'pre_delete' | 'pre_respawn' | 'auto' | 'library_save'
  reason        text not null default 'manual',

  -- THE PAYLOAD — denormalized, FK-free, survives source deletion.
  -- Shape authored by lib/objective-canvas/structure-snapshot.ts
  -- (StructureSnapshotPayload): { schemaVersion, space, improvementGoals[],
  -- entities[], edges[], layerOntology[], whiteboardPositions[], counts }.
  payload       jsonb not null default '{}'::jsonb,

  -- Cheap listing without parsing payload.
  entity_count   integer not null default 0,
  edge_count     integer not null default 0,
  room_count     integer not null default 0,

  -- Integrity / dedupe. content_hash lets a re-capture skip an identical row;
  -- schema_version guards the payload shape across future migrations.
  content_hash   text,
  schema_version integer not null default 1,

  created_at     timestamptz not null default now()
);

-- Newest-first listing per space, and scoped lookups (a room's history).
create index if not exists structure_snapshots_space
  on structure_snapshots (space_id, created_at desc);
create index if not exists structure_snapshots_scope
  on structure_snapshots (space_id, scope, scope_ref);
-- Idempotent capture: same scope + identical content ⇒ one row.
create unique index if not exists structure_snapshots_dedupe
  on structure_snapshots (space_id, scope, coalesce(scope_ref::text, ''), coalesce(content_hash, ''));

-- RLS — per-user ownership, matching the library_objects / entities pattern.
-- VERIFY against the live entities/improvement_goals policies before applying
-- (match whichever role the API client authenticates as).
alter table structure_snapshots enable row level security;

drop policy if exists structure_snapshots_owner on structure_snapshots;
create policy structure_snapshots_owner on structure_snapshots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
