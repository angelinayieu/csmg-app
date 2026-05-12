-- ── Environment overrides ───────────────────────────────────────────────
--
-- Append-only audit trail of user edits to the LLM-derived environment
-- definition. Each row is a single immutable event; the original
-- LLM/template-derived environment is never destroyed. The aggregator
-- reads all overrides for a space, applies them in created_at order
-- to the LLM-derived environment, and includes them in the
-- environment_hash.
--
-- Override kinds correspond to the EnvironmentOverrideKind enum in
-- src/types/environment-definition.ts:
--
--   reclassify_variable           — move entity between buckets (S ↔ A ↔ excluded)
--   override_edge_parameters      — override edge strength / temporal / etc.
--   adjust_goal                   — change weight / target / deadline / discount
--   set_condition                 — set or correct a subject condition
--   request_baseline_measurement  — flag entity for metric-tracker spawn
--   toggle_action_candidate       — add or remove from action_space
--
-- Application logic:
--   - aggregate-environment-definition.ts → applyOverrides()
--   - Each kind has a dedicated apply function that mutates the draft
--     EnvironmentDefinition before hashing
--   - Unknown kinds skipped with no error (forward-compat)
--
-- Pre-commit safety:
--   - pre_commit_impact_estimate stores the predicted Δ on existing
--     prediction_ledger rows at commit time
--   - UI must show "this override changes prediction X by Y%" before
--     letting the user confirm
--
-- RLS: standard "owner can do everything" policy mirroring spaces.

create table if not exists public.environment_overrides (
  id uuid primary key default gen_random_uuid(),

  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  kind text not null,
  target_id text not null,
  payload jsonb not null,

  reasoning text not null,
  pre_commit_impact_estimate jsonb default '[]'::jsonb,

  created_at timestamptz not null default now()
);

-- Discriminated-union check on the kind column. Mirrors
-- EnvironmentOverrideKind in environment-definition.ts.
alter table public.environment_overrides
  drop constraint if exists environment_overrides_kind_check;

alter table public.environment_overrides
  add constraint environment_overrides_kind_check
  check (
    kind in (
      'reclassify_variable',
      'override_edge_parameters',
      'adjust_goal',
      'set_condition',
      'request_baseline_measurement',
      'toggle_action_candidate'
    )
  );

-- Reasoning is required (no anonymous overrides). Empty-string check.
alter table public.environment_overrides
  drop constraint if exists environment_overrides_reasoning_nonempty;

alter table public.environment_overrides
  add constraint environment_overrides_reasoning_nonempty
  check (length(trim(reasoning)) > 0);

-- The aggregator reads all overrides for a space sorted by created_at
-- ASC. This is the canonical query path.
create index if not exists environment_overrides_space_created_idx
  on public.environment_overrides (space_id, created_at asc);

-- Per-user audit history.
create index if not exists environment_overrides_user_idx
  on public.environment_overrides (user_id, created_at desc);

-- Per-target lookup ("what overrides apply to this entity?").
create index if not exists environment_overrides_target_idx
  on public.environment_overrides (space_id, target_id);

-- ── RLS ──

alter table public.environment_overrides enable row level security;

drop policy if exists environment_overrides_select_own
  on public.environment_overrides;

create policy environment_overrides_select_own
  on public.environment_overrides
  for select
  using (
    user_id = auth.uid()
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
    user_id = auth.uid()
    and space_id in (
      select id from public.spaces where user_id = auth.uid()
    )
  );

-- No update / delete policies. Overrides are append-only. To "undo"
-- an override, the user creates a new override that reverses it
-- (preserves audit trail). If a future need arises (e.g., GDPR
-- erasure), add a soft-delete column rather than enabling row delete.

comment on table public.environment_overrides is
  'Append-only audit trail of user edits to the LLM-derived EnvironmentDefinition. Read by aggregate-environment-definition.ts → applyOverrides(). Each row is immutable; "undo" creates a reverse override.';

comment on column public.environment_overrides.payload is
  'Discriminated-union payload typed by `kind`. See EnvironmentOverridePayload in src/types/environment-definition.ts for per-kind shape.';

comment on column public.environment_overrides.pre_commit_impact_estimate is
  'Array of {prediction_id, delta_p50, delta_p90_minus_p10} computed at commit time. Drives "this override changed prediction X by Y%" audit messages.';
