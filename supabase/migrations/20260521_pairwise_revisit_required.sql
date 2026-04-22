-- Phase 1 Step 6 — Checklist invalidation.
--
-- Prior migrations established pairwise_connection_checks as a
-- rich record: examination_level, dimensions_examined, reasoning,
-- revisit_trigger (free-text). But once a pair was examined, there was
-- no programmatic way to flag it for revisit when new context arrived.
-- `revisit_trigger` was advisory prose ("if new evidence on X appears")
-- that required manual re-invocation.
--
-- This column is the executable complement: any insertion/mutation of
-- entities or edges that changes a pair's 2-hop neighborhood flips
-- `revisit_required = true`, and the prospector's queue treats those
-- rows as high-priority re-checks alongside never-checked pairs.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'pairwise_connection_checks'
      and column_name = 'revisit_required'
  ) then
    alter table public.pairwise_connection_checks
      add column revisit_required boolean not null default false;
  end if;
end $$;

-- Reason the row was flagged — one of:
--   'neighbor_added'    — an entity adjacent to this pair's endpoints was inserted
--   'dimension_uncovered' — critique identified a new relevant dimension
--   'deviation_detected'  — a prediction on the causal chain resolved with surprise
-- Nullable because legacy rows pre-date the flag.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'pairwise_connection_checks'
      and column_name = 'revisit_reason'
  ) then
    alter table public.pairwise_connection_checks
      add column revisit_reason text;
  end if;
end $$;

-- Timestamp for when the revisit flag was last raised — supports
-- age-based priority in the prospector queue.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'pairwise_connection_checks'
      and column_name = 'revisit_flagged_at'
  ) then
    alter table public.pairwise_connection_checks
      add column revisit_flagged_at timestamptz;
  end if;
end $$;

-- Partial index so "pairs awaiting revisit" queries don't scan the
-- full table. Only rows with revisit_required=true hit this index.
create index if not exists idx_pairwise_revisit_required
  on public.pairwise_connection_checks(space_id, revisit_flagged_at desc nulls last)
  where revisit_required = true;
