-- ── Interventions — temporal columns ────────────────────────────────
--
-- Phase 4 of the temporal-rigor plan. Adds onset/peak/persistence_days
-- + temporal_confidence to the interventions table so the strategy
-- drawer + cards can display "expected at week N (CI: ...)" alongside
-- effort/impact/timeframe.
--
-- DESIGN
--
-- Mirror the per-edge timing model on a per-intervention basis. An
-- intervention's primary effect path is its `target_entity_id`'s
-- incoming edges; the temporal data on that path is what determines
-- when the intervention is expected to manifest. The
-- `app-generator` (the upstream producer of intervention rows) is
-- responsible for populating these columns from the dominant edge's
-- {onset,peak,persistence}_days_p50 + the pool's
-- temporal_evidence_count + heterogeneity_i2 (Phase 3).
--
-- The pre-existing categorical `timeframe` enum (now / short_term /
-- medium_term / long_term) is RETAINED for back-compat with consumers
-- that haven't adopted the numeric columns. New consumers should
-- prefer the numeric columns and treat `timeframe` as a coarse
-- fallback when peak_days is null. A separate follow-up will derive
-- `timeframe` automatically from peak_days when both are populated.
--
-- COLUMNS
--
--   onset_days          — days from intervention start to first
--                          measurable effect on target.
--   peak_days           — days from start to maximum effect on target.
--   persistence_days    — days the effect persists after intervention
--                          stops.
--   temporal_confidence — 0..1 derived from the path's
--                          temporal_evidence_count + heterogeneity_i2
--                          + extraction_method mix. Drives a UI badge
--                          ("based on N studies, agreement: X%").
--   temporal_basis_edge_id
--                       — the edge whose pooled timing fed these
--                          columns. Lets the drawer link "click to see
--                          source studies for the timing claim."
--
-- All nullable; existing rows continue to validate. New consumers
-- check for null and fall back to `timeframe`.

alter table public.interventions
  add column if not exists onset_days numeric,
  add column if not exists peak_days numeric,
  add column if not exists persistence_days numeric,
  add column if not exists temporal_confidence numeric,
  add column if not exists temporal_basis_edge_id uuid;

-- ── Constraints ──

-- Non-negative timings.
alter table public.interventions
  drop constraint if exists interventions_temporal_nonneg_check;
alter table public.interventions
  add constraint interventions_temporal_nonneg_check
  check (
    (onset_days is null or onset_days >= 0)
    and (peak_days is null or peak_days >= 0)
    and (persistence_days is null or persistence_days >= 0)
  );

-- Confidence in [0, 1].
alter table public.interventions
  drop constraint if exists interventions_temporal_confidence_check;
alter table public.interventions
  add constraint interventions_temporal_confidence_check
  check (
    temporal_confidence is null
    or (temporal_confidence >= 0 and temporal_confidence <= 1)
  );

-- temporal_basis_edge_id FK → edges. Nullable. ON DELETE SET NULL so
-- removing an edge doesn't cascade-delete interventions; the temporal
-- columns just go null and the intervention falls back to qualitative
-- timeframe.
alter table public.interventions
  drop constraint if exists interventions_temporal_basis_edge_fk;
alter table public.interventions
  add constraint interventions_temporal_basis_edge_fk
  foreign key (temporal_basis_edge_id) references public.edges(id)
  on delete set null;

-- ── Index ──

-- Drives the strategy drawer's "interventions sorted by time-to-effect"
-- view. Partial so untimed rows don't bloat the index.
create index if not exists interventions_peak_days_idx
  on public.interventions (space_id, peak_days)
  where peak_days is not null;

-- ── Comments ──

comment on column public.interventions.onset_days is
  'Phase 4 — pooled days from intervention start to first measurable effect on target_entity_id. Sourced from the temporal_basis_edge_id''s edges.onset_days_p50. Null when no temporal evidence has been pooled for the relevant edge; consumers fall back to the categorical `timeframe`.';

comment on column public.interventions.peak_days is
  'Phase 4 — pooled days from start to peak effect. Drives the UI''s "expected at week N" badge and the strategizer''s time_to_outcome signal at intervention level.';

comment on column public.interventions.persistence_days is
  'Phase 4 — pooled days the effect persists after the intervention stops. Combined with the path''s decay_kinetics_modal in trajectory simulation.';

comment on column public.interventions.temporal_confidence is
  'Phase 4 — confidence in the temporal claim, 0..1. Derived from temporal_evidence_count, heterogeneity_i2, and the extraction-method mix on the basis edge''s pool. High when many studies agree (low I², high evidence count, mostly stated_explicitly extractions). Drives a UI badge.';

comment on column public.interventions.temporal_basis_edge_id is
  'Phase 4 — the edge whose Phase 3 temporal pool populated this intervention''s timing fields. Lets the UI link "click to see the source studies for the timing claim" and lets the recompute service skip reprocessing interventions whose basis edge hasn''t changed.';
