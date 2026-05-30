-- ── sub_objective_decisions actions: research_completed ───────────
--
-- Closes the "autopilot's research stage has no notebook footprint"
-- gap (AUTOPILOT_COOPERATION_PLAN.md §2.0.b + Fix A).
--
-- One new action:
--
--   research_completed     — fires when /api/brainstorm/item/research
--                            successfully populates detail_research for
--                            a feature, whether triggered by the
--                            autopilot's Fix A stage, the drawer's
--                            lazy fetch, or room-gen's fire-and-forget
--                            pre-warm. Metadata carries entity_id,
--                            entity_name, technical_count, design_count,
--                            cached (true when the route short-circuits
--                            on existing bundle).
--
-- Without this action, the autopilot's research stage would fire
-- successfully but the notebook would render nothing — the runner's
-- postLog only fires on skipped/failed, and successes are narrated by
-- each route's own logDecision call. The score / chains_enriched /
-- mechanism_spec_generated / scan_complete actions all follow this
-- same pattern; research_completed brings the new stage into parity.
--
-- FULL SUPERSET re-asserted (clobber-trap defense — concurrent sessions
-- co-edit this constraint; appending without re-asserting the whole set
-- means whichever migration loses the race wipes the other's additions).
-- Per project_parallel_workstreams memory.
--
-- = the 45 actions from 20260909_narration_actions.sql verbatim, + 1 new.

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
    -- Annotation lens generated.
    'annotations_generated',
    -- Deliverable-visibility slice (20260906).
    'scan_complete',
    'deliverable_generated',
    'brief_polished',
    -- Brainstorm module lifecycle (20260907).
    'brainstorm_started',
    'brainstorm_completed',
    'brainstorm_elected',
    -- Narration actions (20260909).
    'algorithm_chosen',
    'design_intent_set',
    'macro_rolled_up',
    'data_lineage_resolved',
    -- NEW (20260911) — Cooperation Plan v2 Fix A. Research stage in
    -- canvas autopilot + companion drawer lazy fetch + room-gen
    -- pre-warm all log under this action.
    'research_completed'
  ));
