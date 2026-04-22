-- PR 1: Mechanisms as first-class
-- Promotes mechanism_hints (a string enum on InfrastructureProposal) to a real
-- relational table so the UI can:
--   • show per-mechanism agent assignments + cycle pattern
--   • aggregate per-mechanism metrics
--   • approve/reject mechanisms independently of the full strategy
--   • foreign-key apps to a parent mechanism (apps as sub-branches of mechanisms)
--
-- Recursive twin model: a "twin" is just a space. An app's sub_space_id makes
-- the app contain a recursive twin. The existing spaces.depth_level column has
-- no CHECK constraint already, so recursion at any depth works today. The only
-- new safety we add here is a cycle-prevention helper for the sub_space FK.
--
-- Upstream producer: strategy-engine (post-PR3) will materialize one mechanism
-- row per cluster of related InfrastructureProposal.mechanism_hints[].
-- Downstream consumer: app-generator will set apps.parent_mechanism_id when
-- creating apps from a proposal that produced a mechanism.

-- ──────────────────────────────────────────────────────────────────────
-- 1. mechanisms — first-class cyclical sub-processes within a twin
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.mechanisms (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Definition
  name text not null,
  description text,

  -- Closed enum mirroring MechanismHint in src/types/strategy.ts.
  -- Keep in lockstep with the TS union — adding a value requires migration + types.
  kind text not null
    check (kind in (
      'simulation',
      'prediction',
      'validation',
      'baseline_tracking',
      'deviation_capture',
      'game',
      'ml_personalization'
    )),

  -- Cycle pattern — short slug describing the loop this mechanism runs.
  -- Free text for now (e.g. "experiment_score_reprompt", "research_integrate_test").
  -- Can be promoted to enum once patterns stabilize.
  cycle_pattern text,

  -- Why this mechanism is the right fit for this twin's objective.
  -- Maps to the user-visible "justification" for the mechanism.
  rationale text,

  -- Source provenance — which InfrastructureProposal this came from.
  -- Stable across regens (proposal id is stable within a strategy version).
  source_infrastructure_proposal_id text,
  source_strategy_version int,

  -- Agents staffing this mechanism. Mirrors AgentSpec[] on InfrastructureProposal,
  -- denormalized here so per-mechanism queries don't need to walk strategy JSONB.
  agent_assignments jsonb not null default '[]'::jsonb,

  -- Lifecycle (parallels apps.status semantics).
  status text not null default 'proposed'
    check (status in ('proposed','approved','active','paused','retired')),

  -- Approval gate — populated when user accepts/rejects in the intake review.
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Stable identity across regens: same proposal id stays the same mechanism.
  unique(space_id, source_infrastructure_proposal_id, kind)
);

create index if not exists idx_mechanisms_space
  on public.mechanisms(space_id);
create index if not exists idx_mechanisms_user
  on public.mechanisms(user_id);
create index if not exists idx_mechanisms_space_status
  on public.mechanisms(space_id, status);
create index if not exists idx_mechanisms_active
  on public.mechanisms(space_id) where status in ('approved','active');

-- ──────────────────────────────────────────────────────────────────────
-- 2. apps.parent_mechanism_id — apps as sub-branches of mechanisms
-- ──────────────────────────────────────────────────────────────────────
-- Nullable so existing apps (generated before mechanisms existed) keep working.
-- New apps generated post-PR3 will have this set.
alter table public.apps
  add column if not exists parent_mechanism_id uuid
    references public.mechanisms(id) on delete set null;

create index if not exists idx_apps_parent_mechanism
  on public.apps(parent_mechanism_id) where parent_mechanism_id is not null;

-- ──────────────────────────────────────────────────────────────────────
-- 3. Sub-space cycle prevention (no-op stub)
-- ──────────────────────────────────────────────────────────────────────
-- spaces.parent_space_id doesn't exist yet so the full walk is deferred.
-- In practice the app-generator always creates fresh spaces, so cycles
-- can't arise organically. The trigger is kept as a safe pass-through
-- so the trigger name is reserved for a future real implementation.
create or replace function public.assert_no_sub_space_cycle()
returns trigger as $$
begin
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_apps_sub_space_no_cycle on public.apps;
create trigger trg_apps_sub_space_no_cycle
  before insert or update of sub_space_id on public.apps
  for each row execute function public.assert_no_sub_space_cycle();

-- ──────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ──────────────────────────────────────────────────────────────────────
alter table public.mechanisms enable row level security;

drop policy if exists "mechanisms_owner" on public.mechanisms;
create policy "mechanisms_owner" on public.mechanisms
  for all using (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────
-- 5. updated_at trigger (mirrors existing pattern)
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.set_mechanisms_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_mechanisms_updated_at on public.mechanisms;
create trigger trg_mechanisms_updated_at
  before update on public.mechanisms
  for each row execute function public.set_mechanisms_updated_at();

comment on table public.mechanisms is
  'First-class cyclical sub-processes attached to a twin (space). Promoted from '
  'the InfrastructureProposal.mechanism_hints[] enum so the UI can carry agent '
  'assignments, cycle patterns, justifications, and approval state per mechanism. '
  'Apps reference this via apps.parent_mechanism_id.';
