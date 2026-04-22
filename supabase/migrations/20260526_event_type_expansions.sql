-- ── Expand pipeline_run_events.event_type CHECK for new event types ──
--
-- Since 20260521 added `reasoning_chunk`, two parallel workstreams
-- landed new event types in the StructuralEvent union without
-- touching the DB constraint:
--
--   • Phase 2E · Tier 2 (probability space shells + merge) added:
--       space_opened, space_entity_added, space_edge_added,
--       cross_space_link, space_merge_begin, space_merge_complete
--
--   • Phase 2H (cross-domain structural analogy) added:
--       structural_analog_found
--
-- Without this migration each INSERT of the new types is silently
-- rejected by the CHECK (the event-bus emitter is soft-fail by
-- design). Canvas overlays subscribe to these event names and stay
-- blank forever. Rebroadcasting the existing constraint with the
-- full enum is the only safe fix.
--
-- Existing rows are unaffected — this only widens what's allowed.

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
    'structural_analog_found'
  ));
