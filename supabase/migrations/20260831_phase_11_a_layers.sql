-- Phase 11.A — Objective Layering foundation.
--
-- Adds layer-position tagging to improvement_goals so each sub-objective
-- can declare which causal-stack layer(s) it operates at. The layer
-- stack itself lives on spaces.synthesis_data.objective_canvas.layers
-- (JSONB, no migration needed) — see src/lib/objective-canvas/layer-model.ts
-- for the ObjectiveStack shape.
--
-- Three new decision-log actions track layer lifecycle:
--   - layers_generated      initial decomposition fired
--   - layers_regenerated    user explicitly regenerated the stack
--   - layer_position_set    user manually overrode a sub-objective's
--                           layer assignment
--
-- Why integer[] for layer_ordinals: a sub-objective can be single-layer
-- ([3]) or bridge multiple ([2,3]). Empty array means "legacy / not yet
-- tagged" — the picker UI falls back to the existing flat list when
-- the stack hasn't been generated.

-- 1. layer_ordinals on improvement_goals — which layer(s) a sub-obj touches.
alter table public.improvement_goals
  add column if not exists layer_ordinals integer[] default '{}'::integer[];

-- 2. layer_position_label — human-readable position chip ("L3 · Direct",
--    "L2→L3 · Bridge", "Cross-stack"). The proposer emits this; the UI
--    renders it as-is so no client-side label-derivation logic is needed.
alter table public.improvement_goals
  add column if not exists layer_position_label text;

-- 3. GIN index for cross-room layer-coverage queries (Phase 11.A.10
--    layer_coverage analysis needs "find all goals touching layer N").
create index if not exists improvement_goals_layer_ordinals_idx
  on public.improvement_goals using gin (layer_ordinals);

-- 4. Extend decision-log CHECK with the three new action types.
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
    -- Phase 11.6 — indicator baseline anchoring.
    'baseline_set',
    -- Phase 11.A — objective layering.
    'layers_generated',
    'layers_regenerated',
    'layer_position_set'
  ));
