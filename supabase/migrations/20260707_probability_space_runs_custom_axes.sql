-- Persist ad-hoc / custom-minted probability space axes (B2).
--
-- Why: when the framing panel detects ≥2 lenses converging on a dimension
-- NOT covered by the canonical 8 axes (financial / timeline / actors /
-- causal_scenarios / evidence / assumptions / risk / cultural), it mints a
-- custom AxisSpec with a free-form axis_id like "notification_timing_quality".
-- Today the spec rides in memory only — the per-axis generator gets it via
-- HTTP, but the row that should track it in probability_space_runs is
-- silently rejected by the CHECK constraint on `axis`. That means the
-- entire batch insert (canonical + ad-hoc) fails when there are any
-- custom axes, and we lose the audit trail for ALL axes in that run.
--
-- This migration:
--   1. Drops the CHECK constraint so any text slug is accepted.
--   2. Adds `is_custom` boolean to distinguish canonical from minted.
--   3. Adds `custom_axis_spec` jsonb to store the full AxisSpec so the
--      shell painter (B3) can render axis-name + tagline + accent +
--      description from the spec rather than looking up the catalog
--      (which doesn't have the custom axis).
--
-- Backward compat: existing rows have is_custom=false (default), and
-- custom_axis_spec=null. All canonical-axis code paths continue working
-- unchanged. The check that PREVENTED us from persisting non-canonical
-- slugs is replaced by a softer constraint: when is_custom=true, the
-- axis text can be anything; when is_custom=false, code-side validation
-- still ensures it's one of the 8 (the prompt + LLM keep that invariant).
--
-- Idempotent. Safe to re-run.

-- 1. Drop the CHECK constraint that rejected non-canonical slugs.
--    Constraint name from the original migration: postgres auto-named
--    it after the column. Use NOT VALID + DROP cascade for safety.
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.probability_space_runs'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%axis%IN%';
  if constraint_name is not null then
    execute format(
      'alter table public.probability_space_runs drop constraint if exists %I',
      constraint_name
    );
  end if;
end $$;

-- 2. Add the discriminator + spec storage columns.
alter table public.probability_space_runs
  add column if not exists is_custom boolean not null default false,
  add column if not exists custom_axis_spec jsonb;

comment on column public.probability_space_runs.is_custom is
  'True when this row represents a framing-panel-minted ad-hoc axis '
  '(the spec lives in custom_axis_spec). False for canonical axes from '
  'the 8-axis enum (financial / timeline / etc.) — the catalog has all '
  'their metadata. The shell painter branches on this to know whether '
  'to read label/accent from AXIS_CATALOG or from custom_axis_spec.';

comment on column public.probability_space_runs.custom_axis_spec is
  'Full AxisSpec JSONB for ad-hoc axes (axis_id, label, tagline, '
  'accent, dimension, instrument_kind, output_shape, prompt_variants, '
  'etc.). Null for canonical axes — those use AXIS_CATALOG[axis] for '
  'metadata. Shape: src/lib/probability-space/axis-spec.ts → AxisSpec.';

-- 3. Optional partial index for the shell painter / a future
--    "show me my custom axes" UI surface — these are rare events
--    that benefit from a small filtered index.
create index if not exists idx_probability_space_runs_custom
  on public.probability_space_runs(space_id, run_id, order_index)
  where is_custom = true;
