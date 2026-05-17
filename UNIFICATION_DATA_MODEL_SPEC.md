# Synergy → InteraxisCanvas Unification: Data Model Spec

**Status:** Draft for review · Author: Claude · Last updated: 2026-05-16
**Branch:** `claude/restore-profile-settings-b8nYW`
**Related:** Phase 2 / Phase 3 of the canvas consolidation plan

This document specifies how data currently in the Synergy whiteboard schema
(`brainstorm_sessions`, `brainstorm_nodes`, `brainstorm_components`,
`brainstorm_strokes`, `synergy_strategies`, `synergy_strategy_blocks`) gets
translated into the InteraxisCanvas schema (`spaces`, `entities`, `edges`,
`apps`, plus tldraw shape store). The translation defines what Phase 3 (data
migration + retirement of `/app/synergy/[id]`) actually does.

The document does NOT cover Phase 2 (feature ports — voice, autopilot, focus
mode, selection popover). Those are separate specs.

---

## 1. Goals

1. One canvas codebase (InteraxisCanvas) serves every experience mode.
2. One source-of-truth schema (`spaces` + `entities` + `edges`) for ideation
   artifacts. No more parallel `brainstorm_*` tables for new content.
3. Existing brainstorm sessions remain readable; either migrated in place or
   exposed via a translation view.
4. No data loss. Every Synergy artifact has a clear home in the new model.
5. Reversible. If something goes wrong, we can roll back without orphaning
   user content.

## 2. Non-goals

- Building the Phase 2 feature ports (voice, autopilot, focus mode, popover).
- Multiplayer / collaborative editing. Synergy's `synergy_rooms` stay
  separate; rooms are not yet a canvas feature.
- Marketplace / public feed. `synergy_components` discovery stays Synergy-
  flavored until cross-system marketplace is designed.

## 3. Table-by-table translation

### 3.1 `brainstorm_sessions` → `spaces`

Synergy sessions become spaces with a new `kind` field distinguishing them.

| `brainstorm_sessions` column | `spaces` column | Translation |
|---|---|---|
| `id` | `id` | Keep the same UUID — preserves any URL bookmarks via redirect. |
| `owner_id` | `user_id` | Direct copy. |
| `title` | `name` | Direct copy. |
| `objective_statement` | `description` | If `description` is null, copy `objective_statement` into it. |
| `objective_constraints` | `synthesis_data.constraints` | Push into JSONB under `synthesis_data`. |
| `objective_success_criteria` | `synthesis_data.success_criteria` | Same. |
| `state` ('drafting' \| 'processed' \| 'published' \| 'archived') | `archived` (bool) + `kind_state` (text, new) | `archived = (state === 'archived')`. New `kind_state` captures drafting/processed/published. |
| `created_at` | `created_at` | Direct. |
| `updated_at` | `updated_at` | Direct. |
| n/a | `kind` | **NEW.** Set to `'brainstorm'` for migrated rows. New spaces use `'project'` (full pipeline) or `'twin'` (digital twin). |
| n/a | `space_prefix` | **NEW.** Derive 2-char prefix from title (matches existing logic). |
| n/a | `reasoning_settings.experienceMode` | Inferred: if session has `polished_product` components → `precise_rd`; else `brain_probe`. |

**New columns on `spaces`:**
- `kind text not null default 'project'` — values: `'project' | 'brainstorm' | 'twin'`
- `kind_state text` — values: `'drafting' | 'processed' | 'published'` (only used when `kind='brainstorm'`)

### 3.2 `brainstorm_nodes` → `entities` + tldraw shapes

This is the load-bearing translation. Each brainstorm node becomes BOTH an
`entities` row AND a tldraw shape (because positions live in the tldraw store,
not the entities table).

