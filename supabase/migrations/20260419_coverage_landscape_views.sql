-- Coverage landscape views
--
-- Phase-B Reflexive Loop foundation. Exposes pre-aggregated coverage signals
-- that the blind-spot detector + calibration HUD + landscape storyteller
-- consume through one API call rather than re-aggregating on every render.
--
-- Depends on: 20260418_coverage_depth_metadata.sql

-- ── Dimension coverage matrix ──
-- For each space × each of the 9 edge dimensions, how many pair-checks have
-- explicitly considered that dimension? This answers "which relationship types
-- are we systematically blind to?"
drop view if exists space_dimension_coverage;
create view space_dimension_coverage as
with dim_rows as (
  select
    c.space_id,
    unnest(c.dimensions_examined) as dimension,
    c.examination_level,
    c.edge_proposed,
    c.checked_at
  from pairwise_connection_checks c
  where c.dimensions_examined is not null
    and array_length(c.dimensions_examined, 1) > 0
)
select
  space_id,
  dimension,
  count(*)                                                        as pair_checks,
  count(*) filter (where edge_proposed = true)                    as edges_found,
  count(*) filter (where examination_level >= 2)                  as level_2_plus,
  avg(examination_level)::numeric(4,2)                            as avg_examination_level,
  max(checked_at)                                                 as last_check_at
from dim_rows
group by space_id, dimension;

-- ── Category-pair coverage matrix ──
-- For each space × each (category_A, category_B) pair, coverage stats.
-- Normalized so (concrete, abstract) and (abstract, concrete) count as one bucket.
drop view if exists space_category_pair_coverage;
create view space_category_pair_coverage as
select
  c.space_id,
  least(ea.entity_category, eb.entity_category)                   as category_a,
  greatest(ea.entity_category, eb.entity_category)                as category_b,
  count(*)                                                        as pair_checks,
  count(*) filter (where c.edge_proposed = true)                  as edges_found,
  count(*) filter (where c.examination_level >= 2)                as level_2_plus,
  count(*) filter (where c.user_verdict = 'accepted')             as user_accepted,
  count(*) filter (where c.user_verdict = 'rejected')             as user_rejected,
  max(c.checked_at)                                               as last_check_at
from pairwise_connection_checks c
join entities ea on ea.id = c.entity_a_id
join entities eb on eb.id = c.entity_b_id
group by c.space_id,
         least(ea.entity_category, eb.entity_category),
         greatest(ea.entity_category, eb.entity_category);

-- ── Examination-level distribution ──
-- How much of our "coverage" is actually superficial (L1) vs dimensional (L2+)
-- vs evidence-grounded (L3+)?  This is the one stat that separates "we checked"
-- from "we examined."
drop view if exists space_examination_distribution;
create view space_examination_distribution as
select
  c.space_id,
  c.examination_level,
  count(*)                                                        as pair_checks,
  count(*) filter (where c.edge_proposed = true)                  as edges_found,
  avg(c.negative_confidence)
    filter (where c.edge_proposed = false)                        as avg_negative_confidence
from pairwise_connection_checks c
group by c.space_id, c.examination_level;

-- ── Calibration per dimension ──
-- When the prospector proposes a causal edge, how often does the user keep it?
-- This is the self-learning signal — each row answers "how well-calibrated is
-- the prospector for this specific dimension?"
drop view if exists space_calibration_by_dimension;
create view space_calibration_by_dimension as
with proposed as (
  select
    c.space_id,
    e.dimension,
    c.user_verdict
  from pairwise_connection_checks c
  join edges e on e.id = c.resulting_edge_id
  where c.edge_proposed = true
    and c.resulting_edge_id is not null
)
select
  space_id,
  dimension,
  count(*)                                                        as proposed_count,
  count(*) filter (where user_verdict = 'accepted')               as accepted_count,
  count(*) filter (where user_verdict = 'rejected')               as rejected_count,
  count(*) filter (where user_verdict is null)                    as unreviewed_count,
  (count(*) filter (where user_verdict = 'accepted'))::numeric
    / nullif(
        count(*) filter (where user_verdict is not null),
        0
      )                                                           as acceptance_rate
from proposed
group by space_id, dimension;

-- ── High-value uncovered pairs ──
-- Pairs that SHOULD have been checked but haven't been — ranked by potential
-- value. Uses entity importance and connection_search_count to surface
-- "entities the prospector has never looked at next to hub nodes."
--
-- This is the "self-aware blind-spot detector" — it doesn't just list
-- unchecked pairs, it ranks them by how embarrassing it would be to miss
-- a real connection there.
create or replace function high_value_uncovered_pairs(
  target_space_id uuid,
  limit_count integer default 20
) returns table (
  entity_a_id uuid,
  entity_a_name text,
  entity_b_id uuid,
  entity_b_name text,
  priority_score numeric,
  reason text
) as $$
begin
  return query
  with entities_in_space as (
    select * from entities where space_id = target_space_id
  ),
  -- Score each entity: hub bonus + importance bonus + "under-searched" bonus
  entity_priority as (
    select
      e.id,
      e.name,
      e.entity_id,
      e.entity_category,
      -- Higher centrality_rank (closer to 1) = more important structurally
      coalesce(1.0 / nullif(e.centrality_rank, 0), 0.5)            as centrality_weight,
      case e.importance
        when 'fundamental' then 1.0
        when 'critical'    then 0.8
        when 'important'   then 0.5
        else                    0.3
      end                                                          as importance_weight,
      -- Entities with low search counts are undersampled
      1.0 / greatest(e.connection_search_count + 1, 1)::numeric   as under_searched_weight
    from entities_in_space e
  ),
  -- Existing pair coverage (either direction)
  checked_pairs as (
    select pair_key from pairwise_connection_checks
    where space_id = target_space_id
  ),
  -- Existing edges (another form of coverage)
  existing_edges as (
    select
      case when source_entity_id < target_entity_id
        then source_entity_id || '::' || target_entity_id
        else target_entity_id || '::' || source_entity_id
      end as pair_key
    from edges where space_id = target_space_id
  ),
  -- Candidate uncovered pairs (different categories, not already checked, not already edged)
  candidates as (
    select
      a.id                                                          as a_id,
      a.name                                                        as a_name,
      a.entity_category                                             as a_category,
      b.id                                                          as b_id,
      b.name                                                        as b_name,
      b.entity_category                                             as b_category,
      a.centrality_weight * a.importance_weight
        + b.centrality_weight * b.importance_weight
        + 0.3 * (a.under_searched_weight + b.under_searched_weight) as priority_score,
      case
        when a.entity_category <> b.entity_category then
          'Cross-category pair: ' || a.entity_category || ' ↔ ' || b.entity_category
        else
          'Within-category hub pair'
      end                                                           as reason
    from entity_priority a
    cross join entity_priority b
    where a.id < b.id
      and not exists (
        select 1 from checked_pairs
        where pair_key = a.id::text || '::' || b.id::text
      )
      and not exists (
        select 1 from existing_edges
        where pair_key = a.id::text || '::' || b.id::text
      )
  )
  select a_id, a_name, b_id, b_name, priority_score, reason
  from candidates
  order by priority_score desc
  limit limit_count;
end;
$$ language plpgsql stable;
