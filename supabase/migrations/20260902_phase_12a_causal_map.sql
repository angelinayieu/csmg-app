-- ── Phase 12.A — Causal System Map ───────────────────────────────
--
-- Persistence for the multi-altitude causal map (§17.2):
--   1. Optional user-pinned node positions on canvas-altitude nodes.
--   2. Per-(user, space) view state (altitude, focus, toggles).
--   3. Four new decision-log action types for map interactions.
--
-- STATUS: APPLIED 2026-05-28 via supabase apply_migration (name:
-- phase_12a_causal_map), authorized by the user. Reconciled before apply
-- with the parallel arc3_1_mechanism_spec_action migration already on the
-- remote: its `mechanism_spec_generated` action is included below so this
-- DROP+ADD is a strict superset and doesn't drop it. The map MVP renders
-- from server props and worked without this; these tables back the
-- persistence sub-phases + notebook wiring for map interactions.

-- 1. Optional user-pinned positions on canvas-altitude nodes. NULL =
--    use auto-layout (the default). Set = override for that node only.
alter table public.improvement_goals
  add column if not exists canvas_position jsonb;
  -- Shape: { x: number, y: number, pinned_at: ISO } | null

-- 2. Per-(user, space) view state. Composite PK; RLS-scoped to user so
--    two users on the same canvas keep independent maps (N5).
create table if not exists public.causal_map_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  -- Shape: {
  --   altitude: "canvas" | "room" | "item",
  --   focused_node_id: string | null,
  --   collapsed_layers: number[],
  --   pinned_loops: string[],
  --   show_health_overlay: boolean,
  --   show_inactive_edges: boolean,
  --   layout: "layered" | "force" | "lr"
  -- }
  updated_at timestamp with time zone default now(),
  primary key (user_id, space_id)
);

alter table public.causal_map_state enable row level security;

-- Idempotent policy create (drop-if-exists then create) so re-runs in a
-- branch don't error on the duplicate-policy.
drop policy if exists "Users manage their own map state" on public.causal_map_state;
create policy "Users manage their own map state"
  on public.causal_map_state for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. Extend the decision-log CHECK with 4 new map-interaction actions.
--    Full list = the 28 actions through Phase 11.A + the 4 new ones.
alter table public.sub_objective_decisions
  drop constraint if exists sub_objective_decisions_action_check;

alter table public.sub_objective_decisions
  add constraint sub_objective_decisions_action_check
  check (action in (
    -- Sub-objective lifecycle
    'elect',
    'reject',
    'defer',
    'clear',
    'generate_batch',
    'confirm',
    -- Variation lab + scoring
    'rd_iterate',
    'score',
    'approve_bet',
    'compose',
    'autopilot_run',
    'autopilot_iteration',
    -- Phase 9 — room + expansion + findings + space-scoped
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
    -- Phase 11.4 — chain enrichment
    'chains_enriched',
    -- Phase 11.6 — indicator baselines
    'baseline_set',
    -- Phase 11.A — objective layering
    'layers_generated',
    'layers_regenerated',
    'layer_position_set',
    -- Arc 3.1 — mechanism technical-depth spec. Added by a parallel
    -- migration (arc3_1_mechanism_spec_action) that landed on the remote
    -- AFTER this file was first written. Re-asserted here so applying
    -- this constraint is a SUPERSET and never drops that action.
    'mechanism_spec_generated',
    -- Phase 12.A — causal map interactions
    'map_view_changed',   -- zoom / pan / altitude switch (debounced)
    'loop_highlighted',   -- agent or user surfaced a detected loop
    'node_pinned',        -- user dragged a node to a custom position
    'chain_proposed'      -- user drew an inter-sub-objective edge
  ));
