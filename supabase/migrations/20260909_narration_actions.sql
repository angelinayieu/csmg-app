-- ── sub_objective_decisions actions: 4 new narration actions ─────
--
-- Closes the "macro rollup and design-intent moments are conflated
-- with other actions" gap (2026-05-29 audit, per
-- INTAKE_TO_BRIEF_SURFACING_PLAN.md §4).
--
-- Four new actions, each a distinct chat moment:
--
--   algorithm_chosen        — fires when an `implementation_method` is
--                             selected as `decision_record.chosen`,
--                             carrying the rationale + score delta vs
--                             alternatives. Lets the user see "we
--                             chose X over Y because Z" as its own
--                             chat entry.
--   design_intent_set       — fires when a fresh mechanism spec emits
--                             a v3 `design_intent` block (hero_pattern,
--                             accent_intent, density, motion_intent,
--                             reduction_log). Surfaces the design
--                             moment distinctly from the spec event.
--   macro_rolled_up         — fires when the autopilot runs the
--                             `distill_macro_problems` operation.
--                             Today this is conflated with
--                             `theme_distilled`; this action makes it
--                             a first-class macro moment.
--   data_lineage_resolved   — fires when the data-unit registry
--                             validates a fresh spec's
--                             produces/consumes tokens — surfaces how
--                             many resolved to registered slugs vs
--                             novel (auto-registered) ones.
--
-- FULL SUPERSET re-asserted (clobber-trap defense — concurrent
-- sessions co-edit this constraint; appending without re-asserting
-- the whole set means whichever migration loses the race wipes the
-- other's additions).
--
-- = the 41 actions from 20260907_brainstorm_sessions.sql, verbatim,
--   + 4 new.

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
    -- NEW (20260909) — narration actions per
    -- INTAKE_TO_BRIEF_SURFACING_PLAN.md §4.
    'algorithm_chosen',
    'design_intent_set',
    'macro_rolled_up',
    'data_lineage_resolved'
  ));
