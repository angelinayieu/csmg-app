-- Feedback collection for convergent points
-- Each convergent point can be marked by the user as "useful", "noise", or
-- "inaccurate". The aggregator rolls votes up to their pattern via
-- structural_signature, enabling a feedback-aware library: patterns with
-- many "noise" votes get de-prioritized; "inaccurate" votes surface where
-- the LLM's predictions are systematically wrong.

alter table public.convergent_points
  add column if not exists user_feedback text,
  add column if not exists feedback_note text,
  add column if not exists feedback_at timestamptz;

-- Constraint: NULL (no feedback) or one of the three labels
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'convergent_points_user_feedback_check'
  ) then
    alter table public.convergent_points
      add constraint convergent_points_user_feedback_check
      check (user_feedback is null or user_feedback in ('useful', 'noise', 'inaccurate'));
  end if;
end $$;

-- Partial index: find unaggregated feedback quickly (for incremental rollup)
create index if not exists convergent_points_feedback_idx on public.convergent_points (feedback_at)
  where user_feedback is not null;

-- ── Pattern library: vote counters ──
alter table public.pattern_library
  add column if not exists useful_votes int not null default 0,
  add column if not exists noise_votes int not null default 0,
  add column if not exists inaccurate_votes int not null default 0;

-- Derived quality signal kept as a real column so clients can sort/filter
-- without reading JSONB. Computed as: useful_votes / max(1, all_votes).
-- Updated by the aggregator, never directly by users.
alter table public.pattern_library
  add column if not exists feedback_quality_score real;

create index if not exists pattern_library_feedback_quality_idx on public.pattern_library (feedback_quality_score desc nulls last)
  where feedback_quality_score is not null;
