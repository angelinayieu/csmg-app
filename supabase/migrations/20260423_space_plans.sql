-- ── Space Strategizer substrate ────────────────────────────────────────
--
-- Three tables that together make the adaptive generation loop auditable:
--
--   space_plans              — the full plan document per cycle
--   space_work_queue         — per-item execution queue (what to run next)
--   space_plan_calibrations  — post-hoc "did it pay off?" feedback rows
--
-- Design notes:
--
-- The plan document itself is stored as JSONB in space_plans.plan_document
-- rather than normalized across rows. Rationale: plans are immutable
-- audit artifacts, not things we query piecewise. The only piecewise
-- access pattern is "latest plan per space" which is served by the
-- space_id + generated_at index.
--
-- space_work_queue is normalized because executors DO need row-level
-- access: "give me the highest-priority pending item for this space",
-- mark-in-progress, mark-done, etc. One row per selected item keeps
-- that cheap.
--
-- space_plan_calibrations is append-only. Each row is an observation
-- at a point in time. The ranker's weight-fit job reads from this
-- table and writes nothing back — calibration outputs live in code
-- (DEFAULT_WEIGHTS) or a separate weight-snapshot table down the road.

-- ── 1. space_plans ─────────────────────────────────────────────────────

create table if not exists public.space_plans (
  id uuid primary key,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid references public.pipeline_runs(id) on delete set null,
  generated_at timestamptz not null default now(),

  -- Budget accounting. Denormalized from plan_document for cheap
  -- per-space "how much are we spending on planning" dashboards.
  budget_tokens integer not null,
  budget_headroom integer not null,

  -- The full SpacePlan document. Schema-validated by the TS type,
  -- not by Postgres — plans change shape as the strategizer evolves
  -- and we don't want schema lockstep every time we add a field.
  plan_document jsonb not null,

  -- Provenance
  planner_model text not null,
  planner_temperature real not null
);

create index if not exists space_plans_space_id_generated_at_idx
  on public.space_plans (space_id, generated_at desc);

create index if not exists space_plans_user_id_generated_at_idx
  on public.space_plans (user_id, generated_at desc);

-- Own-only RLS. Plans are per-user audit — no cross-user leakage.
alter table public.space_plans enable row level security;

drop policy if exists "space_plans own select" on public.space_plans;
create policy "space_plans own select"
  on public.space_plans
  for select
  using (user_id = auth.uid());

drop policy if exists "space_plans own insert" on public.space_plans;
create policy "space_plans own insert"
  on public.space_plans
  for insert
  with check (user_id = auth.uid());

drop policy if exists "space_plans own delete" on public.space_plans;
create policy "space_plans own delete"
  on public.space_plans
  for delete
  using (user_id = auth.uid());

-- ── 2. space_work_queue ────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'space_work_kind') then
    create type space_work_kind as enum (
      'axis',
      'edge_space',
      'convergent_point',
      'signature_deepen',
      'intersection_probe'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'space_work_status') then
    create type space_work_status as enum (
      'pending',
      'in_progress',
      'completed',
      'failed',
      'cancelled'
    );
  end if;
end $$;

create table if not exists public.space_work_queue (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.space_plans(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Canonical candidate id from the plan. Format-dependent on kind:
  --   axis:{axis}         edge:{edgeId}        node:{entityId}
  --   sig:{entityId}      probe:{aId}:{bId}
  candidate_id text not null,
  kind space_work_kind not null,

  -- Ranker-scored priority [0,1]. Higher = executed first within the
  -- same plan. Executors claim rows ORDER BY priority_score DESC.
  priority_score real not null,

  -- Budget allocation from the planner. The executor MUST fit its
  -- actual work inside this envelope or soft-fail. Overruns are
  -- calibration signals.
  allocated_tokens integer not null,

  -- Optional execution hint from the planner.
  target_resolution smallint,

  selection_reason text not null,
  expected_insight_type text not null,

  status space_work_status not null default 'pending',

  claimed_at timestamptz,
  completed_at timestamptz,
  outcome_summary text,  -- set when status -> completed: what the executor produced

  created_at timestamptz not null default now()
);

create index if not exists space_work_queue_space_pending_idx
  on public.space_work_queue (space_id, status, priority_score desc)
  where status = 'pending';

create index if not exists space_work_queue_plan_id_idx
  on public.space_work_queue (plan_id);

alter table public.space_work_queue enable row level security;

drop policy if exists "space_work_queue own" on public.space_work_queue;
create policy "space_work_queue own"
  on public.space_work_queue
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── 3. space_plan_calibrations ─────────────────────────────────────────
--
-- Post-hoc "did this pay off" tagging. Append-only. A calibration
-- sweep (separate job) walks completed work items, checks whether
-- their outputs appear in interventions / proposals / variants /
-- reports, and emits a row here. Weight-fitting reads from here.

create table if not exists public.space_plan_calibrations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.space_plans(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  candidate_id text not null,
  kind space_work_kind not null,

  -- Signals at planning time — copied from the plan document so the
  -- regression doesn't need to join back to plan_document JSONB.
  signals jsonb not null,
  score real not null,

  -- The outcome
  paid_off boolean not null,
  paid_off_surface text,  -- 'intervention' | 'proposal' | 'variant_decomposition' | 'report_consequence' | 'widget_render' | null
  latency_seconds integer not null,

  observed_at timestamptz not null default now()
);

create index if not exists space_plan_calibrations_space_observed_idx
  on public.space_plan_calibrations (space_id, observed_at desc);

create index if not exists space_plan_calibrations_kind_paid_idx
  on public.space_plan_calibrations (kind, paid_off);

alter table public.space_plan_calibrations enable row level security;

drop policy if exists "space_plan_calibrations own" on public.space_plan_calibrations;
create policy "space_plan_calibrations own"
  on public.space_plan_calibrations
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
