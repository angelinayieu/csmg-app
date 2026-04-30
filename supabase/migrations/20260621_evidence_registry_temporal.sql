-- ── Evidence registry — temporal extraction columns ─────────────────
--
-- Phase 1 of the temporal-rigor plan. Extends evidence_registries with
-- mechanism-timing fields so that temporal claims (onset, peak,
-- persistence, repeated-measures trajectories) sit on the same L2M
-- substrate as effect sizes.
--
-- DESIGN
--
-- Effect-size extraction already encodes magnitude with the trust
-- boundary (LLM labels spans, parser extracts numerics). Temporal
-- extraction is a peer dimension: same lifecycle (pending → extracted
-- → reviewed | rejected | superseded), same review gate, same
-- domain-agnostic vocabulary.
--
-- A row may carry effect-size data, temporal data, both, or neither
-- (the latter shouldn't happen post-extraction, but the schema permits
-- it). The downstream aggregator (Phase 3) keys off
-- attached_entity_id and pulls every reviewed temporal claim a paper
-- contributes for that entity.
--
-- COLUMNS
--
--   onset_days            — days from intervention start to first
--                            measurable effect.
--   peak_days             — days from intervention start to peak
--                            effect (max effect_size). Distinct from
--                            followup_weeks (the measurement window).
--   persistence_days      — days the effect persists after intervention
--                            stops (decay window).
--   *_ci_lower / *_ci_upper — bounds when the paper reports them.
--   decay_kinetics        — qualitative shape of decay
--                            (linear | exponential | sustained |
--                             biphasic | unknown).
--   time_points           — JSONB array of repeated-measures
--                            observations: [{week, effect_size,
--                            ci_lower, ci_upper, n_observed,
--                            source_quote}, …]. For studies that
--                            report a trajectory rather than a single
--                            endpoint.
--   temporal_evidence_quote
--                         — verbatim span the LLM labelled as the
--                            temporal claim. Independent of the
--                            effect-size source_quote (which lives in
--                            the existing column) so a single row can
--                            cite two distinct quotes.
--   temporal_extraction_method
--                         — provenance of how the timing was derived
--                            (stated_explicitly | back_calculated |
--                             inferred_from_design | inferred_from_class).
--                            Strict-mode aggregators filter to
--                            stated_explicitly only.
--   temporal_flags        — parser flags for temporal extraction
--                            (separate from the effect-size `flags`
--                            column so the two halves don't collide).
--   temporal_llm_provenance / temporal_parser_provenance
--                         — L2M trust halves for the temporal
--                            extraction. Independent of the existing
--                            llm_label_provenance / parser_provenance
--                            (which describe the effect-size half) so
--                            both halves of a hybrid extraction are
--                            independently auditable.
--   temporal_extraction_confidence
--                         — combined LLM × parser confidence for the
--                            temporal half. 0..1.
--
-- BACKWARD COMPAT
--
-- All columns nullable. Existing rows continue to validate. Existing
-- consumers ignore the new fields; new consumers (Phase 3 aggregator,
-- Phase 4 ranker, Phase 6 UI) read them additively.

-- ── Mechanism-timing columns ────────────────────────────────────────

alter table public.evidence_registries
  add column if not exists onset_days numeric,
  add column if not exists onset_days_ci_lower numeric,
  add column if not exists onset_days_ci_upper numeric,
  add column if not exists peak_days numeric,
  add column if not exists peak_days_ci_lower numeric,
  add column if not exists peak_days_ci_upper numeric,
  add column if not exists persistence_days numeric,
  add column if not exists persistence_days_ci_lower numeric,
  add column if not exists persistence_days_ci_upper numeric,
  add column if not exists decay_kinetics text,
  add column if not exists time_points jsonb,
  add column if not exists temporal_evidence_quote text,
  add column if not exists temporal_extraction_method text,
  add column if not exists temporal_flags text[] not null default '{}'::text[],
  add column if not exists temporal_llm_provenance jsonb,
  add column if not exists temporal_parser_provenance jsonb,
  add column if not exists temporal_extraction_confidence numeric;

-- ── Constraints ──

-- decay_kinetics open-vocabulary check. Soft so future kinetic
-- categories (e.g. "logistic", "delayed_onset_then_decay") can be
-- added without DDL changes; current vocabulary enforced.
alter table public.evidence_registries
  drop constraint if exists evidence_registries_decay_kinetics_check;
alter table public.evidence_registries
  add constraint evidence_registries_decay_kinetics_check
  check (
    decay_kinetics is null
    or decay_kinetics in (
      'linear',
      'exponential',
      'sustained',
      'biphasic',
      'unknown'
    )
  );

-- temporal_extraction_method check. Captures how rigorously the
-- timing was derived. Strict-mode pooling filters to
-- stated_explicitly only.
alter table public.evidence_registries
  drop constraint if exists evidence_registries_temporal_method_check;
alter table public.evidence_registries
  add constraint evidence_registries_temporal_method_check
  check (
    temporal_extraction_method is null
    or temporal_extraction_method in (
      'stated_explicitly',
      'back_calculated',
      'inferred_from_design',
      'inferred_from_class'
    )
  );

-- Confidence in [0, 1] when present.
alter table public.evidence_registries
  drop constraint if exists evidence_registries_temporal_conf_check;
alter table public.evidence_registries
  add constraint evidence_registries_temporal_conf_check
  check (
    temporal_extraction_confidence is null
    or (
      temporal_extraction_confidence >= 0
      and temporal_extraction_confidence <= 1
    )
  );

-- Onset / peak / persistence non-negative when present.
alter table public.evidence_registries
  drop constraint if exists evidence_registries_temporal_nonneg_check;
alter table public.evidence_registries
  add constraint evidence_registries_temporal_nonneg_check
  check (
    (onset_days is null or onset_days >= 0)
    and (peak_days is null or peak_days >= 0)
    and (persistence_days is null or persistence_days >= 0)
  );

-- CI bound sanity per timing field (lower ≤ upper when both present).
alter table public.evidence_registries
  drop constraint if exists evidence_registries_onset_ci_check;
alter table public.evidence_registries
  add constraint evidence_registries_onset_ci_check
  check (
    onset_days_ci_lower is null
    or onset_days_ci_upper is null
    or onset_days_ci_lower <= onset_days_ci_upper
  );

alter table public.evidence_registries
  drop constraint if exists evidence_registries_peak_ci_check;
alter table public.evidence_registries
  add constraint evidence_registries_peak_ci_check
  check (
    peak_days_ci_lower is null
    or peak_days_ci_upper is null
    or peak_days_ci_lower <= peak_days_ci_upper
  );

alter table public.evidence_registries
  drop constraint if exists evidence_registries_persistence_ci_check;
alter table public.evidence_registries
  add constraint evidence_registries_persistence_ci_check
  check (
    persistence_days_ci_lower is null
    or persistence_days_ci_upper is null
    or persistence_days_ci_lower <= persistence_days_ci_upper
  );

-- ── Indexes ──

-- Partial index over rows that carry any temporal claim. Drives the
-- aggregator's "every reviewed temporal claim attached to entity X"
-- query without scanning effect-size-only rows.
create index if not exists evidence_registries_has_temporal_idx
  on public.evidence_registries (space_id, attached_entity_id, status)
  where (
    onset_days is not null
    or peak_days is not null
    or persistence_days is not null
    or time_points is not null
  );

-- GIN on temporal_flags so the reviewer drawer can filter by
-- "needs review: lag_back_calculated", "n_observed_inferred", etc.
create index if not exists evidence_registries_temporal_flags_gin_idx
  on public.evidence_registries using gin (temporal_flags);

-- "Pending temporal review" partial index. Mirrors the existing
-- evidence_registries_pending_review_idx but scoped to temporal-only
-- rows (rows with temporal data that have not yet been reviewed).
create index if not exists evidence_registries_temporal_pending_review_idx
  on public.evidence_registries (space_id, created_at desc)
  where status = 'extracted'
    and reviewed_by is null
    and (
      onset_days is not null
      or peak_days is not null
      or persistence_days is not null
      or time_points is not null
    );

-- ── Comments ──

comment on column public.evidence_registries.onset_days is
  'Mechanism timing — days from intervention start to first measurable effect. Distinct from followup_weeks (which is the measurement window). Null when not reported, back-calculated, or inferred (see temporal_extraction_method).';

comment on column public.evidence_registries.peak_days is
  'Mechanism timing — days from intervention start to peak effect. Used by Phase 4 trajectory simulation to ramp the edge''s contribution to its plateau.';

comment on column public.evidence_registries.persistence_days is
  'Mechanism timing — days the effect persists after intervention stops (decay window). Combined with decay_kinetics to model washout in trajectory simulation.';

comment on column public.evidence_registries.decay_kinetics is
  'Qualitative shape of decay after intervention stops: linear | exponential | sustained | biphasic | unknown. Used by Phase 4 simulator to pick a decay function (linear ramp vs exponential half-life vs no decay vs two-phase).';

comment on column public.evidence_registries.time_points is
  'Repeated-measures trajectory: JSONB array of [{week, effect_size, ci_lower, ci_upper, n_observed, source_quote}]. Populated when a study reports outcomes at multiple timepoints (e.g. T0/T4/T8/T12). The aggregator can fit a curve to these instead of relying on a single peak_days estimate.';

comment on column public.evidence_registries.temporal_evidence_quote is
  'Verbatim span the LLM labelled as the temporal claim. Independent of the effect-size source_quote so a single row can cite two distinct quotes (one for magnitude, one for timing). Required by the L2M discipline.';

comment on column public.evidence_registries.temporal_extraction_method is
  'Provenance of how the timing was derived. stated_explicitly: paper says "improvements began at week 2". back_calculated: derived from reported timepoints + curve fit. inferred_from_design: derived from study followup window when no within-trial timing reported. inferred_from_class: defaulted from intervention class kinetics. Strict-mode aggregators filter to stated_explicitly only.';

comment on column public.evidence_registries.temporal_flags is
  'Parser flags raised by the temporal extractor (independent of the existing `flags` column, which is for effect-size flags). Examples: lag_back_calculated, peak_inferred_from_design, repeated_measures_partial, units_ambiguous_days_vs_weeks.';

comment on column public.evidence_registries.temporal_llm_provenance is
  'L2M trust boundary, LLM half — for the temporal extraction. Same shape as llm_label_provenance ({model, prompt_hash, span_id, raw_label, llm_confidence}) but scoped to the timing label.';

comment on column public.evidence_registries.temporal_parser_provenance is
  'L2M trust boundary, parser half — for the temporal extraction. Same shape as parser_provenance ({module, version, rule_fired, raw_match, flags[]}) but scoped to the timing parse.';

comment on column public.evidence_registries.temporal_extraction_confidence is
  'Combined LLM × parser confidence for the temporal half. 0..1. Independent of extraction_confidence (which is the effect-size half) so the reviewer can see a hybrid row''s temporal half rated low while its magnitude half is rated high.';
