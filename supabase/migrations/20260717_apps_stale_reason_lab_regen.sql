-- ── Phase 2 lab diverge-converge — apps.stale_reason 'lab_regen' ──
--
-- Sprint W4.3 of the diverge-converge plan (see
-- DIVERGE_CONVERGE_ARCHITECTURE_PLAN.md §5 Week 4).
--
-- Extends apps.stale_reason to allow 'lab_regen' as a valid value.
-- This is the cascade-supersede signal fired when the user picks a
-- different lab_twin: apps were generated against a particular lab
-- configuration (the prior chosen lab), and a different lab means
-- their execution_brief + variants are no longer aligned. The
-- existing flagAllAppsInSpace helper (strategy-refresh/route.ts:2520)
-- already supports an arbitrary stale_reason string — this migration
-- just adds the CHECK value so 'lab_regen' is accepted.
--
-- Pattern mirrors how 'strategy_regen' was added — single value
-- addition to an existing CHECK list. Backout = drop CHECK + re-add
-- with the prior 5-value list.
--
-- Current CHECK (from 20260428_apps_and_interventions.sql:124-126):
--   stale_reason text check (stale_reason is null or stale_reason in
--     ('kg_changed', 'new_research', 'user_feedback',
--      'strategy_regen', 'whiteboard_edit'))

alter table public.apps
  drop constraint if exists apps_stale_reason_check;

alter table public.apps
  add constraint apps_stale_reason_check
  check (stale_reason is null or stale_reason in (
    'kg_changed',
    'new_research',
    'user_feedback',
    'strategy_regen',
    'whiteboard_edit',
    'lab_regen'
  ));

comment on constraint apps_stale_reason_check on public.apps is
  'Apps mark themselves stale when an upstream artifact changed. '
  'kg_changed = entities/edges shifted; new_research = a paper '
  'landed that affects the app''s claim base; user_feedback = '
  'user flagged the app for regen; strategy_regen = the strategy '
  'this app implements was regenerated; whiteboard_edit = user '
  'manually edited the canvas; lab_regen = the chosen lab '
  'configuration changed (Phase 2 Week 4) so the app''s execution '
  'brief + variants need re-generation against the new lab.';

-- The existing partial index idx_apps_stale (20260428:149) covers
-- "find all stale apps in a space" regardless of reason, so no new
-- index needed for queries that filter by stale_reason='lab_regen'.
