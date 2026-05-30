-- ── Card nesting: container_card_id ──────────────────────────────
-- Phase 11.A.5 — a second axis BELOW the card row. Lets a sub-feature
-- card nest UNDER a sibling "container" card (a surface / engine /
-- umbrella) WITHOUT touching parent_goal_id.
--
-- Why a new column instead of re-pointing parent_goal_id: ~15 routes
-- resolve the space root via a SINGLE parent_goal_id hop
-- (.eq("id", sub.parent_goal_id)) and several fetch "all cards" via
-- .eq("parent_goal_id", <rootId>). Overloading parent_goal_id for
-- nesting would silently break every one of them. container_card_id
-- is orthogonal: parent_goal_id stays = the space root everywhere,
-- and this column carries ONLY the sub-feature → container relation.
--
-- Additive + nullable. NULL = top-level card (the default; matches
-- current behavior). Self-referential FK; ON DELETE SET NULL so
-- deleting a container un-nests its children rather than cascading.
--
-- Deliberately does NOT alter the sub_objective_decisions action
-- CHECK constraint — the grouping pass logs via the existing
-- layer_position_set action, so this migration stays clear of the
-- co-edited-constraint clobber trap.

alter table public.improvement_goals
  add column if not exists container_card_id uuid
    references public.improvement_goals(id) on delete set null;

create index if not exists improvement_goals_container_card_id_idx
  on public.improvement_goals(container_card_id);

comment on column public.improvement_goals.container_card_id is
  'Optional sibling card this card nests under (sub-feature -> container). NULL = top-level. Distinct from parent_goal_id, which stays = the space root.';
