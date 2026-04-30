-- ── edge_calibrations — temporal delta column ────────────────────────
--
-- Phase 5 of the temporal-rigor plan. Adds `temporal_delta_days` to
-- the existing edge_calibrations audit log so the resolver can record
-- "the predicted peak landed at week 6 but the actual peak was at
-- week 9 — that's a +21-day temporal delta on edge X."
--
-- Why on edge_calibrations: this table already records the
-- magnitude calibration (`delta_strength`, `delta_confidence`) that
-- a prediction-error feedback produces. Temporal calibration is a
-- peer dimension of the same feedback loop — when reality lands at a
-- different time than the model predicted, the per-edge timing
-- estimates need updating. Same audit story (one row per (prediction,
-- edge)), same rollback path (compensating row with negated delta),
-- same drift signal hooks.
--
-- The numerical update path itself (how the delta becomes a Bayesian
-- update on edges.peak_days_p50) lives in the resolver service —
-- this migration just provides the durable substrate.
--
-- COLUMNS
--
--   temporal_delta_days        — actual_peak - predicted_peak in
--                                days. Positive = effect peaked
--                                LATER than expected (model under-
--                                estimated lag); negative = peaked
--                                EARLIER. Null when this calibration
--                                row is magnitude-only (the existing
--                                Phase 6A path always was).
--   temporal_basis_evidence_ids
--                              — TEXT[] of evidence_registries.id
--                                rows that fed the edge's predicted
--                                peak. Lets the rollback path know
--                                which evidence to mark stale on a
--                                supersede event.
--
-- METHOD VOCABULARY
--
-- The existing `method` column had three values: path_aware_v1,
-- heuristic_v1, manual_correction. Phase 5 adds:
--   path_aware_temporal_v1   — temporal feedback from a trajectory
--                              prediction's resolution (this file's
--                              raison d'être). Co-fires with
--                              temporal_delta_days populated.
--
-- BACKWARD COMPAT
--
-- All new columns nullable. Existing rows continue to validate. The
-- Phase 6A magnitude-only calibrator continues to write rows with
-- temporal_delta_days=null and a non-temporal method.

-- ── New columns ──

alter table public.edge_calibrations
  add column if not exists temporal_delta_days numeric,
  add column if not exists temporal_basis_evidence_ids text[]
    not null default '{}'::text[];

-- ── Method enum extension ──

alter table public.edge_calibrations
  drop constraint if exists edge_calibrations_method_check;
alter table public.edge_calibrations
  add constraint edge_calibrations_method_check
  check (
    method in (
      'path_aware_v1',
      'heuristic_v1',
      'manual_correction',
      'path_aware_temporal_v1'
    )
  );

-- ── Indexes ──

-- Recent temporal calibrations per space — drives the temporal
-- equivalent of the "stale model regions" surface (calibration drift
-- temporal signal in the strategizer).
create index if not exists edge_calibrations_temporal_recent_idx
  on public.edge_calibrations (space_id, applied_at desc)
  where temporal_delta_days is not null;

-- Per-edge temporal calibration history — drives the edge-detail
-- drawer's "this edge's predicted peak has shifted" surface.
create index if not exists edge_calibrations_edge_temporal_idx
  on public.edge_calibrations (edge_id, applied_at desc)
  where temporal_delta_days is not null;

-- ── Comments ──

comment on column public.edge_calibrations.temporal_delta_days is
  'Phase 5 — actual_peak_day - predicted_peak_day, in days. Positive = effect landed later than predicted (model underestimated lag). Negative = earlier. Null on magnitude-only calibration rows. Drives Bayesian updates to edges.peak_days_p50 and the calibration_drift_temporal ranker signal.';

comment on column public.edge_calibrations.temporal_basis_evidence_ids is
  'Phase 5 — evidence_registries.id rows that fed the predicted_peak_day pool for this edge. Lets a temporal surprise tag back-trace to source studies; rollback path uses this to mark stale evidence after a supersede event.';

comment on constraint edge_calibrations_method_check on public.edge_calibrations is
  'Phase 5 — extends the v1 method vocab with path_aware_temporal_v1 (resolver-driven temporal feedback). Old methods remain valid.';
