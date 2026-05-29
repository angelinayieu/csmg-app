-- ── improvement_goals.priority_vector + priorities_set action ─────
--
-- Per-sub-objective priority vector. Distinct from space-scoped
-- OperationalConstraints (held-fixed hard gates): this captures
-- "what does winning look like for THIS objective" — soft weights
-- the user can shift room-to-room.
--
-- Why a dedicated column (not synthesis_data nested)?
--   - The room page already does a wide select on improvement_goals;
--     the vector loads in a query already running.
--   - Co-located with the row it describes — no separate space read.
--   - Avoids overloading room_categories / room_lane_labels (those
--     are semantically distinct; mixing them in is the orphan-seam
--     mess we keep losing time to).
--
-- Shape:
--   {
--     dimensions: {
--       speed:         number,  -- normalized 0..1, weights sum to 1
--       durability:    number,
--       reversibility: number,
--       certainty:     number,
--       leverage:      number
--     },
--     source: "inferred" | "user",
--     generated_at: "<iso>"
--   }
--
-- Nullable + default null — back-compat with existing goals. The
-- confirm route seeds new rows; older rows auto-infer on first read.

alter table public.improvement_goals
  add column if not exists priority_vector jsonb;

comment on column public.improvement_goals.priority_vector is
  'Per-sub-objective priority vector — soft weights across 5 dimensions (speed, durability, reversibility, certainty, leverage). Distinct from space-scoped operational constraints (which are hard gates). Source: inferred (seeded at confirm) | user (edited via PriorityStrip).';

-- ── sub_objective_decisions action constraint: add priorities_set ──
--
-- Full superset re-asserted (the clobber-trap defense — concurrent
-- sessions co-edit this module, and appending without re-asserting
-- the full set means whichever migration loses the race wipes the
-- other's additions).
--
-- 28 prior actions kept verbatim from 20260903_arc3_1_mechanism_spec_action.sql
-- + 4 actions added live by a parallel session (map_view_changed,
--   loop_highlighted, node_pinned, chain_proposed) merged in so this
--   migration doesn't clobber them.
-- + 1 new: priorities_set.

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
    'priorities_set'
  ));
