-- ── Expand pipeline_run_events.event_type CHECK to cover every
--    StructuralEvent the backend actually emits ──
--
-- The previous expansion (20260526_event_type_expansions) only
-- widened for Phase 2E · Tier 2 + Phase 2H. Since then several
-- workstreams added new event types to src/types/pipeline-events.ts
-- without a corresponding migration:
--
--   • Phase 1.4           — axis_scored
--   • Phase 3 §4.1        — target_outcome_identified
--   • Batch 7             — signature_deepened
--   • VP Project Phase 3  — taxonomy_inferred, variant_proposed
--   • Root-cause tree     — root_cause_identified, why_chain_deepened
--   • Strategy consensus  — strategy_consensus_ready
--   • Layer coverage      — layer_coverage_gap
--   • Sprint B row bands  — app_result_ready, iv_decomposition_ready,
--                           variant_deck_ready, causal_stage_ready
--
-- Symptom: every batch insert that contained one of these types was
-- rejected by the CHECK constraint. Because Supabase inserts are
-- all-or-nothing on CHECK violation, the ENTIRE batch fails — so
-- sibling events (even already-allowed ones like space_opened) never
-- persist either. The SSE endpoint streams from
-- pipeline_run_events, so the canvas painter receives nothing and
-- the whiteboard stays empty until stage_boundary lands later in
-- the run. Symptom from the user's perspective: "my cards are
-- gone, nothing renders."
--
-- Fix: rebuild the CHECK constraint with the full StructuralEvent
-- union. Single source of truth lives in src/types/pipeline-events.ts
-- — any future event types need both a type union entry AND an entry
-- in this list (consider a codegen step later).
--
-- Existing rows are unaffected; this only widens what's allowed.

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
    -- Target outcome (Phase 3 §4.1)
    'target_outcome_identified',
    -- Node signatures (Batch 7)
    'signature_deepened',
    -- VP Project report (Phase 3) — taxonomy + variants
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
