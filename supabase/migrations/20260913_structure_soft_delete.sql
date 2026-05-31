-- ── Structure protection Phase B — soft-delete + skeleton lock ────────
--
-- The second leg of structure protection (companion to
-- 20260912_structure_snapshots.sql). Adds two cross-cutting columns to the
-- structural tables:
--   • deleted_at timestamptz   — soft-delete tombstone (NULL = live).
--   • locked     boolean       — skeleton lock; a locked row refuses
--                                 destructive edits / delete in the API layer.
--
-- WHY a separate migration: the column ADDs below are additive and harmless
-- on their own (nullable tombstone + defaulted flag; Postgres 11+ applies the
-- boolean default without a table rewrite). But the *semantics* are NOT inert:
-- they only protect anything once every READ path adds `where deleted_at is
-- null` and every DELETE path switches to `update … set deleted_at = now()`.
-- That read/write sweep spans ~dozens of objective-canvas routes and is a
-- CROSS-CUTTING change — exactly the kind that collides with a parallel
-- session. So this file is the SUBSTRATE only; the path sweep is a
-- coordinated follow-up, NOT to be done solo.
--
-- ⚠️ APPLY-PENDING + COORDINATION-GATED. Written, not applied. Do not apply
-- until (a) the migration lane is clear AND (b) the read/write-path sweep is
-- planned with the session that owns the objective-canvas read queries.
-- Applying the columns early is safe; flipping deletes to soft-deletes before
-- the read sweep would HIDE rows that legacy `select *` paths still surface.

-- ── deleted_at: soft-delete tombstone ────────────────────────────────
alter table entities          add column if not exists deleted_at timestamptz;
alter table edges             add column if not exists deleted_at timestamptz;
alter table improvement_goals add column if not exists deleted_at timestamptz;
alter table layer_ontology    add column if not exists deleted_at timestamptz;
-- spaces already carries `archived boolean`; deleted_at gives it a precise
-- tombstone timestamp distinct from the (reversible, user-facing) archive flag.
alter table spaces            add column if not exists deleted_at timestamptz;

-- ── locked: skeleton lock (enforced in the API, advisory in SQL) ──────
alter table entities          add column if not exists locked boolean not null default false;
alter table edges             add column if not exists locked boolean not null default false;
alter table improvement_goals add column if not exists locked boolean not null default false;
alter table layer_ontology    add column if not exists locked boolean not null default false;
alter table spaces            add column if not exists locked boolean not null default false;

-- ── Partial indexes — keep the hot "live rows for a space" reads fast ──
-- once the read sweep adds `where deleted_at is null`.
create index if not exists entities_live
  on entities (space_id) where deleted_at is null;
create index if not exists edges_live
  on edges (space_id) where deleted_at is null;
create index if not exists improvement_goals_live
  on improvement_goals (space_id) where deleted_at is null;
create index if not exists layer_ontology_live
  on layer_ontology (space_id) where deleted_at is null;
