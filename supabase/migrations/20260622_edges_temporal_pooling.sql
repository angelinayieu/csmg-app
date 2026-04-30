-- ── Edges — temporal pooling columns ──────────────────────────────
--
-- Phase 3 of the temporal-rigor plan. Activates the dormant temporal
-- substrate on edges by adding precision-weighted aggregates of
-- onset / peak / persistence pulled from evidence_registries via
-- the temporal-pooler service.
--
-- DESIGN
--
-- Mirror of the existing magnitude pipeline:
--
--   Effect-size half (already shipped, Phase 6A):
--     evidence_registries.effect_size + ci → recompute-edge-strengths
--     → edges.strength + edges.dynamics_properties.pooling_metadata.
--
--   Temporal half (this migration + Phase 3 service):
--     evidence_registries.{onset,peak,persistence}_days + ci →
--     recompute-edge-temporals → edges.{onset,peak,persistence}_days_*
--     + edges.dynamics_properties.temporal_pooling_metadata.
--
-- SCALAR COLUMNS (top-level, for fast strategizer + simulator queries)
--
-- The Monte Carlo and what-if endpoints pull from `edges` directly;
-- they shouldn't have to JSONB-pluck every per-edge timing value
-- 1000× per simulation. Scalar columns are indexable and ergonomic in
-- pgAdmin / drawer raw views.
--
--   p50  — pooled point estimate (REML random-effects mean)
--   p10  — μ - 1.282·SE  (matches subject_experiments.outcome_summary
--                          which already uses p10/p50/p90)
--   p90  — μ + 1.282·SE
--   evidence_count — how many evidence rows participated
--   heterogeneity_i2 — I² across studies (0..1 scale; 0=homogeneous)
--   decay_kinetics_modal — most-common decay shape across rows
--   evidence_ids — text[] of evidence_registries.id rows that fed
--                   the pool. Drives the "where did this come from"
--                   citation chip in the edge detail drawer.
--
-- JSONB METADATA (under dynamics_properties.temporal_pooling_metadata)
--
-- Full per-component {pooled_effect, pooled_se, pooled_ci_lower,
-- pooled_ci_upper, tau_squared, n_studies, evidence_row_ids,
-- weighting_method}. Lets reviewers reconstruct the pool without
-- re-querying evidence_registries.
--
-- BACKWARD COMPAT
--
-- The pre-existing `edges.temporal_validity` JSONB column (added
-- 20260408_temporal_validity.sql) had ZERO writes anywhere in the
-- codebase but is read by the critic prompt and a few UI surfaces
-- (node-detail, edge-explanation-popover) for `decay_rate` /
-- `temporal_scope`. We keep the column to avoid breaking those
-- readers, and the temporal-pooler service writes a derived
-- `decay_rate` (mapped from decay_kinetics_modal) so existing
-- consumers see live data for the first time.
--
-- All new columns nullable. Existing edge rows continue to validate
-- and existing readers ignore the new fields until the pooler runs.

-- ── Scalar pooling columns ────────────────────────────────────────

alter table public.edges
  -- Onset (days from intervention start to first measurable effect)
  add column if not exists onset_days_p50 numeric,
  add column if not exists onset_days_p10 numeric,
  add column if not exists onset_days_p90 numeric,

  -- Peak (days from intervention start to maximum effect)
  add column if not exists peak_days_p50 numeric,
  add column if not exists peak_days_p10 numeric,
  add column if not exists peak_days_p90 numeric,

  -- Persistence (days the effect lasts after intervention stops)
  add column if not exists persistence_days_p50 numeric,
  add column if not exists persistence_days_p10 numeric,
  add column if not exists persistence_days_p90 numeric,

  -- Decay shape — most common across rows. Same vocabulary as
  -- evidence_registries.decay_kinetics: linear | exponential |
  -- sustained | biphasic | unknown.
  add column if not exists decay_kinetics_modal text,

  -- Aggregate health metrics
  add column if not exists temporal_evidence_count integer not null default 0,
  add column if not exists temporal_heterogeneity_i2 numeric,

  -- Citation array — text[] of evidence_registries.id rows that
  -- contributed to the pool. Drives the edge-detail drawer's
  -- "supporting timing claims" list.
  add column if not exists temporal_evidence_ids text[] not null default '{}'::text[],

  -- Audit
  add column if not exists temporal_pooled_at timestamptz;

-- ── Constraints ──

-- decay_kinetics_modal open-vocab check (mirrors evidence_registries).
alter table public.edges
  drop constraint if exists edges_decay_kinetics_modal_check;
alter table public.edges
  add constraint edges_decay_kinetics_modal_check
  check (
    decay_kinetics_modal is null
    or decay_kinetics_modal in (
      'linear',
      'exponential',
      'sustained',
      'biphasic',
      'unknown'
    )
  );

