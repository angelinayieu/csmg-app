-- Phase 9 — Lab Notebook extensions to sub_objective_decisions.
--
-- Two structural additions:
--   1. Expand the action CHECK constraint to cover the event types
--      that Phase 4/5b/7b/7c routes need to log:
--        - rd_iterate          (item/variation/refine ran)
--        - score               (item/variation/score completed)
--        - approve_bet         (room/edges/approve approved a chain)
--        - compose             (item/compose synthesized a design)
--        - autopilot_run       (header for a multi-chain autopilot session)
--        - autopilot_iteration (per-chain child of an autopilot_run)
--
--   2. Add sub_objective_id column so the Notebook panel can scope its
--      timeline to ONE room without filtering through metadata. The
--      existing space_id stays — sub_objective_id is a finer-grained
--      pointer. Nullable for backward compat with rows created before
--      this migration (they stay scoped to space_id only).
--
-- Plus a covering index for the notebook's hot query pattern:
-- (sub_objective_id, created_at desc) so the panel pages from newest.

-- Drop + recreate the CHECK constraint.
alter table public.sub_objective_decisions
  drop constraint if exists sub_objective_decisions_action_check;

alter table public.sub_objective_decisions
  add constraint sub_objective_decisions_action_check
  check (action in (
    'elect',
    'reject',
    'defer',
    'clear',
    'generate_batch',
    'confirm',
    -- Phase 9 — Lab Notebook event types.
    'rd_iterate',
    'score',
    'approve_bet',
    'compose',
    'autopilot_run',
    'autopilot_iteration'
  ));

-- Add sub_objective_id pointer. ON DELETE SET NULL keeps the decision
-- audit alive even if the sub-objective is removed — useful for
-- post-mortem analytics.
alter table public.sub_objective_decisions
  add column if not exists sub_objective_id uuid
    references public.improvement_goals(id) on delete set null;

-- Per-room recency index — the notebook's primary read pattern.
create index if not exists sub_objective_decisions_sub_objective_recency_idx
  on public.sub_objective_decisions(sub_objective_id, created_at desc)
  where sub_objective_id is not null;
