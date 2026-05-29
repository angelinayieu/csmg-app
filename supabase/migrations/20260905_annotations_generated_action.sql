-- ── sub_objective_decisions action: add 'annotations_generated' ───
--
-- Makes the annotation stage loggable to the Lab Notebook. Today
-- POST /api/brainstorm/annotations/generate and
-- POST /api/brainstorm/sub-objectives/[id]/annotate extract the
-- objective's concept lens (the first, most KG-shaping step) with ZERO
-- live trace. logDecision needs the action whitelisted here or the
-- insert is rejected (logDecision soft-fails → the event silently never
-- persists → nothing appears in the notebook).
--
-- FULL SUPERSET re-asserted (clobber-trap defense — concurrent sessions
-- co-edit this constraint; appending without re-asserting the whole set
-- means whichever migration loses the race wipes the other's additions).
--
-- = the 34 actions from 20260904_priority_vector.sql, verbatim,
--   + 1 new: 'annotations_generated'.

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
    'mechanism_spec_generated',
    -- Parallel-session additions (causal map interactions).
    'map_view_changed',
    'loop_highlighted',
    'node_pinned',
    'chain_proposed',
    -- Priority vector — per-sub-objective soft weights.
    'priorities_set',
    -- NEW: annotation lens generated (core objective or sub-objective).
    'annotations_generated'
  ));
