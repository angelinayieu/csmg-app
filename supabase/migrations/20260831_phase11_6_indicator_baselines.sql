-- Phase 11.6 — Indicator Baselines.
--
-- Adds one new decision-log action: `baseline_set`.
--
-- Fires whenever the user (or the LLM via the calibration_baseline
-- expansion-tree node auto-fill) sets a baseline value on an
-- indicator of an outcome entity. The Lab Notebook timeline can
-- then render "baseline set: 8/10 GAD-2 (anxiety)" as an event the
-- chat agent can reference later ("you started at 8 — projected
-- delta with this stack is -3.5 over 4 weeks").
--
-- All baseline data (baseline value, target, unit, measurement
-- method, source: user|llm) lives on the existing
-- entities.causal_chain JSONB column under a new
-- `indicator_baselines` key — no new columns, no migration on the
-- entities table itself. Backward-compatible: legacy outcomes
-- without indicator_baselines still work fine; the new field is
-- optional everywhere.

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
    'rd_iterate',
    'score',
    'approve_bet',
    'compose',
    'autopilot_run',
    'autopilot_iteration',
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
    'stage_transitioned',
    'chains_enriched',
    -- Phase 11.6
    'baseline_set'
  ));
