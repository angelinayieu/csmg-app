-- ── Twin Detail Page bundle cache ──────────────────────────────────
--
-- The Twin Detail Page (/app/space/[id]/twin) needs 7+ data sources
-- in a single payload: twin_state, synthesis, entities/edges/cycles,
-- layer_ontology, mechanisms with aggregated layer_distribution,
-- latest_proposal + diff, active_goal, pain_metrics, prediction
-- history, twin_diagnostics, and LLM-narrated summary + coach
-- recommendation.
--
-- Caching avoids re-aggregating mechanism layer_distribution +
-- re-running Narrator/Coach agents on every page load. TTL: 5
-- minutes. Invalidated explicitly on key writes (observation
-- logged, narrator refreshed, mechanism materialized).
--
-- 5 min is short enough that twin-state stays fresh, long enough
-- that browser-tab re-focus doesn't burn LLM tokens.

alter table public.spaces
  add column if not exists twin_dashboard_cache jsonb;

alter table public.spaces
  add column if not exists twin_dashboard_cache_at timestamptz;

-- Lookup pattern: "is this space's cache fresh?" — predicate query.
-- Partial index keeps it small (most spaces have null cache).
create index if not exists idx_spaces_twin_cache_at
  on public.spaces(twin_dashboard_cache_at)
  where twin_dashboard_cache_at is not null;
