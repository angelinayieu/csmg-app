-- ── environment_overrides — column rename + CHECK widening ────────────
--
-- Sprint W5.0 of the Week 5 plan (DIVERGE_CONVERGE_ARCHITECTURE_PLAN.md
-- §5 Week 5 — corrected by the W5 audit's Correction A).
--
-- ── Why this migration exists ──────────────────────────────────────
--
-- The previous migration (20260713_environment_overrides.sql) created
-- columns `kind`, `payload`, `user_id`. Every callsite in the
-- codebase, however, reads/writes `override_kind`, `override_value`,
-- `created_by`:
--
--   • src/app/api/spaces/[id]/preflight/overrides/route.ts:122-126
--     writes `override_kind / override_value / created_by` on insert
--     → has been silently 500'ing since 20260713 landed.
--
--   • src/lib/preflight/load-preflight.ts:195-204 reads
--     `o.override_kind`, `o.override_value`, `o.created_by` from the
--     row → has been silently returning undefined for those fields
--     (the `??` fallbacks have been masking the bug).
--
--   • src/lib/preflight/partition-variables-by-role.ts:96 reads
--     `o.override_kind === "reclassify_variable"` → has been
--     evaluating to false for every override row.
--
-- Net effect: every preflight-page user click that meant to write a
-- variable role override has been failing silently, and even reads
-- of any rows that DID get written by some other path produce
-- "reclassify_variable" fallback rows with no actual content.
--
-- Two fix paths considered: (A) update all 15+ code sites, (B) rename
-- the 3 DB columns + widen the CHECK. Picked (B) because:
--   1. The codebase has many readers, one migration; lower blast radius
--   2. The route's whitelist allows 10 override kinds; the DB CHECK
--      only allows 6 — even after a column rename, several kinds the
--      route writes would still be rejected. Need to widen the CHECK
--      regardless. Doing both in one migration is cleaner.
--   3. The codebase's `override_kind`/`override_value`/`created_by`
--      naming is more semantically descriptive (carries the "override"
--      context the column belongs to) than the bare `kind`/`payload`/
--      `user_id`.
--
-- ── Pre-existing-data safety ───────────────────────────────────────
--
-- ALTER COLUMN ... RENAME preserves data. If any rows did get written
-- by some legacy path (unlikely given the route 500s, but possible via
-- direct SQL), they survive the rename.
--
-- ── Backout ────────────────────────────────────────────────────────
--
-- Reverse migration: rename the 3 columns back + restore the original
-- 6-value CHECK + restore the reasoning-non-empty CHECK + restore the
-- RLS policies referencing user_id.

-- ── 1. Rename the 3 mismatched columns ────────────────────────────

alter table public.environment_overrides
  rename column kind to override_kind;

alter table public.environment_overrides
  rename column payload to override_value;

alter table public.environment_overrides
  rename column user_id to created_by;

-- ── 2. Drop the old CHECK constraint (its `kind` reference is gone) ──

alter table public.environment_overrides
  drop constraint if exists environment_overrides_kind_check;

-- ── 3. Add a widened CHECK matching the route's VALID_OVERRIDE_KINDS ─
--
-- The full 10-value whitelist mirrors the set defined at
-- src/app/api/spaces/[id]/preflight/overrides/route.ts:32-43. Keeping
-- one source of truth would be even better; for now both must stay
-- in sync manually. When you add a new kind, add it BOTH here and to
-- the route's VALID_OVERRIDE_KINDS set + extend the EnvironmentOverride
-- union in src/types/environment-definition.ts.

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
      -- Original migration kept for back-compat (unused by current
      -- code but reserved for future edge-parameter + action-candidate
      -- surfaces called out in the 20260713 file header).
      'override_edge_parameters',
      'toggle_action_candidate'
    )
  );

-- ── 4. Make reasoning nullable + drop the non-empty CHECK ───────────
--
-- The route writes `reasoning: typeof b.reasoning === "string"
-- ? b.reasoning : null`. The original CHECK required non-empty
-- non-null reasoning, which also failed every insert. The reasoning
-- field is audit-quality-of-life, not load-bearing — dropping the
-- constraint + relaxing NOT NULL fixes the second silent-fail path.

alter table public.environment_overrides
  drop constraint if exists environment_overrides_reasoning_nonempty;

alter table public.environment_overrides
  alter column reasoning drop not null;

-- ── 5. Drop + re-add RLS policies (they reference user_id) ──────────
--
-- The auth.uid() comparisons originally compared against user_id.
-- After the rename, the column is created_by — policies need the new
-- name. Re-create with identical semantics.

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

-- ── 6. Indexes ──────────────────────────────────────────────────────
--
-- PostgreSQL auto-rewrites index column references when a column is
-- renamed, so the existing indexes (environment_overrides_user_idx,
-- environment_overrides_space_created_idx, environment_overrides_
-- target_idx) carry over without explicit migration. No-op here,
-- documented for clarity.

-- ── 7. Update column comments ───────────────────────────────────────

comment on column public.environment_overrides.override_kind is
  'Discriminator for the override type. Mirrors VALID_OVERRIDE_KINDS '
  'in src/app/api/spaces/[id]/preflight/overrides/route.ts and the '
  'EnvironmentOverrideKind union in src/types/environment-definition.ts. '
  'Add new kinds in BOTH places + extend the CHECK constraint above.';

comment on column public.environment_overrides.override_value is
  'Discriminated-union payload typed by override_kind. See '
  'EnvironmentOverridePayload in src/types/environment-definition.ts '
  'for per-kind shape. Aggregator at aggregate-environment-definition.ts '
  '→ applyOverrides reads this.';

comment on column public.environment_overrides.created_by is
  'The user who created the override. RLS policies enforce '
  'created_by = auth.uid() on insert.';
