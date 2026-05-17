-- ── Pipeline event type CHECK completeness ──────────────────────────
--
-- The pipeline_run_events.event_type CHECK constraint was last expanded
-- on 20260629 (insight_lab). Since then several event-emitting routes
-- have shipped that emit event types not in the constraint set —
-- meaning the insert silently fails when those events fire, killing the
-- whole event batch (the insert is atomic). The painter has handlers
-- for these events, so the canvas already expects them to arrive.
--
-- Verified live emitters (the audit on 2026-05-16 confirmed these
-- routes emit but the DB rejects):
--
--   framing_proposed    src/app/api/pipeline/frame-panel/route.ts
--   framing_approved    src/app/api/spaces/[id]/framing/approve/route.ts
--   framing_selected    src/app/api/spaces/[id]/framing/select/route.ts
--   lab_proposed        src/app/api/pipeline/generate-lab-options/route.ts
--   lab_approved        src/app/api/pipeline/generate-lab-options/route.ts
--   lab_selected        src/app/api/pipeline/generate-lab-options/route.ts
--   image_extracted     src/app/api/ingest/vision-extract/route.ts
--   image_extracted     src/app/api/canvas/materialize-from-image/route.ts
--   pipeline_warning    src/app/api/pipeline/research/route.ts:1075
--   pipeline_error      (twin of pipeline_warning; declared, painter handles)
--
-- This migration is a pure constraint expansion — additive, idempotent
-- (drop+add), no data migration needed. Safe to apply to live data:
-- existing rows already conform to the smaller set, so the new wider
-- set will accept them too.

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
    'reasoning_chunk',
    -- Probability-space choreography
    'space_opened',
    'space_entity_added',
    'space_edge_added',
    'cross_space_link',
    'space_merge_begin',
    'space_merge_complete',
    'axis_scored',
    'axis_failed',
    -- Cross-domain structural analogy
    'structural_analog_found',
    'target_outcome_identified',
    'signature_deepened',
    'taxonomy_inferred',
    'variant_proposed',
    'root_cause_identified',
    'why_chain_deepened',
    'strategy_consensus_ready',
    'layer_coverage_gap',
    'measurement_coverage_gap',
    -- Sprint B narrative row bands
    'app_result_ready',
    'iv_decomposition_ready',
    'variant_deck_ready',
    'causal_stage_ready',
    -- Situation analyzer summary
    'situation_analyzed',
    -- Asset upload
    'asset_added',
    -- Memory context
    'memory_context_loaded',
    -- Community detection
    'community_detected',
    -- KG generation plan flow
    'kg_plan_proposed',
    'kg_plan_edited',
    'kg_plan_approved',
    'kg_plan_rejected',
    'layer_ontology_materialized',
    -- Phase 2 (research-strategy) — gaps + contradictions
    'triangulation_gap',
    'contradiction_found',
    -- Phase 6 (Insight Lab, 20260629)
    'lab_step_started',
    'lab_insight_emitted',
    'lab_score_recorded',
    -- Phase 7 (this migration) — framing diverge-converge gate
    'framing_proposed',
    'framing_approved',
    'framing_selected',
    -- Phase 7 — lab diverge-converge gate
    'lab_proposed',
    'lab_approved',
    'lab_selected',
    -- Phase 7 — image ingestion (vision extractor)
    'image_extracted',
    -- Phase 7 — pipeline-level warnings/errors surfaced to the chrome
    -- error banner. pipeline_warning is currently emitted from
    -- research/route.ts:1075; pipeline_error is declared and painter-
    -- handled in anticipation of routes that need a fatal signal.
    'pipeline_warning',
    'pipeline_error'
  ));
