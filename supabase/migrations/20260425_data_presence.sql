-- ── Data-presence classification on spaces ───────────────────────────
--
-- Adds two columns to spaces that feed the new DataPresenceClassifier
-- stage (slotted between rigor-intake and frame-extractor):
--
--   twin_mode      — TEXT, one of 'structural' | 'observational' | 'simulation' | null
--                    Drives downstream capability gating:
--                      structural    = user has only an idea/description
--                      observational = user brought historical/measured data
--                      simulation    = user brought telemetry + wants to run twin
--                    null means classifier hasn't run yet (pre-intake, legacy rows).
--
--   data_presence  — JSONB, the full tag bundle from the classifier:
--                      { has_telemetry, has_historical_output, has_baseline,
--                        has_spec, has_just_idea, data_presence_score,
--                        evidence_excerpts: string[], classified_at }
--
-- These are orthogonal to existing columns (`domain`, `tier`,
-- `synthesis_data`, `rigor_score` etc.) — see exploration memo
-- 2026-04-25 — rigor-intake's landscape_coverage measures analysis
-- QUALITY while data_presence measures intake ASSET INVENTORY.
--
-- Both columns default null so legacy spaces remain readable. Frame-
-- extractor soft-fails to the all-8-axis behavior when data_presence
-- is null, matching pre-migration semantics exactly.

alter table public.spaces
  add column if not exists twin_mode text;

alter table public.spaces
  add column if not exists data_presence jsonb;

-- Narrow enum-like check — reject garbage values but allow null.
-- Keeps the column safe even if a future code path forgets to
-- classify before writing.
alter table public.spaces
  drop constraint if exists spaces_twin_mode_check;

alter table public.spaces
  add constraint spaces_twin_mode_check
  check (twin_mode is null or twin_mode in ('structural', 'observational', 'simulation'));

-- No index on twin_mode today — we don't filter spaces by mode yet.
-- Add one when a list view surfaces it.

comment on column public.spaces.twin_mode is
  'Digital-twin readiness tier derived from intake data-presence. structural = idea-only; observational = historical data present; simulation = live telemetry present. null = classifier has not run.';

comment on column public.spaces.data_presence is
  'Full DataPresenceClassifier output. Shape: { has_telemetry, has_historical_output, has_baseline, has_spec, has_just_idea, data_presence_score, evidence_excerpts, classified_at }. Consumed by frame-extractor to gate axis selection.';
