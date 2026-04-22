-- Phase 1 Step 2 — Structural event bus.
--
-- Two tables that together back the SSE-driven "live reasoning" stream
-- on the whiteboard:
--
--   pipeline_runs        — one row per invocation (decompose, research,
--                          synthesize, strategy-refresh). Holds status
--                          + timing + the space it targets.
--
--   pipeline_run_events  — append-only log of structural events emitted
--                          during a run. Canvas SSE endpoint replays these
--                          on client reconnect and polls for new ones.
--
-- Design rule: only events that correspond to a persisted KG /
-- prediction-ledger artifact live in this table. Free-form thinking +
-- tool-call traces go to the audit drawer (separate store, not here).

-- ──────────────────────────────────────────────────────────────────────
-- 1. pipeline_runs
-- ──────────────────────────────────────────────────────────────────────

create table if not exists public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,

  pipeline text not null
    check (pipeline in (
      'decompose',
      'research',
      'research_deep',
      'synthesize',
      'strategy_refresh',
      'generate_apps',
      'critique',
      'expand',
      'intake_bootstrap'
    )),

  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),

  initial_prompt text,
  root_entity_id uuid references public.entities(id) on delete set null,
  error_message text,

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  -- Rolling sequence counter so emitStructuralEvent can assign
  -- monotonically-increasing sequence numbers without a SELECT MAX race.
  last_sequence integer not null default 0
);

create index if not exists idx_pipeline_runs_space_started
  on public.pipeline_runs(space_id, started_at desc);
create index if not exists idx_pipeline_runs_user_status
  on public.pipeline_runs(created_by, status, started_at desc);

alter table public.pipeline_runs enable row level security;

create policy "pipeline_runs user can read own"
  on public.pipeline_runs for select
  using (created_by = auth.uid());

create policy "pipeline_runs user can insert own"
  on public.pipeline_runs for insert
  with check (created_by = auth.uid());

create policy "pipeline_runs user can update own"
  on public.pipeline_runs for update
  using (created_by = auth.uid());

-- ──────────────────────────────────────────────────────────────────────
-- 2. pipeline_run_events (append-only)
-- ──────────────────────────────────────────────────────────────────────

create table if not exists public.pipeline_run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pipeline_runs(id) on delete cascade,

  sequence integer not null,

  event_type text not null
    check (event_type in (
      'stage_boundary',
      'entity_added',
      'edge_added',
      'cycle_detected',
      'bridge_formed',
      'proposal_ready',
      'source_cited',
      'prediction_recorded'
    )),

  payload jsonb not null,

  emitted_at timestamptz not null default now(),

  -- (run_id, sequence) must be unique so the SSE client can dedupe on
  -- reconnect when replaying from its last-seen sequence.
  unique (run_id, sequence)
);

-- Fetch by run, in sequence order — the hottest read path.
create index if not exists idx_pipeline_run_events_run_seq
  on public.pipeline_run_events(run_id, sequence asc);

-- Emission-time index for "what's new across all runs" queries.
create index if not exists idx_pipeline_run_events_emitted
  on public.pipeline_run_events(emitted_at desc);

alter table public.pipeline_run_events enable row level security;

create policy "pipeline_run_events user can read own"
  on public.pipeline_run_events for select
  using (
    exists (
      select 1 from public.pipeline_runs r
      where r.id = pipeline_run_events.run_id and r.created_by = auth.uid()
    )
  );

create policy "pipeline_run_events user can insert for own run"
  on public.pipeline_run_events for insert
  with check (
    exists (
      select 1 from public.pipeline_runs r
      where r.id = pipeline_run_events.run_id and r.created_by = auth.uid()
    )
  );

-- Enable realtime so future cross-instance fan-out can subscribe via
-- supabase-js realtime. MVP SSE implementation polls the table directly
-- — realtime is here for when we scale past single-node dev.
alter publication supabase_realtime add table public.pipeline_run_events;
