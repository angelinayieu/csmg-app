-- ── R5 Phase A — Snapshots + Scenarios + run reproducibility ────────
--
-- Background (see docs/R5_STRATEGIC_BRIEF.md §3): the digital-twin
-- "replicate → diagnose → test → propose → test-after" loop exists in
-- this codebase only as five excellent components that never touch
-- each other. The blocker is that there's no first-class snapshot
-- primitive decoupled from strategy generation. Today the only frozen
-- twin is `strategy_baselines.twin_state`, FK-bound to
-- `strategy_snapshot_id` — so "snapshot my current state so I can
-- test against it" is physically impossible without kicking off a
-- strategy run.
--
-- This migration lands the substrate, not the UI. It creates three
-- primitives:
--
--   1. `twin_snapshots` — user-initiated or pipeline-initiated freeze
--      of the KG + computed twin state. Carries the full
--      entities/edges/cycles subgraph as JSONB so a scenario can
--      diverge without touching the live tables. Every row has a
--      stable `root_hash` so two snapshots of the same state dedupe.
--
--   2. `twin_scenarios` — a fork off a snapshot with an ordered
--      `action_list` applied transactionally. Status lifecycle
--      matches Palantir's pattern: draft → testing → applied → rejected.
--      Only stores deltas (via `twin_scenario_deltas`), not a full
--      snapshot copy. Applying a scenario = replay `action_list`
--      against parent_snapshot's entities/edges.
--
--      NAMING NOTE: this Palantir-style table is `twin_scenarios`,
--      NOT `scenarios`, to avoid colliding with the pre-R5
--      synthesis-output `scenarios` table (id, space_id, name,
--      conditions text, outcome_label, outcome_value, probability)
--      which is owned by the analyze pipeline + synthesis prompts.
--      Both tables coexist; they're disjoint surfaces.
--
--   3. `twin_scenario_deltas` — per-action delta rows. Every mutation
--      (entity/edge create/update/delete + field-level diff for
--      updates) gets one row. Lets the UI render a diff without
--      re-running the action list, and lets the MC engine load
--      baseline + deltas in two queries.
--
-- Plus extends `pipeline_runs` with reproducibility metadata (seed,
-- model_version, snapshot_id, scenario_id, parent_run_id) so any run
-- can be re-executed or compared to an ancestor. This is the
-- MLflow/DVC pattern from the brief.
--
-- Not included here (future migrations):
--   - `twin_diagnostics` table (R5 Phase A.3)
--   - proposals.dowhy_* columns (R5 Phase A.4)
--   - scenario_ui UI session state (Phase B)

-- ── 1. twin_snapshots ────────────────────────────────────────────────

create table if not exists public.twin_snapshots (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Why this snapshot was taken. `user_request` = explicit "freeze
  -- now" click; `pre_strategy` = before strategy-refresh runs (gives
  -- us a true T0 that the baseline capture can link against);
  -- `post_intervention` = after a scenario was applied to the live KG;
  -- `scheduled` = cron sweep.
  reason text not null check (reason in (
    'user_request',
    'pre_strategy',
    'post_intervention',
    'scheduled',
    'pipeline_checkpoint'
  )),

  -- Stable hash of the frozen subgraph + twin state. Two snapshots with
  -- the same hash represent the same state; the UI can dedupe in the
  -- history list rather than showing three identical rows.
  root_hash text not null,

  -- Frozen subgraph — the entire point of a snapshot is that later
  -- reads do NOT go to the live tables. JSONB arrays mirror the
  -- Entity / Edge / Cycle row shapes the MC engine + twin computer
  -- already consume. Write once at capture time; never mutated.
  entities jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  cycles jsonb not null default '[]'::jsonb,
  bridges jsonb not null default '[]'::jsonb,

  -- Precomputed TwinState at capture time. Caching here avoids every
  -- downstream read having to re-run computeTwinState() over the
  -- frozen subgraph. Updated only if the snapshot is re-analyzed
  -- (e.g., a diagnostic pass refreshes the quality score).
  twin_state jsonb,

  -- Counts denormalized for cheap list views. Avoid jsonb_array_length
  -- in hot paths.
  entity_count int not null default 0,
  edge_count int not null default 0,
  cycle_count int not null default 0,

  -- Provenance: which pipeline run (if any) triggered the capture,
  -- and which strategy_baseline captured alongside it (bidirectional
  -- link so strategy_baselines can continue to exist without being
  -- the only twin-freeze path).
  pipeline_run_id uuid references public.pipeline_runs(id) on delete set null,
  strategy_baseline_id uuid references public.strategy_baselines(id) on delete set null,

  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_twin_snapshots_space
  on public.twin_snapshots(space_id, captured_at desc);
