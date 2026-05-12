-- ── Entities: value_directionality ──────────────────────────────────────
--
-- Direction-of-improvement classifier. Today the UI infers this by
-- parsing free text in metric_trackers.green_reading vs red_reading,
-- which is fragile and non-queryable. After this migration:
--
--   higher_better  — improvement = increase (BDNF, working memory, sleep)
--   lower_better   — improvement = decrease (cortisol, fatigue, hsCRP)
--   bidirectional  — both directions can be problematic OR the
--                    "improvement" direction depends on context
--                    (heart rate, weight, blood pressure can be too
--                    high OR too low; the right direction depends
--                    on the patient's current value relative to
--                    healthy_range)
--
-- Read by:
--   - aggregate-environment-definition.ts → StateVariable.value_directionality
--   - reward function: when target > baseline, the goal direction must
--     match the entity's value_directionality (warn on mismatch:
--     "your goal increases cortisol but cortisol is lower_better")
--   - UI: color thresholds (green when moving in directionality,
--     red when moving against)
--   - mediator-proposal-engine (planned): propagate directionality
--     through chain analysis to flag pathways whose end-state is
--     directionally incoherent

alter table public.entities
  add column if not exists value_directionality text;

alter table public.entities
  drop constraint if exists entities_value_directionality_check;

alter table public.entities
  add constraint entities_value_directionality_check
  check (
    value_directionality is null
    or value_directionality in (
      'higher_better',
      'lower_better',
      'bidirectional'
    )
  );

create index if not exists entities_value_directionality_idx
  on public.entities (space_id, value_directionality)
  where value_directionality is not null;

comment on column public.entities.value_directionality is
  'Direction of improvement: higher_better (BDNF), lower_better (cortisol), bidirectional (heart rate — context-dependent). Replaces fragile free-text parsing of green_reading/red_reading thresholds. Read by reward consistency checks and UI threshold coloring.';
