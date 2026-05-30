# Object Flow — Phase 0 Data Model (LOCK before building)

> The foundation from `OBJECT_FLOW_ARCHITECTURE.md`, as concrete schemas to **lock across
> all parallel sessions before anyone writes the migration.** Additive — it reuses the
> existing blob generation untouched, so it doesn't collide with the in-flight autopilot/
> notebook/whiteboard work. Design only; do NOT apply the migration until coordinated.

## Approach: a curation/reference layer, NOT a blob→rows rewrite

We do **not** migrate variations/specs/experiments/deliverables out of `entities.expanded_detail`
into their own tables — that would rewrite the entire generation pipeline (huge, and collides
with every parallel session). Instead:

> **The blob stays the *content*. A new `library_objects` row is the *addressable handle* +
> the cross-system metadata + the selection state.** Every surface (sidebar, notebook,
> whiteboard, library, final spec) references the `library_objects.id`.

This gives every elect-able item a stable identity + the Library + selection + layer slot +
back-links, while the generation code keeps writing blobs exactly as it does today.

## Schema 1 — `library_objects` (the object handle + §4 metadata + selection)

```sql
create table library_objects (
  id                uuid primary key default gen_random_uuid(),
  space_id          uuid not null references spaces(id) on delete cascade,
  user_id           uuid not null,
  -- WHAT it is
  object_type       text not null,        -- experiment|mechanism|feature|deliverable|insight|
                                          -- ui_idea|recommendation|variation|brainstorm_cluster
  title             text not null,
  summary           text,
  -- WHERE the content lives (the handle into the existing blob/row world)
  source_entity_id        uuid references entities(id) on delete cascade,         -- parent feature/pain/outcome
  source_sub_objective_id uuid references improvement_goals(id) on delete set null, -- source room / variable
  source_ref        text,                 -- blob-local id (variation id, prototype_brief id…); null for entity-level
  content_snapshot  jsonb,                -- optional denormalized copy at save time (display stability)
  -- §4 METADATA
  blueprint_layer_ordinal int,            -- product/blueprint layer (1..N); null = unassigned
  rank_score        numeric,              -- evaluation / ranking score
  evaluation        jsonb,                -- richer evaluation result
  selection_status  text not null default 'candidate',  -- candidate|selected|rejected
  included_in_spec  boolean not null default false,
  in_strategy_brief boolean not null default false,
  on_whiteboard     boolean not null default false,
  board_shape_id    text,                 -- the ONE canonical shape↔object link (fixes the 3-way placement mess)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Idempotent natural key: re-"saving" the same blob item upserts the same row.
create unique index library_objects_natural_key
  on library_objects (space_id, coalesce(source_entity_id::text,''), object_type, coalesce(source_ref,''));
create index library_objects_space        on library_objects (space_id);
create index library_objects_spec         on library_objects (space_id) where included_in_spec;
create index library_objects_layer        on library_objects (space_id, blueprint_layer_ordinal);
-- + RLS: user_id = auth.uid() (mirror the existing entities/improvement_goals policies).
```

**§4 metadata → column map (all 11 covered):** object type→`object_type` · source room→`source_sub_objective_id` · source variable→`source_sub_objective_id` (the sub-objective *is* the IV) · related objective→`space_id` · product layer→`blueprint_layer_ordinal` · ranking→`rank_score` · evaluation→`evaluation` · selection→`selection_status` · in final spec→`included_in_spec` · on whiteboard→`on_whiteboard`+`board_shape_id` · in strategy brief→`in_strategy_brief`.

## Schema 2 — `object_links` (the missing back-half object graph)

The front hops (objective→room→feature→variation→experiment) are already real FKs. The
**missing** links are the back half — this table adds them:

```sql
create table object_links (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces(id) on delete cascade,
  from_object_id uuid not null references library_objects(id) on delete cascade,
  to_object_id   uuid not null references library_objects(id) on delete cascade,
  relation       text not null,   -- validates(exp→mechanism) | delivers(deliverable→exp) |
                                  -- depends_on(feature→feature) | feeds(→layer/spec) | derived_from
  created_at     timestamptz not null default now(),
  unique (from_object_id, to_object_id, relation)
);
```

This makes every final-spec section back-traceable to the objective/mechanism/experiment it
came from (§6, §17.10) and gives the ranker real cross-system context (§6).

## Adoption — additive, in dependency order (most is NEW files; wiring is coordinated)

1. **New helper lib `lib/objective-canvas/library-objects.ts`** — `upsertObject()`, `getObject()`,
   `listObjects(spaceId, filter)`, `setSelection()`, `link()`. New file → **zero collision.**
2. **One-time backfill** — create `library_objects` rows from existing `disposition === "elected"`
   variations so nothing already curated is lost.
3. **Wire reads/writes (COORDINATED — touches contested files, do after the schema is locked):**
   - card actions (§2) → `upsertObject` + `setSelection`;
   - final-spec compiler reads `library_objects WHERE included_in_spec` (replaces the blob scan);
   - Library page reads `library_objects` (replaces the count);
   - whiteboard placement writes `board_shape_id` + `on_whiteboard`.

## What it unlocks (→ the 18)

| Section | Becomes possible because… |
|---|---|
| §2 card actions (save/rank/select/reject/trace) | every item has an id + a `library_objects` row to write |
| §3 whiteboard placement (+ persistence) | `board_shape_id` is the canonical link |
| §4 Library | `library_objects` IS the model (its schema = your §4 list) |
| §6 object graph + context ranking | `object_links` + the metadata give cross-system context |
| §7 blueprint layers + swap | `blueprint_layer_ordinal` is a real per-object slot |
| §8 final spec from selection | compiler reads `included_in_spec`, not loose blobs; swap→regen by flipping a flag |

## Open decisions to LOCK (with the parallel sessions)

1. **Eager vs lazy object creation** — recommend **lazy + idempotent upsert** (create the row on first action; the natural key dedupes). Avoids row-explosion; the blob remains the universe.
2. **`object_type` integrity** — recommend **free-text + documented set** (NOT a CHECK) given the active migration-clobber sensitivity; tighten to a CHECK later when migrations calm.
3. **Layer slot home** — recommend on `library_objects` for Phase 0 (curation-layer property), not a new column on `entities`.
4. **Migration timing** — a `brainstorm_sessions` + `deliverable_visibility` migration are already uncommitted; this migration must be sequenced with those, not stacked blindly.

**This is the lock point.** Once these two tables + the lazy/idempotent/free-text decisions are
agreed, every parallel session can build §1–§18 against the same substrate instead of colliding.
