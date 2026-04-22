-- Tier 5 of the App+Strategy Rigor sprint — predictor agent runtime
--
-- Why this exists:
-- Tier 1 added `agent_specs` to InfrastructureProposal so strategies declare
-- what agents should do per app. Tier 3 added sub-strategies that refine
-- those roles. But until now, no actual runtime executed any of those
-- agents — every prediction came from a user clicking PredictionPanel's
-- "Log prediction" form.
--
-- This table is the audit trail for agent executions. Each row represents
-- one scheduled invocation of one agent for one app, with its status,
-- output, and timing. The scheduler uses (scheduled_for, status) to find
-- due runs; the app detail page reads the recent rows to show agent
-- activity.
--
-- Scope (v1): predictor agents only. Measurer, validator, critic agents
-- come in v2 — this migration's schema is role-agnostic so those land
-- without another DDL.
--
-- Lifecycle:
--   scheduled → running → completed (happy path)
--                       → failed (agent threw or LLM timed out)
--                       → skipped (agent decided no action needed;
--                                  e.g. predictor skipping when the
--                                  metric already has an open prediction)
--
-- Scheduling model: the scheduler creates a 'scheduled' row with the
-- target scheduled_for, then during execution flips it to 'running' then
-- 'completed'/'failed'/'skipped'. Using a single row for the full
-- lifecycle keeps the audit trail compact — no need for event-sourcing
-- at this scale.

create table if not exists public.app_agent_runs (
  id uuid primary key default gen_random_uuid(),

  -- Scope — the app this agent is serving. space_id is denormalized so
  -- per-space queries don't need to join apps.
  app_id uuid not null references public.apps(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Agent identity — matches AgentSpec.id from the parent proposal's
  -- agent_specs array. Not an FK because agent_specs live inside JSONB
  -- on strategy_snapshots.recommendation — we link by string id.
  agent_id text not null,
  -- The role as of the run (reasoner | measurer | predictor | ...).
  -- Denormalized so reassigning an agent's role in a later sub-strategy
  -- doesn't rewrite history.
  agent_role text not null,

  -- Lifecycle timestamps + status
  scheduled_for timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'running', 'completed', 'failed', 'skipped')),

  -- Output. Per-role shape (all JSONB so schema evolution is free):
  --   predictor: { prediction_id: uuid }
  --   measurer:  { observation_id: uuid, tracker_id: uuid }
  --   validator: { resolved_prediction_id: uuid }
  --   critic:    { flagged_agent_run_id: uuid, severity: ... }
  --   reasoner:  { signal_ids: uuid[] }
  -- NULL when status is 'skipped' or 'failed'.
  output jsonb,

  -- Skip reason or error detail, depending on status. Kept separate from
  -- output so UI can surface "skipped because X" without parsing JSONB.
  note text,

  -- Performance stats — completed_at - started_at, but denormalized so we
  -- can rank slow agents without arithmetic at query time.
  duration_ms int
);

-- Hot-path index: "give me all scheduled runs whose scheduled_for has passed"
-- — partial index because only 'scheduled' rows are ever actionable.
create index if not exists idx_app_agent_runs_due
  on public.app_agent_runs(scheduled_for)
  where status = 'scheduled';

-- Per-app activity feed: "recent runs for this app, newest first"
create index if not exists idx_app_agent_runs_app_time
  on public.app_agent_runs(app_id, completed_at desc nulls last);

-- Per-agent history: "every run this agent has done on this app"
-- Used by the scheduler to check "when did this agent last complete a run?"
create index if not exists idx_app_agent_runs_app_agent
  on public.app_agent_runs(app_id, agent_id, completed_at desc nulls last);

-- Per-space rollup (Tier 4.5+ future: space-pulse could surface
-- "N agent runs in the last hour")
create index if not exists idx_app_agent_runs_space_time
  on public.app_agent_runs(space_id, completed_at desc nulls last);

alter table public.app_agent_runs enable row level security;

drop policy if exists "owner_all_app_agent_runs" on public.app_agent_runs;
create policy "owner_all_app_agent_runs" on public.app_agent_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Service role bypasses RLS — the cron (/api/cron/agent-runtime) uses
-- the service client to read across all users' apps in one pass.

comment on table public.app_agent_runs is
  'Per-agent execution record. One row per scheduled run, flipped through '
  'running → completed/failed/skipped as the scheduler processes it. '
  'Lets the UI show "agent X has run 12 times this week; last prediction '
  'came from here" and lets the scheduler find due runs cheaply via the '
  'partial idx_app_agent_runs_due index.';