create index if not exists idx_twin_snapshots_user
  on public.twin_snapshots(user_id, captured_at desc);
create index if not exists idx_twin_snapshots_hash
  on public.twin_snapshots(root_hash);
create index if not exists idx_twin_snapshots_run
  on public.twin_snapshots(pipeline_run_id) where pipeline_run_id is not null;

-- ── 2. twin_scenarios ────────────────────────────────────────────────

create table if not exists public.twin_scenarios (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- A scenario ALWAYS has a parent snapshot. Testing an intervention
  -- means: "starting from THIS frozen state, apply this action list,
  -- now measure the delta." Without a baseline there's no delta.
  parent_snapshot_id uuid not null references public.twin_snapshots(id) on delete cascade,

  -- Lifecycle matches Palantir's pattern. A scenario lives in the
  -- shelf as `draft`, gets `testing` when MC runs against it,
  -- `applied` when the user commits the action list to the live KG,
  -- `rejected` when dismissed, `superseded` when a newer scenario
  -- takes its slot.
  status text not null default 'draft' check (status in (
    'draft',
    'testing',
    'applied',
    'rejected',
    'superseded'
  )),

  label text not null,
  description text,

  -- Ordered action list. Each action is a structured object; shape
  -- lives in src/types/scenario.ts `ScenarioAction`. The list is
  -- authoritative — deltas below are DERIVED from replaying this
  -- list against parent_snapshot's entities/edges. If list + deltas
  -- disagree, re-derive from the list.
  action_list jsonb not null default '[]'::jsonb,

  -- Denormalized summary counts for list views.
  action_count int not null default 0,
  delta_count int not null default 0,

  -- Applied-to tracking. When the user commits the scenario to the
  -- live KG, `applied_at` stamps and `post_snapshot_id` links to the
  -- snapshot that was captured immediately AFTER application — that
  -- becomes the "post-intervention" half of the before/after loop.
  applied_at timestamptz,
  post_snapshot_id uuid references public.twin_snapshots(id) on delete set null,
  applied_by uuid references auth.users(id) on delete set null,

  -- Supersession chain for iteration. When a user edits a scenario,
  -- the old version moves to `superseded` and the new row points at
  -- the old via `supersedes_id`. Lets the UI show history without
  -- losing the delta chain.
  supersedes_id uuid references public.twin_scenarios(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_twin_scenarios_space
  on public.twin_scenarios(space_id, created_at desc);
create index if not exists idx_twin_scenarios_parent_snapshot
  on public.twin_scenarios(parent_snapshot_id);
create index if not exists idx_twin_scenarios_status
  on public.twin_scenarios(space_id, status) where status in ('draft', 'testing');

-- ── 3. twin_scenario_deltas ──────────────────────────────────────────

create table if not exists public.twin_scenario_deltas (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.twin_scenarios(id) on delete cascade,

  -- Target of the delta. `entity` / `edge` / `cycle` / `bridge` match
  -- the four shape types a snapshot stores. Target id is the primary
  -- key of the item in the parent snapshot (or `null` for create ops
  -- that haven't chosen an id yet — client-generated UUID at commit).
  target_kind text not null check (target_kind in (
    'entity',
    'edge',
    'cycle',
    'bridge'
  )),
  target_id text,

  op text not null check (op in ('create', 'update', 'delete')),

  -- For `update` ops, the field being changed (e.g. `confidence`,
  -- `strength`, `polarity`). Null for create/delete.
  field text,
  -- Old + new values as JSONB to handle mixed types (number/string/null).
  -- For create: new_value is the full new object; old is null.
  -- For delete: old_value is the full old object; new is null.
  -- For update: only the single field's before/after.
  old_value jsonb,
  new_value jsonb,

  -- Provenance — which action in the scenario's list produced this
  -- delta. Lets the UI group deltas by the action they came from
  -- (e.g. "`raise_confidence(C3, 0.9)` produced 1 delta").
  action_index int,

  created_at timestamptz not null default now()
);

create index if not exists idx_twin_scenario_deltas_scenario
  on public.twin_scenario_deltas(scenario_id, action_index);
create index if not exists idx_twin_scenario_deltas_target
  on public.twin_scenario_deltas(target_kind, target_id);

-- ── 4. pipeline_runs reproducibility metadata ────────────────────────
--
-- Adding these columns lets any run be traced back to its exact
-- inputs: the snapshot it read, the scenario (if any) it was testing,
-- the seed it used, the model version, and its ancestor in a fork
-- chain. This is the MLflow/DVC pattern from the R5 brief.
--
-- All columns are nullable — pre-R5 runs stay unaffected; new runs
-- populate the fields when the caller has them.

alter table public.pipeline_runs
  add column if not exists seed bigint;

comment on column public.pipeline_runs.seed is
  'PRNG seed used by any Monte Carlo / bootstrap simulation in this run. Null when no sim ran. Lets a run be re-executed with identical noise.';

alter table public.pipeline_runs
  add column if not exists model_version text;

comment on column public.pipeline_runs.model_version is
  'LLM model + prompt version tag, e.g. "claude-sonnet-4.7/strategic-rec-v9". Null when no LLM was invoked. Lets downstream analysis correlate outcomes to specific model revs.';

alter table public.pipeline_runs
  add column if not exists snapshot_id uuid references public.twin_snapshots(id) on delete set null;

comment on column public.pipeline_runs.snapshot_id is
  'Snapshot this run read from. When set, the run is a test ON A FROZEN state, not the live KG. MC + twin reads go to the snapshot JSONB instead of live entities/edges.';

alter table public.pipeline_runs
  add column if not exists twin_scenario_id uuid references public.twin_scenarios(id) on delete set null;

comment on column public.pipeline_runs.twin_scenario_id is
  'twin_scenarios row this run was testing. When set, deltas are applied on top of snapshot_id before reading. Null = read snapshot (or live KG) as-is. Disambiguated from the legacy synthesis-output scenarios table.';

alter table public.pipeline_runs
  add column if not exists parent_run_id uuid references public.pipeline_runs(id) on delete set null;

comment on column public.pipeline_runs.parent_run_id is
  'Ancestor run in a fork chain. A user clicking "fork and retry" creates a child run with parent_run_id set; a user re-running a variant creates a sibling via parent_run_id too. Forms a DAG of runs per space.';

create index if not exists idx_pipeline_runs_snapshot
  on public.pipeline_runs(snapshot_id) where snapshot_id is not null;
create index if not exists idx_pipeline_runs_twin_scenario
  on public.pipeline_runs(twin_scenario_id) where twin_scenario_id is not null;
create index if not exists idx_pipeline_runs_parent
  on public.pipeline_runs(parent_run_id) where parent_run_id is not null;

-- ── 5. Row-level security ────────────────────────────────────────────

alter table public.twin_snapshots enable row level security;
alter table public.twin_scenarios enable row level security;
alter table public.twin_scenario_deltas enable row level security;

drop policy if exists "twin_snapshots_owner" on public.twin_snapshots;
create policy "twin_snapshots_owner" on public.twin_snapshots
  for all using (auth.uid() = user_id);

drop policy if exists "twin_scenarios_owner" on public.twin_scenarios;
create policy "twin_scenarios_owner" on public.twin_scenarios
  for all using (auth.uid() = user_id);

drop policy if exists "twin_scenario_deltas_via_scenario" on public.twin_scenario_deltas;
create policy "twin_scenario_deltas_via_scenario" on public.twin_scenario_deltas
  for all using (
    scenario_id in (select id from public.twin_scenarios where user_id = auth.uid())
  );

-- ── 6. updated_at trigger for twin_scenarios ─────────────────────────

create or replace function public.set_twin_scenarios_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_twin_scenarios_updated_at on public.twin_scenarios;
create trigger trg_twin_scenarios_updated_at
  before update on public.twin_scenarios
  for each row execute function public.set_twin_scenarios_updated_at();