| `brainstorm_nodes` column | Destination | Translation |
|---|---|---|
| `id` | `entities.id` | Same UUID. |
| `session_id` | `entities.space_id` | Direct (sessions are now spaces). |
| `parent_id` | NOT a column on entities | Becomes an `edges` row: `edges.from_id = parent_id`, `edges.to_id = node.id`, `edges.relationship_type = 'parent_of'`. |
| `kind` | `entities.entity_type` | Mapping table below. |
| `label` | `entities.name` | Direct. |
| `meta` | `entities.description` | Direct. |
| `x`, `y` | tldraw shape `props.x`, `props.y` | Stored in the tldraw snapshot, not in the entities row. Migration creates a `kg-node` shape for each entity at the original `(x, y)`. |
| `created_at` | `entities.created_at` | Direct. |

**Type mapping (`brainstorm_nodes.kind` → `entities.entity_type`):**

| Synergy `kind` | Canvas `entity_type` | Notes |
|---|---|---|
| `core` | `core_idea` | Add as new entity_type if not present. |
| `branch` | `concept` | Generic branch node. |
| `insight` | `insight` | Direct. |
| `question` | `question` | Direct. |
| `action` | `intervention` | Maps to canvas's intervention concept. |
| `user` | `user_input` | New type for user-typed content. |
| `variation` | `concept` + `entity_category='variation'` | Use category to preserve variation grouping. |
| `ranking` | `concept` + `entity_category='ranked'` | Used by rank action. |
| `plan` | `plan_step` | Maps to plan-step blocks. |
| `synergy` | `concept` + `entity_category='synergy'` | Cross-component synergy markers. |

This requires the canvas's entity-type enum to include `core_idea`, `insight`,
`question`, `intervention`, `user_input`, `plan_step` if they don't already.
Verify via schema check before migration.

### 3.3 `brainstorm_components` → `entities` (extracted markers)

Components are derived artifacts (extracted from nodes). They become entities
with an `is_extracted` flag.

| `brainstorm_components` column | `entities` column | Translation |
|---|---|---|
| `id` | `entities.id` | Same UUID. |
| `session_id` | `entities.space_id` | Same as 3.1. |
| `kind` (`core_idea` \| `upstream_dependency` \| `downstream_output` \| `alternative` \| `polished_product`) | `entities.extraction_kind` (new column) | Direct mapping. |
| `subkind` | `entities.entity_category` | Direct. |
| `label_public` | `entities.name` | Direct. |
| `description_public` | `entities.description` | Direct. |
| `description_private` | `entities.private_description` (new column) | Owner-only field. |
| `visibility` (`private` \| `matchable_only` \| `public`) | `entities.visibility` (new column) | Same enum. |
| `match_count` | NOT migrated | Recomputed from `component_matches` table by background job. |
| n/a | `entities.is_extracted` (new column) | Set `true` for all migrated components. |

**New columns on `entities`:**
- `is_extracted boolean not null default false`
- `extraction_kind text` — values: `'core_idea' | 'upstream_dependency' | 'downstream_output' | 'alternative' | 'polished_product'`
- `private_description text`
- `visibility text not null default 'private'` — values: `'private' | 'matchable_only' | 'public'`

Components don't have tldraw shapes (they're not visible on the whiteboard
directly — they appear in the Strategy Doc and the marketplace). No shape
migration needed.

### 3.4 `brainstorm_strokes` → tldraw freehand shapes (OR dropped)

Synergy stored freehand ink in `brainstorm_strokes`. Tldraw has native draw
shapes. Two options:

**(a) Migrate.** Translate each stroke row into a tldraw `draw` shape with the
same point data. ~1 day of work; complete fidelity.

**(b) Drop.** Inform users in a one-time banner; sessions migrate without ink;
they can redraw. ~0 days; minor user-facing loss.

**Recommendation: (a) for sessions with non-zero strokes, (b) for empty ones.**
Most sessions don't have strokes; the migration script can decide per-session.

### 3.5 `synergy_strategies` + `synergy_strategy_blocks` → kept, linked

The strategy doc tables stay AS-IS. Add ONE nullable column linking back to
the new space.

**New column on `synergy_strategies`:**
- `space_id uuid references spaces(id)` — nullable so legacy rows (pre-
  migration) don't break.

After migration: a brainstorm_session's strategy doc is still at
`/app/synergy/[strategy_id]/strategy` — preserved via the SAME UUID since
sessions and spaces share IDs (see 3.1).

