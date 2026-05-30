-- ── Brainstorm Sessions ─────────────────────────────────────────────
--
-- Foundation for the unified Make-Better brainstorming module
-- (BRAINSTORM_MODULE_SPEC.md, locked 2026-05-29).
--
-- A brainstorm_session row = one user press of the `Brainstorm` button.
-- It captures the WHOLE pipeline: chosen intents, generation batches,
-- cleanup pass, critique-rank pass, user-added ideas, lifecycle. All
-- as JSONB columns for atomic snapshot + cheap library browsing.
--
-- The session is also a tldraw page on the existing objective board
-- (tldraw_page_id) so "Collapse into base" is a literal page switch.
-- That keeps the user's "popup whiteboard that folds back behind"
-- mental model alive without spinning up a second canvas system.
--
-- Phase 1 (this migration): picker-only target. Phase 6 generalises
-- to room features + annotations via the target_kind enum.

create table if not exists public.objective_brainstorm_sessions (
  id                uuid primary key default gen_random_uuid(),
  space_id          uuid not null references public.spaces(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,

  -- WHAT we're brainstorming on. sub_objective_picker is the Phase 1
  -- target. room_feature + annotation reserved for Phase 6.
  target_kind       text not null check (target_kind in (
    'sub_objective_picker',
    'room_feature',
    'annotation'
  )),

  -- Phase 6 anchors; null for Phase 1 picker sessions (the target
  -- IS the space's sub-objective set, scoped by space_id alone).
  sub_objective_id  uuid references public.improvement_goals(id) on delete set null,
  entity_id         uuid references public.entities(id) on delete set null,

  -- The plan + outcomes. Each session has 1 plan (chosen intents),
  -- N generation batches (one per intent), 1 cleanup pass, 1 critique
  -- pass, N candidates with ribbons + scores. Atomic snapshot makes
  -- library re-open trivial — no joins, just rehydrate the row.
  --
  -- Shapes (per BRAINSTORM_MODULE_SPEC.md §5):
  --
  --   plan: { intents: ["gap_fill","creative",...],
  --           reasons: { <intent>: { source, ... } } }
  --
  --   generations: [{ intent, generation_number, batch_id,
  --                   candidates: [...], generated_at, latency_ms }]
  --
  --   cleanup: { clusters: [...], duplicates: [...], ran_at }
  --
  --   ranking: { candidates: [{ proposal_id, composite_score,
  --                             sub_scores: { coverage, diversity,
  --                                           preference, critique },
  --                             ribbon: "green"|"amber"|"tray",
  --                             reasoning: {...} }], ranked_at }
  --
  --   user_added_ideas: [{ id, title, body, added_at,
  --                        scored_with_session, sub_scores,
  --                        composite_score, ribbon }]
  plan              jsonb not null default '{}'::jsonb,
  generations       jsonb not null default '[]'::jsonb,
  cleanup           jsonb,
  ranking           jsonb,
  user_added_ideas  jsonb not null default '[]'::jsonb,

  -- tldraw integration. The brainstorm session = one named tldraw page
  -- on the existing objective board. The page id is stored here so the
  -- panel can switch the editor to it on open + the library can re-open.
  tldraw_page_id    text,

  -- Library affordances.
  pinned            boolean not null default false,
  title             text,
  outcome_summary   text,

  -- Lifecycle. settled = critique pass completed, user can interact.
  -- abandoned = user closed before settle (or runner errored hard).
  status            text not null default 'running' check (status in (
    'running',
    'settled',
    'abandoned'
  )),
  started_at        timestamptz not null default now(),
  settled_at        timestamptz,
  updated_at        timestamptz not null default now()
);

-- Most queries: "this user's recent sessions in this space".
create index if not exists objective_brainstorm_sessions_space_user_idx
  on public.objective_brainstorm_sessions(space_id, user_id, started_at desc);

-- Library view: "this user's pinned sessions across spaces, newest first".
create index if not exists objective_brainstorm_sessions_pinned_idx
  on public.objective_brainstorm_sessions(user_id, settled_at desc)
  where pinned = true;

-- Phase 6 lookups: "all sessions for this sub-objective" / "this entity".
create index if not exists objective_brainstorm_sessions_target_idx
  on public.objective_brainstorm_sessions(sub_objective_id, entity_id)
  where sub_objective_id is not null or entity_id is not null;

-- RLS — same pattern as sub_objective_decisions: user can see/mutate their own.
alter table public.objective_brainstorm_sessions enable row level security;

drop policy if exists "users can read own brainstorm sessions"
  on public.objective_brainstorm_sessions;
create policy "users can read own brainstorm sessions"
  on public.objective_brainstorm_sessions
  for select
  using (user_id = auth.uid());

drop policy if exists "users can insert own brainstorm sessions"
  on public.objective_brainstorm_sessions;
create policy "users can insert own brainstorm sessions"
  on public.objective_brainstorm_sessions
  for insert
  with check (user_id = auth.uid());

drop policy if exists "users can update own brainstorm sessions"
  on public.objective_brainstorm_sessions;
create policy "users can update own brainstorm sessions"
  on public.objective_brainstorm_sessions
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "users can delete own brainstorm sessions"
  on public.objective_brainstorm_sessions;
create policy "users can delete own brainstorm sessions"
  on public.objective_brainstorm_sessions
  for delete
  using (user_id = auth.uid());

-- updated_at auto-bump.
create or replace function public.touch_objective_brainstorm_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists objective_brainstorm_sessions_touch_updated_at
  on public.objective_brainstorm_sessions;
create trigger objective_brainstorm_sessions_touch_updated_at
  before update on public.objective_brainstorm_sessions
  for each row
  execute function public.touch_objective_brainstorm_sessions_updated_at();

-- ── sub_objective_decisions actions: brainstorm_{started,completed,elected} ──
--
-- Three new audit-log actions for the brainstorm module:
--
--   brainstorm_started    — user pressed `Brainstorm`, Runner accepted.
--                           metadata: { session_id, target_kind,
--                                       planned_intents, intent_reasons }
--   brainstorm_completed  — Runner finished critique pass.
--                           metadata: { session_id, n_candidates, n_top,
--                                       n_explore, n_tray, latency_ms }
--   brainstorm_elected    — user clicked a candidate to elect from the panel.
--                           metadata: { session_id, proposal_id, ribbon,
--                                       composite_score, intent_of_origin }
--
-- FULL SUPERSET re-asserted (clobber-trap defence — concurrent sessions
-- co-edit this constraint; appending without re-asserting the whole set
-- means whichever migration loses the race wipes the other's additions).
--
-- = the 38 actions from 20260906_deliverable_visibility.sql, verbatim,
--   + 3 new.

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
    -- Deliverable-visibility slice.
    'scan_complete',
    'deliverable_generated',
    'brief_polished',
    -- Brainstorm module lifecycle (BRAINSTORM_MODULE_SPEC.md).
    'brainstorm_started',
    'brainstorm_completed',
    'brainstorm_elected',
    -- Parallel-session additions discovered on live constraint inspection
    -- 2026-05-30 — preserve them in the superset re-assert to defend
    -- against the clobber trap (project_parallel_workstreams memory).
    'algorithm_chosen',
    'design_intent_set',
    'macro_rolled_up',
    'data_lineage_resolved'
  ));
