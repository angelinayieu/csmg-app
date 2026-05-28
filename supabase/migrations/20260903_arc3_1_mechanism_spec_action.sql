-- Arc 3.1 — Mechanism technical-depth spec.
--
-- Adds ONE new action type: mechanism_spec_generated.
--
-- Fires whenever the user (or the canvas autopilot) generates a
-- technical mechanism spec for a FEATURE entity via
-- POST /api/brainstorm/item/[entityId]/mechanism-spec. The spec is
-- the engineering-grade depth layer the shallow `definition` (2-3
-- sentences) never carried: mechanism_of_action, active_ingredients[],
-- how_it_works[], system_components[], dosage, fidelity_signals[],
-- research_basis. Stored additively on entities.expanded_detail.
-- mechanism_spec — no new columns.
--
-- Metadata on the decision row carries entity_id, entity_name,
-- evidence_strength, n_active_ingredients, n_components so the Lab
-- Notebook timeline can render "generated mechanism spec for
-- Pomodoro Timer · 4 active ingredients · evidence: plausible".
--
-- All 28 prior actions remain valid (full list re-asserted below so
-- the constraint is self-contained — this DROP+ADD is the established
-- pattern from 20260829_phase10a_notebook_events.sql).

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
    'stage_transitioned',
    -- Phase 11.4 — causal chain enrichment.
    'chains_enriched',
    -- Phase 11.6 — indicator baselines.
    'baseline_set',
    -- Phase 11.A — objective layering.
    'layers_generated',
    'layers_regenerated',
    'layer_position_set',
    -- Arc 3.1 — mechanism technical-depth spec.
    'mechanism_spec_generated'
  ));
