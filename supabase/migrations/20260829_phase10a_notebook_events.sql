-- Phase 10a — Lab Notebook event scope expansion.
--
-- Adds 11 new action types to cover the "key system events" decision
-- (lock-in L1 in OBJECTIVE_CANVAS_OPERATION_MAP.md §11). After this
-- migration the notebook can tell the full canvas story — room births,
-- item expansion, cross-room finding curation, theme distillation,
-- concept branching, constraint changes, stage transitions, expansion
-- tree growth, prototype lifecycle, and autopilot sessions.
--
-- New actions:
--   - room_generated            (room/generate completed for a sub-objective)
--   - item_expanded             (item/expand produced variations + def)
--   - expansion_spawned         (item/expansion/spawn added L3+ nodes)
--   - prototype_status_changed  (planned → running → concluded/abandoned)
--   - finding_acknowledged      (cross-room finding marked acknowledged)
--   - finding_dismissed         (cross-room finding hidden)
--   - finding_resolved          (cross-room finding marked resolved)
--   - theme_distilled           (theme finding spawned a new sub-objective)
--   - concept_branched          (canonical concept → new sub-objective)
--   - constraints_set           (space.constraints POST overrides defaults)
--   - stage_transitioned        (clarifying → picking → main)
--
-- All existing Phase 9 actions remain valid. autopilot_iteration is
-- retained but unused at first emit time — autopilot_run is the
-- parent, the underlying score/rd_iterate rows are visually grouped
-- in the UI by timestamp proximity (per lock-in L6).
--
-- No new tables, no new columns — sub_objective_id from Phase 9
-- continues to scope per-room events. Space-level events (stage
-- transitions, constraints, theme distillation, concept branching,
-- finding curation) leave sub_objective_id null and scope by
-- space_id alone (existing column). The space-scoped GET endpoint
-- (Phase 10b) filters on `sub_objective_id IS NULL` to surface them.

alter table public.sub_objective_decisions
  drop constraint if exists sub_objective_decisions_action_check;

alter table public.sub_objective_decisions
  add constraint sub_objective_decisions_action_check
  check (action in (
    -- Phase 1+ — picker / variant lab.
    'elect',
    'reject',
    'defer',
    'clear',
    'generate_batch',
    'confirm',
    -- Phase 9 — Lab Notebook event types (per-room work).
    'rd_iterate',
    'score',
    'approve_bet',
    'compose',
    'autopilot_run',
    'autopilot_iteration',
    -- Phase 10a — system events + cross-room curation.
    'room_generated',
    'item_expanded',
    'expansion_spawned',
    'prototype_status_changed',
    'finding_acknowledged',
    'finding_dismissed',
    'finding_resolved',
    'theme_distilled',
    'concept_branched',
    'constraints_set',
    'stage_transitioned'
  ));

-- Space-scoped events (sub_objective_id null) get their own recency
-- index so the Phase 10b space-scoped notebook GET endpoint pages
-- from newest cheaply without scanning the entire decisions table.
create index if not exists sub_objective_decisions_space_recency_idx
  on public.sub_objective_decisions(space_id, created_at desc)
  where sub_objective_id is null;
