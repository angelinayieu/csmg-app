-- ── Expand pipeline_run_events.event_type CHECK for taxonomy + variant ──
--
-- Paired with 20260422_experiment_taxonomies.sql. The domain-inferrer
-- emits `taxonomy_inferred` at end-of-intake so the canvas painter
-- spawns a taxonomy-card shape; variant_factory emits
-- `variant_proposed` each time a new variant lands so the carousel
-- can animate a card flying onto the deck.
--
-- Same soft-fail trap as 20260526: without widening the CHECK, these
-- events would be silently dropped and the UI would stay empty.

alter table public.pipeline_run_events
  drop constraint if exists pipeline_run_events_event_type_check;

alter table public.pipeline_run_events
  add constraint pipeline_run_events_event_type_check
  check (event_type in (
    -- Core structural stream (20260520)
    'stage_boundary',
    'entity_added',
    'edge_added',
    'cycle_detected',
    'bridge_formed',
    'proposal_ready',
    'source_cited',
    'prediction_recorded',
    -- Streaming reasoning trace (20260521)
    'reasoning_chunk',
    -- Probability-space choreography (Phase 2E · Tier 2)
    'space_opened',
    'space_entity_added',
    'space_edge_added',
    'cross_space_link',
    'space_merge_begin',
    'space_merge_complete',
    -- Cross-domain structural analogy (Phase 2H)
    'structural_analog_found',
    -- VP Project report (Phase 3 — experiment taxonomies)
    'taxonomy_inferred',
    'variant_proposed'
  ));
