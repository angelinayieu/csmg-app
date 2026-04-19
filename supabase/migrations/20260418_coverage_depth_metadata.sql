-- Coverage depth metadata
--
-- Upgrades `pairwise_connection_checks` from binary (checked/unchecked) to
-- an epistemically richer record. This is the foundation for breadth-vs-depth
-- strategy, staleness-aware coverage, dimensional coverage matrices, and
-- calibration tracking.
--
-- All new columns are nullable with sensible defaults so existing rows
-- (and the current prospector behavior) stay valid.
--
-- Depends on: 20260417_coverage_tracking.sql (which created the table).

-- ── Examination level (0-4) ──
-- 0 = unexamined (default — present only if a row was pre-inserted)
-- 1 = breadth_scan       — coarse yes/no/maybe pass, 1 LLM call per ~20 pairs
-- 2 = dimensional_sweep  — explicit consideration of each edge dimension (current prospector baseline)
-- 3 = evidence_grounded  — claims attached, external sources reviewed
-- 4 = user_validated     — human has confirmed or overridden the verdict
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_name = 'pairwise_connection_checks' and column_name = 'examination_level') then
    alter table pairwise_connection_checks add column examination_level integer not null default 1
      check (examination_level between 0 and 4);
  end if;
end $$;

-- ── Negative-result confidence ──
-- When edge_proposed=false, how confident are we that there's truly no edge?
-- 1.0 = certain; 0.5 = unsure / absence of evidence; 0 = flip if asked again.
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_name = 'pairwise_connection_checks' and column_name = 'negative_confidence') then
    alter table pairwise_connection_checks add column negative_confidence numeric check (negative_confidence is null or (negative_confidence >= 0 and negative_confidence <= 1));
  end if;
end $$;

-- ── Dimensions explicitly examined ──
-- Which of the 9 edge dimensions were explicitly considered on this pass?
-- Empty array = "unknown which dimensions were considered" (legacy rows).
-- A breadth_scan might populate just ["quick_screen"]; a dimensional_sweep
-- should populate all 9: structural, functional, temporal, causal,
-- correlational, logical, epistemic, comparative, agentive.
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_name = 'pairwise_connection_checks' and column_name = 'dimensions_examined') then
    alter table pairwise_connection_checks add column dimensions_examined text[] default '{}'::text[];
  end if;
end $$;

-- ── Revisit trigger ──
-- Free-form text describing what would flip this verdict. e.g.:
--   "if new evidence on X domain appears"
--   "revisit after entity Y is decomposed"
-- Null = no revisit heuristic captured.
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_name = 'pairwise_connection_checks' and column_name = 'revisit_trigger') then
    alter table pairwise_connection_checks add column revisit_trigger text;
  end if;
end $$;

-- ── LLM reasoning snippet ──
-- Store the LLM's per-pair reasoning (1-3 sentences) even when no edge is found.
-- This is what separates "examined carefully" from "examined perfunctorily".
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_name = 'pairwise_connection_checks' and column_name = 'reasoning') then
    alter table pairwise_connection_checks add column reasoning text;
  end if;
end $$;

-- ── User verdict (calibration tracking) ──
-- If the user reviews a prospector-proposed edge:
--   'accepted' — user kept the edge
--   'rejected' — user deleted the edge
--   'uncertain' — user marked it for follow-up
-- Null = user hasn't reviewed.
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_name = 'pairwise_connection_checks' and column_name = 'user_verdict') then
    alter table pairwise_connection_checks add column user_verdict text
      check (user_verdict is null or user_verdict in ('accepted', 'rejected', 'uncertain'));
  end if;

  if not exists (select 1 from information_schema.columns
    where table_name = 'pairwise_connection_checks' and column_name = 'user_verdict_at') then
    alter table pairwise_connection_checks add column user_verdict_at timestamptz;
  end if;
end $$;

-- ── Indexes to support future strategy-agent queries ──
-- "Give me pairs I haven't examined at level 2 yet, weighted by entity importance"
-- "Give me negative verdicts older than 30 days with revisit_trigger populated"
create index if not exists idx_pairwise_checks_examination_level
  on pairwise_connection_checks(space_id, examination_level, checked_at desc);

create index if not exists idx_pairwise_checks_user_verdict
  on pairwise_connection_checks(space_id, user_verdict)
  where user_verdict is not null;

create index if not exists idx_pairwise_checks_revisit
  on pairwise_connection_checks(space_id, checked_at asc)
  where revisit_trigger is not null;

-- ── View: coverage stats per space ──
-- Exposes aggregate coverage metrics so future UI + strategy agents have
-- a single canonical data source. Uses the new columns where present;
-- falls back gracefully for legacy rows.
--
-- Dropped-and-recreated (not CREATE OR REPLACE) because column types or
-- names may differ from any partially-applied prior version of this view.
drop view if exists space_coverage_stats;

create view space_coverage_stats as
select
  c.space_id,
  count(*)                                                          as total_checks,
  count(*) filter (where c.edge_proposed = true)                    as edges_proposed,
  count(*) filter (where c.edge_proposed = false)                   as no_edge_verdicts,
  count(*) filter (where c.examination_level >= 2)                  as level_2_plus,
  count(*) filter (where c.examination_level >= 3)                  as level_3_plus,
  count(*) filter (where c.user_verdict is not null)                as user_reviewed,
  count(*) filter (where c.user_verdict = 'rejected')               as user_rejected,
  avg(c.negative_confidence) filter (where c.edge_proposed = false) as avg_negative_confidence,
  max(c.checked_at)                                                 as last_check_at,
  -- Calibration signal: fraction of proposed edges the user kept.
  -- NULLIF on denominator makes the division yield NULL (not error) when no user
  -- has reviewed any proposed edges yet.
  (count(*) filter (where c.edge_proposed = true and c.user_verdict = 'accepted'))::numeric
    / nullif(
        count(*) filter (where c.edge_proposed = true and c.user_verdict is not null),
        0
      )                                                             as prospector_acceptance_rate
from pairwise_connection_checks c
group by c.space_id;

-- ── Helper function: effective coverage with time decay ──
-- Returns a pair's effective coverage level after applying an age-based decay.
-- Fresh check at level 2 → 2.0; same check 30 days later with 30-day half-life → ~1.0.
create or replace function effective_coverage_level(
  raw_level integer,
  checked_at timestamptz,
  half_life_days integer default 60
) returns numeric as $$
declare
  age_days numeric;
begin
  if raw_level is null or checked_at is null then
    return 0;
  end if;
  age_days := extract(epoch from (now() - checked_at)) / 86400.0;
  return raw_level::numeric * exp(-age_days / greatest(half_life_days, 1));
end;
$$ language plpgsql immutable;
