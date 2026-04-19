-- Phase B: Goal ↔ Agent binding
-- Allows multiple `researcher` agents per space, one bound per active goal.
-- Splits the existing `unique(space_id, kind)` constraint into two partial
-- unique indexes so unbound (kind-singleton) + bound (kind × goal) coexist.

-- ── Tighten the referential integrity: cascade delete instead of set null ──
-- (Bound agents should disappear when their goal does.)
alter table agents
  drop constraint if exists agents_source_goal_id_fkey;

alter table agents
  add constraint agents_source_goal_id_fkey
    foreign key (source_goal_id)
    references improvement_goals(id)
    on delete cascade;

-- ── Drop the blunt unique constraint, replace with partial-unique indexes ──
alter table agents drop constraint if exists agents_space_id_kind_key;

-- One row per (space, kind) when the agent is *not* bound to a goal.
-- Preserves the original Phase A semantics for orchestrator / pipeline kinds.
create unique index if not exists agents_space_kind_unbound_unique
  on agents(space_id, kind)
  where source_goal_id is null;

-- One row per (space, kind, goal) when the agent *is* bound to a goal.
-- Allows multiple researchers in a single space, one per active goal.
create unique index if not exists agents_space_kind_goal_unique
  on agents(space_id, kind, source_goal_id)
  where source_goal_id is not null;
