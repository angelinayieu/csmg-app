-- ── environment_overrides — canonical create (W5.7a) ─────────────────
--
-- This migration consolidates 20260713_environment_overrides.sql + the
-- W5.0 canonicalization (20260718_environment_overrides_canonicalize.sql)
-- into a single applyable migration for environments where neither
-- prior one ever landed.
--
-- Why this consolidation exists:
--   The live Supabase project has no environment_overrides table at
--   all — the original 20260713 create migration never reached the
--   remote DB, and 20260718's rename can't fire against a missing
--   table. Every callsite (preflight overrides route, partition,
--   derive-app-variables, load-preflight) reads/writes columns named
--   override_kind / override_value / created_by against a table that
--   doesn't exist → silent 500s.
--
--   Rather than apply the two prior migrations in sequence (the rename
--   would no-op because the table doesn't exist yet for the rename to
--   target), this single migration creates the table directly in the
--   W5.0-final shape so the live DB matches what the codebase reads.
--
-- Idempotency:
--   `create table if not exists` + `drop policy if exists ... ; create
--   policy ...` make this safe to re-apply.
--
-- ── Schema ──────────────────────────────────────────────────────────

create table if not exists public.environment_overrides (
  id uuid primary key default gen_random_uuid(),

  space_id uuid not null references public.spaces (id) on delete cascade,
  -- Canonical naming (W5.0): created_by, not user_id. RLS policies use
  -- this column to match auth.uid().
  created_by uuid not null references auth.users (id) on delete cascade,

  -- Canonical naming (W5.0): override_kind / override_value, not the
  -- legacy `kind` / `payload`.
  override_kind text not null,
  target_id text not null,
  override_value jsonb not null,

  -- W5.0: reasoning is nullable (audit nice-to-have, not load-bearing).
  reasoning text,
  pre_commit_impact_estimate jsonb default '[]'::jsonb,

  created_at timestamptz not null default now()
);

-- ── Discriminated-union check ──────────────────────────────────────
--
-- Widened 12-value list matches src/app/api/spaces/[id]/preflight/
-- overrides/route.ts VALID_OVERRIDE_KINDS (10) + 2 reserved kinds for
-- the original 20260713 file's edge-parameter and action-candidate
-- surfaces.
alter table public.environment_overrides
  drop constraint if exists environment_overrides_kind_check;

alter table public.environment_overrides
  add constraint environment_overrides_kind_check
  check (
    override_kind in (
      -- Preflight variable-role surface
      'reclassify_variable',
      'add_variable',
      'remove_variable',
      'set_observability',
      -- Preflight goal/condition/baseline surface
      'adjust_goal',
      'set_condition',
      'request_baseline_measurement',
      -- Preflight plan-item + mediator-preview surface
      'toggle_plan_item',
      'approve_preview_bridge',
      'reject_preview_bridge',
      -- Reserved for edge-parameter + action-candidate surfaces
      'override_edge_parameters',
      'toggle_action_candidate'
    )
  );

-- ── Indexes ────────────────────────────────────────────────────────
--
-- Aggregator reads space rows in created_at ASC order.
create index if not exists environment_overrides_space_created_idx
  on public.environment_overrides (space_id, created_at asc);

-- Per-user audit history.
create index if not exists environment_overrides_user_idx
  on public.environment_overrides (created_by, created_at desc);

-- Per-target lookup ("what overrides apply to this entity?").
create index if not exists environment_overrides_target_idx
  on public.environment_overrides (space_id, target_id);

-- ── RLS ────────────────────────────────────────────────────────────

alter table public.environment_overrides enable row level security;

drop policy if exists environment_overrides_select_own
  on public.environment_overrides;

create policy environment_overrides_select_own
  on public.environment_overrides
  for select
  using (
    created_by = auth.uid()
    or space_id in (
      select id from public.spaces where user_id = auth.uid()
    )
  );

drop policy if exists environment_overrides_insert_own
  on public.environment_overrides;

create policy environment_overrides_insert_own
  on public.environment_overrides
  for insert
  with check (
    created_by = auth.uid()
    and space_id in (
      select id from public.spaces where user_id = auth.uid()
    )
  );

-- No update / delete policies. Overrides are append-only. "Undo" =
-- create a reverse override (preserves audit trail).

-- ── Comments ───────────────────────────────────────────────────────

comment on table public.environment_overrides is
  'Append-only audit trail of user edits to the LLM-derived EnvironmentDefinition. Read by aggregate-environment-definition.ts → applyOverrides() and by partition-variables-by-role for variable-role overrides. Each row is immutable; "undo" creates a reverse override.';

comment on column public.environment_overrides.override_kind is
  'Discriminator for the override type. Mirrors VALID_OVERRIDE_KINDS in src/app/api/spaces/[id]/preflight/overrides/route.ts and the EnvironmentOverrideKind union in src/types/environment-definition.ts. Add new kinds in BOTH places + extend the CHECK constraint above.';

comment on column public.environment_overrides.override_value is
  'Discriminated-union payload typed by override_kind. See EnvironmentOverridePayload in src/types/environment-definition.ts for per-kind shape. Aggregator at aggregate-environment-definition.ts → applyOverrides reads this.';

comment on column public.environment_overrides.created_by is
  'The user who created the override. RLS policies enforce created_by = auth.uid() on insert.';

comment on column public.environment_overrides.pre_commit_impact_estimate is
  'Array of {prediction_id, delta_p50, delta_p90_minus_p10} computed at commit time. Drives "this override changed prediction X by Y%" audit messages.';