The Final Products tab (Phase 2b) reads strategies via this `space_id`
foreign key — so any canvas space can have an associated strategy doc.

### 3.6 `synergy_rooms`, `match_requests`, `component_matches`, `synergy_room_*`

Not migrated. These are Synergy-only collaborative features. They stay in
their current tables. The Synergy whiteboard route may need to remain alive
in some form to support rooms — TBD by Phase 3 review.

## 4. Migration strategy

### Option A: Batch script (recommended)

A single migration runs once, per-user, on the next sign-in after Phase 3
deploys. Steps:

1. Lock the user's brainstorm sessions for write (5-second window).
2. For each session, create:
   - One `spaces` row (kind=`brainstorm`, same UUID).
   - N `entities` rows (one per node, type-mapped).
   - N-1 `edges` rows (one per parent-child relationship, plus any lateral).
   - K `entities` rows for components (is_extracted=true).
   - One `synergy_strategies.space_id` update if a strategy exists.
   - One tldraw snapshot with K kg-node shapes at original positions.
3. Mark `brainstorm_sessions.migrated_to_space_id = <space_id>` so the legacy
   route can redirect.
4. Release the lock.

Pros: Clean cutover. After migration, brainstorm_sessions becomes read-only.
Cons: Locks users briefly. Bug surface is the script itself — needs careful
testing.

### Option B: Lazy / on-read

Brainstorm sessions stay as-is until the user opens them. First open triggers
the same translation logic above, then the user is redirected to the new
canvas. Subsequent reads go to the canvas.

Pros: No big-bang deploy. Users only feel the cost when they touch a session.
Cons: Translation logic lives in production indefinitely. Some sessions might
never get touched and remain in the old schema forever.

**Recommendation: Option A.** The schema duality is a maintenance tax that
gets worse over time. Pay it once.

### Failure modes + rollback

- Script aborts mid-session → partial rows in entities/edges. Cleanup query
  deletes rows where `entities.space_id = <session_id> AND created_at >
  <migration_start>`. Idempotent re-run.
- Type mapping fails (unknown node kind) → log + skip; user reports later;
  fixed in code + re-run for that user.
- Tldraw snapshot too large → split into multiple chunks; tldraw supports
  partial-state hydration.

Rollback: keep `brainstorm_sessions` table around for 30 days post-migration.
If catastrophic issue, revert the `spaces.kind` filter and restore legacy
routing.

## 5. Schema migration SQL (concrete)

```sql
-- Migration: 20260601_phase3_canvas_unification.sql

-- 5.1 spaces table additions
ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'project',
  ADD COLUMN IF NOT EXISTS kind_state text;

ALTER TABLE spaces
  ADD CONSTRAINT spaces_kind_check
  CHECK (kind IN ('project', 'brainstorm', 'twin'));

CREATE INDEX IF NOT EXISTS idx_spaces_kind ON spaces (kind);

-- 5.2 entities table additions
ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS is_extracted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extraction_kind text,
  ADD COLUMN IF NOT EXISTS private_description text,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

ALTER TABLE entities
  ADD CONSTRAINT entities_extraction_kind_check
  CHECK (extraction_kind IS NULL OR extraction_kind IN (
    'core_idea', 'upstream_dependency', 'downstream_output',
    'alternative', 'polished_product'
  ));

ALTER TABLE entities
  ADD CONSTRAINT entities_visibility_check
  CHECK (visibility IN ('private', 'matchable_only', 'public'));

-- 5.3 synergy_strategies linkback
ALTER TABLE synergy_strategies
  ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES spaces(id);

CREATE INDEX IF NOT EXISTS idx_synergy_strategies_space_id
  ON synergy_strategies (space_id);

-- 5.4 brainstorm_sessions: track migration target
ALTER TABLE brainstorm_sessions
  ADD COLUMN IF NOT EXISTS migrated_to_space_id uuid REFERENCES spaces(id);

CREATE INDEX IF NOT EXISTS idx_brainstorm_sessions_migrated
  ON brainstorm_sessions (migrated_to_space_id)
  WHERE migrated_to_space_id IS NOT NULL;
```

Three columns added on spaces, four on entities, two on synergy_strategies +
brainstorm_sessions. No destructive changes. Rollback is dropping these
columns.

