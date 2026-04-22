-- ── Domain learning curves (Phase 2I — calibration tracking) ──
--
-- Per-user, per-domain proficiency measurements. One row every time
-- the user finishes a meaningful pipeline run on a space (or on an
-- explicit re-measure request). Over time the series forms a
-- learning curve: coverage rises, calibration improves, novelty
-- falls off as the user's domain knowledge stabilizes.
--
-- Why this lives in its own table (not computed on the fly):
--   • Calibration requires resolved predictions — cheap once, but
--     the query involves joining prediction_ledger → metric_obs →
--     claims → evidence_items. Caching the snapshot keeps the
--     learning panel snappy.
--   • The curve itself is the signal. The agent uses trajectory
--     (measurement[t] vs measurement[t-k]) as input to "should I
--     explore deeper vs explore wider?" decisions.
--   • Cross-space comparisons (user's calibration in business vs
--     medical) matter for routing research-depth defaults.
--
-- Columns are intentionally specific numbers — the agent and UI can
-- read them directly without re-derivation. `raw_features` catches
-- the inputs that produced each metric so a future revision of the
-- formula can recompute historical rows.

create table if not exists domain_learning_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid references spaces(id) on delete cascade,

  -- Coarse domain taxonomy — matches CoarseDomain in
  -- src/lib/research/source-strategy.ts. Free-text column so new
  -- domains can land without a schema migration; validated at write
  -- time by the endpoint.
  domain text not null,

  -- ── Core metrics, all in [0, 1] ──
  -- Coverage: fraction of important entities that have been analyzed
  -- (analysis_count > 0) and/or carry non-null evidence_strength.
  coverage_depth numeric(6, 4) not null default 0,

  -- Calibration: mean of 1 - |deviation| over resolved predictions
  -- within this user+domain. NULL when the user has no resolved
  -- predictions yet — the agent treats NULL as "unknown calibration"
  -- rather than "0 calibration".
  calibration_score numeric(6, 4),

  -- Novelty rate: fraction of entities in this space not seen in
  -- the user's prior domain spaces. Falls as the user revisits
  -- the same concepts; a curve heading toward 0 means the domain
  -- is saturating for this user.
  novelty_rate numeric(6, 4) not null default 1,

  -- Citation density: evidence_items per entity (capped at 5, then
  -- normalized). Higher = more grounded work in this space.
  citation_density numeric(6, 4) not null default 0,

  -- Mean reliability_prior of the evidence backing this space.
  mean_evidence_reliability numeric(6, 4),

  -- Raw inputs for the formulas above — lets a later metric version
  -- recompute without refiring the pipeline.
  entity_count int not null default 0,
  analyzed_entity_count int not null default 0,
  evidence_count int not null default 0,
  resolved_prediction_count int not null default 0,
  raw_features jsonb not null default '{}'::jsonb,

  measured_at timestamptz not null default now()
);

-- Reads are almost always "give me this user's trajectory in this
-- domain, newest first". One composite index covers that.
create index if not exists idx_domain_learning_user_domain_time
  on domain_learning_measurements(user_id, domain, measured_at desc);

-- Per-space lookup (e.g., "show the measurement for this space").
create index if not exists idx_domain_learning_space
  on domain_learning_measurements(space_id);

-- RLS: own-only. No cross-user sharing for learning data — unlike
-- kg_signatures (where anonymized signatures are intentional), the
-- calibration history is always personal.
alter table domain_learning_measurements enable row level security;

create policy dlm_select_own on domain_learning_measurements for select
  using (user_id = auth.uid());

create policy dlm_insert_own on domain_learning_measurements for insert
  with check (user_id = auth.uid());

create policy dlm_update_own on domain_learning_measurements for update
  using (user_id = auth.uid());

create policy dlm_delete_own on domain_learning_measurements for delete
  using (user_id = auth.uid());

-- Convenience view: latest measurement per (user, domain). The
-- learning panel's rollup table reads from here instead of
-- recomputing max(measured_at) joins every render.
create or replace view user_domain_rollup as
  select distinct on (user_id, domain)
    user_id,
    domain,
    space_id as latest_space_id,
    coverage_depth,
    calibration_score,
    novelty_rate,
    citation_density,
    mean_evidence_reliability,
    entity_count,
    analyzed_entity_count,
    evidence_count,
    resolved_prediction_count,
    measured_at
  from domain_learning_measurements
  order by user_id, domain, measured_at desc;

-- View inherits RLS from the base table — users see only their own
-- rows automatically.
