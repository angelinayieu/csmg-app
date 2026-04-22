-- Tier 6 of the App+Strategy Rigor sprint — deep wiring fixes
--
-- The prior tiers built the SURFACE of the compound improvement loop:
-- per-app sub-strategies, predictor agents, rollups, spec-aware widgets.
-- But the audit revealed three broken joints in the actual data flow:
--
--   (A) Predictions were stringly typed — prediction_ledger.metric_label
--       was the only identity, no FK to knowledge-graph entities. If an
--       entity was deleted or renamed, predictions about its metrics
--       sat orphaned pointing at ghost labels.
--
--   (B) Sub-strategies had no entity backlinks. apps.dominant_entity_ids
--       exists (GIN-indexed, used by flagAppsByEntityChange for cascade
--       staleness). The parallel column on app_strategies was missing,
--       so entity updates flagged apps but not the sub-strategies that
--       were actively consuming those entities' metrics.
--
-- This migration adds those two columns + their GIN indexes, mirroring
-- the apps.dominant_entity_ids pattern exactly. The populate logic
-- (predictor agent + app-strategy-generator) lands in parallel code
-- changes; existing rows default to empty arrays which is safe — all
-- consumers (cascade flagging, aggregate queries) treat empty-array as
-- "no backlinks known" rather than as a match.
--
-- Migration notes:
--   - uuid[] matches the existing dominant_entity_ids column type exactly
--   - GIN index enables `overlaps` / `&&` queries in PostgREST
--   - NOT NULL + default '{}'::uuid[] so the code never has to handle
--     NULL vs empty — always an array
--   - No data backfill: existing predictions/sub-strategies stay empty
--     until regenerated. That's acceptable because the cascade staleness
--     path gracefully no-ops on empty arrays.

-- ── 1. prediction_ledger.entity_ids ─────────────────────────────────────

alter table public.prediction_ledger
  add column if not exists entity_ids uuid[] not null default '{}'::uuid[];

create index if not exists idx_prediction_ledger_entities
  on public.prediction_ledger using gin (entity_ids);

comment on column public.prediction_ledger.entity_ids is
  'Knowledge-graph entity UUIDs this prediction concerns. Populated by '
  'the predictor agent from app.dominant_entity_ids (+ the metric tracker '
  'lineage when clean). Enables cascade staleness when an entity changes '
  'and aggregate queries like "how many predictions reference entity X?"';

-- ── 2. app_strategies.entity_refs ───────────────────────────────────────

alter table public.app_strategies
  add column if not exists entity_refs uuid[] not null default '{}'::uuid[];

create index if not exists idx_app_strategies_entity_refs
  on public.app_strategies using gin (entity_refs);

comment on column public.app_strategies.entity_refs is
  'Knowledge-graph entity UUIDs this sub-strategy depends on — mirrors the '
  'apps.dominant_entity_ids pattern so cascade staleness flags sub-strategies '
  'the same way it flags apps. Populated by app-strategy-generator at '
  'generation time from the parent app + the sub-strategy''s focused_objective '
  'metric tracker lineage.';