## 6. Edge cases

### 6.1 Lateral edges (in-memory in Synergy)

Synergy's `connectFromId` lateral edges are in-memory only (V1, never
persisted). They're lost on page reload today. Migration drops them silently
— no data exists to migrate.

If we wanted to preserve them mid-session: serialize the in-memory lateral-
edges state to a `client_state` JSONB column. Out of scope; defer.

### 6.2 Sessions with strokes

Per 3.4, sessions with non-zero `brainstorm_strokes` rows trigger the (a)
migration path (translate to tldraw draw shapes). Empty-stroke sessions skip
this step.

### 6.3 Sessions in 'published' state with strategy docs

The strategy doc table (`synergy_strategies`) stays — only adds `space_id`
back-link. The doc remains accessible at `/app/synergy/[id]/strategy` post-
migration (same UUID). Eventually we add `/app/space/[id]/strategy` as the
canonical URL; old URL redirects.

### 6.4 Sessions used in rooms / matched components

Rooms and matches reference brainstorm_components by ID. Since components
keep their original IDs (3.3), no relinking needed. The room continues to
work; matches continue to resolve.

### 6.5 Twin-mode brainstorm sessions

There aren't any today — twin lives on the canvas already, not on Synergy.
Sessions migrate as `kind='brainstorm'`; if a user wants to escalate one
into a twin, they trigger the twin flow which sets `digital_twin_state` and
overrides `kind='twin'`. Path covered by Phase 2c.

### 6.6 Performance

Migration script estimate: ~10ms/node + 20ms/edge + 50ms/component for the
insert burst. For a typical 50-node session: ~3 seconds. For the largest
sessions (~500 nodes): ~30 seconds, batched. Acceptable for one-time
migration.

## 7. Open questions for review

These need explicit answers before the spec is locked.

1. **Auto-migrate on next sign-in vs schedule a maintenance window?**
   Default: auto-migrate per-session lazily during off-peak hours via a
   background worker. Users see no interruption.

2. **Should `spaces.kind = 'brainstorm'` show in the user's space list,
   or be hidden by default?** Default: show, with a small "Brainstorm"
   label badge. Users find them easily.

3. **Do we keep `/app/synergy/[id]` as an alias forever, or sunset after
   N months?** Default: 6-month redirect window, then hard-deprecate.

4. **Strategy doc URL — keep `/app/synergy/[id]/strategy` or move to
   `/app/space/[id]/strategy`?** Default: add the canvas URL as canonical,
   keep the synergy URL as a redirect for 6 months.

5. **Stroke migration policy — migrate all, migrate none, or migrate
   per-session-on-open?** Default: migrate on first canvas open
   (incremental cost, no big-bang).

6. **`spaces.kind` enum — three values (`project | brainstorm | twin`)
   enough, or do we need more granularity?** Reserved values: `analysis`,
   `template`. Default: start with three, add as needed.

7. **What happens to sessions where the user never converged (drafting
   state)?** They migrate the same way — get a space with no strategy,
   no extracted components, just nodes.

## 8. Estimated effort

- Schema migration SQL: ~2 hours
- Migration script (TypeScript, Inngest job): ~3 days
- Canvas read path adaptations (handle migrated spaces): ~2 days
- URL redirect layer: ~0.5 day
- Smoke tests + sample data migration validation: ~1.5 days
- Rollback runbook + monitoring: ~1 day

**Total: ~7 days of focused work.** Schedules after Phase 2a and 2b ship.

## 9. Decision required from product owner

Three bullet asks:

1. **Approve the type-mapping table** (3.2). Specifically: does the
   `kind` → `entity_type` mapping match how you want these to render on
   the canvas? Some kinds may need their own shape (e.g. `question` →
   question-card shape, not regular kg-node).

2. **Approve the migration strategy** (4). Option A (batch) or B (lazy)?

3. **Lock the answers to the 7 open questions** in §7. Even a "use the
   defaults, we'll revisit later" is enough to proceed.

Once these are answered, Phase 3 has clear acceptance criteria and can be
scheduled.

---

**End of spec.**
