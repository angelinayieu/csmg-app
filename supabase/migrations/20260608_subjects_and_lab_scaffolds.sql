-- ── Subjects + experiments + lab scaffolds ──────────────────────
--
-- The "Subject" primitive lands here. Recap from design discussion:
--
--   Subject = a NAMED COMPOSITION of existing things, NOT a new
--   sandbox engine. Each Subject is "the center of focus we want to
--   manipulate" — a person (clinical), a product (engineering), an
--   essay topic (writing), a reaction (chemistry), or a carved-out
--   environment from the KG (analysis). The whiteboard is a shared
--   ingredient pool; multiple Subjects can coexist on the same
--   whiteboard, each with its own scope, conditions, and per-subject
--   parameter overrides.
--
-- The Subject composes:
--   1. A baseline TWIN_SNAPSHOT (the frozen "save game" of the KG)
--   2. A SYSTEM scope (which ingredients are inside the walls)
--   3. CONDITIONS — a JSONB bag of modulator key-value pairs
--      (sleep_h, stress_0_10, caffeine_mg, time_of_day_24h, …)
--   4. ENTITY PARAMETER OVERRIDES — per-subject K/tau/rho/alpha
--      tuning that doesn't clobber `entities.parameters`
--   5. An EXPERIMENT LOG — append-only audit of every what-if /
--      MC / calibration run against this subject
--
-- Companion `lab_scaffolds` table is the pre-flight checklist: the
-- LLM proposes "here are 2 subjects + 4 lab features to enable"
-- after strategy-refresh; the user approves; the scaffold endpoint
-- materializes the subjects + flips status="scaffolded" + emits
-- `stage_boundary{stage:"lab",phase:"enter"}`.
--
-- See:
--   - src/types/subject.ts (TS view of these rows)
--   - src/lib/subjects/modulators.ts (condition vocabulary +
--     applyModulators math)
--   - src/app/api/spaces/[id]/subjects/* (CRUD)
--   - src/app/api/spaces/[id]/lab-scaffolds/* (wizard endpoints)

-- ──────────────────────────────────────────────────────────────────
-- Pre-flight dependency guards
-- ──────────────────────────────────────────────────────────────────
-- This migration depends on three earlier ones:
--   - 20260602_snapshots_scenarios.sql      (twin_snapshots, twin_scenarios)
--   - 20260607_systems.sql                   (systems)
--   - any migration creating spaces + pipeline_runs + strategy_snapshots
--
-- If any are missing, fail LOUD up front rather than mid-way through
-- a partial table create. The DO block raises a readable error so the
-- operator knows exactly which migration to run first.

do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='twin_snapshots') then
    raise exception 'subjects migration requires twin_snapshots — apply 20260602_snapshots_scenarios.sql first';
  end if;
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='twin_scenarios') then
    raise exception 'subjects migration requires twin_scenarios — apply 20260602_snapshots_scenarios.sql first (do not confuse with the legacy synthesis-output scenarios table)';
  end if;
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='systems') then
    raise exception 'subjects migration requires systems — apply 20260607_systems.sql first';
  end if;
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='strategy_snapshots') then
    raise exception 'subjects migration requires strategy_snapshots';
  end if;
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='pipeline_runs') then
    raise exception 'subjects migration requires pipeline_runs';
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────
-- 1. subjects — composition wrapper
-- ──────────────────────────────────────────────────────────────────

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Identity
  name text not null,
  description text,

  -- "Center of focus" classification — drives icon + UX language.
  -- Closed enum so the UI can dispatch confidently. Add a new value
  -- via migration; keep `other` as the catch-all rather than
  -- letting unknown strings leak in.
  focus_kind text not null check (focus_kind in (
    'person',
    'document',
    'product',
    'topic',
    'environment',
    'system',
    'data',
    'reaction',
    'other'
  )),
  -- Free-form label of what's at the center, e.g. "Patient #4287",
  -- "Caffeine + ATP paper", "Q3 product launch", "Acme→Bcme reaction"
  focus_label text not null,

  -- Gates the KG-growth aggression (user explicitly flagged this).
  -- bare_topic     → KG generates new ingredients freely
  -- partial_artifact → anchor on what exists, find gaps
  -- complete_artifact → critique + simulate, don't add new ingredients
  artifact_state text not null default 'bare_topic' check (
    artifact_state in (
      'bare_topic',
      'partial_artifact',
      'complete_artifact'
    )
  ),

  -- Composition — points at existing primitives (no duplication)
  baseline_snapshot_id uuid references public.twin_snapshots(id)
    on delete set null,
  scope_system_id uuid references public.systems(id)
    on delete set null,

  -- Conditions = the modulator slider bag.
  -- Shape: { "<modulator_key>": <number>, ... }
  -- e.g. { "sleep_h": 8.0, "stress_0_10": 2.0, "caffeine_mg": 0,
  --        "time_of_day_24h": 10 }
  -- Vocabulary lives in src/lib/subjects/modulators.ts (TS constant
  -- for v1; promote to a per-space modulators table when users
  -- want to author their own).
  conditions jsonb not null default '{}'::jsonb,

  -- Per-subject entity parameter overrides — DOES NOT clobber
  -- `entities.parameters` (which stays the global default). Layered
  -- on top at lab read time via applyModulators().
  -- Shape: { "<entity_id>": { "K"?: num, "tau"?: num, "rho"?: num,
  --                            "alpha"?: num }, ... }
  entity_param_overrides jsonb not null default '{}'::jsonb,

  -- Provenance — how was this subject formed?
  -- Drives the "added more prompts/files spawn new subjects" flow.
  source_kind text check (source_kind in (
    'initial_prompt',
    'added_prompt',
    'uploaded_file',
    'research_paper',
    'lasso_selection',
    'pipeline_proposed',
    'manual'
  )),
  -- Free-form ref payload. Shape varies by source_kind:
  --   initial_prompt → { "prompt_text": "..." }
  --   uploaded_file  → { "file_id": "uuid" }
  --   research_paper → { "doi": "...", "title": "..." }
  --   pipeline_proposed → { "lab_scaffold_id": "uuid" }
  source_ref jsonb,

  status text not null default 'active' check (status in (
    'active', 'archived'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subjects_space on public.subjects(space_id);
create index if not exists idx_subjects_user on public.subjects(user_id);
create index if not exists idx_subjects_status
  on public.subjects(space_id, status);
create index if not exists idx_subjects_baseline
  on public.subjects(baseline_snapshot_id);
create index if not exists idx_subjects_scope
  on public.subjects(scope_system_id);

comment on table public.subjects is
  'Phase: subject primitive. A named composition that wraps a baseline snapshot, a system scope, a conditions bag (modulators), and per-subject entity parameter overrides. Multiple subjects can coexist per whiteboard; each is the user-facing unit of "this is what I want to manipulate / experiment with."';

comment on column public.subjects.conditions is
  'Modulator key-value bag (sleep_h, stress_0_10, caffeine_mg, time_of_day_24h). Vocabulary lives in src/lib/subjects/modulators.ts. Applied to entity parameters at lab read time via applyModulators(); never mutates entity rows.';

comment on column public.subjects.entity_param_overrides is
  'Per-subject K/tau/rho/alpha overrides keyed by entity_id. Layered on top of entities.parameters (the global default) at lab read time. Lets two subjects test the same entity with different parameter assumptions without clobbering each other.';

comment on column public.subjects.artifact_state is
  'Gates KG-growth aggression. bare_topic = generate freely. partial_artifact = anchor on existing, find gaps. complete_artifact = critique + simulate only.';

-- ──────────────────────────────────────────────────────────────────
-- 2. subject_experiments — append-only audit log
-- ──────────────────────────────────────────────────────────────────
--
-- Closes the gap surfaced in design discussion: today scenarios
-- store action lists but never the (subject + conditions + run
-- params) → outcome trail. Every what-if / MC / calibration run
-- against a subject writes one row here.
--
-- conditions_at_run is FROZEN at the moment of the run so changing
-- the subject's conditions later doesn't rewrite history.

create table if not exists public.subject_experiments (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Optional link to the twin_scenario that was applied. Null when
  -- the run was a pure read-only sim against the baseline (no
  -- scenario). Points at the Palantir-style `twin_scenarios` table
  -- (action_list + parent_snapshot), NOT the legacy synthesis-output
  -- `scenarios` table.
  twin_scenario_id uuid references public.twin_scenarios(id) on delete set null,

  -- Conditions snapshot at the moment of the run.
  conditions_at_run jsonb not null default '{}'::jsonb,

  run_kind text not null check (run_kind in (
    'what_if',
    'monte_carlo',
    'bootstrap',
    'deterministic_replay',
    'calibration'
  )),
  -- Run inputs: target_entity_id, direction, magnitude, iterations…
  run_params jsonb,
  -- Compact summary: { p10, p50, p90, mean, stddev, verdict, ... }
  outcome_summary jsonb,
  -- Full histogram / distribution payload when applicable.
  outcome_distribution jsonb,

  ran_at timestamptz not null default now()
);

create index if not exists idx_subject_experiments_subject_time
  on public.subject_experiments(subject_id, ran_at desc);
create index if not exists idx_subject_experiments_user
  on public.subject_experiments(user_id);

comment on table public.subject_experiments is
  'Append-only audit log of every experiment (what-if / MC / calibration / etc.) run against a Subject. conditions_at_run is frozen to make history reproducible regardless of later subject edits.';

-- ──────────────────────────────────────────────────────────────────
-- 3. lab_scaffolds — the pre-flight checklist
-- ──────────────────────────────────────────────────────────────────
--
-- Sequence:
--   strategy-refresh completes
--      → propose-lab endpoint LLM-generates checklist
--      → row inserted with status='proposed'
--      → user reviews wizard, toggles, approves
--      → approve endpoint flips status='approved' then 'scaffolded'
--      → subjects materialize (subject ids land in
--        materialized_subject_ids[])
--      → stage_boundary{stage:"lab",phase:"enter"} emitted
--
-- Multiple proposals per space are allowed (one per strategy-refresh
-- run); old ones move to status='superseded' when a new one lands.

create table if not exists public.lab_scaffolds (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Proposal payloads. Shapes documented in
  -- src/types/subject.ts under LabScaffold.
  proposed_subjects jsonb not null default '[]'::jsonb,
  proposed_features jsonb not null default '[]'::jsonb,
  proposed_parameters jsonb not null default '{}'::jsonb,

  -- Provenance — what triggered this proposal?
  source_strategy_snapshot_id uuid
    references public.strategy_snapshots(id) on delete set null,
  pipeline_run_id uuid references public.pipeline_runs(id)
    on delete set null,

  status text not null default 'proposed' check (status in (
    'proposed',
    'approved',
    'scaffolded',
    'rejected',
    'superseded'
  )),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),

  -- Filled in by the approve endpoint after subjects materialize.
  materialized_subject_ids uuid[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lab_scaffolds_space on public.lab_scaffolds(space_id);
create index if not exists idx_lab_scaffolds_status
  on public.lab_scaffolds(space_id, status);
create index if not exists idx_lab_scaffolds_run
  on public.lab_scaffolds(pipeline_run_id);

comment on table public.lab_scaffolds is
  'Pre-flight checklist proposed by the LLM after strategy-refresh: which subjects to create + which lab features to enable. The user reviews via the lab proposal wizard; on approval, subjects materialize and the lab opens scoped to the chosen subject(s).';

-- ──────────────────────────────────────────────────────────────────
-- 4. updated_at triggers (shared function for both tables)
-- ──────────────────────────────────────────────────────────────────

create or replace function public.touch_subjects_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_subjects_touch on public.subjects;
create trigger trg_subjects_touch
  before update on public.subjects
  for each row execute function public.touch_subjects_updated_at();

drop trigger if exists trg_lab_scaffolds_touch on public.lab_scaffolds;
create trigger trg_lab_scaffolds_touch
  before update on public.lab_scaffolds
  for each row execute function public.touch_subjects_updated_at();

-- ──────────────────────────────────────────────────────────────────
-- 5. RLS — owner-only on all three tables
-- ──────────────────────────────────────────────────────────────────

alter table public.subjects enable row level security;
drop policy if exists subjects_owner_select on public.subjects;
create policy subjects_owner_select on public.subjects
  for select using (auth.uid() = user_id);
drop policy if exists subjects_owner_insert on public.subjects;
create policy subjects_owner_insert on public.subjects
  for insert with check (auth.uid() = user_id);
drop policy if exists subjects_owner_update on public.subjects;
create policy subjects_owner_update on public.subjects
  for update using (auth.uid() = user_id);
drop policy if exists subjects_owner_delete on public.subjects;
create policy subjects_owner_delete on public.subjects
  for delete using (auth.uid() = user_id);

alter table public.subject_experiments enable row level security;
drop policy if exists subject_experiments_owner_select on public.subject_experiments;
create policy subject_experiments_owner_select on public.subject_experiments
  for select using (auth.uid() = user_id);
drop policy if exists subject_experiments_owner_insert on public.subject_experiments;
create policy subject_experiments_owner_insert on public.subject_experiments
  for insert with check (auth.uid() = user_id);
-- No update/delete policies — append-only audit log by design.

alter table public.lab_scaffolds enable row level security;
drop policy if exists lab_scaffolds_owner_select on public.lab_scaffolds;
create policy lab_scaffolds_owner_select on public.lab_scaffolds
  for select using (auth.uid() = user_id);
drop policy if exists lab_scaffolds_owner_insert on public.lab_scaffolds;
create policy lab_scaffolds_owner_insert on public.lab_scaffolds
  for insert with check (auth.uid() = user_id);
drop policy if exists lab_scaffolds_owner_update on public.lab_scaffolds;
create policy lab_scaffolds_owner_update on public.lab_scaffolds
  for update using (auth.uid() = user_id);
drop policy if exists lab_scaffolds_owner_delete on public.lab_scaffolds;
create policy lab_scaffolds_owner_delete on public.lab_scaffolds
  for delete using (auth.uid() = user_id);
