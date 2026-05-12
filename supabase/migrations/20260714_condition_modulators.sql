-- ── Condition modulators ────────────────────────────────────────────────
--
-- Per-(condition, edge) effect-size multipliers that personalize the
-- simulator to each user's persona. Today this is the missing piece of
-- per-patient calibration: the user's `subjects.conditions` JSONB
-- (e.g., {sleep_h: 0, stress: 7, post_chemo_24mo: true}) is read from
-- the table but never applied to predictions, so "Healthy Young Adult"
-- and "Resident Post-Call" get identical forecasts for identical
-- interventions.
--
-- After this table lands and is populated:
--
--   - aggregate-environment-definition.ts → InitialStateDistribution.
--     applied_modulators / uncalibrated_conditions surface which
--     conditions the aggregator could / couldn't calibrate against
--   - simulator (planned): when an active subject has condition X and
--     a row exists for (X, edge_e), multiply edge_e.strength by the
--     sampled multiplier (drawn from the p10/p50/p90 triple)
--   - confidence_breakdown.initial_state_calibration measures the
--     ratio of (conditions with modulators) / (total conditions) and
--     drives the "predictions may use uncalibrated population averages"
--     callout
--
-- Population: rows are sourced from
--   (a) literature extraction — research pipeline finds "BDNF response
--       reduced 40% in post-chemo populations" → inserts a row
--   (b) template seeds — well-established modulators ship with the
--       template for common conditions (sleep deprivation, stress,
--       inflammation)
--   (c) fitted models — when enough (condition × edge × outcome) data
--       accumulates, regress modulator coefficients
--
-- Scoping: space_id is nullable. NULL = global modulator that applies
-- to any space whose ontology contains the matching edge label.
-- Specific space_id = override / refinement scoped to one space.

create table if not exists public.condition_modulators (
  id uuid primary key default gen_random_uuid(),

  -- Nullable: NULL = global modulator (applies across spaces).
  -- Non-null: scoped to one space (override or refinement).
  space_id uuid references public.spaces (id) on delete cascade,

  condition_key text not null,

  -- The edge whose strength this modulator adjusts. May be:
  --   - a UUID FK to a specific edges.id (when this row was authored
  --     against a specific space's edge)
  --   - an opaque text label (when this is a global modulator that
  --     applies to any edge with a matching canonical label, e.g.,
  --     "aerobic_exercise → bdnf")
  -- The aggregator resolves UUID-shaped values through the FK and
  -- treats text-shaped values as label matches against
  -- edges.canonical_label / edges.source_name + edges.target_name.
  target_edge_id text not null,

  multiplier_p10 numeric not null,
  multiplier_p50 numeric not null,
  multiplier_p90 numeric not null,

  source_evidence_ids text[] not null default array[]::text[],

  -- Provenance: who/what authored this modulator?
  source_kind text not null default 'literature',

  created_at timestamptz not null default now()
);

-- Sanity constraints on the multiplier triple.
alter table public.condition_modulators
  drop constraint if exists condition_modulators_multipliers_check;

alter table public.condition_modulators
  add constraint condition_modulators_multipliers_check
  check (
    multiplier_p10 >= 0
    and multiplier_p50 >= 0
    and multiplier_p90 >= 0
    and multiplier_p10 <= multiplier_p50
    and multiplier_p50 <= multiplier_p90
  );

alter table public.condition_modulators
  drop constraint if exists condition_modulators_source_kind_check;

alter table public.condition_modulators
  add constraint condition_modulators_source_kind_check
  check (
    source_kind in (
      'literature',
      'template_seed',
      'fitted_model',
      'user_provided'
    )
  );

-- Aggregator's primary lookup pattern: "for this space, find all
-- modulators whose condition_key matches one of my subject's
-- conditions." The `space_id IS NULL OR space_id = $1` predicate
-- picks up both global and space-scoped modulators.
create index if not exists condition_modulators_lookup_idx
  on public.condition_modulators (space_id, condition_key);

create index if not exists condition_modulators_global_idx
  on public.condition_modulators (condition_key)
  where space_id is null;

create index if not exists condition_modulators_target_idx
  on public.condition_modulators (target_edge_id);

-- ── RLS ──

alter table public.condition_modulators enable row level security;

-- Read access: anyone authenticated can read global modulators (the
-- public literature library). Space-scoped modulators only readable by
-- the space owner.
drop policy if exists condition_modulators_select on public.condition_modulators;

create policy condition_modulators_select
  on public.condition_modulators
  for select
  using (
    space_id is null
    or space_id in (
      select id from public.spaces where user_id = auth.uid()
    )
  );

-- Write access: owners can insert/update modulators scoped to their
-- own spaces. Global modulators are write-protected (managed by
-- backend services — research pipeline, template materializer — via
-- service-role client that bypasses RLS).
drop policy if exists condition_modulators_insert on public.condition_modulators;

create policy condition_modulators_insert
  on public.condition_modulators
  for insert
  with check (
    space_id in (
      select id from public.spaces where user_id = auth.uid()
    )
  );

drop policy if exists condition_modulators_update on public.condition_modulators;

create policy condition_modulators_update
  on public.condition_modulators
  for update
  using (
    space_id in (
      select id from public.spaces where user_id = auth.uid()
    )
  );

drop policy if exists condition_modulators_delete on public.condition_modulators;

create policy condition_modulators_delete
  on public.condition_modulators
  for delete
  using (
    space_id in (
      select id from public.spaces where user_id = auth.uid()
    )
  );

comment on table public.condition_modulators is
  'Per-(condition, edge) multipliers that personalize simulator predictions to a subject''s persona. Read by aggregate-environment-definition.ts → InitialStateDistribution.applied_modulators. Empty table = uncalibrated personas; predictions use population averages.';

comment on column public.condition_modulators.target_edge_id is
  'Either a UUID FK to edges.id (specific edge in a space) or a text label that resolves against edges.canonical_label / source_name + target_name (global modulator).';

comment on column public.condition_modulators.source_kind is
  'Provenance: literature (extracted from research), template_seed (shipped with template), fitted_model (regressed from observation data), user_provided (manually authored).';
