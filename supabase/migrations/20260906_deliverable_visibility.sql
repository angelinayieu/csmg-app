-- ── sub_objective_decisions actions: scan_complete, deliverable_generated, brief_polished ──
--
-- Closes the "autopilot ends silently" + "deliverable surface is
-- invisible" gaps in the Lab Notebook (2026-05-29 audit). Today
-- the runner emits scoring/refinement events but goes silent after
-- the final chains_enriched — the cross-room analysis scan + every
-- deliverable-producing route (mockup, export-prompt, description-doc,
-- prototype, agent-spec, brief polish) logs nothing.
--
-- Three new actions:
--
--   scan_complete           — fires at end of /space/analysis/scan
--                             with n_findings + cached flag.
--   deliverable_generated   — single action covering mockup,
--                             export_prompt, description_doc,
--                             prototype_brief, agent_spec. Metadata
--                             carries deliverable_subtype.
--   brief_polished          — strategy brief tldr regenerated.
--
-- FULL SUPERSET re-asserted (clobber-trap defense — concurrent sessions
-- co-edit this constraint; appending without re-asserting the whole set
-- means whichever migration loses the race wipes the other's additions).
--
-- = the 35 actions from 20260905_annotations_generated_action.sql,
--   verbatim, + 3 new.

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
    -- NEW: deliverable-visibility slice.
    'scan_complete',
    'deliverable_generated',
    'brief_polished'
  ));