-- I² is a proportion in [0, 1]. Allow 0 (homogeneous) up to 1 (max
-- heterogeneity). Above-1 values are math errors.
alter table public.edges
  drop constraint if exists edges_temporal_i2_check;
alter table public.edges
  add constraint edges_temporal_i2_check
  check (
    temporal_heterogeneity_i2 is null
    or (temporal_heterogeneity_i2 >= 0 and temporal_heterogeneity_i2 <= 1)
  );

-- Non-negative timings.
alter table public.edges
  drop constraint if exists edges_temporal_nonneg_check;
alter table public.edges
  add constraint edges_temporal_nonneg_check
  check (
    (onset_days_p50 is null or onset_days_p50 >= 0)
    and (peak_days_p50 is null or peak_days_p50 >= 0)
    and (persistence_days_p50 is null or persistence_days_p50 >= 0)
  );

-- Percentile ordering: p10 ≤ p50 ≤ p90 when all three are present.
-- Soft (only when ALL three present) so a partially-populated pool
-- (e.g. n=1 study with no SE) doesn't trip on null bounds.
alter table public.edges
  drop constraint if exists edges_onset_percentile_check;
alter table public.edges
  add constraint edges_onset_percentile_check
  check (
    onset_days_p10 is null
    or onset_days_p50 is null
    or onset_days_p90 is null
    or (
      onset_days_p10 <= onset_days_p50
      and onset_days_p50 <= onset_days_p90
    )
  );

alter table public.edges
  drop constraint if exists edges_peak_percentile_check;
alter table public.edges
  add constraint edges_peak_percentile_check
  check (
    peak_days_p10 is null
    or peak_days_p50 is null
    or peak_days_p90 is null
    or (
      peak_days_p10 <= peak_days_p50
      and peak_days_p50 <= peak_days_p90
    )
  );

alter table public.edges
  drop constraint if exists edges_persistence_percentile_check;
alter table public.edges
  add constraint edges_persistence_percentile_check
  check (
    persistence_days_p10 is null
    or persistence_days_p50 is null
    or persistence_days_p90 is null
    or (
      persistence_days_p10 <= persistence_days_p50
      and persistence_days_p50 <= persistence_days_p90
    )
  );

-- ── Indexes ──

-- Edges with any pooled timing data. Drives strategizer's
-- time_to_outcome signal and the simulator's edge-loading query
-- without scanning untimed edges.
create index if not exists edges_has_temporal_pool_idx
  on public.edges (space_id, peak_days_p50)
  where peak_days_p50 is not null;

-- Citation lookup: "find all edges that cite evidence row X" — used
-- when the reviewer rejects a row and we need to mark dependent
-- edges stale.
create index if not exists edges_temporal_evidence_ids_gin_idx
  on public.edges using gin (temporal_evidence_ids);

-- ── Comments ──

comment on column public.edges.onset_days_p50 is
  'Pooled median (p50) days from intervention start to first measurable effect. REML random-effects mean across reviewed evidence_registries rows attached to either endpoint. Null when no temporal evidence has been pooled. Peer of edges.strength (which is the magnitude half).';

comment on column public.edges.peak_days_p50 is
  'Pooled median days from intervention start to peak effect. Drives the trajectory simulator''s ramp-to-peak curve and the strategizer''s time_to_outcome signal. p10/p90 widen with study-level heterogeneity (τ² > 0).';

comment on column public.edges.persistence_days_p50 is
  'Pooled median days the effect persists after intervention stops. Combined with decay_kinetics_modal to choose a decay function in trajectory simulation (linear ramp vs exponential half-life vs no decay).';

comment on column public.edges.decay_kinetics_modal is
  'Most-common decay shape across pooled evidence rows. Same vocabulary as evidence_registries.decay_kinetics (linear | exponential | sustained | biphasic | unknown). Tie-break: alphabetical, with a flag in dynamics_properties.temporal_pooling_metadata.kinetics_tied = true.';

comment on column public.edges.temporal_heterogeneity_i2 is
  'I² heterogeneity statistic across pooled rows (0..1 scale, where 0 = perfectly homogeneous, 1 = max heterogeneity). I² > 0.5 typically warrants surfacing as "studies disagree on this timing." Computed alongside τ² in the REML fit.';

comment on column public.edges.temporal_evidence_count is
  'Count of evidence_registries rows that contributed to the pool. n=1 ⇒ single-study estimate (CIs reflect within-study uncertainty only). n≥3 ⇒ between-study τ² is meaningful.';

comment on column public.edges.temporal_evidence_ids is
  'evidence_registries.id values that fed the pool. Drives the edge-detail drawer''s citation chip ("peak: 6 weeks, n=4 studies, click to see") and lets a reviewer trace the pool back to source PDFs. Mirrors edges.literature_sources but at the timing-claim grain.';

comment on column public.edges.temporal_pooled_at is
  'When the pool was last computed. Used by the recompute service to decide whether to re-pool after evidence-registry changes (newer evidence → stale pool).';
