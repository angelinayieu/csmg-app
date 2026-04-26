-- ── Add `axis_failed` to pipeline_run_events.event_type CHECK ──
--
-- Pipeline audit 2026-04-24: when a probability-space axis generator
-- hard-fails or returns thin output, the canvas shell sat in "opening…"
-- state forever because no event ever signaled the terminal state.
-- Added a new StructuralEvent variant (`AxisFailedEvent`) and the
-- axis route now emits it from both failure branches; this migration
-- widens the DB CHECK so those inserts succeed.
--
-- Existing rows unaffected; this only adds one more allowed value.

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
    -- Axis semantic score (Phase 1.4)
    'axis_scored',
    -- Axis generator failure / thin-output (new — pipeline audit 2026-04-24)
    'axis_failed',
    -- Target outcome (Phase 3 §4.1)
    'target_outcome_identified',
    -- Node signatures (Batch 7)
    'signature_deepened',
    -- VP Project report (Phase 3)
    'taxonomy_inferred',
    'variant_proposed',
    -- Root-cause tree + why-chain deepening
    'root_cause_identified',
    'why_chain_deepened',
    -- Strategy consensus payload
    'strategy_consensus_ready',
    -- Layer coverage gap signal
    'layer_coverage_gap',
    -- Sprint B narrative row bands
    'app_result_ready',
    'iv_decomposition_ready',
    'variant_deck_ready',
    'causal_stage_ready'
  ));
