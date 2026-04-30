-- ── prediction_ledger — temporal trajectory columns ──────────────────
--
-- Phase 5 of the temporal-rigor plan. Extends the existing
-- prediction_ledger (migration 20260508) so it can carry a per-week
-- trajectory prediction in addition to single-point forecasts. This
-- is the substrate the time-aware Monte Carlo (Phase 4) writes into
-- when an intervention is pre-registered.
--
-- DESIGN
--
-- The existing `predicted_distribution` JSONB carries a single
-- {p10,p50,p90} for a point-in-time prediction. Phase 4's simulator
-- now emits per-week trajectories `[{week, p10, p50, p90, mean,
-- stddev}, …]`. Rather than overload `predicted_distribution`
-- (and break consumers that read it as a single point), we add a
-- separate `predicted_trajectory` column and a `prediction_kind`
-- discriminator. Old consumers that read predicted_distribution
-- continue to work. New consumers read predicted_trajectory when
-- prediction_kind='trajectory'.
--
-- Resolution gets the same treatment: existing `resolved_actual`
-- + `deviation` for point predictions; new `actual_trajectory`
-- JSONB for repeated-measures resolution. The resolver computes
-- per-week deviation from the trajectory and emits one
-- edge_calibrations row per timepoint surprise (or one aggregate row
-- with the path's bottleneck week).
--
-- COLUMNS
--
--   prediction_kind        — 'point_value' (existing) | 'trajectory'
--                              (new, Phase 5). Drives consumer
--                              behavior.
--   target_entity_id       — KG entity the prediction is about. Was
--                              implicit via tracker_id; now explicit
--                              so consumers can attach without
--                              joining metric_trackers.
--   intervention_id        — Phase 5: the intervention whose
--                              activation triggered this prediction.
--                              Null for predictions emitted from
--                              other paths (agent ad-hoc, pipeline-
--                              level forecasts).
--   predicted_trajectory   — JSONB array of [{week, p10, p50, p90,
--                              mean, stddev}, …]. Populated when
--                              prediction_kind='trajectory'.
--   predicted_basis_edge_ids
--                          — UUIDs of edges whose pooled timing
--                              produced this trajectory (from Phase
--                              3 edges.{onset,peak,persistence}_days_p50).
--                              Drives the resolver's path-aware
--                              calibration.
--   predicted_basis_evidence_ids
--                          — TEXT[] of evidence_registries.id rows
--                              that fed the path's pooled timing.
--                              Lets a deviation tag back-trace to
--                              source studies for review-mode
--                              correction.
--   actual_trajectory      — JSONB array of [{week, value,
--                              n_observed?, source_quote?}, …].
--                              Populated at resolution when the user
--                              reports repeated-measures outcomes.
--   predicted_simulator    — 'monte_carlo_discrete' | 'monte_carlo_ode' |
--                              'template_seed' | 'user_curated'.
--                              Records WHICH simulator produced the
--                              trajectory so calibration can tell
--                              which engine to credit/debit.
--
-- BACKWARD COMPAT
--
-- All new columns nullable. prediction_kind defaults to 'point_value'
-- so existing rows continue to validate without migration. The
-- existing `predicted_distribution` and `resolved_actual` paths are
-- unchanged.

-- ── New columns ──

alter table public.prediction_ledger
  add column if not exists prediction_kind text not null default 'point_value',
  add column if not exists target_entity_id uuid,
  add column if not exists intervention_id uuid,
  add column if not exists predicted_trajectory jsonb,
  add column if not exists predicted_basis_edge_ids uuid[] not null default '{}'::uuid[],
  add column if not exists predicted_basis_evidence_ids text[] not null default '{}'::text[],
  add column if not exists actual_trajectory jsonb,
  add column if not exists predicted_simulator text;

-- ── Constraints ──

-- prediction_kind enum check (open vocab pattern — soft check).
alter table public.prediction_ledger
  drop constraint if exists prediction_ledger_kind_check;
alter table public.prediction_ledger
  add constraint prediction_ledger_kind_check
  check (prediction_kind in ('point_value', 'trajectory'));

-- predicted_simulator open vocab check.
alter table public.prediction_ledger
  drop constraint if exists prediction_ledger_simulator_check;
alter table public.prediction_ledger
  add constraint prediction_ledger_simulator_check
  check (
    predicted_simulator is null
    or predicted_simulator in (
      'monte_carlo_discrete',
      'monte_carlo_ode',
      'template_seed',
      'user_curated'
    )
  );

-- target_entity_id FK → entities (nullable; ON DELETE SET NULL so
-- entity churn doesn't cascade-delete history).
alter table public.prediction_ledger
  drop constraint if exists prediction_ledger_target_entity_fk;
alter table public.prediction_ledger
  add constraint prediction_ledger_target_entity_fk
  foreign key (target_entity_id) references public.entities(id)
  on delete set null;

-- intervention_id FK → interventions (nullable; ON DELETE SET NULL).
alter table public.prediction_ledger
  drop constraint if exists prediction_ledger_intervention_fk;
alter table public.prediction_ledger
  add constraint prediction_ledger_intervention_fk
  foreign key (intervention_id) references public.interventions(id)
  on delete set null;

-- Trajectory predictions must populate predicted_trajectory; point
-- predictions stay back-compat (no requirement on predicted_value vs
-- predicted_value_text — the existing prediction_has_value check
-- still applies for those).
alter table public.prediction_ledger
  drop constraint if exists prediction_ledger_trajectory_present;
alter table public.prediction_ledger
  add constraint prediction_ledger_trajectory_present
  check (
    prediction_kind != 'trajectory'
    or predicted_trajectory is not null
  );

-- ── Indexes ──

-- Per-intervention prediction history. Drives the strategy drawer's
-- "predictions made for this intervention" surface.
create index if not exists prediction_ledger_intervention_idx
  on public.prediction_ledger (intervention_id, predicted_at desc)
  where intervention_id is not null;

-- Per-target-entity history. Drives the entity-detail drawer's
-- "predictions about this entity" surface.
create index if not exists prediction_ledger_target_entity_idx
  on public.prediction_ledger (target_entity_id, predicted_at desc)
  where target_entity_id is not null;

-- Trajectory-only queue: open trajectory predictions awaiting
-- repeated-measures resolution. Drives the cron resolver's
-- trajectory-aware path.
create index if not exists prediction_ledger_open_trajectory_idx
  on public.prediction_ledger (horizon_at)
  where status = 'open' and prediction_kind = 'trajectory';

-- "Find predictions citing edge X" — used when the edge's pool
-- changes and we want to mark dependent predictions stale.
create index if not exists prediction_ledger_basis_edges_gin_idx
  on public.prediction_ledger using gin (predicted_basis_edge_ids);

-- ── Comments ──

comment on column public.prediction_ledger.prediction_kind is
  'Phase 5 — discriminator: point_value (existing single-distribution forecast) vs trajectory (new per-week distribution). Drives consumer behavior; back-compat default is point_value.';

comment on column public.prediction_ledger.target_entity_id is
  'Phase 5 — KG entity this prediction is about. Was implicit via tracker_id+metric_label; now explicit so consumers (entity-detail drawer, calibration path) can attach without joining metric_trackers.';

comment on column public.prediction_ledger.intervention_id is
  'Phase 5 — the intervention whose activation triggered this prediction. Null for predictions emitted from other paths (ad-hoc agents, pipeline-level forecasts).';

comment on column public.prediction_ledger.predicted_trajectory is
  'Phase 5 — JSONB array of per-week distributions: [{week, p10, p50, p90, mean, stddev}, ...]. Populated when prediction_kind=trajectory. Compatible with the time-aware Monte Carlo simulator''s WeeklyTrajectoryEntry shape (Phase 4).';

comment on column public.prediction_ledger.predicted_basis_edge_ids is
  'Phase 5 — UUIDs of edges whose Phase 3 pooled timing produced this prediction. Drives path-aware calibration: when actuals deviate from prediction, the resolver pushes deltas back to these specific edges (not all edges in the space).';

comment on column public.prediction_ledger.predicted_basis_evidence_ids is
  'Phase 5 — evidence_registries.id rows that fed the basis edges'' pools. Lets a surprise tag back-trace to specific source studies — critical for review-mode correction (e.g. "this paper''s peak claim was wrong; mark the row stale and recompute").';

comment on column public.prediction_ledger.actual_trajectory is
  'Phase 5 — JSONB array of repeated-measures observations: [{week, value, n_observed?, source_quote?}, ...]. Populated at resolution. The resolver computes per-week deviation from predicted_trajectory and emits one edge_calibrations row per surprise timepoint.';

comment on column public.prediction_ledger.predicted_simulator is
  'Phase 5 — which simulator produced predicted_trajectory: monte_carlo_discrete (the time-aware Phase 4 engine), monte_carlo_ode, template_seed, or user_curated. Calibration can credit/debit the right engine when surprises happen.';
